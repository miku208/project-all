import { BotAdapter, EVENTS } from "./botAdapter.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * MockBotAdapter — data dummy JUJUR untuk development/testing Gateway & APK
 * sebelum integrasi ke bot utama. TIDAK mengklaim terhubung ke WhatsApp.
 *
 * Aktif dengan ADAPTER_MODE=mock (default).
 */
export class MockBotAdapter extends BotAdapter {
  constructor() {
    super();
    this._startedAt = Date.now();
    this._state = "connected";
    this._plugins = [
      { name: "Downloader", description: "Download media (YT, IG, TikTok)", version: "1.2.0", enabled: true },
      { name: "AI", description: "Auto reply AI (Gemini)", version: "2.0.1", enabled: true },
      { name: "Games", description: "Permainan grup (family100, tebak gambar)", version: "1.0.0", enabled: true },
      { name: "Group", description: "Fitur grup (welcome, antilink)", version: "1.4.0", enabled: true },
      { name: "Owner", description: "Perintah khusus owner", version: "1.1.0", enabled: true },
    ];
    this._settings = {
      botName: "MikuBot",
      mode: "self", // sesuai bot utama saat ini
      prefix: ".",
      autoRead: false,
      autoTyping: false,
    };
    this._chats = [
      {
        id: "6285189063747@s.whatsapp.net",
        name: "Owner",
        lastMessageText: "siap, sudah aku cek",
        lastMessageTs: Date.now() - 5 * 60 * 1000,
        unread: 2,
        pinned: true,
        muted: false,
        isGroup: false,
      },
      {
        id: "6281234567890@s.whatsapp.net",
        name: "Alip",
        lastMessageText: "bang ready?",
        lastMessageTs: Date.now() - 60 * 60 * 1000,
        unread: 0,
        pinned: false,
        muted: false,
        isGroup: false,
      },
      {
        id: "120363021234567890@g.us",
        name: "Group Bot",
        lastMessageText: ".menu",
        lastMessageTs: Date.now() - 26 * 60 * 60 * 1000,
        unread: 0,
        pinned: false,
        muted: true,
        isGroup: true,
      },
    ];
    this._messages = {
      "6285189063747@s.whatsapp.net": [
        {
          messageId: "MOCKMSG001",
          chatId: "6285189063747@s.whatsapp.net",
          senderId: "6285189063747@s.whatsapp.net",
          senderName: "Owner",
          messageType: "text",
          text: "cek gateway jalan?",
          timestamp: Date.now() - 10 * 60 * 1000,
          isFromMe: false,
          status: "read",
        },
        {
          messageId: "MOCKMSG002",
          chatId: "6285189063747@s.whatsapp.net",
          senderId: "bot",
          senderName: "MikuBot",
          messageType: "text",
          text: "siap, sudah aku cek",
          timestamp: Date.now() - 5 * 60 * 1000,
          isFromMe: true,
          status: "delivered",
        },
      ],
    };
    this._contacts = [
      { id: "6285189063747@s.whatsapp.net", name: "Owner", notify: "Owner", status: "" },
      { id: "6281234567890@s.whatsapp.net", name: "Alip", notify: "Alip", status: "hello IT" },
      { id: "6289876543210@s.whatsapp.net", name: "Mundi", notify: "Mundi", status: "" },
    ];
  }

  getConnectionStatus() {
    return { state: this._state, uptimeMs: Date.now() - this._startedAt };
  }

  async getChats() {
    return [...this._chats].sort((a, b) => (b.lastMessageTs || 0) - (a.lastMessageTs || 0));
  }

  async getChat(chatId) {
    return this._chats.find((c) => c.id === chatId) || null;
  }

  async getMessages(chatId, { limit = 30, before = null } = {}) {
    let msgs = this._messages[chatId] || [];
    if (before) msgs = msgs.filter((m) => m.timestamp < before);
    return msgs.slice(-limit);
  }

  async sendMessage(chatId, text, { replyTo } = {}) {
    await wait(150);
    const msg = {
      messageId: `MOCK${Date.now()}`,
      chatId,
      senderId: "bot",
      senderName: "MikuBot",
      messageType: "text",
      text,
      timestamp: Date.now(),
      isFromMe: true,
      status: "sent",
      replyTo: replyTo || null,
    };
    this._messages[chatId] = this._messages[chatId] || [];
    this._messages[chatId].push(msg);
    const chat = this._chats.find((c) => c.id === chatId);
    if (chat) {
      chat.lastMessageText = text;
      chat.lastMessageTs = msg.timestamp;
    }
    setImmediate(() => {
      this._emit(EVENTS.MESSAGE_SENT, msg);
      this._emit(EVENTS.CHAT_UPDATED, { chatId, lastMessageText: text, lastMessageTs: msg.timestamp });
    });
    return msg;
  }

  async getContacts() {
    return this._contacts;
  }

  async getGroups() {
    return this._chats.filter((c) => c.isGroup);
  }

  async getBotSettings() {
    return { ...this._settings };
  }

  async updateBotSetting(key, value) {
    if (!this.getSupportedSettings().includes(key)) {
      return { ok: false, applied: [], error: `Setting "${key}" tidak didukung` };
    }
    if (key === "mode" && value !== "public" && value !== "self") {
      return {
        ok: false,
        applied: [],
        error: 'Mode hanya "public" atau "self" (bot core belum dukung "private")',
      };
    }
    if (key === "prefix" && (typeof value !== "string" || value.length > 4)) {
      return { ok: false, applied: [], error: "Prefix maksimal 4 karakter" };
    }
    if (key === "autoRead" && typeof value !== "boolean") {
      return { ok: false, applied: [], error: "autoRead harus boolean" };
    }
    if (key === "autoTyping" && typeof value !== "boolean") {
      return { ok: false, applied: [], error: "autoTyping harus boolean" };
    }
    this._settings[key] = value;
    setImmediate(() => {
      this._emit(EVENTS.BOT_SETTINGS_UPDATED, { key, value });
    });
    return { ok: true, applied: [key] };
  }

  async getPlugins() {
    return this._plugins.map((p) => ({ ...p }));
  }

  async enablePlugin(name) {
    const p = this._plugins.find((x) => x.name === name);
    if (!p) return { ok: false, error: `Plugin "${name}" tidak ditemukan` };
    p.enabled = true;
    setImmediate(() => this._emit(EVENTS.PLUGIN_UPDATED, { name, enabled: true }));
    return { ok: true };
  }

  async disablePlugin(name) {
    const pl = this._plugins.find((x) => x.name === name);
    if (!pl) return { ok: false, error: `Plugin "${name}" tidak ditemukan` };
    pl.enabled = false;
    setImmediate(() => this._emit(EVENTS.PLUGIN_UPDATED, { name, enabled: false }));
    return { ok: true };
  }

  // ===== Blokir (mock) =====

  async getBlocked() {
    return { blocked: this._blocked || (this._blocked = []) };
  }

  async blockContact(jid) {
    this._blocked = this._blocked || [];
    if (!this._blocked.includes(jid)) this._blocked.push(jid);
    return { ok: true };
  }

  async unblockContact(jid) {
    this._blocked = (this._blocked || []).filter((x) => x !== jid);
    return { ok: true };
  }

  // ===== Profil bot (mock) =====
  async getBotProfile() {
    return {
      profile: {
        number: "6285189063747",
        name: this._settings.botName || "MikuBot",
        bio: "Mock profile bio",
      },
    };
  }

  async updateBotProfile(key, value) {
    if (key !== "name" && key !== "bio") return { ok: false, error: 'Key harus "name" atau "bio"' };
    if (key === "name") this._settings.botName = value;
    return { ok: true };
  }

  async startPrivateChat(number) {
    const digits = String(number || "").replace(/[^0-9]/g, "");
    if (!digits || digits.length < 8) return { ok: false, error: "Nomor tidak valid" };
    const jid = `${digits}@s.whatsapp.net`;
    let chat = this._chats.find((c) => c.id === jid);
    if (!chat) {
      chat = { id: jid, name: digits, lastMessageText: null, lastMessageTs: null, unread: 0, pinned: false, muted: false, isGroup: false };
      this._chats.push(chat);
    }
    return { ok: true, chat };
  }

  async getMessageText(chatId, messageId) {
    const msgs = this._messages[chatId] || [];
    return msgs.find((m) => m.messageId === messageId)?.text ?? null;
  }

  // ===== Media (mock) — menyimulasikan kirim/terima media tanpa WA asli =====

  async sendMedia(chatId, media) {
    await wait(200);
    if (!media || !Buffer.isBuffer(media.buffer) || media.buffer.length === 0) {
      throw new Error("Buffer media kosong / tidak valid");
    }
    const type = String(media.type || "").toLowerCase();
    if (!["image", "video", "audio", "sticker", "document"].includes(type)) {
      throw new Error(`Tipe media tidak didukung: ${type || "(kosong)"}`);
    }
    const msg = {
      messageId: `MOCKMEDIA${Date.now()}`,
      chatId,
      senderId: "bot",
      senderName: "MikuBot",
      messageType: type,
      text: media.caption || null,
      mediaMetadata: {
        mimetype: media.mimetype || null,
        fileName: media.fileName || null,
        fileLength: media.buffer.length,
        caption: media.caption || null,
        seconds: null,
      },
      timestamp: Date.now(),
      isFromMe: true,
      status: "sent",
      replyTo: media.replyTo || null,
    };
    // Simpan bytes di memori supaya GET media bisa “mengembalikan” file yang sama
    this._mockMedia = this._mockMedia || new Map();
    this._mockMedia.set(`${chatId}|${msg.messageId}`, media.buffer);
    this._messages[chatId] = this._messages[chatId] || [];
    this._messages[chatId].push(msg);
    const chat = this._chats.find((c) => c.id === chatId);
    if (chat) {
      const label = { image: "Foto", video: "Video", audio: "Audio", sticker: "Stiker", document: "Dokumen" }[type] || type;
      chat.lastMessageText = media.caption ? `[${label}] ${media.caption}` : `[${label}]`;
      chat.lastMessageTs = msg.timestamp;
    }
    setImmediate(() => {
      this._emit(EVENTS.MESSAGE_SENT, msg);
      this._emit(EVENTS.CHAT_UPDATED, { chatId, lastMessageText: chat?.lastMessageText, lastMessageTs: msg.timestamp });
    });
    return msg;
  }

  async getMedia(chatId, messageId) {
    const buf = this._mockMedia?.get(`${chatId}|${messageId}`);
    if (!buf) return { ok: false, error: "Media mock tidak ditemukan (kirim dulu lewat sendMedia)" };
    return {
      ok: true,
      buffer: buf,
      info: { type: "image", mimetype: "image/jpeg", fileName: null, caption: null, seconds: null },
    };
  }

  // ===== Manajemen chat (mock) =====

  async leaveGroup(chatId) {
    if (!chatId?.endsWith("@g.us")) {
      return { ok: false, error: "Hanya grup yang bisa ditinggalkan" };
    }
    this._chats = this._chats.filter((c) => c.id !== chatId);
    delete this._messages[chatId];
    this._emit(EVENTS.CHAT_UPDATED, { chatId, deleted: true });
    return { ok: true };
  }

  async deleteMessage(chatId, messageId, scope = "me") {
    const msgs = this._messages[chatId];
    if (msgs) {
      const idx = msgs.findIndex((m) => m.messageId === messageId);
      if (idx !== -1) {
        if (scope === "everyone") msgs.splice(idx, 1);
        else msgs[idx].status = "deleted";
      }
    }
    this._emit(EVENTS.MESSAGE_DELETED, { chatId, messageId });
    return { ok: true };
  }

  async deleteChat(chatId) {
    this._chats = this._chats.filter((c) => c.id !== chatId);
    delete this._messages[chatId];
    this._mockMedia?.forEach((_, k) => {
      if (k.startsWith(chatId + "|")) this._mockMedia.delete(k);
    });
    this._emit(EVENTS.CHAT_UPDATED, { chatId, deleted: true });
    return { ok: true };
  }

  // ===== Kelola member grup (mock) =====

  _mockMembers() {
    return [
      { id: "6285189063747@s.whatsapp.net", name: "Owner", isAdmin: true, isSuperAdmin: true },
      { id: "6281234567890@s.whatsapp.net", name: "Alip", isAdmin: false, isSuperAdmin: false },
      { id: "6289876543210@s.whatsapp.net", name: "Mundi", isAdmin: false, isSuperAdmin: false },
    ];
  }

  async getGroupMembers(chatId) {
    if (!chatId?.endsWith("@g.us")) return { ok: false, error: "Bukan JID grup" };
    return { ok: true, members: this._mockMembers(), subject: "Group Bot (MOCK)" };
  }

  async addParticipants(chatId, jids) {
    if (!chatId?.endsWith("@g.us")) return { ok: false, error: "Bukan JID grup" };
    if (!Array.isArray(jids) || jids.length === 0) return { ok: false, error: "Daftar nomor kosong" };
    const added = [];
    const failed = [];
    for (const j of jids) {
      const digits = String(j).replace(/[^0-9]/g, "");
      if (digits.startsWith("0")) failed.push({ jid: j, error: "403: nomor menolak dimasukkan grup (setting privasi) — kirim undangan manual" });
      else added.push(`${digits}@s.whatsapp.net`);
    }
    return { ok: true, added, failed };
  }

  async removeParticipants(chatId, jids) {
    if (!chatId?.endsWith("@g.us")) return { ok: false, error: "Bukan JID grup" };
    if (!Array.isArray(jids) || jids.length === 0) return { ok: false, error: "Daftar nomor kosong" };
    const removed = jids.map((j) => (String(j).includes("@") ? j : `${String(j).replace(/[^0-9]/g, "")}@s.whatsapp.net`));
    return { ok: true, removed, failed: [] };
  }

  // Mock promote/demote: selalu sukses, balik daftar jid yang "diubah".
  async setGroupAdmins(chatId, jids, action) {
    if (!chatId?.endsWith("@g.us")) return { ok: false, error: "Bukan JID grup" };
    if (action !== "promote" && action !== "demote") {
      return { ok: false, error: 'action harus "promote" atau "demote"' };
    }
    if (!Array.isArray(jids) || jids.length === 0) return { ok: false, error: "Daftar nomor kosong" };
    const changed = jids.map((j) => (String(j).includes("@") ? j : `${String(j).replace(/[^0-9]/g, "")}@s.whatsapp.net`));
    return { ok: true, changed, failed: [] };
  }

  async sendGroupInvite(chatId, targetNumber, message) {
    if (!chatId?.endsWith("@g.us")) return { ok: false, error: "Bukan JID grup" };
    return { ok: true, url: "https://chat.whatsapp.com/MOCKinvite123", target: String(targetNumber) };
  }

  // ===== YouTube (mock) =====

  async ytSearch(query) {
    const q = String(query || "").trim();
    if (!q) return { ok: false, error: "Query kosong" };
    const videos = [1, 2, 3, 4, 5].map((i) => ({
      videoId: `MOCK${i}abcde`,
      title: `[MOCK] ${q} — hasil ${i}`,
      author: "Mock Channel",
      duration: "3:45",
      seconds: 225,
      views: 1000 * i,
      thumbnail: null,
      url: `https://www.youtube.com/watch?v=MOCK${i}`,
    }));
    return { ok: true, videos };
  }

  async getYtStream(videoIdOrUrl, format = "mp3") {
    return { ok: false, error: "Mode MOCK tidak menyediakan stream — jalankan dengan bot utama (live)" };
  }

  async requestHistory(chatId, count = 50) {
    // Mock: history memang sudah ada di memori, tidak ada yang perlu diminta
    return { ok: true, queued: false };
  }

  async getBotAvatar() {
    return null; // mock tanpa PP bot
  }
}
