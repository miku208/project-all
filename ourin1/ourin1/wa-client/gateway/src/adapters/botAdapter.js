/**
 * BotAdapter — satu abstraction layer antara Gateway dan bot core.
 *
 * ATURAN: Gateway TIDAK PERNAH menyentuh socket Baileys, session/auth state,
 * atau struktur internal bot secara langsung. Semua akses hanya lewat interface ini.
 *
 * Implementasi:
 *  - MockBotAdapter: data dummy untuk dev/test (jujur dilabeli MOCK, tidak mengklaim live)
 *  - LiveBotAdapter: in-process dengan bot utama (belum diaktifkan — butuh izin integrasi)
 *
 * TODO(integrasi): LiveBotAdapter aktif saat bot utama memuat gateway in-process,
 *                  lihat wa-client/gateway/INTEGRATION.md
 */

/**
 * @typedef {Object} AdapterChat
 * @property {string} id            JID chat
 * @property {string} [name]
 * @property {string} [lastMessageText]
 * @property {number} [lastMessageTs]
 * @property {number} [unread]
 * @property {boolean} [pinned]
 * @property {boolean} [muted]
 * @property {boolean} [isGroup]
 */

/**
 * @typedef {Object} AdapterMessage
 * @property {string} messageId
 * @property {string} chatId
 * @property {string} [senderId]
 * @property {string} [senderName]
 * @property {string} messageType   text|image|video|audio|document|sticker
 * @property {string} [text]
 * @property {Object} [mediaMetadata]
 * @property {number} timestamp     epoch ms
 * @(AdapterMessage.isFromMe) @property {boolean} [isFromMe]
 * @property {string} [status]      sent|delivered|read
 * @property {string} [replyTo]
 */

/**
 * @typedef {Object} AdapterContact
 * @property {string} id
 * @property {string} [name]
 * @property {string} [notify]
 * @property {string} [status]
 */

export class BotAdapter {
  constructor() {
    if (new.target === BotAdapter) {
      throw new Error("BotAdapter adalah abstract class");
    }
  }

  async init() {}
  async shutdown() {}

  /** @returns {{state: "connected"|"connecting"|"reconnecting"|"disconnected", uptimeMs: number}} */
  getConnectionStatus() {
    throw new Error("not implemented");
  }

  /** @returns {AdapterChat[]} */
  async getChats() {
    throw new Error("not implemented");
  }
  async getChat(chatId) {
    throw new Error("not implemented");
  }
  async getMessages(chatId, { limit, before, after } = {}) {
    throw new Error("not implemented");
  }
  async sendMessage(chatId, text, { replyTo } = {}) {
    throw new Error("not implemented");
  }
  /** Kirim media; payload binary TIDAK lewat WebSocket — endpoint terpisah */
  async sendMedia(chatId, media) {
    throw new Error("not implemented");
  }
  async getAvatar(jid) {
    throw new Error("getAvatar() not implemented");
  }

  /** Foto profil bot sendiri (untuk halaman Settings/profile). */
  async getBotAvatar() {
    throw new Error("getBotAvatar() not implemented");
  }

  async getContacts() {
    throw new Error("not implemented");
  }
  async getGroups() {
    throw new Error("not implemented");
  }

  /** Settings yang didukung adapter ini (jujur; mode "private" tidak didukung bot core) */
  getSupportedSettings() {
    return ["botName", "mode", "prefix", "autoRead", "autoTyping"];
  }

  async getBotSettings() {
    throw new Error("not implemented");
  }
  /** @returns {Promise<{ok: boolean, error?: string, applied: string[]}>} */
  async updateBotSetting(key, value) {
    throw new Error("not implemented");
  }

  async getPlugins() {
    throw new Error("not implemented");
  }
  /** @returns {Promise<{ok: boolean, error?: string}>} */
  async enablePlugin(name) {
    throw new Error("not implemented");
  }
  async disablePlugin(name) {
    throw new Error("not implemented");
  }

  // ===== Blokir nomor (chat pribadi) =====
  /** @returns {Promise<{blocked: string[]}>} daftar nomor yang diblokir */
  async getBlocked() {
    throw new Error("not implemented");
  }
  /** Blokir nomor di WA server + simpan flag di database bot (isBlocked). @returns {Promise<{ok: boolean, error?: string}>} */
  async blockContact(jid) {
    throw new Error("not implemented");
  }
  /** Buka blokir nomor di WA server + hapus flag di database bot. @returns {Promise<{ok: boolean, error?: string}>} */
  async unblockContact(jid) {
    throw new Error("not implemented");
  }

  // ===== Profil bot (nomor, nama, bio/status) =====
  async getBotProfile() {
    throw new Error("not implemented");
  }
  /** key: "name" | "bio". @returns {Promise<{ok: boolean, error?: string}>} */
  async updateBotProfile(key, value) {
    throw new Error("not implemented");
  }

  /** Mulai chat pribadi baru dari daftar kontak: validasi nomor, seed chat kosong. @returns {Promise<{ok: boolean, chat?: AdapterChat, error?: string}>} */
  async startPrivateChat(number) {
    throw new Error("not implemented");
  }

  /** Ambil isi (text) satu pesan berdasar chatId + messageId — untuk fitur salin text. */
  async getMessageText(chatId, messageId) {
    throw new Error("not implemented");
  }

  // ===== Manajemen chat: keluar grup / hapus pesan / hapus chat =====

  /**
   * Keluar dari grup (bot meninggalkan grup ini).
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async leaveGroup(chatId) {
    throw new Error("not implemented");
  }

  /**
   * Hapus pesan.
   * @param {"me"|"everyone"} scope - "me" = hapus di sisi bot (chat bot saja),
   *   "everyone" = hapus untuk semua orang (HANYA di grup & bot harus admin).
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async deleteMessage(chatId, messageId, scope = "me") {
    throw new Error("not implemented");
  }

  /**
   * Hapus seluruh chat (nomor/grup) dari daftar chat bot.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async deleteChat(chatId) {
    throw new Error("not implemented");
  }

  // ===== Kelola member grup (tambah/kick) =====

  /**
   * Daftar member grup + status admin.
   * @returns {Promise<{ok: boolean, members?: Array<{id: string, name?: string, isAdmin: boolean, isSuperAdmin: boolean}>, error?: string}>}
   */
  async getGroupMembers(chatId) {
    throw new Error("not implemented");
  }

  /**
   * Tambah member ke grup. Terima array nomor (62xxx) atau JID.
   * @returns {Promise<{ok: boolean, added?: string[], failed?: Array<{jid: string, error?: string}>, error?: string}>}
   */
  async addParticipants(chatId, jids) {
    throw new Error("not implemented");
  }

  /**
   * Kick member dari grup. Terima array nomor (62xxx) atau JID.
   * @returns {Promise<{ok: boolean, removed?: string[], failed?: Array<{jid: string, error?: string}>, error?: string}>}
   */
  async removeParticipants(chatId, jids) {
    throw new Error("not implemented");
  }

  /**
   * Promote/demote admin grup. action: "promote" | "demote".
   * @returns {Promise<{ok: boolean, changed?: string[], failed?: Array<{jid: string, error?: string}>, error?: string}>}
   */
  async setGroupAdmins(chatId, jids, action) {
    throw new Error("not implemented");
  }

  /**
   * Kirim link undangan grup ke nomor (untuk yang menolak ditambah langsung).
   * @returns {Promise<{ok: boolean, url?: string, target?: string, error?: string}>}
   */
  async sendGroupInvite(chatId, targetNumber, message) {
    throw new Error("not implemented");
  }

  // ===== YouTube (tab Musik di APK — STREAMING, bukan download) =====

  /**
   * Cari video YouTube.
   * @returns {Promise<{ok: boolean, videos?: Array<{videoId, title, author, duration, seconds, views, thumbnail, url}>, error?: string}>}
   */
  async ytSearch(query) {
    throw new Error("not implemented");
  }

  /**
   * Ambil URL stream mp3/mp4 untuk satu video (bukan file download —
   * APK memutar langsung via MediaPlayer/ExoPlayer).
   * @returns {Promise<{ok: boolean, streamUrl?: string, title?: string, format?: string, error?: string}>}
   */
  async getYtStream(videoIdOrUrl, format = "mp3") {
    throw new Error("not implemented");
  }

  /**
   * Minta server WA mengirim history chat ini (HISTORY_SYNC_ON_DEMAND).
   * Hasilnya mengalir via messages.upsert -> tersimpan permanen di DB gateway.
   * @returns {Promise<{ok: boolean, queued?: boolean, error?: string}>}
   */
  async requestHistory(chatId, count = 50) {
    throw new Error("not implemented");
  }

  /** Daftarkan callback untuk event realtime dari bot */
  onEvent(handler) {
    this._eventHandler = handler;
  }
  _emit(type, data) {
    if (this._eventHandler) this._eventHandler(type, data);
  }
}

export const EVENTS = {
  MESSAGE_RECEIVED: "message.received",
  MESSAGE_SENT: "message.sent",
  MESSAGE_UPDATED: "message.updated",
  MESSAGE_DELETED: "message.deleted",
  CHAT_UPDATED: "chat.updated",
  CHAT_READ: "chat.read",
  CONTACT_UPDATED: "contact.updated",
  CONNECTION_UPDATED: "connection.updated",
  BOT_SETTINGS_UPDATED: "bot.settings.updated",
  PLUGIN_UPDATED: "plugin.updated",
};
