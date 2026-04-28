import { auth, db, collection, getDocs, limit, onAuthStateChanged, orderBy, query, where } from "../firebase-init.js";
import { formatAuthError, isValidEmail, isValidPhoneLogin, isValidUsername, loginWithEmail, loginWithPhone, loginWithUsername, signupWithPhone, syncCurrentUserDisplayName } from "../auth.js";
import {
  createFriendMorpionRoomSecure,
  getDepositFundingStatusSecure,
  getMyGameHistorySecure,
  joinFriendMorpionRoomByCodeSecure,
} from "../secure-functions.js";
import { mountTransferModal } from "../transfer.js";
import { buildWhatsappUrlForKey, getWhatsappContactLabel } from "../whatsapp-modal-config.js";
import PaymentModal from "../payment.js";

document.documentElement.classList.add("kobposh-ready");

if (window.lucide) {
  window.lucide.createIcons();
}

mountTransferModal({ triggerSelector: "#kobposhTransferBtn", theme: "kobposh" });

const isPublicView = new URLSearchParams(window.location.search).get("view") === "public";

const HERO_ROTATION_MS = 5000;
const BALANCE_REFRESH_MS = 2 * 60 * 1000;
let heroRotationTimer = null;
let balanceRefreshTimer = null;
const gamesModal = document.querySelector("[data-games-modal]");
const openGamesModalBtn = document.querySelector("[data-open-games-modal]");
const closeGamesModalBtn = document.querySelector("[data-close-games-modal]");
const openDepositModalBtns = document.querySelectorAll("[data-open-deposit-modal]");
const withdrawalQuickBtn = document.querySelector("#kobposhWithdrawalBtn");
const supportQuickBtn = document.querySelector("#kobposhSupportBtn");
const balanceEl = document.querySelector("[data-kobposh-balance]");
const recentMatchesEl = document.querySelector("[data-kobposh-recent-matches]");
const authScreenEl = document.querySelector("[data-kobposh-auth-screen]");
const loginFormEl = document.querySelector("[data-kobposh-login-form]");
const loginIdentifierEl = document.querySelector("[data-kobposh-login-identifier]");
const loginPasswordEl = document.querySelector("[data-kobposh-login-password]");
const loginErrorEl = document.querySelector("[data-kobposh-login-error]");
const signupToggleBtn = document.querySelector("[data-kobposh-open-signup]");
const loginFieldsEl = document.querySelector("[data-kobposh-login-fields]");
const signupFieldsEl = document.querySelector("[data-kobposh-signup-fields]");
const signupUsernameEl = document.querySelector("[data-kobposh-signup-username]");
const signupPhoneEl = document.querySelector("[data-kobposh-signup-phone]");
const signupPasswordEl = document.querySelector("[data-kobposh-signup-password]");
const signupPasswordConfirmEl = document.querySelector("[data-kobposh-signup-password-confirm]");
const signupAgeEl = document.querySelector("[data-kobposh-signup-age]");
const signupTermsEl = document.querySelector("[data-kobposh-signup-terms]");
const authCardTitleEl = document.querySelector(".auth-screen__title");
const authCardSubtitleEl = document.querySelector(".auth-screen__subtitle");
const authSubmitBtn = document.querySelector(".auth-screen__button");
const accountLabelEl = document.querySelector("[data-kobposh-account-label]");
const passwordToggleBtns = document.querySelectorAll("[data-kobposh-toggle-password]");
let authMode = "login";
let depositModal = null;
let depositAmountInput = null;
let depositAmountSummary = null;
let depositErrorEl = null;
let depositSubmitBtn = null;
let activePaymentModal = null;
let stakeModal = null;
let stakeAmountSummary = null;
let stakeErrorEl = null;
let stakeSubmitBtn = null;
let stakeSummaryLabelEl = null;
let activeGameKey = "";
let selectedGameStake = 100;
let selectedGameMode = "";
let selectedGameAltFlow = "";
let selectedGameFundingCurrency = "htg";
let stakeModalStage = "amount";
let morpionFriendRoomDraft = {
  roomId: "",
  seatIndex: 0,
  stakeDoes: 500,
  inviteCode: "",
};
let withdrawalAgentModal = null;
let historyModal = null;
const historyModalState = {
  rows: [],
  offset: 0,
  pageSize: 3,
  hasMore: true,
  loading: false,
};

const WITHDRAWAL_AGENT_CONTACTS = [
  {
    key: "withdrawal_assistance",
    title: "Agent retrait",
    role: "Retrait / suivi",
    note: "Contacte cet agent pour un retrait rapide.",
    message: "Bonjou, mwen bezwen fè yon retrè sou kont mwen.",
  },
  {
    key: "agent_deposit",
    title: "Support secours",
    role: "Assistance générale",
    note: "Si l'agent retrait ne répond pas, contacte le support.",
    message: "Bonjou, mwen bezwen asistans pou yon retrè sou kont mwen.",
  },
];

const HTG_PER_DOES_RATE = 20;

function buildGameLaunchHref(pathname = "", stakeDoes = 0, fundingCurrency = "does") {
  const params = new URLSearchParams();
  const safeStakeDoes = Math.max(0, Number.parseInt(String(stakeDoes || 0), 10) || 0);
  params.set("stake", String(safeStakeDoes));
  if (String(fundingCurrency || "").trim().toLowerCase() === "htg" && safeStakeDoes > 0 && safeStakeDoes % HTG_PER_DOES_RATE === 0) {
    params.set("fundingCurrency", "htg");
    params.set("stakeHtg", String(Math.floor(safeStakeDoes / HTG_PER_DOES_RATE)));
  }
  return `${pathname}?${params.toString()}`;
}

const GAME_LAUNCH_CONFIG = {
  domino: {
    title: "DOMINO",
    label: "Domino",
    description: "Chwazi kantite HTG ou vle mete pou kòmanse yon pati Domino.",
    image: "./domino.png",
    selectionType: "mode",
    modes: [
      {
        value: "classic",
        label: "Domino 4 player",
        summary: "4 joueurs",
        amounts: [100, 250, 500, 1000],
        htgAmounts: [100, 500, 1000],
        buildHref: (amount, fundingCurrency = "does") => buildGameLaunchHref("../jeu.html", amount, fundingCurrency),
      },
      {
        value: "duel",
        label: "Domino 2 player",
        summary: "2 joueurs",
        amounts: [500, 1000],
        htgAmounts: [500, 1000],
        buildHref: (amount, fundingCurrency = "does") => buildGameLaunchHref("../jeu-duel.html", amount, fundingCurrency),
      },
    ],
  },
  morpion: {
    title: "MOPYON",
    label: "Mopyon",
    description: "Chwazi kantite HTG ou vle jwe pou Mopyon.",
    image: "./mopyon.png",
    amounts: [500],
    htgAmounts: [500],
    buildHref: (amount, fundingCurrency = "does") => buildGameLaunchHref("../morpion.html", amount, fundingCurrency),
    altAction: {
      label: "Jwe ak yon ami",
      title: "Mopyon antre amis",
      description: "Chwazi kijan ou vle antre nan salon prive Mopyon an.",
      options: [
        {
          value: "friend_join",
          label: "Mwen resevwa yon envitasyon",
        },
        {
          value: "friend_create",
          label: "Kreye yon salon",
        },
      ],
    },
  },
  dame: {
    title: "DAME",
    label: "Dame",
    description: "Chwazi kantite HTG ou vle mete pou Dame.",
    image: "./dame.png",
    amounts: [100, 250, 500, 1000],
    htgAmounts: [100, 500, 1000],
    buildHref: (amount, fundingCurrency = "does") => buildGameLaunchHref("../dame.html", amount, fundingCurrency),
  },
  pong: {
    title: "PONG",
    label: "Pong",
    description: "Chwazi kantite HTG ou vle jwe pou Pong.",
    image: "./pong.png",
    amounts: [100, 500],
    htgAmounts: [100, 500],
    buildHref: (amount, fundingCurrency = "does") => buildGameLaunchHref("../pong.html", amount, fundingCurrency),
  },
};

const GAME_HISTORY_SOURCES = [
  { collectionName: "roomResults", gameLabel: "Domino", gameKey: "domino" },
  { collectionName: "duelRoomResults", gameLabel: "Duel", gameKey: "duel" },
  { collectionName: "morpionRoomResults", gameLabel: "Mopyon", gameKey: "morpion" },
  { collectionName: "dameRoomResults", gameLabel: "Dame", gameKey: "dame" },
  { collectionName: "pongMatchResults", gameLabel: "Pong", gameKey: "pong" },
];

function buildHeroSlides() {
  const track = document.querySelector("[data-kobposh-hero-track]");
  if (!track) return [];

  const slides = [
    { src: "../hero.jpg", alt: "Entèfas Kobposh" },
    { src: "../hero1.jpg", alt: "Entèfas Kobposh 1" },
    { src: "../hero2.jpg", alt: "Entèfas Kobposh 2" },
  ];

  track.replaceChildren();

  slides.forEach((slideData, index) => {
    const slide = document.createElement("div");
    slide.className = "hero-banner__slide";
    slide.setAttribute("data-kobposh-hero-slide", "");
    if (index === 0) slide.classList.add("is-active");
    slide.innerHTML = `
      <img
        src="${slideData.src}"
        alt="${slideData.alt}"
        width="600"
        height="600"
        fetchpriority="${index === 0 ? "high" : "auto"}"
        decoding="async"
      />
    `;
    track.appendChild(slide);
  });

  return Array.from(track.querySelectorAll("[data-kobposh-hero-slide]"));
}

function initHeroRotation() {
  const slides = Array.from(document.querySelectorAll("[data-kobposh-hero-slide]"));
  if (heroRotationTimer) {
    window.clearInterval(heroRotationTimer);
    heroRotationTimer = null;
  }
  if (slides.length === 0) return;

  let activeIndex = slides.findIndex((slide) => slide.classList.contains("is-active"));
  if (activeIndex < 0) activeIndex = 0;

  const render = () => {
    slides.forEach((slide, index) => {
      slide.classList.toggle("is-active", index === activeIndex);
    });
  };

  render();
  if (slides.length === 1) return;

  heroRotationTimer = window.setInterval(() => {
    activeIndex = (activeIndex + 1) % slides.length;
    render();
  }, HERO_ROTATION_MS);
}

function ensureWithdrawalAgentModal() {
  if (withdrawalAgentModal) return withdrawalAgentModal;

  withdrawalAgentModal = document.createElement("section");
  withdrawalAgentModal.id = "kobposhWithdrawalAgentModal";
  withdrawalAgentModal.className = "kobposh-agent-modal hidden";
  withdrawalAgentModal.setAttribute("aria-hidden", "true");
  withdrawalAgentModal.innerHTML = `
    <div class="kobposh-agent-modal__backdrop" data-kobposh-agent-close></div>
    <div class="kobposh-agent-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhAgentTitle">
      <div class="kobposh-agent-modal__header">
        <div class="min-w-0">
          <p class="kobposh-agent-modal__eyebrow">RETRAIT RAPIDE</p>
          <h2 id="kobposhAgentTitle" class="kobposh-agent-modal__title">Contacte un agent en 1 clic</h2>
          <p class="kobposh-agent-modal__subtitle">Chwazi yon ajan pou fè retrè a fèt rapidman.</p>
        </div>
        <button class="kobposh-agent-modal__back" type="button" aria-label="Retour" data-kobposh-agent-close>
          <i data-lucide="arrow-left" class="icon" aria-hidden="true"></i>
        </button>
      </div>

      <div class="kobposh-agent-modal__list">
        ${WITHDRAWAL_AGENT_CONTACTS.map((agent) => {
          const phoneLabel = getWhatsappContactLabel(agent.key);
          const waLink = buildWhatsappUrlForKey(agent.key, agent.message);
          return `
            <a class="kobposh-agent-card" href="${waLink}" target="_blank" rel="noopener noreferrer">
              <div class="kobposh-agent-card__top">
                <div class="min-w-0">
                  <h3 class="kobposh-agent-card__name">${agent.title}</h3>
                  <p class="kobposh-agent-card__role">${agent.role}</p>
                </div>
                <p class="kobposh-agent-card__phone">${phoneLabel || ""}</p>
              </div>
              <div class="kobposh-agent-card__action">
                <span>Ouvrir WhatsApp</span>
                <i data-lucide="message-circle"></i>
              </div>
              <p class="kobposh-agent-card__note">${agent.note}</p>
            </a>
          `;
        }).join("")}
      </div>

      <a class="kobposh-agent-modal__cta" href="./recrutement.html">
        Devenir un agent
      </a>
    </div>
  `;

  document.body.appendChild(withdrawalAgentModal);
  if (window.lucide) {
    window.lucide.createIcons();
  }

  withdrawalAgentModal.addEventListener("click", (event) => {
    if (event.target === withdrawalAgentModal || event.target?.closest?.("[data-kobposh-agent-close]")) {
      closeWithdrawalAgentModal();
    }
  });

  return withdrawalAgentModal;
}

function openWithdrawalAgentModal() {
  const modal = ensureWithdrawalAgentModal();
  modal.classList.remove("hidden");
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeWithdrawalAgentModal() {
  if (!withdrawalAgentModal) return;
  withdrawalAgentModal.classList.add("hidden");
  withdrawalAgentModal.classList.remove("is-open");
  withdrawalAgentModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function getHistoryNetLabel(row) {
  const net = Number(row?.netDoes || 0);
  if (net > 0) return `+${formatMatchAmount(net)}`;
  if (net < 0) return `-${formatMatchAmount(Math.abs(net))}`;
  return "0 HTG";
}

function renderHistoryModalRows() {
  const list = historyModal?.querySelector("[data-kobposh-history-list]");
  const empty = historyModal?.querySelector("[data-kobposh-history-empty]");
  const loadMoreBtn = historyModal?.querySelector("[data-kobposh-history-load-more]");
  const status = historyModal?.querySelector("[data-kobposh-history-status]");
  if (!list || !empty || !loadMoreBtn) return;

  if (status) {
    status.textContent = historyModalState.loading
      ? "Ap chaje..."
      : historyModalState.rows.length
        ? `${historyModalState.rows.length} jwèt`
        : "0 jwèt";
  }

  const visibleRows = historyModalState.rows.slice(0, historyModalState.offset + historyModalState.pageSize);
  if (!visibleRows.length) {
    list.replaceChildren();
    empty.hidden = historyModalState.loading;
    empty.textContent = historyModalState.loading ? "Ap chaje..." : "Pa gen istorik jwèt pou montre.";
    loadMoreBtn.hidden = true;
    return;
  }

  empty.hidden = true;
  list.innerHTML = visibleRows.map((row) => {
    const resultClass = row.won ? "win" : "loss";
    const resultLabel = row.resultLabel || (row.won ? "Genyen" : "Pèdi");
    const metaParts = [
      row.gameLabel || "Jwèt",
      row.scoreLabel ? `Nòt ${row.scoreLabel}` : "",
      row.endedAtMs ? formatMatchDate(row.endedAtMs) : "",
    ].filter(Boolean);

    return `
      <article class="kobposh-history-card">
        <div class="kobposh-history-card__top">
          <div class="min-w-0">
            <h3 class="kobposh-history-card__title">${row.gameLabel || "Jwèt"}</h3>
            <p class="kobposh-history-card__meta">${metaParts.join(" • ")}</p>
          </div>
          <span class="kobposh-history-card__result kobposh-history-card__result--${resultClass}">${resultLabel}</span>
        </div>
        <div class="kobposh-history-card__bottom">
          <span class="kobposh-history-card__amount ${row.netDoes >= 0 ? "is-win" : "is-loss"}">${getHistoryNetLabel(row)}</span>
          <span class="kobposh-history-card__details">Mise ${formatMatchAmount(row.wageredDoes || row.stakeDoes || 0)} · Gain ${formatMatchAmount(row.wonDoes || 0)}</span>
        </div>
      </article>
    `;
  }).join("");

  loadMoreBtn.hidden = !historyModalState.hasMore;
  loadMoreBtn.disabled = historyModalState.loading;
  loadMoreBtn.textContent = historyModalState.loading ? "Ap chaje..." : "Chaje 3 lòt";
}

async function loadHistoryModalPage() {
  const user = auth.currentUser;
  if (!user?.uid || historyModalState.loading) return;
  historyModalState.loading = true;
  renderHistoryModalRows();
  try {
    const payload = await loadRecentMatchesForUser(user.uid, historyModalState.offset, historyModalState.pageSize);
    historyModalState.rows = historyModalState.rows.concat(Array.isArray(payload?.rows) ? payload.rows : []);
    historyModalState.offset += historyModalState.pageSize;
    historyModalState.hasMore = Boolean(payload?.hasMore);
  } catch (error) {
    console.warn("[KOBPOSH] history modal load failed", error);
    historyModalState.hasMore = false;
  } finally {
    historyModalState.loading = false;
    renderHistoryModalRows();
  }
}

function ensureHistoryModal() {
  if (historyModal) return historyModal;

  historyModal = document.createElement("section");
  historyModal.className = "kobposh-history-modal";
  historyModal.setAttribute("aria-hidden", "true");
  historyModal.innerHTML = `
    <div class="kobposh-history-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhHistoryTitle">
      <header class="kobposh-history-modal__header">
        <div>
          <p class="kobposh-history-modal__eyebrow">ISTORIK</p>
          <h2 id="kobposhHistoryTitle" class="kobposh-history-modal__title">Istwa jwèt ou yo</h2>
          <p class="kobposh-history-modal__subtitle">Wè 3 jwèt pa 3 jwèt, ak gan oswa pèt sou chak pati.</p>
        </div>
        <button class="kobposh-history-modal__back" type="button" aria-label="Retour" data-kobposh-history-close>
          <i data-lucide="arrow-left" class="icon" aria-hidden="true"></i>
        </button>
      </header>

      <div class="kobposh-history-modal__content">
        <div class="kobposh-history-modal__summary">
          <span>3 a la fwa</span>
          <strong data-kobposh-history-status>0 jwèt</strong>
        </div>
        <div class="kobposh-history-modal__list" data-kobposh-history-list></div>
        <p class="kobposh-history-modal__empty" data-kobposh-history-empty hidden>Pa gen istorik jwèt pou montre.</p>
        <button class="kobposh-history-modal__more" type="button" data-kobposh-history-load-more>Chaje 3 lòt</button>
      </div>
    </div>
  `;

  document.body.appendChild(historyModal);

  historyModal.addEventListener("click", (event) => {
    if (event.target === historyModal || event.target?.closest?.("[data-kobposh-history-close]")) {
      closeHistoryModal();
    }
  });

  historyModal.querySelector("[data-kobposh-history-load-more]")?.addEventListener("click", () => {
    void loadHistoryModalPage();
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }

  return historyModal;
}

function openHistoryModal() {
  const modal = ensureHistoryModal();
  historyModalState.rows = [];
  historyModalState.offset = 0;
  historyModalState.hasMore = true;
  historyModalState.loading = false;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
  renderHistoryModalRows();
  void loadHistoryModalPage();
}

function closeHistoryModal() {
  if (!historyModal) return;
  historyModal.classList.remove("is-open");
  historyModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function formatDepositAmount(value) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)} HTG`;
}

function formatDoesOnly(value) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)} Does`;
}

function formatHtgOnlyFromDoes(stakeDoes = 0) {
  const amountHtg = Math.floor(Math.max(0, Number.parseInt(String(stakeDoes || 0), 10) || 0) / HTG_PER_DOES_RATE);
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountHtg)} HTG`;
}

function getSelectableStakeOptions(config, activeMode = null, fundingCurrency = "does") {
  if (activeMode) {
    return fundingCurrency === "htg"
      ? (Array.isArray(activeMode.htgAmounts) ? activeMode.htgAmounts : [])
      : (Array.isArray(activeMode.amounts) ? activeMode.amounts : []);
  }
  return fundingCurrency === "htg"
    ? (Array.isArray(config?.htgAmounts) ? config.htgAmounts : [])
    : (Array.isArray(config?.amounts) ? config.amounts : []);
}

function normalizeInviteCode(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function parseStrictWholeNumber(value = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const normalized = String(value || "").trim().replace(/[^\d-]/g, "");
  if (!normalized) return Number.NaN;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isValidMorpionFriendStake(stakeDoes = 0) {
  const safeStake = parseStrictWholeNumber(stakeDoes);
  return Number.isFinite(safeStake) && safeStake >= 500 && safeStake % 100 === 0;
}

function buildPrivateMorpionRewardDoes(stakeDoes = 0) {
  const safeStakeDoes = Math.max(0, Number.parseInt(String(stakeDoes || 0), 10) || 0);
  if (safeStakeDoes <= 0) return 0;
  return Math.max(1, Math.round(safeStakeDoes * 1.8));
}

function buildFriendMorpionGameUrl(roomId = "", seatIndex = 0, stakeDoes = 500, fundingCurrency = "does") {
  const params = new URLSearchParams();
  params.set("autostart", "1");
  params.set("stake", String(Math.max(500, Number.parseInt(String(stakeDoes || 0), 10) || 500)));
  params.set("friendMorpionRoomId", String(roomId || "").trim());
  params.set("seat", String(Math.max(0, Number.parseInt(String(seatIndex || 0), 10) || 0)));
  params.set("roomMode", "morpion_friends");
  if (String(fundingCurrency || "").trim().toLowerCase() === "htg") {
    params.set("fundingCurrency", "htg");
    params.set("stakeHtg", String(Math.floor(Math.max(500, Number.parseInt(String(stakeDoes || 0), 10) || 500) / HTG_PER_DOES_RATE)));
  }
  return `../morpion.html?${params.toString()}`;
}

function getGameLaunchConfig(gameKey) {
  return GAME_LAUNCH_CONFIG[String(gameKey || "").trim().toLowerCase()] || null;
}

function getSelectedGameModeConfig(config) {
  if (!config || !Array.isArray(config.modes)) return null;
  return config.modes.find((mode) => mode.value === selectedGameMode) || config.modes[0] || null;
}

function syncStakeSelectionState(config, selectionValue) {
  if (!config || !stakeModal) return;

  if (config.selectionType === "mode" && stakeModalStage === "mode") {
    const activeMode = getSelectedGameModeConfig({
      ...config,
      modes: Array.isArray(config.modes) ? config.modes : [],
    }) || (Array.isArray(config.modes) ? config.modes.find((mode) => mode.value === selectionValue) || config.modes[0] || null : null);
    selectedGameMode = String(activeMode?.value || "");
    if (stakeSummaryLabelEl) stakeSummaryLabelEl.textContent = "Ou chwazi mod la";
    if (stakeAmountSummary) stakeAmountSummary.textContent = activeMode?.label || "Domino";

    stakeModal.querySelectorAll("[data-stake-mode-chip]").forEach((chip) => {
      const chipValue = String(chip.getAttribute("data-stake-mode-chip") || "");
      chip.classList.toggle("is-active", chipValue === selectedGameMode);
    });
    return;
  }

  if (stakeModalStage === "alt-flow") {
    const altOptions = Array.isArray(config?.altAction?.options) ? config.altAction.options : [];
    const activeAltOption = altOptions.find((option) => option.value === selectionValue) || altOptions[0] || null;
    selectedGameAltFlow = String(activeAltOption?.value || "");
    if (stakeSummaryLabelEl) stakeSummaryLabelEl.textContent = "Ou chwazi opsyon an";
    if (stakeAmountSummary) stakeAmountSummary.textContent = activeAltOption?.label || "Jwe ak yon ami";

    stakeModal.querySelectorAll("[data-stake-alt-flow-chip]").forEach((chip) => {
      const chipValue = String(chip.getAttribute("data-stake-alt-flow-chip") || "");
      chip.classList.toggle("is-active", chipValue === selectedGameAltFlow);
    });
    return;
  }

  const amount = Math.max(25, Math.floor(Number(selectionValue) || 0));
  selectedGameStake = amount;
  if (stakeSummaryLabelEl) stakeSummaryLabelEl.textContent = "Ou pral jwe ak";
  if (stakeAmountSummary) {
    stakeAmountSummary.textContent = selectedGameFundingCurrency === "htg"
      ? formatHtgOnlyFromDoes(amount)
      : formatDoesOnly(amount);
  }

  stakeModal.querySelectorAll("[data-stake-amount-chip]").forEach((chip) => {
    const chipAmount = Number(chip.getAttribute("data-stake-amount-chip") || 0);
    chip.classList.toggle("is-active", chipAmount === amount);
  });
}

function renderMorpionFriendJoinStage() {
  if (!stakeModal) return;
  const titleEl = stakeModal.querySelector("#stakeModalTitle");
  const copyEl = stakeModal.querySelector("[data-stake-modal-copy]");
  const chipsEl = stakeModal.querySelector("[data-stake-modal-chips]");
  if (titleEl) titleEl.textContent = "Kòd envitasyon";
  if (copyEl) copyEl.textContent = "Antre kòd zanmi ou voye a pou antre nan salon prive Mopyon an.";
  if (!chipsEl) return;
  chipsEl.innerHTML = `
    <input
      class="deposit-modal__input"
      type="text"
      inputmode="text"
      autocomplete="off"
      maxlength="12"
      placeholder="ABC123"
      data-morpion-friend-join-code
      style="text-transform:uppercase;text-align:center;letter-spacing:0.18em;"
    />
    <div class="deposit-modal__note" data-morpion-friend-join-hint>
      Antre kòd la menm jan ak jan zanmi ou te voye li.
    </div>
  `;
  const input = chipsEl.querySelector("[data-morpion-friend-join-code]");
  input?.addEventListener("input", () => {
    input.value = normalizeInviteCode(input.value);
    if (stakeErrorEl) stakeErrorEl.textContent = "";
  });
  stakeModal.querySelector("[data-stake-modal-funding-toggle]")?.setAttribute("style", "display:none;");
  stakeModal.querySelector("[data-stake-modal-funding-toggle]")?.setAttribute("style", "display:none;");
  if (stakeSubmitBtn) stakeSubmitBtn.textContent = "Antre nan salon an";
  if (stakeSummaryLabelEl) stakeSummaryLabelEl.textContent = "Mòd";
  if (stakeAmountSummary) stakeAmountSummary.textContent = "Envitasyon prive";
}

function renderMorpionFriendCreateStage() {
  if (!stakeModal) return;
  const titleEl = stakeModal.querySelector("#stakeModalTitle");
  const copyEl = stakeModal.querySelector("[data-stake-modal-copy]");
  const chipsEl = stakeModal.querySelector("[data-stake-modal-chips]");
  if (titleEl) titleEl.textContent = "Kreye yon salon";
  if (copyEl) copyEl.textContent = "Chwazi mise salon prive Mopyon an. Li dwe 500 Does oswa plis, pa tranche 100.";
  if (!chipsEl) return;
  chipsEl.innerHTML = `
    <input
      class="deposit-modal__input"
      type="number"
      min="500"
      step="100"
      inputmode="numeric"
      value="${Math.max(500, Number(morpionFriendRoomDraft.stakeDoes || 500))}"
      data-morpion-friend-create-stake
    />
    <div class="deposit-modal__note" data-morpion-friend-create-summary>
      Mise ${formatDoesOnly(Math.max(500, Number(morpionFriendRoomDraft.stakeDoes || 500)))}. Gain ${formatDoesOnly(buildPrivateMorpionRewardDoes(Math.max(500, Number(morpionFriendRoomDraft.stakeDoes || 500))))}.
    </div>
  `;
  const input = chipsEl.querySelector("[data-morpion-friend-create-stake]");
  const summary = chipsEl.querySelector("[data-morpion-friend-create-summary]");
  const syncSummary = () => {
    const stakeDoes = parseStrictWholeNumber(input?.value || 500);
    if (!summary) return;
    if (!isValidMorpionFriendStake(stakeDoes)) {
      summary.textContent = "Chwazi yon mise valab tankou 500, 600, 700, 800.";
      return;
    }
    summary.textContent = `Mise ${formatDoesOnly(stakeDoes)}. Gain ${formatDoesOnly(buildPrivateMorpionRewardDoes(stakeDoes))}.`;
  };
  input?.addEventListener("input", () => {
    input.value = String(input.value || "").replace(/[^\d]/g, "");
    syncSummary();
    if (stakeErrorEl) stakeErrorEl.textContent = "";
  });
  syncSummary();
  stakeModal.querySelector("[data-stake-modal-funding-toggle]")?.setAttribute("style", "display:none;");
  if (stakeSubmitBtn) stakeSubmitBtn.textContent = "Jenere kòd la";
  if (stakeSummaryLabelEl) stakeSummaryLabelEl.textContent = "Mòd";
  if (stakeAmountSummary) stakeAmountSummary.textContent = "Salon prive";
}

function renderMorpionFriendCodeStage() {
  if (!stakeModal) return;
  const titleEl = stakeModal.querySelector("#stakeModalTitle");
  const copyEl = stakeModal.querySelector("[data-stake-modal-copy]");
  const chipsEl = stakeModal.querySelector("[data-stake-modal-chips]");
  const inviteCode = String(morpionFriendRoomDraft.inviteCode || "").trim();
  const stakeDoes = Math.max(500, Number.parseInt(String(morpionFriendRoomDraft.stakeDoes || 500), 10) || 500);
  if (titleEl) titleEl.textContent = "Salon kreye";
  if (copyEl) copyEl.textContent = "Pataje kòd sa a ak zanmi ou, epi antre nan salon an lè ou pare.";
  if (!chipsEl) return;
  chipsEl.innerHTML = `
    <div class="deposit-modal__summary" aria-live="polite">
      <span>Kòd salon an</span>
      <strong style="letter-spacing:0.18em;">${inviteCode || "------"}</strong>
    </div>
    <div class="deposit-modal__note">
      Mise ${formatDoesOnly(stakeDoes)}. Gain ${formatDoesOnly(buildPrivateMorpionRewardDoes(stakeDoes))}.
    </div>
    <button class="stake-modal__submit" type="button" data-morpion-friend-copy-code>Kopye kòd la</button>
  `;
  chipsEl.querySelector("[data-morpion-friend-copy-code]")?.addEventListener("click", async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      if (stakeErrorEl) stakeErrorEl.textContent = "Kòd la kopye.";
    } catch (_) {
      if (stakeErrorEl) stakeErrorEl.textContent = "M pa ka kopye kòd la sou aparèy sa a.";
    }
  });
  if (stakeSubmitBtn) stakeSubmitBtn.textContent = "Antre nan salon an";
  if (stakeSummaryLabelEl) stakeSummaryLabelEl.textContent = "Salon";
  if (stakeAmountSummary) stakeAmountSummary.textContent = inviteCode || "Kòd";
}

function closeStakeModal() {
  if (!stakeModal) return;
  stakeModal.classList.remove("is-open");
  stakeModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
  if (stakeErrorEl) stakeErrorEl.textContent = "";
}

function ensureStakeModal() {
  if (stakeModal) return stakeModal;

  stakeModal = document.createElement("section");
  stakeModal.className = "stake-modal";
  stakeModal.setAttribute("aria-hidden", "true");
  stakeModal.innerHTML = `
    <div class="stake-modal__panel" role="dialog" aria-modal="true" aria-labelledby="stakeModalTitle">
      <header class="stake-modal__header">
        <button class="stake-modal__back" type="button" aria-label="Fèmen modal la" data-close-stake-modal>
          <i data-lucide="arrow-left" class="icon icon--modal-back" aria-hidden="true"></i>
        </button>

        <div class="stake-modal__brand">
          <p class="stake-modal__eyebrow">JWÈT</p>
          <h2 id="stakeModalTitle" class="stake-modal__title">JWÈT</h2>
        </div>

        <div class="stake-modal__badge">CHWAZI</div>
      </header>

      <div class="stake-modal__body">
        <div class="stake-modal__card">
          <div class="stake-modal__visual">
            <img src="" alt="" data-stake-modal-image />
          </div>

          <p class="stake-modal__lead" data-stake-modal-copy></p>

          <div class="stake-modal__chips" aria-label="Kantite rapid" data-stake-modal-chips></div>

          <div class="stake-modal__summary" aria-live="polite">
            <span data-stake-modal-summary-label>Ou pral jwe ak</span>
            <strong data-stake-modal-total>5 HTG</strong>
          </div>

          <div class="stake-modal__error" data-stake-modal-error></div>

          <button class="stake-modal__submit" type="button" data-stake-modal-submit>
            Kontinye nan jwèt la
          </button>
          <button class="stake-modal__submit" type="button" data-stake-modal-funding-toggle style="display:none;">
            Jwe ak HTG
          </button>
          <button class="stake-modal__submit" type="button" data-stake-modal-alt-action style="display:none;">
            Jwe ak yon ami
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(stakeModal);

  stakeAmountSummary = stakeModal.querySelector("[data-stake-modal-total]");
  stakeSummaryLabelEl = stakeModal.querySelector("[data-stake-modal-summary-label]");
  stakeErrorEl = stakeModal.querySelector("[data-stake-modal-error]");
  stakeSubmitBtn = stakeModal.querySelector("[data-stake-modal-submit]");
  const stakeFundingToggleBtn = stakeModal.querySelector("[data-stake-modal-funding-toggle]");
  const stakeAltActionBtn = stakeModal.querySelector("[data-stake-modal-alt-action]");
  const stakeImageEl = stakeModal.querySelector("[data-stake-modal-image]");
  const stakeCopyEl = stakeModal.querySelector("[data-stake-modal-copy]");
  const stakeTitleEl = stakeModal.querySelector("#stakeModalTitle");
  const stakeChipsEl = stakeModal.querySelector("[data-stake-modal-chips]");
  const closeBtn = stakeModal.querySelector("[data-close-stake-modal]");

  const syncStakeSelectionState = (config, selectionValue) => {
    if (!config) return;

    if (config.selectionType === "mode" && stakeModalStage === "mode") {
      const modeOptions = Array.isArray(config.modes) ? config.modes : [];
      const activeMode = modeOptions.find((mode) => mode.value === selectionValue) || modeOptions[0] || null;
      selectedGameMode = String(activeMode?.value || "");
      if (stakeSummaryLabelEl) stakeSummaryLabelEl.textContent = "Ou chwazi mòd";
      if (stakeAmountSummary) stakeAmountSummary.textContent = activeMode?.label || "Domino";

      stakeModal.querySelectorAll("[data-stake-mode-chip]").forEach((chip) => {
        const chipValue = String(chip.getAttribute("data-stake-mode-chip") || "");
        chip.classList.toggle("is-active", chipValue === selectedGameMode);
      });
      return;
    }

    if (stakeModalStage === "alt-flow") {
      const altOptions = Array.isArray(config?.altAction?.options) ? config.altAction.options : [];
      const activeAltOption = altOptions.find((option) => option.value === selectionValue) || altOptions[0] || null;
      selectedGameAltFlow = String(activeAltOption?.value || "");
      if (stakeSummaryLabelEl) stakeSummaryLabelEl.textContent = "Ou chwazi opsyon an";
      if (stakeAmountSummary) stakeAmountSummary.textContent = activeAltOption?.label || "Jwe ak yon ami";

      stakeModal.querySelectorAll("[data-stake-alt-flow-chip]").forEach((chip) => {
        const chipValue = String(chip.getAttribute("data-stake-alt-flow-chip") || "");
        chip.classList.toggle("is-active", chipValue === selectedGameAltFlow);
      });
      return;
    }

    const amount = Math.max(25, Math.floor(Number(selectionValue) || 0));
    selectedGameStake = amount;
    if (stakeSummaryLabelEl) stakeSummaryLabelEl.textContent = "Ou pral jwe ak";
    if (stakeAmountSummary) {
      stakeAmountSummary.textContent = selectedGameFundingCurrency === "htg"
        ? formatHtgOnlyFromDoes(amount)
        : formatDoesOnly(amount);
    }

    stakeModal.querySelectorAll("[data-stake-amount-chip]").forEach((chip) => {
      const chipAmount = Number(chip.getAttribute("data-stake-amount-chip") || 0);
      chip.classList.toggle("is-active", chipAmount === amount);
    });
  };

  const syncFundingToggleState = (config, activeMode = null) => {
    if (!stakeFundingToggleBtn || !config) return;
    const htgOptions = getSelectableStakeOptions(config, activeMode, "htg");
    const canUseHtg = Array.isArray(htgOptions) && htgOptions.length > 0;
    selectedGameFundingCurrency = canUseHtg ? "htg" : "does";
    stakeFundingToggleBtn.style.display = "none";
    stakeFundingToggleBtn.textContent = "Jwe ak HTG";
  };

  const renderAmountSelectionStage = (config, activeMode = null) => {
    if (!config || !stakeModal) return;
    const chipsEl = stakeModal.querySelector("[data-stake-modal-chips]");
    if (!chipsEl) return;
    stakeModalStage = "amount";
    const amountOptions = getSelectableStakeOptions(config, activeMode, selectedGameFundingCurrency);
    if (!amountOptions.length && selectedGameFundingCurrency === "htg") {
      selectedGameFundingCurrency = "does";
    }
    const resolvedOptions = getSelectableStakeOptions(config, activeMode, selectedGameFundingCurrency);
    const safeOptions = resolvedOptions.length ? resolvedOptions : [100];
    if (!safeOptions.includes(Number(selectedGameStake || 0))) {
      selectedGameStake = Number(safeOptions[0] || 100);
    }
    chipsEl.replaceChildren();
    safeOptions.forEach((amount) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "stake-modal__chip";
      chip.setAttribute("data-stake-amount-chip", String(amount));
      chip.textContent = selectedGameFundingCurrency === "htg"
        ? formatHtgOnlyFromDoes(amount)
        : formatDoesOnly(amount);
      chipsEl.appendChild(chip);
    });
    if (stakeSubmitBtn) stakeSubmitBtn.textContent = "Kontinye nan jwet la";
    syncStakeSelectionState(config, selectedGameStake);
    syncFundingToggleState(config, activeMode);
    if (stakeErrorEl) stakeErrorEl.textContent = "";
  };

  const renderAltFlowSelectionStage = (config) => {
    if (!config || !stakeModal) return;
    const altOptions = Array.isArray(config?.altAction?.options) ? config.altAction.options : [];
    const titleEl = stakeModal.querySelector("#stakeModalTitle");
    const copyEl = stakeModal.querySelector("[data-stake-modal-copy]");
    const chipsEl = stakeModal.querySelector("[data-stake-modal-chips]");
    if (!chipsEl || !altOptions.length) return;

    stakeModalStage = "alt-flow";
    selectedGameAltFlow = String(selectedGameAltFlow || altOptions[0]?.value || "");
    if (!altOptions.some((option) => option.value === selectedGameAltFlow)) {
      selectedGameAltFlow = String(altOptions[0]?.value || "");
    }
    if (titleEl) titleEl.textContent = String(config.altAction?.title || `${config.label} antre amis`);
    if (copyEl) copyEl.textContent = String(config.altAction?.description || "Chwazi yon opsyon.");
    chipsEl.replaceChildren();
    altOptions.forEach((option) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "stake-modal__chip";
      chip.setAttribute("data-stake-alt-flow-chip", String(option.value || ""));
      chip.textContent = String(option.label || "Opsyon");
      chipsEl.appendChild(chip);
    });
    if (stakeSubmitBtn) stakeSubmitBtn.textContent = "Kontinye";
    if (stakeFundingToggleBtn) stakeFundingToggleBtn.style.display = "none";
    if (stakeAltActionBtn) stakeAltActionBtn.style.display = "none";
    syncStakeSelectionState(config, selectedGameAltFlow);
    if (stakeErrorEl) stakeErrorEl.textContent = "";
  };

  const renderBaseStakeStage = (config) => {
    if (!config || !stakeModal) return;
    const titleEl = stakeModal.querySelector("#stakeModalTitle");
    const imageEl = stakeModal.querySelector("[data-stake-modal-image]");
    const copyEl = stakeModal.querySelector("[data-stake-modal-copy]");
    const chipsEl = stakeModal.querySelector("[data-stake-modal-chips]");
    const altActionLabel = String(config?.altAction?.label || "").trim();
    const altActionOptions = Array.isArray(config?.altAction?.options) ? config.altAction.options : [];
    if (!chipsEl) return;

    if (titleEl) titleEl.textContent = config.title;
    if (imageEl) {
      imageEl.src = config.image;
      imageEl.alt = config.label;
    }
    if (copyEl) copyEl.textContent = config.description;
    if (stakeAltActionBtn) {
      stakeAltActionBtn.style.display = activeGameKey === "morpion" && altActionLabel && altActionOptions.length ? "" : "none";
      stakeAltActionBtn.textContent = altActionLabel || "Aksyon";
    }

    chipsEl.replaceChildren();
    if (config.selectionType === "mode") {
      stakeModalStage = "mode";
      const modeOptions = Array.isArray(config.modes) && config.modes.length ? config.modes : [];
      if (!modeOptions.some((mode) => mode.value === selectedGameMode)) {
        selectedGameMode = String(modeOptions[0]?.value || "");
      }
      modeOptions.forEach((mode) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "stake-modal__chip";
        chip.setAttribute("data-stake-mode-chip", String(mode.value || ""));
        chip.textContent = mode.label;
        chipsEl.appendChild(chip);
      });
      if (stakeSubmitBtn) stakeSubmitBtn.textContent = "Kontinye";
      syncStakeSelectionState(config, selectedGameMode);
      syncFundingToggleState(config, getSelectedGameModeConfig(config));
    } else {
      renderAmountSelectionStage(config, null);
    }
    if (stakeErrorEl) stakeErrorEl.textContent = "";
  };

  stakeChipsEl?.addEventListener("click", (event) => {
    const origin = event.target instanceof Element ? event.target : null;
    const button = origin?.closest("[data-stake-amount-chip], [data-stake-mode-chip], [data-stake-alt-flow-chip]");
    if (!button) return;
    const config = getGameLaunchConfig(activeGameKey);
    if (!config) return;
    if (button.hasAttribute("data-stake-mode-chip")) {
      syncStakeSelectionState(config, button.getAttribute("data-stake-mode-chip") || "");
    } else if (button.hasAttribute("data-stake-alt-flow-chip")) {
      syncStakeSelectionState(config, button.getAttribute("data-stake-alt-flow-chip") || "");
    } else {
      const amount = Number(button.getAttribute("data-stake-amount-chip") || 0);
      syncStakeSelectionState(config, amount);
    }
    if (stakeErrorEl) stakeErrorEl.textContent = "";
  });

  const openGameHref = () => {
    const config = getGameLaunchConfig(activeGameKey);
    const amount = Math.max(25, Math.floor(Number(selectedGameStake || 0)));
    if (!config) {
      if (stakeErrorEl) stakeErrorEl.textContent = "Jeu a pa disponib ankò.";
      return;
    }
    if (!Number.isFinite(amount) || amount < 25) {
      if (stakeErrorEl) stakeErrorEl.textContent = "Mete yon montan HTG ki valab.";
      return;
    }

    closeStakeModal();
    window.location.href = config.buildHref(amount, selectedGameFundingCurrency);
  };

  const continueGameLaunch = () => {
    const config = getGameLaunchConfig(activeGameKey);
    if (!config) {
      if (stakeErrorEl) stakeErrorEl.textContent = "Jeu a pa disponib ankÃ².";
      return;
    }

    if (stakeModalStage === "alt-flow") {
      const altOptions = Array.isArray(config?.altAction?.options) ? config.altAction.options : [];
      const activeAltOption = altOptions.find((option) => option.value === selectedGameAltFlow) || altOptions[0] || null;
      if (!activeAltOption) {
        if (stakeErrorEl) stakeErrorEl.textContent = "Chwazi yon opsyon ki valab.";
        return;
      }
      if (activeAltOption.value === "friend_join") {
        stakeModalStage = "friend-join";
        renderMorpionFriendJoinStage();
        if (stakeErrorEl) stakeErrorEl.textContent = "";
        return;
      }
      if (activeAltOption.value === "friend_create") {
        stakeModalStage = "friend-create";
        renderMorpionFriendCreateStage();
        if (stakeErrorEl) stakeErrorEl.textContent = "";
        return;
      }
      if (stakeErrorEl) stakeErrorEl.textContent = "Opsyon sa a poko disponib.";
      return;
    }

    if (stakeModalStage === "friend-join") {
      const joinInput = stakeModal?.querySelector("[data-morpion-friend-join-code]");
      const inviteCode = normalizeInviteCode(joinInput?.value || "");
      if (!inviteCode) {
        if (stakeErrorEl) stakeErrorEl.textContent = "Antre kòd envitasyon an pou kontinye.";
        joinInput?.focus();
        return;
      }
      if (stakeSubmitBtn) stakeSubmitBtn.disabled = true;
      joinFriendMorpionRoomByCodeSecure({
        inviteCode,
        fundingCurrency: selectedGameFundingCurrency,
      }).then((result) => {
        morpionFriendRoomDraft.roomId = String(result?.roomId || "").trim();
        morpionFriendRoomDraft.seatIndex = Number.parseInt(String(result?.seatIndex || 0), 10) || 0;
        morpionFriendRoomDraft.stakeDoes = Number.parseInt(String(result?.stakeDoes || 500), 10) || 500;
        morpionFriendRoomDraft.inviteCode = String(result?.inviteCode || inviteCode).trim();
        closeStakeModal();
        window.location.href = buildFriendMorpionGameUrl(
          morpionFriendRoomDraft.roomId,
          morpionFriendRoomDraft.seatIndex,
          morpionFriendRoomDraft.stakeDoes,
          selectedGameFundingCurrency
        );
      }).catch((error) => {
        if (stakeErrorEl) stakeErrorEl.textContent = error?.message || "M pa ka antre nan salon sa a pou kounye a.";
      }).finally(() => {
        if (stakeSubmitBtn) stakeSubmitBtn.disabled = false;
      });
      return;
    }

    if (stakeModalStage === "friend-create") {
      const createInput = stakeModal?.querySelector("[data-morpion-friend-create-stake]");
      const stakeAmount = parseStrictWholeNumber(createInput?.value || 500);
      if (!isValidMorpionFriendStake(stakeAmount)) {
        if (stakeErrorEl) stakeErrorEl.textContent = "Mise prive a poko disponib nan fòma HTG sa a.";
        createInput?.focus();
        return;
      }
      if (stakeSubmitBtn) stakeSubmitBtn.disabled = true;
      createFriendMorpionRoomSecure({
        stakeDoes: stakeAmount,
        fundingCurrency: selectedGameFundingCurrency,
      }).then((result) => {
        morpionFriendRoomDraft.roomId = String(result?.roomId || "").trim();
        morpionFriendRoomDraft.seatIndex = Number.parseInt(String(result?.seatIndex || 0), 10) || 0;
        morpionFriendRoomDraft.stakeDoes = Number.parseInt(String(result?.stakeDoes || stakeAmount), 10) || stakeAmount;
        morpionFriendRoomDraft.inviteCode = String(result?.inviteCode || "").trim();
        stakeModalStage = "friend-code";
        renderMorpionFriendCodeStage();
        if (stakeErrorEl) stakeErrorEl.textContent = "";
      }).catch((error) => {
        if (stakeErrorEl) stakeErrorEl.textContent = error?.message || "M pa ka kreye salon an pou kounye a.";
      }).finally(() => {
        if (stakeSubmitBtn) stakeSubmitBtn.disabled = false;
      });
      return;
    }

    if (stakeModalStage === "friend-code") {
      if (!morpionFriendRoomDraft.roomId) {
        if (stakeErrorEl) stakeErrorEl.textContent = "Salon prive a poko pare.";
        return;
      }
      closeStakeModal();
      window.location.href = buildFriendMorpionGameUrl(
        morpionFriendRoomDraft.roomId,
        morpionFriendRoomDraft.seatIndex,
        morpionFriendRoomDraft.stakeDoes,
        selectedGameFundingCurrency
      );
      return;
    }

    if (config.selectionType === "mode") {
      const modeOptions = Array.isArray(config.modes) ? config.modes : [];
      const activeMode = modeOptions.find((mode) => mode.value === selectedGameMode) || modeOptions[0] || null;
      if (stakeModalStage === "mode") {
        if (activeMode) {
          renderAmountSelectionStage(config, activeMode);
          return;
          const amountOptions = Array.isArray(activeMode.amounts) && activeMode.amounts.length ? activeMode.amounts : [100];
          stakeModalStage = "amount";
          stakeChipsEl.replaceChildren();
          amountOptions.forEach((amount, index) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = `stake-modal__chip${index === 0 ? " is-active" : ""}`;
            chip.setAttribute("data-stake-amount-chip", String(amount));
            chip.textContent = formatDoesOnly(amount);
            stakeChipsEl.appendChild(chip);
          });
          selectedGameStake = Number(amountOptions[0] || 100);
          if (stakeSubmitBtn) stakeSubmitBtn.textContent = "Kontinye nan jwet la";
          syncStakeSelectionState(config, selectedGameStake);
          if (stakeErrorEl) stakeErrorEl.textContent = "";
          return;
        }
        if (stakeErrorEl) stakeErrorEl.textContent = "Chwazi yon mòd jwèt ki valab.";
        return;
      }

      const amount = Math.max(25, Math.floor(Number(selectedGameStake || 0)));
      if (!activeMode?.buildHref || !Number.isFinite(amount) || amount < 25) {
        if (stakeErrorEl) stakeErrorEl.textContent = "Chwazi yon kantite HTG ki valab.";
        return;
      }

      closeStakeModal();
      window.location.href = activeMode.buildHref(amount, selectedGameFundingCurrency);
      return;
    }

    openGameHref();
  };

  stakeSubmitBtn?.addEventListener("click", continueGameLaunch);

  stakeFundingToggleBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const config = getGameLaunchConfig(activeGameKey);
    if (!config) return;
    selectedGameFundingCurrency = selectedGameFundingCurrency === "htg" ? "does" : "htg";
    if (config.selectionType === "mode" && stakeModalStage === "amount") {
      renderAmountSelectionStage(config, getSelectedGameModeConfig(config));
      return;
    }
    if (stakeModalStage === "amount") {
      renderAmountSelectionStage(config, null);
      return;
    }
    syncFundingToggleState(config, getSelectedGameModeConfig(config));
  });

  stakeAltActionBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const config = getGameLaunchConfig(activeGameKey);
    const altOptions = Array.isArray(config?.altAction?.options) ? config.altAction.options : [];
    if (!config || activeGameKey !== "morpion" || !altOptions.length) return;
    const titleEl = stakeModal?.querySelector("#stakeModalTitle");
    const copyEl = stakeModal?.querySelector("[data-stake-modal-copy]");
    const chipsEl = stakeModal?.querySelector("[data-stake-modal-chips]");
    if (!chipsEl) return;

    selectedGameStake = Number(Array.isArray(config.amounts) && config.amounts.length ? config.amounts[0] : 500) || 500;
    renderAltFlowSelectionStage(config);
  });

  stakeModal.addEventListener("click", (event) => {
    if (event.target === stakeModal) closeStakeModal();
  });

  closeBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const config = getGameLaunchConfig(activeGameKey);
    if (!config) {
      closeStakeModal();
      return;
    }

    if (stakeModalStage === "friend-code") {
      stakeModalStage = "friend-create";
      renderMorpionFriendCreateStage();
      if (stakeErrorEl) stakeErrorEl.textContent = "";
      return;
    }

    if (stakeModalStage === "friend-join" || stakeModalStage === "friend-create") {
      renderAltFlowSelectionStage(config);
      return;
    }

    if (stakeModalStage === "alt-flow") {
      renderBaseStakeStage(config);
      return;
    }

    if (config.selectionType === "mode" && stakeModalStage === "amount") {
      renderBaseStakeStage(config);
      return;
    }

    closeStakeModal();
  });

  syncStakeSelectionState({ amounts: [100] }, 100);
  stakeModal.__renderBaseStakeStage = renderBaseStakeStage;

  if (window.lucide) {
    window.lucide.createIcons();
  }

  return stakeModal;
}

function openStakeModal(gameKey) {
  const config = getGameLaunchConfig(gameKey);
  if (!config) return;

  const modal = ensureStakeModal();
  closeGamesModal();
  closeDepositModal();

  activeGameKey = String(gameKey || "").trim().toLowerCase();
  selectedGameFundingCurrency = "htg";
  selectedGameAltFlow = "";

  modal.__renderBaseStakeStage?.(config);
  if (stakeErrorEl) stakeErrorEl.textContent = "";

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");

  if (window.lucide) {
    window.lucide.createIcons();
  }
  return;

  const titleEl = modal.querySelector("#stakeModalTitle");
  const imageEl = modal.querySelector("[data-stake-modal-image]");
  const copyEl = modal.querySelector("[data-stake-modal-copy]");
  const chipsEl = modal.querySelector("[data-stake-modal-chips]");

  if (titleEl) titleEl.textContent = config.title;
  if (imageEl) {
    imageEl.src = config.image;
    imageEl.alt = config.label;
  }
  if (copyEl) copyEl.textContent = config.description;
  const altActionBtn = modal.querySelector("[data-stake-modal-alt-action]");
  const altActionLabel = String(config?.altAction?.label || "").trim();
  const altActionOptions = Array.isArray(config?.altAction?.options) ? config.altAction.options : [];
  if (altActionBtn) {
    altActionBtn.style.display = activeGameKey === "morpion" && altActionLabel && altActionOptions.length ? "" : "none";
    altActionBtn.textContent = altActionLabel || "Aksyon";
  }

  chipsEl.replaceChildren();
  if (config.selectionType === "mode") {
    stakeModalStage = "mode";
    const modeOptions = Array.isArray(config.modes) && config.modes.length ? config.modes : [];
    modeOptions.forEach((mode, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `stake-modal__chip${index === 0 ? " is-active" : ""}`;
      chip.setAttribute("data-stake-mode-chip", String(mode.value || ""));
      chip.textContent = mode.label;
      chipsEl.appendChild(chip);
    });

    selectedGameMode = String(modeOptions[0]?.value || "");
    if (stakeSubmitBtn) stakeSubmitBtn.textContent = "Kontinye";
    syncStakeSelectionState(config, selectedGameMode);
  } else {
    stakeModalStage = "amount";
    const amountOptions = Array.isArray(config.amounts) && config.amounts.length ? config.amounts : [100];
    amountOptions.forEach((amount, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `stake-modal__chip${index === 0 ? " is-active" : ""}`;
      chip.setAttribute("data-stake-amount-chip", String(amount));
      chip.textContent = formatDoesOnly(amount);
      chipsEl.appendChild(chip);
    });

    const firstAmount = Number(amountOptions[0] || 100);
    selectedGameStake = firstAmount;
    if (stakeSubmitBtn) stakeSubmitBtn.textContent = "Kontinye nan jwet la";
    syncStakeSelectionState(config, firstAmount);
  }

  if (stakeErrorEl) stakeErrorEl.textContent = "";

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function ensureDepositModal() {
  if (depositModal) return depositModal;

  depositModal = document.createElement("section");
  depositModal.className = "deposit-modal";
  depositModal.setAttribute("aria-hidden", "true");
  depositModal.innerHTML = `
    <div class="deposit-modal__panel" role="dialog" aria-modal="true" aria-labelledby="depositModalTitle">
      <header class="deposit-modal__header">
        <button class="deposit-modal__back" type="button" aria-label="Fèmen depo a" data-close-deposit-modal>
          <i data-lucide="arrow-left" class="icon icon--modal-back" aria-hidden="true"></i>
        </button>

        <div class="deposit-modal__brand">
          <p class="deposit-modal__eyebrow">DEPÒ</p>
          <h2 id="depositModalTitle" class="deposit-modal__title">Fè yon depo</h2>
        </div>

        <div class="deposit-modal__badge">Kobposh</div>
      </header>

      <div class="deposit-modal__body">
        <div class="deposit-modal__card">
          <p class="deposit-modal__lead">
            Mete kantite lajan ou vle depoze a.
          </p>

          <div class="deposit-modal__field">
            <label class="deposit-modal__label" for="depositAmount">Montan depo (HTG)</label>
            <input
              id="depositAmount"
              class="deposit-modal__input"
              type="number"
              min="25"
              step="25"
              inputmode="numeric"
              value="25"
            />
          </div>

          <div class="deposit-modal__chips" aria-label="Kantite rapid">
            <button class="deposit-modal__chip is-active" type="button" data-deposit-amount-chip="25">25</button>
            <button class="deposit-modal__chip" type="button" data-deposit-amount-chip="50">50</button>
            <button class="deposit-modal__chip" type="button" data-deposit-amount-chip="100">100</button>
            <button class="deposit-modal__chip" type="button" data-deposit-amount-chip="250">250</button>
          </div>

          <div class="deposit-modal__summary" aria-live="polite">
            <span>Total ou pral antre a</span>
            <strong data-deposit-total>25 HTG</strong>
          </div>

          <div class="deposit-modal__note">
            Depo a pral kontinye sou sistèm peman an. Asire montan an kòrèk anvan ou kontinye.
          </div>

          <div class="deposit-modal__error" data-deposit-error></div>

          <button class="deposit-modal__submit" type="button" data-deposit-submit>
            Kontinye nan depo a
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(depositModal);

  depositAmountInput = depositModal.querySelector("#depositAmount");
  depositAmountSummary = depositModal.querySelector("[data-deposit-total]");
  depositErrorEl = depositModal.querySelector("[data-deposit-error]");
  depositSubmitBtn = depositModal.querySelector("[data-deposit-submit]");
  const closeBtn = depositModal.querySelector("[data-close-deposit-modal]");

  const syncAmountState = (amountValue) => {
    const amount = Math.max(25, Number(amountValue) || 0);
    if (depositAmountInput) depositAmountInput.value = String(amount);
    if (depositAmountSummary) depositAmountSummary.textContent = formatDepositAmount(amount);

    depositModal.querySelectorAll("[data-deposit-amount-chip]").forEach((chip) => {
      const chipAmount = Number(chip.getAttribute("data-deposit-amount-chip") || 0);
      chip.classList.toggle("is-active", chipAmount === amount);
    });
  };

  depositAmountInput?.addEventListener("input", () => {
    syncAmountState(depositAmountInput.value);
    if (depositErrorEl) depositErrorEl.textContent = "";
  });

  depositModal.querySelectorAll("[data-deposit-amount-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const amount = Number(chip.getAttribute("data-deposit-amount-chip") || 0);
      syncAmountState(amount);
      if (depositErrorEl) depositErrorEl.textContent = "";
    });
  });

  closeBtn?.addEventListener("click", closeDepositModal);
  depositModal.addEventListener("click", (event) => {
    if (event.target === depositModal) closeDepositModal();
  });

  depositSubmitBtn?.addEventListener("click", () => {
    const amount = Math.max(25, Math.floor(Number(depositAmountInput?.value || 0)));
    if (!Number.isFinite(amount) || amount < 25) {
      if (depositErrorEl) depositErrorEl.textContent = "Mete yon montan ki valab, omwen 25 HTG.";
      return;
    }

    const user = auth.currentUser;
    if (!user?.uid) {
      if (depositErrorEl) depositErrorEl.textContent = "Ou dwe konekte pou fè depo a.";
      return;
    }

    const clientName =
      user.displayName?.trim()
      || user.email?.split("@")?.[0]?.trim()
      || "Itilizatè Kobposh";

    closeDepositModal();
    activePaymentModal = new PaymentModal({
      amount,
      theme: "kobposh",
      client: {
        id: user.uid,
        uid: user.uid,
        name: clientName,
        email: user.email || "",
        photoURL: user.photoURL || "",
      },
      cart: [
        {
          productId: "kobposh-deposit",
          name: "Depo Kobposh",
          price: amount,
          quantity: 1,
          image: "logokobpash.png",
        },
      ],
      imageBasePath: "./",
      onClose: () => {
        activePaymentModal = null;
        void refreshBalance();
        void refreshRecentMatches();
      },
      onSuccess: () => {
        void refreshBalance();
        void refreshRecentMatches();
      },
    });
  });

  syncAmountState(25);

  if (window.lucide) {
    window.lucide.createIcons();
  }

  return depositModal;
}

function openDepositModal() {
  const modal = ensureDepositModal();
  if (!modal) return;
  closeGamesModal();
  closeStakeModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
  depositAmountInput?.focus();
  depositAmountInput?.select?.();
}

function closeDepositModal() {
  if (!depositModal) return;
  depositModal.classList.remove("is-open");
  depositModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
  if (depositErrorEl) depositErrorEl.textContent = "";
}

buildHeroSlides();
initHeroRotation();

function formatBalance(value) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)} HTG`;
}

function getBestFundingBalance(data = {}) {
  const playable = Number(data?.playableHtg);
  if (Number.isFinite(playable) && playable >= 0) return playable;

  const approved = Number(data?.approvedHtgAvailable);
  const provisional = Number(data?.provisionalHtgAvailable);
  if (Number.isFinite(approved) || Number.isFinite(provisional)) {
    return Math.max(0, (Number.isFinite(approved) ? approved : 0) + (Number.isFinite(provisional) ? provisional : 0));
  }

  const withdrawable = Number(data?.withdrawableHtg);
  if (Number.isFinite(withdrawable) && withdrawable >= 0) return withdrawable;

  return null;
}

async function refreshBalance() {
  if (!balanceEl) return;
  const user = auth.currentUser;
  if (!user?.uid) {
    balanceEl.textContent = "-- HTG";
    return;
  }

  try {
    const funding = await getDepositFundingStatusSecure({});
    const balance = getBestFundingBalance(funding);
    if (Number.isFinite(balance)) {
      balanceEl.textContent = formatBalance(balance);
      balanceEl.title = `Balans HTG: ${formatBalance(balance)}`;
      return;
    }
    balanceEl.textContent = "-- HTG";
  } catch (error) {
    console.warn("[KOBPOSH] balance refresh failed", error);
    balanceEl.textContent = "-- HTG";
  }
}

function formatMatchAmount(value) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)} HTG`;
}

function formatMatchDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function inferMatchOutcome(docData = {}, uid = "") {
  const safeUid = String(uid || "").trim();
  const winnerUid = String(docData?.winnerUid || "").trim();
  const winnerType = String(docData?.winnerType || "").trim().toLowerCase();
  const playerUids = Array.isArray(docData?.playerUids)
    ? docData.playerUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const won = winnerUid
    ? winnerUid === safeUid
    : winnerType === "human" && playerUids.includes(safeUid);
  const lost = !won;
  return {
    won,
    lost,
    label: won ? "Genyen" : "Pèdi",
  };
}

function buildMatchRecord(collectionKey, docSnap, uid) {
  const data = docSnap.data() || {};
  const playerUids = Array.isArray(data.playerUids)
    ? data.playerUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const safeUid = String(uid || "").trim();
  const participantUid = String(data.uid || data.clientId || data.playerUid || "").trim();
  const winnerUid = String(data.winnerUid || "").trim();
  const isRelevant = (
    participantUid === safeUid
    || playerUids.includes(safeUid)
    || winnerUid === safeUid
  );
  if (!isRelevant) return null;

  const endedAtMs = Number(data.endedAtMs || data.endedAt || data.createdAtMs || 0);
  const startedAtMs = Number(data.startedAtMs || 0);
  const outcome = inferMatchOutcome(data, safeUid);
  const rewardDoes = Number(data.rewardAmountDoes || data.rewardDoes || 0);
  const stakeDoes = Number(data.stakeDoes || data.entryCostDoes || 0);
  const netDoes = outcome.won ? Math.max(0, rewardDoes || stakeDoes) : -Math.max(0, stakeDoes);
  return {
    id: String(docSnap.id || "").trim(),
    collectionKey,
    gameLabel: GAME_HISTORY_SOURCES.find((item) => item.collectionName === collectionKey)?.gameLabel || "Jeu",
    endedAtMs: Number.isFinite(endedAtMs) ? endedAtMs : 0,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
    resultLabel: outcome.label,
    won: outcome.won,
    lost: outcome.lost,
    scoreLabel: String(data.scoreLabel || "").trim(),
    stakeDoes: Number.isFinite(stakeDoes) ? Math.max(0, Math.floor(stakeDoes)) : 0,
    rewardDoes: Number.isFinite(rewardDoes) ? Math.max(0, Math.floor(rewardDoes)) : 0,
    netDoes: Number.isFinite(netDoes) ? Math.trunc(netDoes) : 0,
    opponentLabel: String(data.opponentLabel || (data.botCount > 0 ? "Bot" : "") || "").trim(),
  };
}

async function loadRecentMatchesForUser(uid, offset = 0, pageSize = 3) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    return { rows: [], hasMore: false, total: 0 };
  }

  try {
    const payload = await getMyGameHistorySecure({
      uid: safeUid,
      pageSize,
      offset,
      game: "all",
      opponent: "all",
      result: "all",
    });
    return payload || { rows: [], hasMore: false, total: 0 };
  } catch (error) {
    console.warn("[KOBPOSH] recent matches load failed", error);
    return { rows: [], hasMore: false, total: 0 };
  }
}

function renderRecentMatches(rows = []) {
  if (!recentMatchesEl) return;
  if (!rows.length) {
    recentMatchesEl.innerHTML = "<li>Pa gen istwa jwèt pou kounye a.</li>";
    return;
  }

  recentMatchesEl.innerHTML = rows.map((row) => {
    const subtitleParts = [
      row.gameLabel,
      row.scoreLabel ? `Nòt ${row.scoreLabel}` : "",
      row.endedAtMs ? formatMatchDate(row.endedAtMs) : "",
    ].filter(Boolean);

    return `
      <li class="recent-match">
        <div class="recent-match__top">
          <span class="recent-match__game">${row.gameLabel}</span>
          <strong class="recent-match__result recent-match__result--${row.won ? "win" : "loss"}">${row.resultLabel || (row.won ? "Genyen" : "Pèdi")}</strong>
        </div>
        <div class="recent-match__meta">${subtitleParts.join(" • ")}</div>
        <div class="recent-match__bottom">
          <span>${row.scoreLabel || "Match fini"}</span>
          <span>${row.netDoes > 0 ? `+${formatMatchAmount(row.netDoes)}` : row.netDoes < 0 ? `-${formatMatchAmount(Math.abs(row.netDoes))}` : "0 HTG"}</span>
        </div>
      </li>
    `;
  }).join("");
}

async function refreshRecentMatches() {
  if (!recentMatchesEl) return;
  const user = auth.currentUser;
  if (!user?.uid) {
    recentMatchesEl.innerHTML = "<li>Konekte pou w wè 3 dènye jwèt ou yo.</li>";
    return;
  }

  recentMatchesEl.innerHTML = "<li>Ap chaje...</li>";
  try {
    const payload = await loadRecentMatchesForUser(user.uid, 0, 3);
    renderRecentMatches(Array.isArray(payload?.rows) ? payload.rows : []);
  } catch (error) {
    console.warn("[KOBPOSH] recent matches refresh failed", error);
    recentMatchesEl.innerHTML = "<li>Nou pa ka chaje istwa jwèt la kounye a.</li>";
  }
}

function startBalanceRefreshLoop() {
  if (balanceRefreshTimer) {
    window.clearInterval(balanceRefreshTimer);
    balanceRefreshTimer = null;
  }
  balanceRefreshTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void refreshBalance();
  }, BALANCE_REFRESH_MS);
}

function getCurrentAuthFields() {
  if (authMode === "signup") {
    return {
      identifier: String(signupUsernameEl?.value || "").trim(),
      phone: String(signupPhoneEl?.value || "").trim(),
      password: String(signupPasswordEl?.value || ""),
      confirmPassword: String(signupPasswordConfirmEl?.value || ""),
      ageAccepted: signupAgeEl?.checked === true,
      termsAccepted: signupTermsEl?.checked === true,
    };
  }

  return {
    identifier: String(loginIdentifierEl?.value || "").trim(),
    password: String(loginPasswordEl?.value || ""),
  };
}

function updateFormValidity() {
  const fields = getCurrentAuthFields();
  const loginBtn = authSubmitBtn;

  if (authMode === "signup") {
    const usernameOk = isValidUsername(fields.identifier);
    const phoneOk = isValidPhoneLogin(fields.phone);
    const passOk = String(fields.password || "").length >= 6;
    const confirmOk = String(fields.password || "") === String(fields.confirmPassword || "") && String(fields.confirmPassword || "").length >= 6;
    const ageOk = fields.ageAccepted === true;
    const termsOk = fields.termsAccepted === true;
    if (loginBtn) loginBtn.disabled = !(usernameOk && phoneOk && passOk && confirmOk && ageOk && termsOk);
    return { valid: usernameOk && phoneOk && passOk && confirmOk && ageOk && termsOk, ...fields };
  }

  const emailOk = isValidEmail(fields.identifier);
  const phoneOk = isValidPhoneLogin(fields.identifier);
  const usernameOk = isValidUsername(fields.identifier);
  const passOk = String(fields.password || "").length >= 6;
  if (loginBtn) loginBtn.disabled = !(passOk && (emailOk || phoneOk || usernameOk));
  return { valid: passOk && (emailOk || phoneOk || usernameOk), ...fields };
}

function setLoggedOutState(isLoggedOut) {
  const shouldLock = isLoggedOut && !isPublicView;
  document.body.classList.toggle("is-auth-locked", shouldLock);
  if (authScreenEl) {
    authScreenEl.hidden = !shouldLock;
  }
  if (shouldLock) {
    window.setTimeout(() => {
      loginIdentifierEl?.focus?.();
    }, 0);
  }
}

function setLoginError(message = "") {
  if (loginErrorEl) loginErrorEl.textContent = message;
}

function setPasswordVisibility(inputId, visible) {
  const inputEl = document.getElementById(inputId);
  const toggleBtn = document.querySelector(`[data-kobposh-toggle-password="${inputId}"]`);
  if (!inputEl || !toggleBtn) return;

  inputEl.type = visible ? "text" : "password";
  toggleBtn.setAttribute("aria-pressed", visible ? "true" : "false");
  toggleBtn.setAttribute("aria-label", visible ? "Maske modpas la" : "Montre modpas la");
  toggleBtn.innerHTML = visible
    ? '<i data-lucide="eye-off" class="icon auth-screen__password-icon" aria-hidden="true"></i>'
    : '<i data-lucide="eye" class="icon auth-screen__password-icon" aria-hidden="true"></i>';

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setAuthMode(mode = "login") {
  authMode = mode === "signup" ? "signup" : "login";
  if (loginFieldsEl) loginFieldsEl.hidden = authMode === "signup";
  if (signupFieldsEl) signupFieldsEl.hidden = authMode !== "signup";
  if (authSubmitBtn) {
    authSubmitBtn.textContent = authMode === "signup" ? "Kreye kont" : "Konekte";
  }
  if (signupToggleBtn) {
    signupToggleBtn.textContent = authMode === "signup"
      ? "Mwen deja gen kont, konekte"
      : "Si w pa gen kont, kreye youn la";
  }
  if (authCardTitleEl) {
    authCardTitleEl.textContent = authMode === "signup" ? "KREYE KONT" : "KOBPOSH";
  }
  if (authCardSubtitleEl) {
    authCardSubtitleEl.textContent = authMode === "signup"
      ? "Kreye kont ou pou kontinye."
      : "Konekte pou kontinye.";
  }
}

passwordToggleBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const inputId = btn.getAttribute("data-kobposh-toggle-password");
    if (!inputId) return;
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    setPasswordVisibility(inputId, inputEl.type === "password");
  });
});

loginFormEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginError("");
  const state = updateFormValidity();
  try {
    if (authMode === "signup") {
      if (!state.valid) {
        setLoginError("Vérifie tout chan yo avan ou kontinye.");
        return;
      }
      if (!isValidUsername(state.identifier)) {
        setLoginError("Antre yon username ki valab.");
        return;
      }
      if (!isValidPhoneLogin(state.phone)) {
        setLoginError("Antre yon numero ki valab.");
        return;
      }
      if (state.password !== state.confirmPassword) {
        setLoginError("Modpas verifikasyon an pa menm.");
        return;
      }
      if (!state.ageAccepted || !state.termsAccepted) {
        setLoginError("Ou dwe konfime ou gen plis pase 18 an epi ou aksepte kondisyon yo.");
        return;
      }
      await signupWithPhone(state.phone, state.password);
      await syncCurrentUserDisplayName(state.identifier);
    } else {
      if (!state.valid) {
        setLoginError("Antre yon username, email oswa numero ki valab ak modpas ou.");
        return;
      }
      if (isValidEmail(state.identifier)) {
        await loginWithEmail(state.identifier, state.password);
      } else if (isValidPhoneLogin(state.identifier)) {
        await loginWithPhone(state.identifier, state.password);
      } else if (isValidUsername(state.identifier)) {
        await loginWithUsername(state.identifier, state.password);
      } else {
        setLoginError("Antre yon username oswa yon email ki valab.");
        return;
      }
    }
  } catch (error) {
    setLoginError(formatAuthError(error, authMode === "signup" ? "Kreyasyon kont la pa mache." : "Koneksyon an pa mache."));
  }
});

signupToggleBtn?.addEventListener("click", () => {
  setLoginError("");
  setAuthMode(authMode === "signup" ? "login" : "signup");
});

[loginIdentifierEl, loginPasswordEl, signupUsernameEl, signupPhoneEl, signupPasswordEl, signupPasswordConfirmEl, signupAgeEl, signupTermsEl].forEach((input) => {
  input?.addEventListener("input", () => {
    setLoginError("");
    updateFormValidity();
  });
});

onAuthStateChanged(auth, (user) => {
  const loggedOut = !user;
  setLoggedOutState(loggedOut);
  if (accountLabelEl) {
    const label = loggedOut
      ? "Ou pagen kont"
      : String(user?.displayName || user?.email || user?.uid || "").split("@")[0] || "Ou pagen kont";
    accountLabelEl.textContent = label;
  }
  if (loggedOut) {
    setLoginError("");
    if (recentMatchesEl) recentMatchesEl.innerHTML = "<li>Konekte pou w wè 3 dènye match ou yo.</li>";
    if (balanceEl) balanceEl.textContent = "-- HTG";
    return;
  }
  void refreshBalance();
  void refreshRecentMatches();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void refreshBalance();
    void refreshRecentMatches();
  }
});

startBalanceRefreshLoop();
void refreshBalance();
void refreshRecentMatches();
setAuthMode("login");
updateFormValidity();

function openGamesModal() {
  if (!gamesModal) return;
  gamesModal.classList.add("is-open");
  gamesModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeGamesModal() {
  if (!gamesModal) return;
  gamesModal.classList.remove("is-open");
  gamesModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function openHistoryModalAndRefresh() {
  openHistoryModal();
}

openGamesModalBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  openGamesModal();
});

document.querySelector("[data-open-history-modal]")?.addEventListener("click", (event) => {
  event.preventDefault();
  openHistoryModalAndRefresh();
});

openDepositModalBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    openDepositModal();
  });
});

withdrawalQuickBtn?.addEventListener("click", () => {
  openWithdrawalAgentModal();
});

supportQuickBtn?.addEventListener("click", () => {
  window.location.href = buildWhatsappUrlForKey(
    "support_default",
    "Bonjou, mwen bezwen asistans nan sèvis kliyan Kobposh."
  );
});

document.querySelectorAll("[data-kobposh-launch-game]").forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    openStakeModal(item.getAttribute("data-kobposh-launch-game"));
  });
});

closeGamesModalBtn?.addEventListener("click", closeGamesModal);

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeGamesModal();
  closeDepositModal();
  closeStakeModal();
  closeWithdrawalAgentModal();
  closeHistoryModal();
});
