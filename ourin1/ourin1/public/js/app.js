/* ==========================================================================
   JadiBot — shared utilities (toast, modal, api, auth guard, sidebar)
   Dipakai oleh semua halaman lewat <script src="../js/app.js">
   ========================================================================== */

const App = (() => {
  const API_BASE = "/api";

  /* ---------------- toast ---------------- */
  function ensureToastStack() {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  const TOAST_ICONS = {
    success: "fa-circle-check",
    error: "fa-circle-exclamation",
    warn: "fa-triangle-exclamation",
  };

  function toast(message, type = "success", duration = 3200) {
    const stack = ensureToastStack();
    const el = document.createElement("div");
    el.className = `toast ${type === "success" ? "" : type}`.trim();
    el.innerHTML = `<i class="fa-solid ${TOAST_ICONS[type] || TOAST_ICONS.success}"></i><span>${escapeHtml(
      message
    )}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 200);
    }, duration);
  }

  /* ---------------- confirm modal ---------------- */
  function confirmModal({ title = "Konfirmasi", message = "", confirmLabel = "Ya, lanjutkan", danger = true }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button class="btn ghost" data-act="cancel">Batal</button>
            <button class="btn ${danger ? "danger" : ""}" data-act="confirm">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      function close(result) {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") close(false);
      }
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(false);
      });
      overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => close(false));
      overlay.querySelector('[data-act="confirm"]').addEventListener("click", () => close(true));
      document.addEventListener("keydown", onKey);
    });
  }

  /* ---------------- api wrapper ---------------- */
  function token() {
    return localStorage.getItem("jadibot_token") || "";
  }

  async function api(path, { method = "GET", body, silent = false } = {}) {
    try {
      const res = await fetch(API_BASE + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.status === 401) {
        localStorage.removeItem("jadibot_token");
        localStorage.removeItem("jadibot_user");
        if (!location.pathname.includes("login.html")) {
          location.href = "login.html";
        }
        return { success: false, error: "Sesi berakhir, silakan login lagi." };
      }

      if (!res.ok && !data) {
        if (!silent) toast("Tidak bisa menghubungi server.", "error");
        return { success: false, error: "Tidak bisa menghubungi server." };
      }

      if (data && data.success === false && !silent) {
        toast(data.error || "Terjadi kesalahan.", "error");
      }

      return data || { success: false, error: "Respons tidak valid." };
    } catch (err) {
      if (!silent) toast("Tidak bisa menghubungi server.", "error");
      return { success: false, error: "Tidak bisa menghubungi server." };
    }
  }

  /* ---------------- websocket ---------------- */
  function connectSocket(onMessage, { path = "/ws" } = {}) {
    let ws = null;
    let retryDelay = 1500;
    let closedByUser = false;

    function open() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      try {
        ws = new WebSocket(`${proto}//${location.host}${path}`);
      } catch {
        return scheduleRetry();
      }
      ws.addEventListener("message", (ev) => {
        try {
          onMessage(JSON.parse(ev.data));
        } catch {
          /* abaikan pesan yang tidak bisa diparse */
        }
      });
      ws.addEventListener("close", () => {
        if (!closedByUser) scheduleRetry();
      });
      ws.addEventListener("error", () => ws && ws.close());
    }

    function scheduleRetry() {
      setTimeout(open, retryDelay);
      retryDelay = Math.min(retryDelay * 1.5, 15000);
    }

    open();
    return {
      close() {
        closedByUser = true;
        if (ws) ws.close();
      },
    };
  }

  /* ---------------- auth guard ---------------- */
  function requireAuth() {
    if (!token()) {
      location.href = "login.html";
      return false;
    }
    return true;
  }

  function requireAdmin() {
    if (!requireAuth()) return false;
    const user = currentUser();
    if (!user || user.role !== "admin") {
      location.href = "dashboard.html";
      return false;
    }
    return true;
  }

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem("jadibot_user") || "null");
    } catch {
      return null;
    }
  }

  function setSession(tok, user) {
    localStorage.setItem("jadibot_token", tok);
    localStorage.setItem("jadibot_user", JSON.stringify(user));
  }

  function logout() {
    localStorage.removeItem("jadibot_token");
    localStorage.removeItem("jadibot_user");
    location.href = "login.html";
  }

  /* ---------------- sidebar (mobile) ---------------- */
  function initSidebar() {
    const sidebar = document.querySelector(".sidebar");
    const toggle = document.querySelector(".menu-toggle");
    if (!sidebar || !toggle) return;

    let scrim = document.querySelector(".sidebar-scrim");
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.className = "sidebar-scrim";
      document.body.appendChild(scrim);
    }

    function open() {
      sidebar.classList.add("open");
      scrim.classList.add("show");
    }
    function close() {
      sidebar.classList.remove("open");
      scrim.classList.remove("show");
    }
    toggle.addEventListener("click", () => {
      sidebar.classList.contains("open") ? close() : open();
    });
    scrim.addEventListener("click", close);
    sidebar.querySelectorAll(".nav-link").forEach((l) => l.addEventListener("click", close));
  }

  /* ---------------- nav active state + user chip ---------------- */
  function paintUserChip() {
    const user = currentUser();
    if (!user) return;
    const nameEl = document.querySelector("[data-user-name]");
    const emailEl = document.querySelector("[data-user-email]");
    const avatarEl = document.querySelector("[data-user-avatar]");
    if (nameEl) nameEl.textContent = user.name || user.email.split("@")[0];
    if (emailEl) emailEl.textContent = user.email;
    if (avatarEl) avatarEl.textContent = (user.name || user.email).slice(0, 2).toUpperCase();
  }

  function bindLogoutButtons() {
    document.querySelectorAll("[data-logout]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ok = await confirmModal({
          title: "Keluar dari akun?",
          message: "Kamu perlu login lagi untuk mengakses dashboard.",
          confirmLabel: "Ya, keluar",
        });
        if (ok) logout();
      });
    });
  }

  /* ---------------- helpers ---------------- */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "baru saja";
    if (m < 60) return `${m} menit lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} jam lalu`;
    return `${Math.floor(h / 24)} hari lalu`;
  }

  function formatRuntime(seconds) {
    if (!seconds || seconds < 0) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  return {
    toast,
    confirmModal,
    api,
    connectSocket,
    requireAuth,
    requireAdmin,
    currentUser,
    setSession,
    logout,
    initSidebar,
    paintUserChip,
    bindLogoutButtons,
    escapeHtml,
    timeAgo,
    formatRuntime,
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.initSidebar();
  App.paintUserChip();
  App.bindLogoutButtons();
});
