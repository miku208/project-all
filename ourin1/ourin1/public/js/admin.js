const $ = (id) => document.getElementById(id);

if (!App.requireAdmin()) {
  // requireAdmin sudah redirect kalau bukan admin / belum login
}

const connDot = $("connDot");
const connLabel = $("connLabel");
const sectionTitle = $("sectionTitle");

const SECTION_TITLES = {
  overview: "Dashboard",
  users: "Users",
  bots: "Bots",
  logs: "Logs",
  settings: "Settings",
};

const loadedSections = new Set();

/* ---------------- section routing ---------------- */
function showSection(name) {
  document.querySelectorAll("[id^='sec-']").forEach((s) => s.classList.add("hidden"));
  const target = $(`sec-${name}`);
  if (target) {
    target.classList.remove("hidden");
    target.classList.add("fade-in");
  }
  document.querySelectorAll(".nav-link[data-section]").forEach((l) => {
    l.classList.toggle("active", l.dataset.section === name);
  });
  sectionTitle.textContent = SECTION_TITLES[name] || "Dashboard";
  location.hash = name;

  if (!loadedSections.has(name)) {
    loadedSections.add(name);
    if (name === "overview") loadOverview();
    if (name === "users") loadUsers();
    if (name === "bots") loadBots();
    if (name === "logs") loadLogs();
    if (name === "settings") loadSettings();
  }
}

document.querySelectorAll(".nav-link[data-section]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    showSection(link.dataset.section);
  });
});

const initialSection = location.hash.replace("#", "") || "overview";
showSection(SECTION_TITLES[initialSection] ? initialSection : "overview");

/* ---------------- overview ---------------- */
async function loadOverview() {
  const res = await App.api("/admin/overview", { silent: true });
  if (!res.success) {
    connDot.className = "dot error";
    connLabel.textContent = "gagal memuat";
    return;
  }
  connDot.className = "dot active";
  connLabel.textContent = "terhubung";

  $("statTotalUser").textContent = res.totalUsers ?? "0";
  $("statBotOnline").textContent = res.botOnline ?? "0";
  $("statBotOffline").textContent = res.botOffline ?? "0";
  $("statUptime").textContent = res.uptime || "—";

  setBar("cpu", res.cpu ?? 0);
  setBar("ram", res.ram ?? 0);
  setBar("storage", res.storage ?? 0);
}

function setBar(key, pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  $(`${key}Pct`).textContent = `${Math.round(clamped)}%`;
  const bar = $(`${key}Bar`);
  const span = bar.querySelector("span") || bar;
  span.style.width = `${clamped}%`;
  bar.classList.remove("warn", "danger");
  if (clamped >= 90) bar.classList.add("danger");
  else if (clamped >= 70) bar.classList.add("warn");
}

/* ---------------- users ---------------- */
let allUsers = [];

async function loadUsers() {
  const res = await App.api("/users", { silent: true });
  const tbody = $("usersBody");

  if (!res.success) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Gagal memuat data user.</td></tr>`;
    return;
  }

  allUsers = res.users || [];
  renderUsers(allUsers);
}

function renderUsers(list) {
  const tbody = $("usersBody");
  if (!list.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Belum ada user.</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (u) => `
    <tr>
      <td class="cell-strong">${App.escapeHtml(u.email)}</td>
      <td><span class="badge ${u.role === "admin" ? "on" : "off"}">${App.escapeHtml(u.role)}</span></td>
      <td><span class="badge ${u.status === "banned" ? "danger" : "on"}">${u.status === "banned" ? "banned" : "aktif"}</span></td>
      <td>${u.activeBots ?? 0}</td>
      <td class="actions-cell">
        <button class="btn ghost sm" data-act="edit" data-id="${u.id}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn ghost sm" data-act="ban" data-id="${u.id}">
          <i class="fa-solid fa-ban"></i> ${u.status === "banned" ? "Unban" : "Ban"}
        </button>
        <button class="btn danger sm" data-act="delete" data-id="${u.id}"><i class="fa-solid fa-trash"></i> Delete</button>
      </td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-act='ban']").forEach((btn) => btn.addEventListener("click", () => toggleBanUser(btn.dataset.id)));
  tbody.querySelectorAll("[data-act='delete']").forEach((btn) => btn.addEventListener("click", () => deleteUser(btn.dataset.id)));
  tbody.querySelectorAll("[data-act='edit']").forEach((btn) => btn.addEventListener("click", () => App.toast("Fitur edit user segera hadir.", "warn")));
}

$("userSearch").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderUsers(allUsers.filter((u) => u.email.toLowerCase().includes(q)));
});

async function toggleBanUser(id) {
  const user = allUsers.find((u) => String(u.id) === String(id));
  if (!user) return;
  const willBan = user.status !== "banned";

  const ok = await App.confirmModal({
    title: willBan ? "Ban user ini?" : "Buka blokir user ini?",
    message: willBan
      ? `${user.email} tidak akan bisa mengakses dashboard sampai di-unban.`
      : `${user.email} akan bisa mengakses dashboard kembali.`,
    confirmLabel: willBan ? "Ya, ban" : "Ya, unban",
  });
  if (!ok) return;

  const res = await App.api(`/users/${id}/ban`, { method: "POST", body: { banned: willBan }, silent: true });
  if (!res.success) {
    App.toast(res.error || "Gagal memperbarui status user.", "error");
    return;
  }
  App.toast(willBan ? "User diblokir." : "User dibuka blokirnya.", "success");
  loadedSections.delete("users");
  loadUsers();
}

async function deleteUser(id) {
  const user = allUsers.find((u) => String(u.id) === String(id));
  if (!user) return;

  const ok = await App.confirmModal({
    title: "Hapus user ini?",
    message: `${user.email} beserta seluruh data bot miliknya akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.`,
    confirmLabel: "Ya, hapus",
  });
  if (!ok) return;

  const res = await App.api(`/users/${id}`, { method: "DELETE", silent: true });
  if (!res.success) {
    App.toast(res.error || "Gagal menghapus user.", "error");
    return;
  }
  App.toast("User dihapus.", "success");
  loadedSections.delete("users");
  loadUsers();
}

/* ---------------- bots ---------------- */
let allBots = [];

async function loadBots() {
  const res = await App.api("/bots", { silent: true });
  const tbody = $("botsBody");

  if (!res.success) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Gagal memuat data bot.</td></tr>`;
    return;
  }

  allBots = res.bots || [];
  renderBots(allBots);
}

function renderBots(list) {
  const tbody = $("botsBody");
  if (!list.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Belum ada bot terdaftar.</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (b) => `
    <tr>
      <td class="cell-strong mono">+${App.escapeHtml(b.number)}</td>
      <td>${App.escapeHtml(b.owner)}</td>
      <td><span class="badge ${b.status === "online" ? "on" : "off"}">${b.status === "online" ? "online" : "offline"}</span></td>
      <td class="mono">${App.formatRuntime(b.runtimeSeconds || 0)}</td>
      <td class="actions-cell">
        <button class="btn ghost sm" data-act="disconnect" data-number="${b.number}" ${b.status !== "online" ? "disabled" : ""}>
          <i class="fa-solid fa-plug-circle-xmark"></i> Disconnect
        </button>
        <button class="btn danger sm" data-act="delete-session" data-number="${b.number}"><i class="fa-solid fa-trash"></i> Delete Session</button>
      </td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-act='disconnect']").forEach((btn) => btn.addEventListener("click", () => disconnectBot(btn.dataset.number)));
  tbody.querySelectorAll("[data-act='delete-session']").forEach((btn) => btn.addEventListener("click", () => deleteBotSession(btn.dataset.number)));
}

$("botSearch").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderBots(allBots.filter((b) => b.number.toLowerCase().includes(q) || b.owner.toLowerCase().includes(q)));
});

async function disconnectBot(number) {
  const ok = await App.confirmModal({
    title: "Disconnect bot ini?",
    message: `Nomor +${number} akan langsung diputus dari sesi WhatsApp.`,
    confirmLabel: "Ya, disconnect",
  });
  if (!ok) return;

  const res = await App.api(`/bots/${number}/disconnect`, { method: "POST", silent: true });
  if (!res.success) {
    App.toast(res.error || "Gagal disconnect bot.", "error");
    return;
  }
  App.toast("Bot diputus.", "success");
  loadedSections.delete("bots");
  loadBots();
}

async function deleteBotSession(number) {
  const ok = await App.confirmModal({
    title: "Hapus session bot ini?",
    message: `Semua data session untuk +${number} akan dihapus permanen. Pemilik harus pairing ulang dari awal.`,
    confirmLabel: "Ya, hapus session",
  });
  if (!ok) return;

  const res = await App.api(`/bots/${number}/session`, { method: "DELETE", silent: true });
  if (!res.success) {
    App.toast(res.error || "Gagal menghapus session.", "error");
    return;
  }
  App.toast("Session bot dihapus.", "success");
  loadedSections.delete("bots");
  loadBots();
}

/* ---------------- logs ---------------- */
async function loadLogs() {
  const res = await App.api("/admin/logs", { silent: true });
  const tbody = $("logsBody");

  if (!res.success) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Gagal memuat log.</td></tr>`;
    return;
  }

  const logs = res.logs || [];
  if (!logs.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Belum ada aktivitas.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs
    .map(
      (l) => `
    <tr>
      <td class="cell-strong">${App.escapeHtml(l.user)}</td>
      <td>${App.escapeHtml(l.activity)}</td>
      <td class="mono">${App.escapeHtml(l.date)}</td>
    </tr>`
    )
    .join("");
}

/* ---------------- settings ---------------- */
async function loadSettings() {
  const res = await App.api("/admin/settings", { silent: true });
  if (!res.success) return;
  $("maxBot").value = res.maxBot ?? 1;
  $("maintenanceToggle").checked = !!res.maintenance;
}

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("saveSettingsBtn");
  btn.disabled = true;
  btn.querySelector(".btn-label").textContent = "Menyimpan…";

  const res = await App.api("/admin/settings", {
    method: "POST",
    body: {
      maxBot: Number($("maxBot").value) || 1,
      maintenance: $("maintenanceToggle").checked,
    },
    silent: true,
  });

  btn.disabled = false;
  btn.querySelector(".btn-label").textContent = "Simpan";

  if (!res.success) {
    App.toast(res.error || "Gagal menyimpan pengaturan.", "error");
    return;
  }
  App.toast("Pengaturan disimpan.", "success");
});

/* ---------------- websocket realtime ---------------- */
App.connectSocket((msg) => {
  if (msg.type === "admin_overview") {
    loadedSections.delete("overview");
    if (!$("sec-overview").classList.contains("hidden")) loadOverview();
  }
  if (msg.type === "bot_status") {
    loadedSections.delete("bots");
    if (!$("sec-bots").classList.contains("hidden")) loadBots();
  }
});
