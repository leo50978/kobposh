const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("node:crypto");

if (!process.env.FIREBASE_CONFIG) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID || "";
  if (projectId) {
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
  }
}

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

const CLIENTS_COLLECTION = "clients";
const PONG_ALLOWED_STAKES = new Set([100, 500]);
const PONG_ODDS_NUMERATOR = 19;
const PONG_ODDS_DENOMINATOR = 10;
const PONG_ACTIVE_WAGER_STALE_MS = 30 * 60 * 1000;

function safeInt(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  const safeFallback = Number(fallback);
  return Number.isFinite(safeFallback) ? Math.max(0, Math.floor(safeFallback)) : 0;
}

function safeSignedInt(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) {
    return Math.trunc(n);
  }
  const safeFallback = Number(fallback);
  return Number.isFinite(safeFallback) ? Math.trunc(safeFallback) : 0;
}

function sanitizeText(value, maxLength = 160) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function assertAuth(request) {
  const uid = String(request.auth?.uid || "").trim();
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }
  const email = String(request.auth?.token?.email || "").trim();
  return { uid, email };
}

function walletRef(uid) {
  return db.collection(CLIENTS_COLLECTION).doc(uid);
}

function walletHistoryRef(uid) {
  return walletRef(uid).collection("xchanges");
}

function buildFrozenAccountError(walletData = {}) {
  return new HttpsError(
    "failed-precondition",
    "Ton compte a ete temporairement gele apres plusieurs depots refuses. Les depots et retraits sont bloques. Contacte l'assistance.",
    {
      code: "account-frozen",
      accountFrozen: true,
      freezeReason: String(walletData.freezeReason || walletData.withdrawalHoldReason || "3_rejected_deposits"),
      rejectedDepositStrikeCount: safeInt(walletData.rejectedDepositStrikeCount),
    }
  );
}

function assertWalletNotFrozen(walletData = {}) {
  if (walletData?.accountFrozen === true || walletData?.withdrawalHold === true) {
    throw buildFrozenAccountError(walletData);
  }
}

exports.startPongWagerSecure = onCall({ cors: true }, async (request) => {
  const { uid, email } = assertAuth(request);
  const payload = request.data && typeof request.data === "object" ? request.data : {};
  const stakeDoes = safeInt(payload.stakeDoes);

  if (!PONG_ALLOWED_STAKES.has(stakeDoes)) {
    throw new HttpsError("invalid-argument", "Mise Pong non autorisee.");
  }

  const nowMs = Date.now();
  const requestedSessionId = sanitizeText(payload.sessionId || "", 120);
  const sessionId = requestedSessionId || `pongw_${nowMs.toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const rewardDoes = Math.floor((stakeDoes * PONG_ODDS_NUMERATOR) / PONG_ODDS_DENOMINATOR);
  const clientDocRef = walletRef(uid);

  return db.runTransaction(async (tx) => {
    const clientSnap = await tx.get(clientDocRef);
    const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
    const currentWager = clientData.pongWagerState && typeof clientData.pongWagerState === "object"
      ? clientData.pongWagerState
      : {};

    const isActive = String(currentWager.status || "").trim().toLowerCase() === "active";
    const activeSessionId = sanitizeText(currentWager.sessionId || "", 120);
    const activeLastEventAtMs = Math.max(
      safeSignedInt(currentWager.lastEventAtMs, 0),
      safeSignedInt(currentWager.startedAtMs, 0)
    );
    const activeWagerExpired = activeLastEventAtMs > 0
      ? (nowMs - activeLastEventAtMs) >= PONG_ACTIVE_WAGER_STALE_MS
      : false;
    if (isActive && activeSessionId && !activeWagerExpired) {
      throw new HttpsError("failed-precondition", "Une mise Pong est deja en cours.", {
        code: "active-pong-wager",
        sessionId: activeSessionId,
      });
    }

    assertWalletNotFrozen(clientData);

    const beforeDoes = safeInt(clientData.doesBalance);
    if (stakeDoes > beforeDoes) {
      throw new HttpsError("failed-precondition", "Solde Does insuffisant.");
    }

    const beforeApprovedDoes = safeInt(
      typeof clientData.doesApprovedBalance === "number"
        ? clientData.doesApprovedBalance
        : beforeDoes - safeInt(clientData.doesProvisionalBalance)
    );
    const beforeProvisionalDoes = safeInt(clientData.doesProvisionalBalance);
    const beforePendingFromXchange = safeInt(clientData.pendingPlayFromXchangeDoes);
    const beforePendingFromReferral = safeInt(clientData.pendingPlayFromReferralDoes);
    const beforePendingFromWelcome = safeInt(clientData.pendingPlayFromWelcomeDoes);
    const beforeExchangeableDoes = safeInt(
      typeof clientData.exchangeableDoesAvailable === "number"
        ? clientData.exchangeableDoesAvailable
        : beforeApprovedDoes
    );
    const beforeExchanged = safeSignedInt(clientData.exchangedGourdes);
    const beforeWelcomeBonusHtgAvailable = safeInt(clientData.welcomeBonusHtgAvailable);
    const beforeWelcomeBonusHtgConverted = safeInt(clientData.welcomeBonusHtgConverted);
    const beforeWelcomeBonusHtgPlayed = safeInt(clientData.welcomeBonusHtgPlayed);
    const beforeTotalExchangedEver = safeInt(clientData.totalExchangedHtgEver);

    const provisionalSpentDoes = Math.min(beforeProvisionalDoes, stakeDoes);
    const approvedSpentDoes = Math.max(0, stakeDoes - provisionalSpentDoes);

    const afterProvisionalDoes = Math.max(0, beforeProvisionalDoes - provisionalSpentDoes);
    const afterApprovedDoes = Math.max(0, beforeApprovedDoes - approvedSpentDoes);
    const afterDoes = afterApprovedDoes + afterProvisionalDoes;

    let pendingXchange = beforePendingFromXchange;
    let pendingReferral = beforePendingFromReferral;
    let pendingWelcome = beforePendingFromWelcome;
    let playedApprovedDoes = approvedSpentDoes;
    let consumedXchangeDoes = 0;
    let consumedReferralDoes = 0;
    let consumedWelcomeDoes = 0;
    let welcomeBonusHtgPlayed = beforeWelcomeBonusHtgPlayed;

    if (playedApprovedDoes > 0 && pendingXchange > 0) {
      const consumeXchange = Math.min(playedApprovedDoes, pendingXchange);
      pendingXchange -= consumeXchange;
      playedApprovedDoes -= consumeXchange;
      consumedXchangeDoes += consumeXchange;
    }
    if (playedApprovedDoes > 0 && pendingReferral > 0) {
      const consumeReferral = Math.min(playedApprovedDoes, pendingReferral);
      pendingReferral -= consumeReferral;
      playedApprovedDoes -= consumeReferral;
      consumedReferralDoes += consumeReferral;
    }
    if (playedApprovedDoes > 0 && pendingWelcome > 0) {
      const consumeWelcome = Math.min(playedApprovedDoes, pendingWelcome);
      pendingWelcome -= consumeWelcome;
      playedApprovedDoes -= consumeWelcome;
      consumedWelcomeDoes += consumeWelcome;
      welcomeBonusHtgPlayed += Math.floor(consumeWelcome / 20);
    }

    let exchangeableDoes = beforeExchangeableDoes;
    if (pendingWelcome > 0) {
      exchangeableDoes = 0;
    } else if ((pendingXchange + pendingReferral + pendingWelcome) <= 0) {
      exchangeableDoes = safeInt(afterApprovedDoes);
    } else {
      exchangeableDoes = Math.min(
        safeInt(afterApprovedDoes),
        safeInt(beforeExchangeableDoes + consumedXchangeDoes + consumedReferralDoes)
      );
    }

    tx.set(clientDocRef, {
      uid,
      email: email || String(clientData.email || ""),
      doesBalance: safeInt(afterDoes),
      doesApprovedBalance: safeInt(afterApprovedDoes),
      doesProvisionalBalance: safeInt(afterProvisionalDoes),
      exchangedGourdes: beforeExchanged,
      exchangeableDoesAvailable: safeInt(exchangeableDoes),
      pendingPlayFromXchangeDoes: safeInt(pendingXchange),
      pendingPlayFromReferralDoes: safeInt(pendingReferral),
      pendingPlayFromWelcomeDoes: safeInt(pendingWelcome),
      welcomeBonusHtgAvailable: safeInt(beforeWelcomeBonusHtgAvailable),
      welcomeBonusHtgConverted: safeInt(beforeWelcomeBonusHtgConverted),
      welcomeBonusHtgPlayed: safeInt(welcomeBonusHtgPlayed),
      totalExchangedHtgEver: safeInt(beforeTotalExchangedEver),
      pongWagerState: {
        sessionId,
        status: "active",
        stakeDoes,
        rewardDoes,
        startedAtMs: nowMs,
        lastEventAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });

    tx.set(walletHistoryRef(uid).doc(), {
      uid,
      email: email || String(clientData.email || ""),
      type: "game_entry",
      note: `Mise Pong (${sessionId})`,
      amountGourdes: 0,
      amountDoes: stakeDoes,
      deltaDoes: -stakeDoes,
      deltaExchangedGourdes: 0,
      beforeDoes: safeInt(beforeDoes),
      afterDoes: safeInt(afterDoes),
      beforeExchangedGourdes: beforeExchanged,
      afterExchangedGourdes: beforeExchanged,
      beforePendingPlayFromXchangeDoes: safeInt(beforePendingFromXchange),
      afterPendingPlayFromXchangeDoes: safeInt(pendingXchange),
      beforePendingPlayFromReferralDoes: safeInt(beforePendingFromReferral),
      afterPendingPlayFromReferralDoes: safeInt(pendingReferral),
      beforePendingPlayFromWelcomeDoes: safeInt(beforePendingFromWelcome),
      afterPendingPlayFromWelcomeDoes: safeInt(pendingWelcome),
      beforeExchangeableDoesAvailable: safeInt(beforeExchangeableDoes),
      afterExchangeableDoesAvailable: safeInt(exchangeableDoes),
      beforeApprovedDoesBalance: safeInt(beforeApprovedDoes),
      afterApprovedDoesBalance: safeInt(afterApprovedDoes),
      beforeProvisionalDoesBalance: safeInt(beforeProvisionalDoes),
      afterProvisionalDoesBalance: safeInt(afterProvisionalDoes),
      beforeWelcomeBonusHtgAvailable: safeInt(beforeWelcomeBonusHtgAvailable),
      afterWelcomeBonusHtgAvailable: safeInt(beforeWelcomeBonusHtgAvailable),
      beforeWelcomeBonusHtgConverted: safeInt(beforeWelcomeBonusHtgConverted),
      afterWelcomeBonusHtgConverted: safeInt(beforeWelcomeBonusHtgConverted),
      beforeWelcomeBonusHtgPlayed: safeInt(beforeWelcomeBonusHtgPlayed),
      afterWelcomeBonusHtgPlayed: safeInt(welcomeBonusHtgPlayed),
      gameEntryFunding: {
        approvedDoes: safeInt(approvedSpentDoes),
        provisionalDoes: safeInt(provisionalSpentDoes),
        welcomeDoes: safeInt(consumedWelcomeDoes),
        provisionalSources: [],
      },
      provisionalConversion: {
        consumedGourdes: 0,
        consumedDoes: 0,
        sources: [],
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
    });

    return {
      ok: true,
      sessionId,
      stakeDoes,
      rewardDoes,
      does: safeInt(afterDoes),
    };
  });
});
