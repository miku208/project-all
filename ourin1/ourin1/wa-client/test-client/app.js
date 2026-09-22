/* MikuWA Gateway — debug client (bukan produk final) */
const $ = (id) => document.getElementById(id);
const state = {
  baseUrl: localStorage.getItem("gw_url") || location.origin,
  token: null,
  refreshToken: null,
  ws: null,
  wsRetry: 0,
  currentChat: null,
  messages: [], // [{chatId, messageId, ...}] dedup by messageId
};

// ===== Helpers =====
async function api(path, opts = {}) {
  const res = await fetch(state.baseUrl + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 && state.refreshToken) {
    const ok = await tryRefresh();
    if (ok) return api(path, opts);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function tryRefresh() {
  try {
    const r = await fetch(state.baseUrl + "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    state.token = data.accessToken;
    if (data.refreshToken) state.refreshToken = data.refreshToken;
    return true;
  } catch {
    return false;
  }
}

function logWs(text) {
  const el = $("ws-log");
  const line = `[${new Date().toLocaleTimeString()}] ${text}`;
  el.textContent = line + "\n" + el.textContent;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ===== Login =====
$("btn-login").onclick = async () => {
  $("login-err").textContent = "";
  state.baseUrl = $("in-url").value.replace(/\/$/, "");
  localStorage.setItem("gw_url", state.baseUrl);
  try {
    const r = await fetch(state.baseUrl + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: $("in-user").value,
        password: $("in-pass").value,
        deviceName: "web-debug-client",
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Login gagal");
    state.token = data.accessToken;
    state.refreshToken = data.refreshToken;
    sessionStorage.setItem("gw_rt", state.refreshToken);
    enterApp();
  } catch (e) {
    $("login-err").textContent = e.message;
  }
};
$("in-pass").addEventListener("keydown", (e) => e.key === "Enter" && $("btn-login").click());

function enterApp() {
  $("screen-login").classList.add("hidden");
  $("screen-app").classList.remove("hidden");
  connectWs();
  loadStatus();
  loadChats();
  loadSettings();
  loadPlugins();
  loadDevices();
}

$("btn-logout").onclick = async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  location.reload();
};

// ===== WebSocket dengan reconnect + exponential backoff =====
function connectWs() {
  if (state.ws) { try { state.ws.close(); } catch {} }
  const wsUrl = state.baseUrl.replace(/^http/, "ws") + "/ws?token=" + encodeURIComponent(state.token);
  state.ws = new WebSocket(wsUrl);
  state.ws.onopen = () => { state.wsRetry = 0; setDot("badge-ws", true); logWs("WS connected"); };
  state.ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleWsEvent(msg);
  };
  state.ws.onclose = (ev) => {
    setDot("badge-ws", false);
    logWs(`WS closed (${ev.code}) — reconnect ${Math.min(2 ** state.wsRetry, 30)}s`);
    const delay = Math.min(1000 * 2 ** state.wsRetry, 30000);
    state.wsRetry++;
    setTimeout(connectWs, delay);
  };
  state.ws.onerror = () => {};
}

function handleWsEvent(msg) {
  logWs(JSON.stringify(msg).slice(0, 140));
  switch (msg.type) {
    case "message.received":
    case "message.sent": {
      const m = msg.data;
      if (state.currentChat === m.chatId && !state.messages.some((x) => x.messageId === m.messageId)) {
        state.messages.push(m);
        renderMessages();
      }
      loadChats(); // update snippet + urutan
      break;
    }
    case "chat.read": {
      const item = document.querySelector(`#chat-list li[data-id="${CSS.escape(msg.data.chatId)}"] .unread-badge`);
      if (item) item.remove();
      break;
    }
    case "bot.settings.updated":
      loadStatus();
      break;
    case "connection.updated":
      if (msg.data?.bot) setDot("badge-bot", msg.data.bot.state === "connected");
      break;
  }
}

function setDot(id, on) {
  const el = $(id);
  el.className = "dot " + (on ? "on" : "off");
}

// ===== Status =====
async function loadStatus() {
  try {
    const s = await api("/api/status");
    setDot("badge-bot", s.bot.state === "connected");
    $("badge-adapter").textContent = s.gateway.adapterMode;
    const h = Math.floor(s.bot.uptimeMs / 3600000);
    const m = Math.floor((s.bot.uptimeMs % 3600000) / 60000);
    $("uptime").textContent = `${h}h ${m}m`;
  } catch (e) { logWs("status: " + e.message); }
}

// ===== Chats =====
async function loadChats() {
  try {
    const { chats } = await api("/api/chats?limit=50");
    const ul = $("chat-list");
    ul.innerHTML = "";
    for (const c of chats) {
      const li = document.createElement("li");
      li.dataset.id = c.id;
      li.innerHTML = `
        <div>
          <div class="title">${escapeHtml(c.name || c.id)}</div>
          <div class="snippet">${escapeHtml(c.last_message_text || "")}</div>
        </div>
        <div class="meta">
          <span>${c.last_message_ts ? fmtTime(c.last_message_ts) : ""}</span>
          ${c.unread > 0 ? `<span class="unread-badge">${c.unread}</span>` : ""}
          ${c.pinned ? "📌" : ""}${c.muted ? "🔇" : ""}
        </div>`;
      li.onclick = () => openChat(c.id, c.name || c.id);
      ul.appendChild(li);
    }
  } catch (e) { logWs("chats: " + e.message); }
}

async function openChat(chatId, title) {
  state.currentChat = chatId;
  $("chat-view").classList.remove("hidden");
  $("chat-title").textContent = title;
  try {
    const { messages } = await api(`/api/chats/${encodeURIComponent(chatId)}/messages?limit=30`);
    state.messages = messages.map(mapDbMessage);
    renderMessages();
    api(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: "PATCH", body: JSON.stringify({ unread: 0 }) }).catch(() => {});
  } catch (e) { logWs("openChat: " + e.message); }
}

function mapDbMessage(r) {
  return {
    messageId: r.message_id,
    chatId: r.chat_id,
    text: r.text,
    senderName: r.sender_name,
    isFromMe: !!r.is_from_me,
    timestamp: r.timestamp,
    status: r.status,
    messageType: r.message_type,
  };
}

function renderMessages() {
  const box = $("msg-list");
  box.innerHTML = "";
  for (const m of state.messages) {
    const div = document.createElement("div");
    div.className = "msg" + (m.isFromMe ? " me" : "");
    div.innerHTML = `${escapeHtml(m.text || `[${m.messageType}]`)}<div class="m-meta">${fmtTime(m.timestamp)} ${m.isFromMe ? "✓" : ""}</div>`;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

$("btn-send").onclick = async () => {
  const text = $("in-msg").value.trim();
  if (!text || !state.currentChat) return;
  $("in-msg").value = "";
  try {
    const { message } = await api(`/api/chats/${encodeURIComponent(state.currentChat)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (!state.messages.some((x) => x.messageId === message.messageId)) {
      state.messages.push(message);
      renderMessages();
    }
  } catch (e) { logWs("send: " + e.message); }
};
$("in-msg").addEventListener("keydown", (e) => e.key === "Enter" && $("btn-send").click());

$("btn-back").onclick = () => {
  state.currentChat = null;
  $("chat-view").classList.add("hidden");
};
$("btn-refresh").onclick = loadChats;
$("in-search").addEventListener("input", debounce(loadChats, 300));

// ===== Settings =====
async function loadSettings() {
  try {
    const { settings } = await api("/api/bot/settings");
    $("s-name").value = settings.botName || "";
    $("s-prefix").value = settings.prefix || ".";
    document.querySelector(`input[name="s-mode"][value="${settings.mode}"]`).checked = true;
    $("s-autoread").checked = !!settings.autoRead;
    $("s-autotyping").checked = !!settings.autoTyping;
  } catch (e) { logWs("settings: " + e.message); }
}

$("btn-save-settings").onclick = async () => {
  $("settings-result").textContent = "";
  const body = {
    botName: $("s-name").value.trim(),
    prefix: $("s-prefix").value,
    mode: document.querySelector('input[name="s-mode"]:checked')?.value,
    autoRead: $("s-autoread").checked,
    autoTyping: $("s-autotyping").checked,
  };
  try {
    const r = await api("/api/bot/settings", { method: "PATCH", body: JSON.stringify(body) });
    $("settings-result").textContent = "OK: " + (r.applied || []).join(", ");
  } catch (e) {
    $("settings-result").textContent = "GAGAL: " + e.message;
  }
};

// ===== Plugins =====
async function loadPlugins() {
  try {
    const { plugins } = await api("/api/plugins");
    const ul = $("plugin-list");
    ul.innerHTML = "";
    for (const p of plugins) {
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <div class="title">${escapeHtml(p.name)}</div>
          <div class="snippet">${escapeHtml(p.description || "")}</div>
        </div>
        <label class="row">ON <input type="checkbox" ${p.enabled ? "checked" : ""} data-plugin="${escapeHtml(p.name)}" /></label>`;
      ul.appendChild(li);
      li.querySelector("input").onchange = async (e) => {
        try {
          await api(`/api/plugins/${encodeURIComponent(p.name)}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled: e.target.checked }),
          });
        } catch (err) {
          e.target.checked = !e.target.checked;
          logWs("plugin: " + err.message);
        }
      };
    }
  } catch (e) { logWs("plugins: " + e.message); }
}

// ===== Devices =====
async function loadDevices() {
  try {
    const { devices } = await api("/auth/devices");
    const ul = $("device-list");
    ul.innerHTML = "";
    for (const d of devices) {
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <div class="title">${escapeHtml(d.name)}</div>
          <div class="snippet">${escapeHtml(d.id.slice(0, 8))} • last seen ${fmtTime(d.last_seen_at)}</div>
        </div>
        <button class="ghost">Revoke</button>`;
      li.querySelector("button").onclick = async () => {
        try {
          await api(`/auth/devices/${encodeURIComponent(d.id)}`, { method: "DELETE" });
          loadDevices();
        } catch (e) { logWs("revoke: " + e.message); }
      };
      ul.appendChild(li);
    }
  } catch (e) { logWs("devices: " + e.message); }
}

// ===== Utils =====
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Auto-refresh status tiap 30 detik (fallback, bukan pengganti WS)
setInterval(() => { if (state.token) loadStatus(); }, 30000);
