const $ = (id) => document.getElementById(id);

if (!App.requireAuth()) {
  // requireAuth sudah redirect ke login.html
}

/* ---------------- elements ---------------- */
const connDot = $("connDot");
const connLabel = $("connLabel");
const statStatus = $("statStatus");
const statStatusBadge = $("statStatusBadge");
const statRuntime = $("statRuntime");
const statLimit = $("statLimit");
const statLimitBar = $("statLimitBar");
const botCard = $("botCard");

const pairModal = $("pairModal");
const pairStepNumber = $("pairStepNumber");
const pairStepProgress = $("pairStepProgress");
const pairStepCode = $("pairStepCode");
const pairNumber = $("pairNumber");
const pairError = $("pairError");
const pairSubmitBtn = $("pairSubmitBtn");
const pairCancelBtn = $("pairCancelBtn");
const pairCancelBtn2 = $("pairCancelBtn2");
const codeRow = $("codeRow");
const copyCodeBtn = $("copyCodeBtn");
const countdownWrap = $("countdownWrap");
const countdownFill = $("countdownFill");
const countdownText = $("countdownText");
const pairRegenBtn = $("pairRegenBtn");

let bot = null; // status bot terakhir dari server
let runtimeTimer = null;
let countdownTimer = null;
let currentPairingNumber = null;
let currentCode = null;

/* ---------------- render bot card ---------------- */
function renderBotCard() {
  if (!bot || bot.status === "offline") {
    botCard.innerHTML = `
      <div class="empty-bot">
        <div class="icon"><i class="fa-solid fa-robot"></i></div>
        <h3>Belum ada bot aktif</h3>
        <p>Hubungkan nomor WhatsApp-mu untuk mulai jadi bot.</p>
        <button class="btn" id="jadiBotBtn"><span class="btn-label">Jadi Bot</span></button>
      </div>`;
    $("jadiBotBtn").addEventListener("click", openPairModal);
    stopRuntimeTicker();
    statStatus.textContent = "Nonaktif";
    statStatusBadge.textContent = "offline";
    statStatusBadge.className = "badge off";
    statRuntime.textContent = "00:00:00";
    return;
  }

  botCard.innerHTML = `
    <div class="bot-head">
      <div class="bot-profile">
        <span class="avatar">${bot.photo ? `<img src="${bot.photo}" alt="">` : `<i class="fa-solid fa-user"></i>`}</span>
        <div>
          <div class="name">${App.escapeHtml(bot.name || "Bot WhatsApp")}</div>
          <div class="number mono">+${App.escapeHtml(bot.number)}</div>
        </div>
      </div>
      <span class="badge on"><span class="dot active"></span> terhubung</span>
    </div>

    <div class="bot-meta-grid">
      <div>
        <div class="m-label">Runtime</div>
        <div class="m-value" id="botRuntime">${App.formatRuntime(bot.runtimeSeconds || 0)}</div>
      </div>
      <div>
        <div class="m-label">Nomor</div>
        <div class="m-value">+${App.escapeHtml(bot.number)}</div>
      </div>
      <div>
        <div class="m-label">Terhubung sejak</div>
        <div class="m-value">${bot.connectedAt ? App.timeAgo(bot.connectedAt) : "—"}</div>
      </div>
    </div>

    <button class="btn danger block" id="stopBotBtn"><span class="btn-label">Hentikan Jadibot</span></button>
  `;

  $("stopBotBtn").addEventListener("click", stopBot);

  statStatus.textContent = "Aktif";
  statStatusBadge.textContent = "online";
  statStatusBadge.className = "badge on";

  startRuntimeTicker(bot.runtimeSeconds || 0);
}

function startRuntimeTicker(startSeconds) {
  stopRuntimeTicker();
  let seconds = startSeconds;
  statRuntime.textContent = App.formatRuntime(seconds);
  const el = $("botRuntime");
  if (el) el.textContent = App.formatRuntime(seconds);
  runtimeTimer = setInterval(() => {
    seconds += 1;
    statRuntime.textContent = App.formatRuntime(seconds);
    const runtimeEl = $("botRuntime");
    if (runtimeEl) runtimeEl.textContent = App.formatRuntime(seconds);
  }, 1000);
}

function stopRuntimeTicker() {
  if (runtimeTimer) clearInterval(runtimeTimer);
  runtimeTimer = null;
}

/* ---------------- load dashboard ---------------- */
async function loadDashboard() {
  const res = await App.api("/dashboard", { silent: true });
  if (!res.success) {
    connDot.className = "dot error";
    connLabel.textContent = "gagal memuat";
    botCard.innerHTML = `<div class="empty-bot"><div class="icon"><i class="fa-solid fa-plug-circle-xmark"></i></div><h3>Tidak bisa memuat data</h3><p>Periksa koneksi lalu muat ulang halaman.</p></div>`;
    return;
  }

  connDot.className = "dot active";
  connLabel.textContent = "terhubung";

  bot = res.bot || null;
  const limit = res.limit || { used: bot ? 1 : 0, max: 1 };
  statLimit.textContent = `${limit.used} / ${limit.max}`;
  statLimitBar.style.width = `${Math.min(100, (limit.used / Math.max(1, limit.max)) * 100)}%`;

  renderBotCard();
}

/* ---------------- pairing flow ---------------- */
const PROGRESS_STEPS = ["contact", "session", "code", "wait", "sync", "done"];

function resetPairModal() {
  pairStepNumber.classList.remove("hidden");
  pairStepProgress.classList.add("hidden");
  pairStepCode.classList.add("hidden");
  pairNumber.value = "";
  pairError.textContent = "";
  pairSubmitBtn.disabled = false;
  pairSubmitBtn.querySelector(".btn-label").textContent = "Generate Pairing";
  pairRegenBtn.classList.add("hidden");
  document.querySelectorAll("#progressLog .p-item").forEach((el) => el.classList.remove("done", "active"));
  stopCountdown();
}

function openPairModal() {
  resetPairModal();
  pairModal.classList.remove("hidden");
  setTimeout(() => pairNumber.focus(), 50);
}

function closePairModal() {
  pairModal.classList.add("hidden");
  stopCountdown();
  currentPairingNumber = null;
  currentCode = null;
}

function setProgressStep(stepKey, state) {
  const el = document.querySelector(`#progressLog [data-step="${stepKey}"]`);
  if (!el) return;
  el.classList.remove("done", "active");
  if (state) el.classList.add(state);
}

async function markStepsSequential(upTo) {
  const idx = PROGRESS_STEPS.indexOf(upTo);
  for (let i = 0; i < PROGRESS_STEPS.length; i++) {
    if (i < idx) setProgressStep(PROGRESS_STEPS[i], "done");
    else if (i === idx) setProgressStep(PROGRESS_STEPS[i], "active");
    else setProgressStep(PROGRESS_STEPS[i], null);
  }
}

function renderCode(code) {
  codeRow.innerHTML = "";
  for (const ch of code) {
    const box = document.createElement("div");
    if (ch === "-") {
      box.className = "code-digit dash";
      box.textContent = "—";
    } else {
      box.className = "code-digit";
      box.textContent = ch;
    }
    codeRow.appendChild(box);
  }
}

function startCountdown(seconds = 60) {
  stopCountdown();
  const circumference = 62.8;
  let remaining = seconds;
  countdownWrap.classList.remove("expiring");
  pairRegenBtn.classList.add("hidden");
  updateCountdownUI(remaining, seconds, circumference);

  countdownTimer = setInterval(() => {
    remaining -= 1;
    updateCountdownUI(remaining, seconds, circumference);
    if (remaining <= 15) countdownWrap.classList.add("expiring");
    if (remaining <= 0) {
      stopCountdown();
      countdownText.textContent = "Kode kedaluwarsa";
      pairRegenBtn.classList.remove("hidden");
    }
  }, 1000);
}

function updateCountdownUI(remaining, total, circumference) {
  countdownText.textContent = remaining > 0 ? `Kode berlaku ${remaining} detik` : "Kode kedaluwarsa";
  const offset = circumference * (1 - remaining / total);
  countdownFill.setAttribute("stroke-dashoffset", String(offset));
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

async function submitPairing() {
  const raw = pairNumber.value.trim();
  pairError.textContent = "";

  if (!raw) {
    pairError.textContent = "Isi nomor dulu, ya.";
    return;
  }

  pairSubmitBtn.disabled = true;
  pairSubmitBtn.querySelector(".btn-label").textContent = "Memproses…";

  pairStepNumber.classList.add("hidden");
  pairStepProgress.classList.remove("hidden");
  markStepsSequential("contact");

  await sleep(400);
  markStepsSequential("session");

  const res = await App.api("/pairing", { method: "POST", body: { number: raw }, silent: true });

  pairSubmitBtn.disabled = false;
  pairSubmitBtn.querySelector(".btn-label").textContent = "Generate Pairing";

  if (!res.success) {
    pairStepProgress.classList.add("hidden");
    pairStepNumber.classList.remove("hidden");
    pairError.textContent = res.error || "Gagal membuat pairing code.";
    return;
  }

  markStepsSequential("code");
  await sleep(350);

  currentPairingNumber = res.id || raw.replace(/[^0-9]/g, "");
  currentCode = res.pairingCode;

  markStepsSequential("wait");
  pairStepProgress.classList.add("hidden");
  pairStepCode.classList.remove("hidden");
  renderCode(currentCode);
  startCountdown(60);

  pollPairingStatus();
}

async function pollPairingStatus() {
  if (!currentPairingNumber) return;

  const poll = setInterval(async () => {
    if (!currentPairingNumber) {
      clearInterval(poll);
      return;
    }
    const res = await App.api(`/pairing/${currentPairingNumber}/status`, { silent: true });
    if (res.success && res.status === "syncing") {
      markStepsSequential("sync");
    }
    if (res.success && res.status === "connected") {
      clearInterval(poll);
      markStepsSequential("done");
      document.querySelectorAll("#progressLog .p-item").forEach((el) => el.classList.add("done"));
      stopCountdown();
      App.toast("Nomor berhasil terhubung jadi bot.", "success");
      setTimeout(() => {
        closePairModal();
        loadDashboard();
      }, 700);
    }
    if (res.success && res.status === "expired") {
      clearInterval(poll);
      stopCountdown();
      countdownText.textContent = "Kode kedaluwarsa";
      pairRegenBtn.classList.remove("hidden");
    }
  }, 2500);
}

async function regeneratePairing() {
  if (!currentPairingNumber) return;
  pairRegenBtn.disabled = true;
  const res = await App.api("/pairing", { method: "POST", body: { number: currentPairingNumber }, silent: true });
  pairRegenBtn.disabled = false;

  if (!res.success) {
    App.toast(res.error || "Gagal membuat ulang kode.", "error");
    return;
  }

  currentCode = res.pairingCode;
  renderCode(currentCode);
  startCountdown(60);
  pollPairingStatus();
}

async function stopBot() {
  if (!bot) return;
  const ok = await App.confirmModal({
    title: "Hentikan jadibot?",
    message: `Nomor +${bot.number} akan berhenti aktif sebagai bot. Kamu bisa menghubungkannya lagi kapan saja.`,
    confirmLabel: "Ya, hentikan",
  });
  if (!ok) return;

  const btn = $("stopBotBtn");
  if (btn) btn.disabled = true;

  const res = await App.api("/bot/stop", { method: "POST", body: { number: bot.number }, silent: true });

  if (!res.success) {
    App.toast(res.error || "Gagal menghentikan bot.", "error");
    if (btn) btn.disabled = false;
    return;
  }

  App.toast("Jadibot dihentikan.", "success");
  bot = null;
  renderBotCard();
  loadDashboard();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------------- events ---------------- */
pairSubmitBtn.addEventListener("click", submitPairing);
pairNumber.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitPairing();
});
pairCancelBtn.addEventListener("click", closePairModal);
pairCancelBtn2.addEventListener("click", closePairModal);
pairRegenBtn.addEventListener("click", regeneratePairing);
pairModal.addEventListener("click", (e) => {
  if (e.target === pairModal) closePairModal();
});

copyCodeBtn.addEventListener("click", async () => {
  if (!currentCode) return;
  try {
    await navigator.clipboard.writeText(currentCode.replace(/-/g, ""));
    copyCodeBtn.textContent = "Tersalin ✓";
    setTimeout(() => (copyCodeBtn.textContent = "Salin kode"), 1500);
  } catch {
    copyCodeBtn.textContent = "Gagal menyalin";
  }
});

/* ---------------- websocket realtime ---------------- */
App.connectSocket((msg) => {
  if (msg.type === "bot_status" && bot && msg.number === bot.number) {
    bot = { ...bot, ...msg.data };
    renderBotCard();
  }
  if (msg.type === "pairing_status" && currentPairingNumber && msg.number === currentPairingNumber) {
    if (msg.status === "connected") {
      loadDashboard();
    }
  }
});

/* ---------------- init ---------------- */
loadDashboard();
