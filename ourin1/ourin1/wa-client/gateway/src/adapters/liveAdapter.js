import { BotAdapter, EVENTS } from "./botAdapter.js";
import { log } from "../utils/logger.js";
import { config } from "../config.js";
import fs from "fs";
import path from "path";

/**
 * LiveBotAdapter — in-process adapter ke bot utama (ADAPTER_MODE=live).
 *
 * Sumber data:
 *  - bot.store     : in-memory store bot (history pesan, chats, contacts)
 *  - bot.getSocket : socket Baileys (kirim pesan, groupMetadata)
 *  - bot.resolveLid: resolver LID -> JID asli milik bot
 *  - bot.getDatabase: settings/kontak bot
 *
 * Semua handler event dibungkus try/catch supaya bot utama tidak pernah
 * crash karena error gateway.
 */

const GROUP_REFRESH_MS = 5 * 60 * 1000;

const BAILEYS_STATUS = { 1: "pending", 2: "delivered", 3: "read", 4: "played" };

// Kode hasil groupParticipantsUpdate Baileys -> pesan yang bisa dibaca manusia.
const PARTICIPANT_STATUS = {
  "200": "sukses",
  "403": "nomor menolak dimasukkan grup (setting privasi) — kirim undangan manual",
  "404": "nomor tidak terdaftar di WhatsApp",
  "408": "baru saja keluar dari grup — hanya bisa ditambah lewat undangan",
  "409": "sudah jadi member",
  "413": "melebihi batas ukuran grup",
  "500": "grup penuh / kesalahan server",
  "501": "nomor belum terdaftar",
};

export class LiveBotAdapter extends BotAdapter {
  constructor({ botModules }) {
    super();
    if (!botModules) {
      throw new Error(
        "LiveBotAdapter butuh botModules dari proses bot utama. Lihat integration.js.",
      );
    }
    this._bot = botModules;
    this._startedAt = Date.now();
    this._boundSock = null;
    this._pushNames = new Map(); // jid (sudah di-resolve) -> nama
    this._lidMap = new Map(); // xxx@lid -> xxx@s.whatsapp.net (dari participants grup)
    this._groups = new Map(); // jid -> { name, participants: Set<jid> }
    this._lastGroupFetch = 0;
    this._lastGroupTry = 0;
    this._backfillDone = false;
    this._backfillTries = 0;
    this._syncRequested = new Map(); // raw store key -> ts terakhir minta history-sync (cooldown 2 menit)
    this._newsletters = new Map(); // jid newsletter -> title (cache)
    this._sentTexts = new Map(); // chatId -> Map(messageId -> text) utk salin text pesan keluar
    this._initMediaCache();
  }

  // ===== Media disk cache (penting: anti "media tidak tersedia") =====
  //
  // Media yang dikirim via gateway (atau berhasil di-download dari WA)
  // disimpan ke disk: data/media/<chatId>__<messageId>.bin + .json sidecar.
  // getMedia CEK CACHE INI DULU sebelum store bot — sebab echo pesan keluar
  // sering belum masuk store saat bubble langsung dimuat, dan store bot
  // membuang pesan lama (cache 200/chat) sementara DB gateway permanen.
  _initMediaCache() {
    try {
      // Pakai dataDir gateway (satu lokasi dengan gateway.db) — bukan cwd,
      // karena cwd tergantung dari mana proses bot dijalankan.
      this._mediaCacheDir = path.join(config.dataDir, "media");
      fs.mkdirSync(this._mediaCacheDir, { recursive: true });
    } catch (e) {
      log.warn("Adapter", `media cache dir gagal: ${e.message}`);
      this._mediaCacheDir = null;
    }
  }

  // Nama file aman: buang karakter non-word dari jid (ada @ . : yang sah di jid
  // tapi di-sanitize supaya tidak bikin subdir / path traversal).
  static _mediaCacheKey(chatId, messageId) {
    const safe = (s) => String(s || "").replace(/[^\w.-]/g, "_").slice(0, 120);
    return `${safe(chatId)}__${safe(messageId)}`;
  }

  _cacheMediaPath(chatId, messageId, ext) {
    if (!this._mediaCacheDir) return null;
    return path.join(this._mediaCacheDir, `${LiveBotAdapter._mediaCacheKey(chatId, messageId)}.${ext}`);
  }

  _writeMediaCache(chatId, messageId, buffer, info) {
    try {
      const binPath = this._cacheMediaPath(chatId, messageId, "bin");
      const jsonPath = this._cacheMediaPath(chatId, messageId, "json");
      if (!binPath) return;
      fs.writeFileSync(binPath, buffer);
      fs.writeFileSync(jsonPath, JSON.stringify(info || {}));
      this._pruneMediaCache();
    } catch (e) {
      log.warn("Adapter", `media cache write gagal: ${e.message}`);
    }
  }

  // Jaga total ukuran cache (default 500MB). Hapus file tertua dulu.
  // Dipanggil ringan setelah tiap write (scan murah untuk ribuan file pun OK
  // karena hanya fs.statSync kecil; jalan di event loop bot tapi cepat).
  _pruneMediaCache() {
    if (!this._mediaCacheDir || this._pruning) return;
    this._pruning = true;
    setImmediate(() => {
      try {
        const MAX_BYTES = 500 * 1024 * 1024;
        const files = fs.readdirSync(this._mediaCacheDir)
          .filter((f) => f.endsWith(".bin"))
          .map((f) => {
            const p = path.join(this._mediaCacheDir, f);
            let st = {};
            try { st = fs.statSync(p); } catch { }
            return { p, size: st.size || 0, mtime: st.mtimeMs || 0 };
          });
        let total = files.reduce((s, f) => s + f.size, 0);
        if (total <= MAX_BYTES) return;
        files.sort((a, b) => a.mtime - b.mtime);
        for (const f of files) {
          if (total <= MAX_BYTES) break;
          try { fs.unlinkSync(f.p); } catch { }
          try { fs.unlinkSync(f.p.replace(/\.bin$/, ".json")); } catch { }
          total -= f.size;
        }
      } catch { } finally {
        this._pruning = false;
      }
    });
  }

  _readMediaCache(chatId, messageId) {
    try {
      const binPath = this._cacheMediaPath(chatId, messageId, "bin");
      const jsonPath = this._cacheMediaPath(chatId, messageId, "json");
      if (!binPath || !fs.existsSync(binPath)) return null;
      const buffer = fs.readFileSync(binPath);
      let info = {};
      try { info = JSON.parse(fs.readFileSync(jsonPath, "utf8")); } catch { }
      if (!buffer.length) return null;
      return { ok: true, buffer, info };
    } catch {
      return null;
    }
  }

  // ===== Lifecycle =====

  async init() {
    this._tryBind();
    // Re-bind berkala + backfill menunggu sampai store bot berisi data
    const t = setInterval(() => {
      this._tryBind();
      if (!this._backfillDone && this._backfillTries < 30) {
        this._backfillTries++;
        const storeSize = this._bot.store?.messages?.size || 0;
        if (storeSize > 0) {
          this._backfillDone = true;
          this._backfillFromStore().catch((e) => log.warn("Adapter", `backfill: ${e.message}`));
        }
      }
    }, 10 * 1000);
    if (t.unref) t.unref();
    log.info("Adapter", "LiveBotAdapter init (menunggu socket bot bila belum siap)");
  }

  async shutdown() {}

  _tryBind() {
    try {
      const sock = this._bot.getSocket?.();
      if (!sock || sock === this._boundSock) return;
      this._bindEvents(sock);
      this._boundSock = sock;
      log.info("Adapter", "Bound ke socket bot utama");
      this._emit(EVENTS.CONNECTION_UPDATED, { bot: this.getConnectionStatus() });
    } catch (e) {
      log.error("Adapter", `bind gagal: ${e.message}`);
    }
  }

  _bindEvents(sock) {
    // Fetch grup segera saat socket baru ter-bound
    this._fetchGroupsSafe({ force: true }).catch(() => { });

    sock.ev.on("messages.upsert", ({ messages } = {}) => {
      try {
        for (const m of messages || []) this._handleIncoming(m);
      } catch (e) {
        log.error("Adapter", `messages.upsert: ${e.message}`);
      }
    });

    sock.ev.on("messages.update", (updates) => {
      try {
        for (const u of updates || []) {
          const key = u?.key;
          if (!key?.remoteJid || !key?.id) continue;
          const statusNum = u.update?.status;
          const status = BAILEYS_STATUS[statusNum] || null;
          this._emit(EVENTS.MESSAGE_UPDATED, {
            chatId: key.remoteJid,
            messageId: key.id,
            status,
          });
        }
      } catch (e) {
        log.error("Adapter", `messages.update: ${e.message}`);
      }
    });

    sock.ev.on("messages.delete", (items) => {
      try {
        for (const item of items || []) {
          const key = item?.key || item;
          if (!key?.remoteJid || !key?.id) continue;
          this._emit(EVENTS.MESSAGE_DELETED, {
            chatId: key.remoteJid,
            messageId: key.id,
          });
        }
      } catch (e) {
        log.error("Adapter", `messages.delete: ${e.message}`);
      }
    });

    sock.ev.on("connection.update", (update) => {
      try {
        this._emit(EVENTS.CONNECTION_UPDATED, {
          bot: this.getConnectionStatus(),
          raw: { connection: update.connection },
        });
      } catch { }
    });

    sock.ev.on("contacts.upsert", (contacts) => {
      try {
        for (const c of contacts || []) {
          const rawId = c?.id;
          if (!rawId) continue;
          const name = c.notify || c.name || c.verifiedName || null;
          // Mapping LID -> nomor asli bila Baileys menyediakan keduanya
          if (c.lid && c.lid !== rawId) this._lidMap.set(c.lid, rawId);
          const jid = this._resolveJid(rawId);
          if (name) this._pushNames.set(jid, name);
        }
      } catch { }
    });

    sock.ev.on("groups.upsert", (chats) => {
      try {
        for (const c of chats || []) {
          if (c?.id) this._groups.set(c.id, { name: c.subject || null, participants: new Set() });
        }
      } catch { }
    });

    sock.ev.on("groups.update", (updates) => {
      try {
        for (const g of updates || []) {
          if (g?.id) {
            const cur = this._groups.get(g.id) || { participants: new Set() };
            cur.name = g.subject || cur.name;
            this._groups.set(g.id, cur);
          }
        }
      } catch { }
    });
  }

  // ===== Nama pengirim & JID =====

  // Deteksi JID hasil "konversi" LID yang salah — format @s.whatsapp.net tapi
  // nomornya adalah nomor LID (bukan nomor HP asli). JID seperti ini TIDAK boleh
  // dipakai sebagai chatId kanonik: riwayatnya harus tetap terikat pada @lid
  // aslinya sampai mapping ke nomor asli benar-benar diketahui.
  /** Resolver publik utk kebutuhan gateway (migrasi riwayat LID, dll). */
  resolveJid(jid) {
    return this._resolveJid(jid);
  }

  _isLidConverted(jid) {
    if (!jid || !String(jid).endsWith("@s.whatsapp.net")) return false;
    const num = String(jid).replace("@s.whatsapp.net", "");
    // LID umumnya 15+ digit acak. Nomor HP asli yang benar-benar 15 digit
    // (batas E.164) sangat jarang — salah flag pada kasus langka itu hanya
    // menunda resolve (riwayat tetap aman under @lid), bukan kehilangan data.
    if (num.length > 14) return true;
    // LID juga sering 13-14 digit tanpa awalan kode negara yang masuk akal
    if (num.length >= 13 && !/^(1|7|20|27|3\d|39|4\d|5\d|6\d|8\d|9\d)/.test(num)) return true;
    return false;
  }

  _resolveJid(jid) {
    if (!jid) return jid;
    // 1) mapping LID -> nomor dari participants grup metadata / remoteJidAlt
    const mapped = this._lidMap.get(jid);
    if (mapped && !this._isLidConverted(mapped)) return mapped;
    // 2) resolver cache LID milik bot — TAPI jangan terima hasil "konversi"
    //    LID yang salah (nomor LID di-relabel jadi @s.whatsapp.net). Dulu ini
    //    bikin chat bar muncul dua kali (@lid vs nomor asli) dan riwayat
    //    terpisah di dua chatId — akar bug "riwayat sebagian nomor hilang".
    try {
      const r = this._bot.resolveLid?.(jid);
      if (r && r !== jid && !this._isLidConverted(r)) return r;
    } catch { }
    return jid;
  }

  // Perkaya cache nama: key jid asli + jid yang sudah di-resolve.
  // Penting buat grup: participant bisa datang sebagai @lid sedangkan pesan
  // berikutnya memakai nomor asli (atau sebaliknya).
  _rememberName(jid, name) {
    if (!jid || !name) return;
    try {
      const resolved = this._resolveJid(jid);
      this._pushNames.set(jid, name);
      if (resolved && resolved !== jid) this._pushNames.set(resolved, name);
    } catch { }
  }

  _senderName(jid, fallback) {
    if (!jid) return fallback || null;
    // 1) kontak tersimpan (database bot) — prioritas tertinggi, seperti WhatsApp asli
    try {
      const c = this._bot.getDatabase?.()?.getSettings?.()?.contacts?.[jid];
      if (c?.name) return c.name;
    } catch { }
    // 2) store.contacts bot (notify/name dari contacts.upsert)
    try {
      const sc = this._bot.store?.contacts?.[jid];
      if (sc?.notify || sc?.name) return sc.notify || sc.name;
    } catch { }
    // 3) pushName cache (nama WA pengirim, HANYA dari pesan bukan fromMe)
    const pn = this._pushNames.get(jid);
    if (pn) return pn;
    // 4) pushName versi LID
    const pnLid = this._pushNames.get(this._resolveJid(jid) || "");
    if (pnLid) return pnLid;
    return fallback || null;
  }

  _groupParticipantName(participantJid, groupJid) {
    if (!participantJid) return null;
    const resolved = this._resolveJid(participantJid);
    const name = this._senderName(resolved);
    if (name) return name;
    // Coba metadata grup (subject tidak membantu per-orang, tapi setidaknya
    // fallback ke nomor yang rapi)
    const digits = String(resolved).split("@")[0];
    return digits || null;
  }

  // Nama chat private: kontak/pushname, lalu saluran (@newsletter), lalu nomor/LID.
  // SELALU mengembalikan string (tidak pernah null) supaya nama chat tidak "hilang".
  _privateChatName(jid, fallbackPushName = null) {
    const name = this._senderName(jid, fallbackPushName);
    if (name) return name;
    if (jid?.endsWith("@newsletter")) return this._newsletterName(jid) || "Saluran";
    return String(jid).split("@")[0] || "Unknown";
  }

  // Judul saluran: dari cache; bila belum ada, fetch di BACKGROUND (tidak memperlambat
  // getChats) dan akan tampil pada poll berikutnya.
  _newsletterName(jid) {
    if (this._newsletters.has(jid)) return this._newsletters.get(jid);
    this._newsletters.set(jid, null);
    (async () => {
      let name = null;
      try {
        const sock = this._bot.getSocket?.();
        const meta = await sock?.newsletterFetchMetadata?.(jid, "GUEST");
        const n = meta?.thread_metadata?.name;
        name = (typeof n === "string" ? n : n?.text) || null;
      } catch { }
      this._newsletters.set(jid, name);
    })().catch(() => { });
    return null;
  }

  // ===== Backfill dari store bot =====

  async _backfillFromStore() {
    const store = this._bot.store;
    if (!store?.messages) return;
    try {
      await this._fetchGroupsSafe();
      let chatCount = 0;
      let msgCount = 0;
      for (const [jid, msgs] of store.messages) {
        if (!jid) continue;
        // update nama chat
        const isGroup = jid.endsWith("@g.us");
        if (isGroup && this._groups.has(jid)) {
          // nama dari grup
        }
        // nama pengirim dari pushName yang tersimpan di pesan store
        // (pushName pesan fromMe TIDAK disimpan — itu nama bot sendiri)
        let last = null;
        for (const m of msgs.values()) {
          if (m.pushName && !m.key?.fromMe && m.key?.participant) {
            this._pushNames.set(this._resolveJid(m.key.participant), m.pushName);
          }
          if (m.pushName && !isGroup && !m.key?.fromMe) {
            this._pushNames.set(jid, m.pushName);
          }
          if (!last || this._ts(m) > this._ts(last)) last = m;
        }
        if (last) chatCount++;
        if (last) msgCount += msgs.size;
        // Emit pesan-pesan store sebagai backfill event (gateway DB insert idempotent)
        if (last) {
          const arr = [...msgs.values()].sort((a, b) => this._ts(a) - this._ts(b)).slice(-50);
          for (const m of arr) this._handleIncoming(m, { silentBroadcast: true, skipNameRefresh: true });
        }
      }
      log.info("Adapter", `Backfill dari store bot: ${chatCount} chats, ${msgCount} pesan (diproses via upsert handler)`);
    } catch (e) {
      log.warn("Adapter", `backfill gagal: ${e.message}`);
    }
  }

  // ===== Event: pesan masuk =====

  _handleIncoming(m, opts = {}) {
    const key = m?.key;
    const rawChatId = key?.remoteJid;
    if (!rawChatId) return;
    if (rawChatId === "status@broadcast" && !key?.fromMe) return; // abaikan status orang lain

    // Pesan dihapus (revoke) oleh pengirim -> emit deleted, jangan disimpan sbg pesan baru
    const proto = m.message?.protocolMessage;
    if (proto?.type === 0 && proto?.key?.id) {
      this._emit(EVENTS.MESSAGE_DELETED, { chatId: this._resolveJid(rawChatId) || rawChatId, messageId: proto.key.id });
      return;
    }
    if (proto) return; // protocolMessage lain (rotate key dll) bukan pesan chat

    // FIX riwayat LID: chat private bisa datang dengan remoteJid = xxx@lid
    // sementara remoteJidAlt membawa nomor aslinya. Pelajari mappingnya SEBELUM
    // resolve supaya pesan ini (dan history-sync berikutnya) tersimpan di chatId
    // nomor asli — bukan tercecer di chatId @lid yang tidak pernah muncul di chat bar.
    if (rawChatId.endsWith("@lid")) {
      const alt = key?.remoteJidAlt;
      if (
        alt && !String(alt).endsWith("@lid") &&
        !this._isLidConverted(alt) &&
        !this._lidMap.has(rawChatId) // belum ada mapping lain
      ) {
        this._lidMap.set(rawChatId, alt);
      }
    }
    const chatId = this._resolveJid(rawChatId) || rawChatId;
    const senderJid = key.fromMe ? this._botBotJid() : this._resolveJid(key.participant || chatId);

    // PENTING: pushName hanya disimpan utk pesan BUKAN fromMe.
    // pushName pesan fromMe = nama akun bot sendiri -> kalau disimpan akan
    // menimpa nama kontak dgn nama WA bot (bug "nama kontak jadi nama WA kita").
    if (m.pushName && !key.fromMe) {
      this._rememberName(senderJid, m.pushName);
      if (!chatId.endsWith("@g.us")) this._pushNames.set(chatId, m.pushName);
    }

    const { text, type } = this._extract(m.message);
    // contextInfo bisa ada di tipe pesan apa pun (image caption reply, dll)
    const unwrapped = this._unwrapMessage(m.message);
    const ctxInfo =
      unwrapped?.extendedTextMessage?.contextInfo ||
      unwrapped?.imageMessage?.contextInfo ||
      unwrapped?.videoMessage?.contextInfo ||
      unwrapped?.documentMessage?.contextInfo ||
      null;
    const payload = {
      chatId,
      messageId: key.id || `UNK${Date.now()}`,
      senderId: senderJid,
      senderName: key.fromMe
        ? this._bot.config?.bot?.name || "Bot"
        : this._senderName(senderJid, m.pushName) ||
          (chatId.endsWith("@g.us") ? this._groupParticipantName(key.participant, chatId) : null) ||
          String(senderJid).split("@")[0] || null, // fallback terakhir: nomor HP
      messageType: type,
      text,
      mediaMetadata: this._extractMedia(m.message),
      timestamp: this._ts(m),
      isFromMe: !!key.fromMe,
      status: key.fromMe ? "sent" : null,
      replyTo: ctxInfo?.quotedMessage ? (ctxInfo.stanzaId || null) : null,
    };

    if (!opts.silentBroadcast) {
      this._emit(key.fromMe ? EVENTS.MESSAGE_SENT : EVENTS.MESSAGE_RECEIVED, payload);
    } else {
      // backfill: tetap masuk DB gateway lewat event wiring, tapi tanpa push WS
      // (flag backfill dikenali oleh wiring? -> gunakan emit biasa; idempotency DB
      //  mencegah duplikat, dan push WS ke klien yang online pun tidak masalah)
      this._emit(key.fromMe ? EVENTS.MESSAGE_SENT : EVENTS.MESSAGE_RECEIVED, payload);
    }
  }

  _ts(m) {
    try {
      const raw = m?.messageTimestamp;
      const sec = typeof raw?.toNumber === "function" ? raw.toNumber() : Number(raw) || 0;
      return sec > 0 ? sec * 1000 : Date.now();
    } catch {
      return Date.now();
    }
  }

  // WhatsApp membungkus pesan dalam wrapper (ephemeral/viewOnce/edited/dll).
  // Harus dibongkar berlapis sampai konten aslinya, kalau tidak teks = null.
  _unwrapMessage(message) {
    let m = message;
    for (let i = 0; i < 5 && m; i++) {
      const inner =
        m.ephemeralMessage?.message ||
        m.viewOnceMessage?.message ||
        m.viewOnceV2Message?.message ||
        m.viewOnceMessageV2?.message ||
        m.documentWithCaptionMessage?.message ||
        m.editedMessage?.message?.protocolMessage?.editedMessage ||
        null;
      if (!inner) break;
      m = inner;
    }
    return m;
  }

  _extract(message) {
    message = this._unwrapMessage(message);
    if (!message) return { text: null, type: "unknown" };
    if (message.conversation) return { text: message.conversation, type: "text" };
    if (message.extendedTextMessage?.text) return { text: message.extendedTextMessage.text, type: "text" };
    const map = [
      ["imageMessage", "image"],
      ["videoMessage", "video"],
      ["audioMessage", "audio"],
      ["stickerMessage", "sticker"],
      ["documentMessage", "document"],
      ["contactMessage", "contact"],
      ["locationMessage", "location"],
      ["reactionMessage", "reaction"],
      ["pollCreationMessage", "poll"],
    ];
    for (const [k, type] of map) {
      const node = message[k];
      if (node) {
        let text;
        if (type === "reaction") text = node.text || null;
        else if (type === "sticker") text = null; // sticker tidak punya caption — tampil [Stiker]
        else text = node.caption || node.fileName || null;
        return { text, type };
      }
    }
    return { text: null, type: "unknown" };
  }

  // Label preview media untuk daftar chat: [Foto], [Video], dll.
  static _MEDIA_LABEL = {
    image: "Foto",
    video: "Video",
    audio: "Audio",
    sticker: "Stiker",
    document: "Dokumen",
    contact: "Kontak",
    location: "Lokasi",
    poll: "Polling",
    reaction: "Reaksi",
  };

  static _mediaPreview(text, type) {
    if (type && LiveBotAdapter._MEDIA_LABEL[type]) {
      const label = `[${LiveBotAdapter._MEDIA_LABEL[type]}]`;
      // caption mengikuti label, seperti WhatsApp asli ("[Foto] kucing lucu")
      return text ? `${label} ${text}` : label;
    }
    return text;
  }

  _extractMedia(message) {
    message = this._unwrapMessage(message);
    if (!message) return null;
    for (const k of ["imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage"]) {
      const node = message[k];
      if (node) {
        return {
          mimetype: node.mimetype || null,
          fileName: node.fileName || null,
          fileLength: Number(node.fileLength || 0),
          caption: node.caption || null,
          seconds: node.seconds || null,
        };
      }
    }
    return null;
  }

  _botBotJid() {
    try {
      return this._bot.getSocket?.()?.user?.id || "bot";
    } catch {
      return "bot";
    }
  }

  // ===== Status =====

  getConnectionStatus() {
    try {
      const st = this._bot.getConnectionState?.() || {};
      let state = "disconnected";
      if (st.isConnected && st.isReady) state = "connected";
      else if (!st.isConnected && (st.reconnectAttempts || 0) > 0) state = "reconnecting";
      const uptimeMs = st.connectedAt ? Date.now() - new Date(st.connectedAt).getTime() : 0;
      return { state, uptimeMs };
    } catch {
      return { state: "disconnected", uptimeMs: 0 };
    }
  }

  // ===== Groups =====

  async _fetchGroupsSafe({ force = false } = {}) {
    const sock = this._bot.getSocket?.();
    if (!sock) return;
    // Saat socket baru connect, fetch pertama sering gagal (WA masih syncing) -> retry
    if (!force && Date.now() - this._lastGroupFetch < GROUP_REFRESH_MS) return;
    if (Date.now() - this._lastGroupTry < 15 * 1000) return; // anti-spam retry
    this._lastGroupTry = Date.now();
    try {
      const all = await sock.groupFetchAllParticipating();
      this._lastGroupFetch = Date.now();
      for (const [jid, meta] of Object.entries(all || {})) {
        const participants = new Set();
        for (const p of meta?.participants || []) {
          if (!p.id) continue;
          participants.add(p.id);
          // mapping LID -> nomor HP bila Baileys menyediakan keduanya
          if (p.jid && p.jid !== p.id) this._lidMap.set(p.id, p.jid);
          // Nama participant grup: id/notify/verifiedName dari metadata.
          // Ini sumber nama pengirim grup saat pushname belum pernah terlihat
          // (mis. chat lama yang baru dibuka di APK).
          const pn = p.notify || p.name || p.verifiedName || null;
          if (pn) this._rememberName(p.id, pn);
        }
        this._groups.set(jid, { name: meta?.subject || null, participants });
      }
      log.info("Adapter", `Grup tersinkron: ${this._groups.size}`);
    } catch (e) {
      log.warn("Adapter", `groupFetchAll (akan retry): ${e.message}`);
    }
  }

  // ===== Chats =====

  // Cari kunci store yang cocok dengan chatId (resolved). Store memakai raw jid
  // (kadang @lid), sedangkan API memakai jid resolved -> coba langsung, lalu scan.
  _findStoreMsgs(chatId) {
    const store = this._bot.store;
    if (!store?.messages) return null;
    const direct = store.messages.get(chatId);
    if (direct) return direct;
    for (const [rawJid, msgs] of store.messages) {
      if (rawJid === chatId || this._resolveJid(rawJid) === chatId) return msgs;
    }
    return null;
  }

  _findRawChatKey(chatId) {
    const store = this._bot.store;
    if (!store?.messages) return null;
    if (store.messages.has(chatId)) return chatId;
    for (const rawJid of store.messages.keys()) {
      if (this._resolveJid(rawJid) === chatId) return rawJid;
    }
    return null;
  }

  async getChats() {
    await this._fetchGroupsSafe();
    const byId = new Map();
    const store = this._bot.store;

    const addChat = (jid, { name, lastMsg = null, ts = null, isGroup }) => {
      if (!jid || jid === "status@broadcast") return;
      const entry = {
        id: jid,
        name: name || null,
        lastMessageText: lastMsg ? LiveBotAdapter._mediaPreview(lastMsg.text, lastMsg.type) : null,
        lastMessageTs: ts,
        unread: null,
        pinned: null,
        muted: null,
        isGroup,
      };
      const existing = byId.get(jid);
      if (!existing) {
        byId.set(jid, entry);
      } else {
        // Merge: ambil nama/timestamp yang lebih informatif
        if (!existing.name) existing.name = entry.name;
        if (!existing.isGroup && entry.isGroup) existing.isGroup = true;
        if ((entry.lastMessageTs || 0) > (existing.lastMessageTs || 0)) {
          existing.lastMessageText = entry.lastMessageText;
          existing.lastMessageTs = entry.lastMessageTs;
        }
      }
    };

    // 1) SEMUA chat yang punya pesan di store — sumber paling akurat & realtime.
    //    Chat baru otomatis muncul begitu pesan pertamanya masuk.
    if (store?.messages) {
      for (const [rawJid, msgs] of store.messages) {
        if (!rawJid || rawJid === "status@broadcast") continue;
        if (msgs.size === 0) continue;
        const jid = this._resolveJid(rawJid) || rawJid;
        let last = null;
        for (const m of msgs.values()) {
          if (!last || this._ts(m) > this._ts(last)) last = m;
        }
        if (!last) continue;
        const isGroup = jid.endsWith("@g.us");
        const { text, type } = this._extract(last.message);
        addChat(jid, {
          // pushName hanya fallback utk pesan BUKAN fromMe (pushName fromMe = nama bot sendiri)
          name: isGroup
            ? this._groups.get(jid)?.name || null
            : this._privateChatName(jid, !last.key?.fromMe ? last.pushName : null),
          lastMsg: { text, type },
          ts: this._ts(last),
          isGroup,
          // NOTE: last.pushName di sini aman dari bug nama-bot karena pushName
          // pesan fromMe tidak pernah masuk _pushNames (difilter di _handleIncoming);
          // pesan fromMe dgn pushName = nama bot hanya fallback TERAKHIR setelah _senderName.
        });
      }
    }

    // 2) store.chats — chat tanpa pesan tersimpan pun tetap tampil
    if (store?.chats) {
      for (const [rawJid, chat] of store.chats) {
        if (!rawJid || rawJid === "status@broadcast") continue;
        const jid = this._resolveJid(rawJid) || rawJid;
        const isGroup = jid.endsWith("@g.us");
        addChat(jid, {
          name: isGroup
            ? this._groups.get(jid)?.name || chat?.name || null
            : this._privateChatName(jid) || chat?.name || null,
          isGroup,
        });
      }
    }

    // 3) Semua grup dari groupFetchAllParticipating (walau belum ada pesan)
    for (const [jid, g] of this._groups) {
      addChat(jid, { name: g.name || null, isGroup: true });
    }

    // Sort: chat terbaru selalu di atas (yang belum ada pesan di paling bawah)
    const out = [...byId.values()];
    out.sort((a, b) => (b.lastMessageTs || 0) - (a.lastMessageTs || 0));
    return out;
  }

  async getChat(chatId) {
    const isGroup = chatId.endsWith("@g.us");
    this._requestHistorySync(chatId);
    return {
      id: chatId,
      name: isGroup ? this._groups.get(chatId)?.name || null : this._senderName(chatId),
      isGroup,
    };
  }

  // Minta WhatsApp mengirim history chat ini via HISTORY_SYNC_ON_DEMAND
  // (sock.fetchMessageHistory — method asli library ourin). Hasilnya masuk
  // store bot via messages.upsert -> event -> DB gateway (idempotent), lalu
  // tersimpan PERMANEN di SQLite gateway meski store bot membuang yang lama.
  // Cooldown 2 menit per chat supaya tidak spam request ke server WA.
  _requestHistorySync(chatId) {
    try {
      const rawKey = this._findRawChatKey(chatId) || chatId;
      const last = this._syncRequested.get(rawKey) || 0;
      if (Date.now() - last > 2 * 60 * 1000) {
        this._syncRequested.set(rawKey, Date.now());
        const sock = this._bot.getSocket?.();
        if (!sock?.fetchMessageHistory) return;
        (async () => {
          // Butuh kunci pesan tertua di chat ini sebagai anchor request.
          const msgs = this._findStoreMsgs(rawKey);
          let oldest = null;
          if (msgs) {
            for (const m of msgs.values()) {
              if (!oldest || this._ts(m) < this._ts(oldest)) oldest = m;
            }
          }
          if (!oldest?.key) return; // belum ada pesan sama sekali -> tidak ada anchor
          const oldestTs = this._ts(oldest);
          await sock.fetchMessageHistory(50, oldest.key, oldestTs);
          log.info("Adapter", `History sync diminta: ${rawKey} (anchor ${oldest.key.id})`);
        })().catch((e) => log.warn("Adapter", `history sync: ${e.message}`));
      }
    } catch { }
  }

  // Dipanggil route saat chat dibuka / scroll ke atas / diminta eksplisit.
  async requestHistory(chatId, count = 50) {
    const rawKey = this._findRawChatKey(chatId) || chatId;
    const msgs = this._findStoreMsgs(rawKey);
    let oldest = null;
    if (msgs) {
      for (const m of msgs.values()) {
        if (!oldest || this._ts(m) < this._ts(oldest)) oldest = m;
      }
    }
    if (!oldest?.key) {
      return { ok: false, error: "Belum ada pesan di chat ini untuk dijadikan anchor sync" };
    }
    const sock = this._bot.getSocket?.();
    if (!sock?.fetchMessageHistory) {
      return { ok: false, error: "Method fetchMessageHistory tidak tersedia di socket bot" };
    }
    try {
      await sock.fetchMessageHistory(count, oldest.key, this._ts(oldest));
      return { ok: true, queued: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async getMessages(chatId, { limit = 30, before = null } = {}) {
    // Setiap kali pesan diminta (chat dibuka / scroll ke atas), picu history-sync
    // supaya chat lama yang belum tersinkron terus terisi dari WhatsApp.
    this._requestHistorySync(chatId);
    const msgs = this._findStoreMsgs(chatId);
    if (!msgs) return [];
    let arr = [...msgs.values()];
    if (before) arr = arr.filter((m) => this._ts(m) < before);
    arr.sort((a, b) => this._ts(a) - this._ts(b));
    const isGroup = chatId.endsWith("@g.us");
    return arr.slice(-limit).map((m) => {
      const senderJid = m.key?.fromMe ? this._botBotJid() : this._resolveJid(m.key?.participant || chatId);
      const { text, type } = this._extract(m.message);
      return {
        messageId: m.key?.id,
        chatId,
        senderId: senderJid,
        senderName: m.key?.fromMe
          ? this._bot.config?.bot?.name || "Bot"
          : this._senderName(senderJid, m.pushName) || (isGroup ? this._groupParticipantName(m.key?.participant, chatId) : null) || String(senderJid).split("@")[0] || null,
        messageType: type,
        text,
        mediaMetadata: this._extractMedia(m.message),
        timestamp: this._ts(m),
        isFromMe: !!m.key?.fromMe,
        status: m.key?.fromMe ? BAILEYS_STATUS[m.update?.status] || "sent" : null,
      };
    });
  }

  // ===== Kirim =====

  async sendMessage(chatId, text, { replyTo } = {}) {
    const sock = this._bot.getSocket?.();
    if (!sock) throw new Error("Bot tidak terhubung ke WhatsApp");
    let quoted;
    if (replyTo) {
      quoted = this._bot.store?.messages?.get(chatId)?.get(replyTo);
    }
    const sent = await sock.sendMessage(chatId, { text }, quoted ? { quoted } : undefined);
    const messageId = sent?.key?.id || `GW${Date.now()}`;
    // Simpan text pesan keluar — saat APK minta salin text, pesan ini belum
    // tentu balik ke store bot via messages.upsert.
    if (!this._sentTexts.has(chatId)) this._sentTexts.set(chatId, new Map());
    const sentMap = this._sentTexts.get(chatId);
    sentMap.set(messageId, text);
    if (sentMap.size > 200) {
      const firstKey = sentMap.keys().next().value;
      sentMap.delete(firstKey);
    }
    const { text: _t, type } = this._extract(sent?.message) || {};
    return {
      messageId,
      chatId,
      senderId: this._botBotJid(),
      senderName: this._bot.config?.bot?.name || "Bot",
      messageType: "text",
      text,
      timestamp: this._ts(sent) || Date.now(),
      isFromMe: true,
      status: "sent",
      replyTo: replyTo || null,
    };
  }

  // ===== Kirim media (image/video/audio/sticker/document) =====

  // media: { type: "image"|"video"|"audio"|"sticker"|"document", buffer: Buffer,
  //          mimetype?, fileName?, caption?, ptt?, replyTo? }
  async sendMedia(chatId, media) {
    const sock = this._bot.getSocket?.();
    if (!sock) throw new Error("Bot tidak terhubung ke WhatsApp");
    if (!media || !Buffer.isBuffer(media.buffer) || media.buffer.length === 0) {
      throw new Error("Buffer media kosong / tidak valid");
    }
    const type = String(media.type || "").toLowerCase();
    if (!["image", "video", "audio", "sticker", "document"].includes(type)) {
      throw new Error(`Tipe media tidak didukung: ${type || "(kosong)"}`);
    }
    const MAX_SEND = 50 * 1024 * 1024; // 50MB
    if (media.buffer.length > MAX_SEND) {
      throw new Error("File terlalu besar (maks 50MB)");
    }

    let quoted;
    if (media.replyTo) {
      quoted = this._bot.store?.messages?.get(chatId)?.get(media.replyTo);
    }
    const opts = quoted ? { quoted } : undefined;

    let sent;
    let displayType = type;
    if (type === "image") {
      sent = await sock.sendMessage(chatId, {
        image: media.buffer,
        caption: media.caption || undefined,
        mimetype: media.mimetype || undefined,
      }, opts);
    } else if (type === "video") {
      sent = await sock.sendMessage(chatId, {
        video: media.buffer,
        caption: media.caption || undefined,
        mimetype: media.mimetype || "video/mp4",
      }, opts);
    } else if (type === "audio") {
      sent = await sock.sendMessage(chatId, {
        audio: media.buffer,
        mimetype: media.mimetype || "audio/mpeg",
        ptt: !!media.ptt,
      }, opts);
    } else if (type === "sticker") {
      // Pakai helper stiker bot (konversi webp + EXIF packname/author) bila ada;
      // fallback kirim buffer langsung sebagai sticker.
      const packname = this._bot.config?.sticker?.packname || this._bot.config?.bot?.name || "MikuWA";
      const author = this._bot.config?.sticker?.author || "MikuWA";
      if (typeof sock.sendImageAsSticker === "function") {
        try {
          sent = await sock.sendImageAsSticker(chatId, media.buffer, quoted || null, { packname, author });
          displayType = "sticker";
        } catch {
          sent = null;
        }
      }
      if (!sent) {
        sent = await sock.sendMessage(chatId, { sticker: media.buffer }, opts);
      }
    } else {
      // document
      sent = await sock.sendMessage(chatId, {
        document: media.buffer,
        mimetype: media.mimetype || "application/octet-stream",
        fileName: media.fileName || "file",
        caption: media.caption || undefined,
      }, opts);
    }

    const messageId = sent?.key?.id || `GW${Date.now()}`;
    const text = media.caption || null;
    if (text) {
      if (!this._sentTexts.has(chatId)) this._sentTexts.set(chatId, new Map());
      const sentMap = this._sentTexts.get(chatId);
      sentMap.set(messageId, text);
      if (sentMap.size > 200) {
        const firstKey = sentMap.keys().next().value;
        sentMap.delete(firstKey);
      }
    }
    // SIMPAN KE DISK CACHE: supaya GET media langsung ketemu meski echo pesan
    // keluar belum masuk store bot. Tanpa ini bubble di APK = "media tidak tersedia".
    // Untuk sticker: simpan buffer STICKER ASLI yang dikirim (hasil konversi webp)
    // supaya yang tampil di APK sama dengan yang diterima penerima WA.
    try {
      this._writeMediaCache(chatId, messageId, media.buffer, {
        type: displayType,
        mimetype: media.mimetype || (displayType === "sticker" ? "image/webp" : null),
        fileName: media.fileName || null,
        caption: media.caption || null,
        seconds: null,
        source: "sent",
      });
    } catch { }
    return {
      messageId,
      chatId,
      senderId: this._botBotJid(),
      senderName: this._bot.config?.bot?.name || "Bot",
      messageType: displayType,
      text,
      mediaMetadata: {
        mimetype: media.mimetype || null,
        fileName: media.fileName || null,
        fileLength: media.buffer.length,
        caption: media.caption || null,
        seconds: null,
      },
      timestamp: this._ts(sent) || Date.now(),
      isFromMe: true,
      status: "sent",
      replyTo: media.replyTo || null,
    };
  }

  // ===== Download media pesan (img/vid/audio/sticker/doc) =====

  // Cari raw pesan di store bot berdasar chatId + messageId.
  _findStoreMessage(chatId, messageId) {
    if (!messageId) return null;
    const msgs = this._findStoreMsgs(chatId);
    if (msgs?.has(messageId)) return msgs.get(messageId);
    // Fallback: pesan keluar yang baru dikirim mungkin belum masuk store ->
    // cek semua kunci raw yang cocok (resolve LID).
    const store = this._bot.store;
    if (store?.messages) {
      for (const [rawJid, m2] of store.messages) {
        if ((rawJid === chatId || this._resolveJid(rawJid) === chatId) && m2.has(messageId)) {
          return m2.get(messageId);
        }
      }
    }
    return null;
  }

  // mediaType Baileys: image -> image, sticker -> sticker, dst.
  // downloadContentFromMessage butuh type tanpa kata "Message".
  async getMedia(chatId, messageId) {
    // 1) DISK CACHE DULU — sumber tercepat & paling andal untuk media yang
    //    pernah lewat gateway (terutama pesan keluar yang baru dikirim).
    const cached = this._readMediaCache(chatId, messageId);
    if (cached) return cached;

    const m = this._findStoreMessage(chatId, messageId);
    if (!m?.message) return { ok: false, error: "Pesan tidak ditemukan di store bot" };

    // Bongkar wrapper (ephemeral/viewOnce/dll) sampai konten aslinya.
    let content = m.message;
    for (let i = 0; i < 5 && content; i++) {
      const inner =
        content.ephemeralMessage?.message ||
        content.viewOnceMessage?.message ||
        content.viewOnceV2Message?.message ||
        content.viewOnceMessageV2?.message ||
        content.viewOnceMessageV2Extension?.message ||
        content.documentWithCaptionMessage?.message ||
        null;
      if (!inner) break;
      content = inner;
    }

    const mediaKeys = [
      "imageMessage", "videoMessage", "audioMessage",
      "stickerMessage", "documentMessage",
    ];
    const mediaType = mediaKeys.find((k) => content[k]);
    if (!mediaType) {
      return { ok: false, error: "Pesan ini bukan media (atau media sudah tidak tersedia)" };
    }

    try {
      const { downloadContentFromMessage } = await import("ourin");
      const stream = await downloadContentFromMessage(content[mediaType], mediaType.replace("Message", ""));
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) return { ok: false, error: "Media kosong" };

      const node = content[mediaType];
      const info = {
        type: mediaType.replace("Message", ""),
        mimetype: node.mimetype || null,
        fileName: node.fileName || null,
        caption: node.caption || null,
        seconds: node.seconds || null,
        source: "store",
      };
      // Persist ke disk: download dari WA mahal (dekripsi + network), dan
      // store bot akan membuang pesan ini saat cache-nya penuh.
      this._writeMediaCache(chatId, messageId, buffer, info);
      return { ok: true, buffer, info };
    } catch (e) {
      return { ok: false, error: `Gagal download media: ${e.message}` };
    }
  }

  // ===== Blokir nomor (chat pribadi) =====

  async getBlocked() {
    try {
      return { blocked: this._bot.getSocket?.()?.user?.blocked || [] };
    } catch {
      return { blocked: [] };
    }
  }

  async blockContact(rawJid) {
    const check = this._validatePrivateJid(rawJid);
    if (!check.ok) return { ok: false, error: check.error };
    const jid = check.jid;
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      // 1) Blokir di server WA (efek nyata: nomor tidak bisa chat bot)
      await sock.updateBlockStatus(jid.split("@")[0], "block");
      // 2) Tandai juga di database bot (isBlocked) agar konsisten dgn fitur blokir bawaan bot
      try {
        const db = this._bot.getDatabase?.();
        if (db && typeof db.setUser === "function") db.setUser(jid, { isBlocked: true });
      } catch { }
      return { ok: true, jid };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async unblockContact(rawJid) {
    const check = this._validatePrivateJid(rawJid);
    if (!check.ok) return { ok: false, error: check.error };
    const jid = check.jid;
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      await sock.updateBlockStatus(jid.split("@")[0], "unblock");
      try {
        const db = this._bot.getDatabase?.();
        if (db && typeof db.setUser === "function") db.setUser(jid, { isBlocked: false });
      } catch { }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ===== Profil bot (nomor, nama, bio/status) =====

  async getBotProfile() {
    try {
      const sock = this._bot.getSocket?.();
      if (!sock?.user) return { profile: null, error: "Bot tidak terhubung ke WhatsApp" };
      let status = null;
      try {
        const st = await sock.fetchStatus(sock.user.id);
        // Bentuk respons beda-beda antar versi Baileys — coba beberapa varian
        status =
          (typeof st?.status === "string" && st.status) ||
          (typeof st === "string" && st) ||
          st?.status?.status ||
          st?.[0]?.status ||
          null;
      } catch { }
      return {
        profile: {
          number: String(sock.user.id).split(":")[0].split("@")[0],
          name: sock.user.name || sock.user.verifiedName || this._bot.config?.bot?.name || "Bot",
          bio: status,
        },
      };
    } catch (e) {
      return { profile: null, error: e.message };
    }
  }

  async updateBotProfile(key, value) {
    if (key !== "name" && key !== "bio") {
      return { ok: false, error: 'Key harus "name" atau "bio"' };
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false, error: "Value tidak boleh kosong" };
    }
    if (value.length > 139) {
      return { ok: false, error: "Maksimal 139 karakter (batas bio WhatsApp)" };
    }
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      if (key === "name") {
        await sock.updateProfileName(value.trim());
        if (this._bot.config?.bot) this._bot.config.bot.name = value.trim();
      } else {
        await sock.updateProfileStatus(value.trim());
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ===== Chat pribadi baru dari kontak =====

  // Validasi JID pribadi: harus nomor (bukan grup/saluran/status/LID).
  _validatePrivateJid(jid) {
    if (typeof jid !== "string" || jid.length === 0) return { ok: false, error: "JID kosong" };
    if (jid.endsWith("@s.whatsapp.net")) {
      const digits = jid.split("@")[0].replace(/[^0-9]/g, "");
      if (digits.length < 8 || digits.length > 15) return { ok: false, error: "Nomor tidak valid" };
      return { ok: true, jid: `${digits}@s.whatsapp.net` };
    }
    return { ok: false, error: "Hanya JID pribadi (@s.whatsapp.net) yang didukung" };
  }

  // Terima nomor dari NEGARA MANA PUN — rapikan jadi <digits>@s.whatsapp.net.
  // Contoh yang diterima:
  //   "+628123456789", "628123456789", "081234567890" (trunk lokal Indonesia -> 62)
  //   "+447911123456", "447911123456", "+819012345678", "819012345678"
  //   "447911123456@s.whatsapp.net" (JID penuh -> tidak diubah)
  // Aturan: buang spasi/"-"/"("/")", leading "+" boleh, TIDAK memaksa country
  // code, TIDAK mengonversi nomor asing ke 62. Hanya prefix "0" (konvensi trunk
  // lokal) yang dipetakan ke 62.
  _normalizeIdNumber(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    // JID penuh: validasi & normalkan, jangan dianggap nomor telepon
    if (s.includes("@")) {
      const check = this._validatePrivateJid(s);
      return check.ok ? check.jid.split("@")[0] : null;
    }
    const digits = s.replace(/[^0-9]/g, "");
    if (!digits) return null;
    let out = digits;
    if (out.startsWith("0")) out = "62" + out.slice(1); // trunk lokal (08xx) -> 62
    // E.164: 8-15 digit, country code negara apa pun diterima apa adanya
    if (out.length < 8 || out.length > 15) return null;
    return out;
  }

  async startPrivateChat(rawNumber) {
    const digits = this._normalizeIdNumber(rawNumber);
    if (!digits) {
      return { ok: false, error: "Nomor tidak valid. Gunakan format internasional, contoh: +628123456789 atau +447911123456" };
    }
    const jid = `${digits}@s.whatsapp.net`;
    const sock = this._bot.getSocket?.();
    if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
    const existing = await this.getChat(jid);
    const chat = {
      id: jid,
      name: this._senderName(jid) || digits,
      lastMessageText: existing?.lastMessageText ?? null,
      lastMessageTs: existing?.lastMessageTs ?? null,
      unread: 0,
      isGroup: false,
    };
    // Emit supaya chat langsung muncul di daftar chat semua client yang online
    this._emit(EVENTS.CHAT_UPDATED, { chatId: jid, name: chat.name });
    return { ok: true, chat };
  }

  // ===== Salin text: isi satu pesan =====

  async getMessageText(chatId, messageId) {
    if (!messageId || typeof messageId !== "string") return null;
    // 1) Pesan keluar yang baru dikirim dari APK mungkin belum masuk store bot
    if (this._sentTexts?.get(chatId)?.has(messageId)) {
      return this._sentTexts.get(chatId).get(messageId);
    }
    // 2) Sumber utama: store pesan bot
    const msgs = this._findStoreMsgs(chatId);
    if (!msgs) return null;
    const m = msgs.get(messageId);
    if (!m) return null;
    const { text } = this._extract(m.message);
    return text ?? null;
  }

  // ===== Manajemen chat: keluar grup / hapus pesan / hapus chat =====

  async leaveGroup(chatId) {
    if (!chatId?.endsWith("@g.us")) {
      return { ok: false, error: "Hanya grup yang bisa ditinggalkan" };
    }
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      await sock.groupLeave(chatId);
      // Bersihkan cache internal + DB gateway supaya chat hilang dari APK
      this._groups.delete(chatId);
      try {
        this._bot.getDatabase?.()?.deleteGroup?.(chatId);
      } catch { }
      this._emit(EVENTS.CHAT_UPDATED, { chatId, deleted: true });
      log.info("WA", `Bot keluar dari grup ${chatId}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async deleteMessage(chatId, messageId, scope = "me") {
    if (!messageId || typeof messageId !== "string") {
      return { ok: false, error: "messageId tidak valid" };
    }
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };

      const rawMsg = this._findStoreMessage(chatId, messageId);

      if (scope === "everyone") {
        // HAPUS UNTUK SEMUA ORANG (unsend):
        // - Private: hanya pesan milik bot sendiri (fromMe) yang bisa di-revoke.
        // - Grup: pesan siapa pun, ASALKAN bot admin grup (WA yang enforce).
        const isGroup = chatId.endsWith("@g.us");
        const fromMe = rawMsg?.key?.fromMe ?? true; // pesan keluar gateway default fromMe
        if (!isGroup && !fromMe) {
          return { ok: false, error: "Di chat pribadi hanya pesan bot sendiri yang bisa dihapus untuk semua" };
        }
        const key = {
          remoteJid: chatId,
          id: messageId,
          fromMe,
        };
        if (isGroup && !fromMe && rawMsg?.key?.participant) {
          key.participant = rawMsg.key.participant;
        }
        await sock.sendMessage(chatId, { delete: key });
        log.info("WA", `Pesan ${messageId} dihapus untuk semua (chat ${chatId})`);
      } else {
        // HAPUS UNTUK SAYA (sisi bot saja):
        // Bila pesan milik bot, WA revoke biasa; pesan orang lain cukup
        // dihapus dari DB gateway (hilang dari tampilan APK).
        const fromMe = rawMsg?.key?.fromMe ?? false;
        if (fromMe) {
          await sock.sendMessage(chatId, {
            delete: { remoteJid: chatId, id: messageId, fromMe: true },
          }).catch(() => { });
        }
        log.info("WA", `Pesan ${messageId} dihapus untuk saya (chat ${chatId})`);
      }

      // Tandai terhapus di DB gateway — hilang dari tampilan APK.
      try {
        const { markMessageDeleted } = await import("../db.js");
        markMessageDeleted(chatId, messageId);
      } catch { }
      this._emit(EVENTS.MESSAGE_DELETED, { chatId, messageId });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async deleteChat(chatId) {
    try {
      // 1) Hapus chat + seluruh pesannya dari DB gateway (hilang dari APK)
      try {
        const { deleteChatData } = await import("../db.js");
        deleteChatData(chatId);
      } catch { }
      // 2) Hapus dari store bot (in-memory) bila kunci raw ketemu
      const store = this._bot.store;
      if (store?.messages) {
        const rawKey = this._findRawChatKey(chatId);
        if (rawKey) {
          store.messages.delete(rawKey);
        }
      }
      // 3) Hapus disk cache media chat ini
      try {
        const dir = this._mediaCacheDir;
        if (dir && fs.existsSync(dir)) {
          const prefix = LiveBotAdapter._mediaCacheKey(chatId, "").replace(/__$/, "");
          for (const f of fs.readdirSync(dir)) {
            if (f.startsWith(prefix + "__")) {
              try { fs.unlinkSync(path.join(dir, f)); } catch { }
            }
          }
        }
      } catch { }
      // 4) Broadcast ke semua client APK supaya chat hilang realtime
      this._emit(EVENTS.CHAT_UPDATED, { chatId, deleted: true });
      log.info("WA", `Chat ${chatId} dihapus dari bot`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ===== Kelola member grup (lihat / tambah / kick) =====

  // Normalisasi input "628xxx", "+44 7xx-", "08xxx", JID penuh, dll -> JID WA.
  // Negara mana pun: tidak memaksa 62, prefix "0" (trunk lokal) -> 62.
  _normalizeParticipantJid(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (s.includes("@")) {
      // JID penuh: buang suffix device ":12" bila ada
      const [user, server] = s.split("@");
      return `${user.split(":")[0]}@${server}`;
    }
    const digits = this._normalizeIdNumber(s);
    if (!digits) return null;
    return `${digits}@s.whatsapp.net`;
  }

  async getGroupMembers(chatId) {
    if (!chatId?.endsWith("@g.us")) {
      return { ok: false, error: "Bukan JID grup" };
    }
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      const meta = await sock.groupMetadata(chatId);
      const members = (meta?.participants || []).map((p) => {
        const jid = p.jid || p.id || "";
        const resolved = this._resolveJid(jid);
        return {
          id: resolved || jid,
          name: p.notify || p.name || p.verifiedName || this._senderName(resolved || jid) || null,
          isAdmin: !!p.admin,
          isSuperAdmin: p.admin === "superadmin" || p.admin === "owner",
        };
      });
      // Cache nama & grup sekaligus
      for (const mem of members) this._rememberName(mem.id, mem.name);
      this._groups.set(chatId, {
        name: meta?.subject || this._groups.get(chatId)?.name || null,
        participants: new Set(members.map((m) => m.id)),
      });
      return { ok: true, members, subject: meta?.subject || null };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async addParticipants(chatId, jids) {
    if (!chatId?.endsWith("@g.us")) {
      return { ok: false, error: "Bukan JID grup" };
    }
    if (!Array.isArray(jids) || jids.length === 0) {
      return { ok: false, error: "Daftar nomor kosong" };
    }
    if (jids.length > 50) {
      return { ok: false, error: "Maksimal 50 nomor per permintaan" };
    }
    const normalized = [];
    for (const j of jids) {
      const n = this._normalizeParticipantJid(j);
      if (n) normalized.push(n);
    }
    if (normalized.length === 0) {
      return { ok: false, error: "Tidak ada nomor valid (format: 62xxx / 08xxx)" };
    }
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      // Baileys groupParticipantsUpdate: hasil per-participant "200"=sukses,
      // "403"=privasi menolak (undangan manual), "408"=sudah keluar baru-baru ini, dll.
      const result = await sock.groupParticipantsUpdate(chatId, normalized, "add");
      const added = [];
      const failed = [];
      for (const r of result || []) {
        const jid = r?.jid || r?.content?.[0]?.attrs?.jid || "";
        const code = String(r?.status || r?.content?.[0]?.attrs?.type || "");
        if (code === "200") added.push(jid);
        // Prefix kode di pesan error (mis. "403: nomor menolak...") supaya
        // client (APK) bisa mendeteksi kode & menawarkan aksi terkait
        // (403 -> tawarkan kirim undangan link).
        else failed.push({ jid, error: `${code}: ${PARTICIPANT_STATUS[code] || "gagal (kode tidak dikenal)"}` });
      }
      log.info("WA", `Tambah member ke ${chatId}: ${added.length} sukses, ${failed.length} gagal`);
      return { ok: true, added, failed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async removeParticipants(chatId, jids) {
    if (!chatId?.endsWith("@g.us")) {
      return { ok: false, error: "Bukan JID grup" };
    }
    if (!Array.isArray(jids) || jids.length === 0) {
      return { ok: false, error: "Daftar nomor kosong" };
    }
    if (jids.length > 50) {
      return { ok: false, error: "Maksimal 50 nomor per permintaan" };
    }
    const normalized = [];
    for (const j of jids) {
      const n = this._normalizeParticipantJid(j);
      if (n) normalized.push(n);
    }
    if (normalized.length === 0) {
      return { ok: false, error: "Tidak ada nomor valid" };
    }
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      const result = await sock.groupParticipantsUpdate(chatId, normalized, "remove");
      const removed = [];
      const failed = [];
      for (const r of result || []) {
        const jid = r?.jid || r?.content?.[0]?.attrs?.jid || "";
        const code = String(r?.status || r?.content?.[0]?.attrs?.type || "");
        if (code === "200") removed.push(jid);
        else failed.push({ jid, error: PARTICIPANT_STATUS[code] || `kode ${code}` });
      }
      log.info("WA", `Kick member dari ${chatId}: ${removed.length} sukses, ${failed.length} gagal`);
      return { ok: true, removed, failed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Promote/demote admin grup. action: "promote" | "demote".
  // Baileys: groupParticipantsUpdate(chatId, jids, "promote"|"demote") —
  // WA yang enforce: bot HARUS admin grup, target bukan superadmin/pembuat.
  async setGroupAdmins(chatId, jids, action) {
    if (!chatId?.endsWith("@g.us")) {
      return { ok: false, error: "Bukan JID grup" };
    }
    if (action !== "promote" && action !== "demote") {
      return { ok: false, error: 'action harus "promote" atau "demote"' };
    }
    if (!Array.isArray(jids) || jids.length === 0) {
      return { ok: false, error: "Daftar nomor kosong" };
    }
    if (jids.length > 50) {
      return { ok: false, error: "Maksimal 50 nomor per permintaan" };
    }
    const normalized = [];
    for (const j of jids) {
      const n = this._normalizeParticipantJid(j);
      if (n) normalized.push(n);
    }
    if (normalized.length === 0) {
      return { ok: false, error: "Tidak ada nomor valid" };
    }
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      const result = await sock.groupParticipantsUpdate(chatId, normalized, action);
      const changed = [];
      const failed = [];
      for (const r of result || []) {
        const jid = r?.jid || r?.content?.[0]?.attrs?.jid || "";
        const code = String(r?.status || r?.content?.[0]?.attrs?.type || "");
        if (code === "200") changed.push(jid);
        else failed.push({ jid, error: `${code}: ${PARTICIPANT_STATUS[code] || "gagal (kode tidak dikenal)"}` });
      }
      log.info("WA", `${action} admin di ${chatId}: ${changed.length} sukses, ${failed.length} gagal`);
      return { ok: true, changed, failed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ===== Kirim undangan grup via link (untuk nomor yang menolak ditambah / 403) =====

  // Ambil kode undangan grup (bot harus member; WA enforce sisanya).
  async getGroupInviteCode(chatId) {
    if (!chatId?.endsWith("@g.us")) {
      return { ok: false, error: "Bukan JID grup" };
    }
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      const code = await sock.groupInviteCode(chatId);
      if (!code) return { ok: false, error: "Kode undangan tidak tersedia" };
      return { ok: true, code, url: `https://chat.whatsapp.com/${code}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Kirim link undangan grup ke nomor via chat pribadi.
  async sendGroupInvite(chatId, targetNumber, message) {
    const inv = await this.getGroupInviteCode(chatId);
    if (!inv.ok) return inv;
    const targetJid = this._normalizeParticipantJid(targetNumber);
    if (!targetJid) return { ok: false, error: "Nomor tidak valid (contoh: +628123456789 atau +447911123456)" };
    try {
      const sock = this._bot.getSocket?.();
      if (!sock) return { ok: false, error: "Bot tidak terhubung ke WhatsApp" };
      // Nama grup dari cache (fallback: metadata langsung).
      let groupName = this._groups?.get(chatId)?.name;
      if (!groupName) {
        try {
          groupName = (await sock.groupMetadata(chatId))?.subject;
        } catch {}
      }
      const caption = message || `Undangan grup ${groupName || ""}`.trim();
      // Payload groupInviteMessage resmi Baileys — tampil sebagai KARTU UNDANGAN
      // resmi WA di HP penerima (bisa tap "Join Group"), bukan cuma link mentah.
      // Ini jalur yang benar untuk nomor yang menolak ditambah langsung (403).
      try {
        await sock.sendMessage(targetJid, {
          groupInviteMessage: {
            groupJid: chatId,
            inviteCode: inv.code,
            inviteExpiration: 0,
            groupName: groupName || undefined,
            caption,
          },
        });
      } catch {
        // Fallback: kirim sebagai teks biasa kalau payload invite ditolak server.
        await sock.sendMessage(targetJid, {
          text: `${caption}\n\n${inv.url}`,
        });
      }
      log.info("WA", `Link undangan ${chatId} dikirim ke ${targetJid}`);
      return { ok: true, url: inv.url, target: targetJid };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ===== YouTube: cari & stream (untuk tab Musik di APK) =====
  // PENTING: ini STREAMING ke APK, bukan file download — server hanya
  // menyediakan URL stream yang di-redirect ke ExoPlayer/MediaPlayer.

  async ytSearch(query) {
    const q = String(query || "").trim();
    if (!q) return { ok: false, error: "Query pencarian kosong" };
    try {
      const yts = (await import("yt-search")).default;
      const res = await yts(q);
      const videos = (res?.videos || []).slice(0, 20).map((v) => ({
        videoId: v.videoId || null,
        title: v.title || "",
        author: v.author?.name || "",
        duration: v.duration?.timestamp || v.timestamp || "",
        seconds: v.seconds || 0,
        views: v.views || 0,
        thumbnail: v.image || v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        url: v.url || `https://www.youtube.com/watch?v=${v.videoId}`,
      }));
      return { ok: true, videos };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Ambil URL stream untuk satu video YouTube.
  // Prioritas: scraper ytdl milik bot (URL konversi mp3/mp4 siap stream).
  async getYtStream(videoIdOrUrl, format = "mp3") {
    const fmt = String(format).toLowerCase() === "mp4" ? "mp4" : "mp3";
    const vid = String(videoIdOrUrl || "").trim();
    if (!vid) return { ok: false, error: "videoId/url kosong" };
    const url = vid.startsWith("http") ? vid : `https://www.youtube.com/watch?v=${vid}`;
    try {
      const mod = await import(path.join(process.cwd(), "src", "scraper", "ytdl.js"));
      const result = await mod.ytdl(url, fmt);
      if (!result?.status || !result?.dl) {
        return { ok: false, error: result?.mess || "Gagal mendapatkan stream URL" };
      }
      return {
        ok: true,
        title: result.title || null,
        format: fmt,
        streamUrl: result.dl,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ===== Avatar (foto profil) =====

  // Avatar bot sendiri: JID bot sering punya suffix device (":11") yang
  // bikin profilePictureUrl gagal -> bersihkan dulu.
  async getBotAvatar() {
    const sock = this._bot.getSocket?.();
    if (!sock?.user?.id) return null;
    return this.getAvatar(sock.user.id);
  }

  async getAvatar(rawJid) {
    const sock = this._bot.getSocket?.();
    if (!sock?.profilePictureUrl) return null;
    try {
      // Bersihkan JID: LID -> nomor asli, buang suffix device ":11",
      // handle user "xxx:13@s.whatsapp.net". Tanpa ini PP pengirim grup
      // (yang sering dikirim sebagai @lid) dan PP bot gagal 404.
      let jid = String(rawJid || "");
      if (jid.endsWith("@lid")) {
        const resolved = this._resolveJid(jid);
        if (resolved && !resolved.endsWith("@lid")) jid = resolved;
      }
      if (jid.endsWith("@g.us")) {
        // Foto grup: jid grup dipakai apa adanya
      } else if (jid.includes("@")) {
        const [user, server] = jid.split("@");
        jid = `${user.split(":")[0]}@${server}`;
      }
      if (jid.endsWith("@lid")) return null; // gagal resolve -> tanpa PP (fallback inisial)
      const url = await sock.profilePictureUrl(jid, "image");
      return typeof url === "string" && url.length > 0 ? url : null;
    } catch {
      return null; // 404/401 -> user tidak punya PP atau menyembunyikannya (NORMAL, bukan error)
    }
  }

  // ===== Contacts =====

  async getContacts() {
    const out = new Map();
    // 1) kontak database bot
    try {
      const settings = this._bot.getDatabase?.()?.getSettings?.() || {};
      for (const [jid, c] of Object.entries(settings.contacts || {})) {
        if (jid.endsWith("@s.whatsapp.net")) {
          out.set(jid, { id: jid, name: c?.name || null, notify: c?.name || null, status: null });
        }
      }
    } catch { }
    // 2) store.contacts bot
    try {
      for (const [jid, c] of Object.entries(this._bot.store?.contacts || {})) {
        if (!jid.endsWith("@s.whatsapp.net")) continue;
        const existing = out.get(jid) || { id: jid, name: null, notify: null, status: null };
        existing.name = existing.name || c.name || null;
        existing.notify = existing.notify || c.notify || null;
        out.set(jid, existing);
      }
    } catch { }
    // 3) pushName cache adapter
    for (const [jid, name] of this._pushNames) {
      if (!out.has(jid) && jid.endsWith("@s.whatsapp.net")) {
        out.set(jid, { id: jid, name: null, notify: name, status: null });
      }
    }
    return [...out.values()];
  }

  async getGroups() {
    await this._fetchGroupsSafe();
    return [...this._groups.entries()].map(([jid, g]) => ({
      id: jid,
      name: g.name || null,
      isGroup: true,
    }));
  }

  // ===== Settings =====

  getSupportedSettings() {
    return ["botName", "mode", "prefix", "autoRead", "autoTyping"];
  }

  async getBotSettings() {
    const db = this._bot.getDatabase?.();
    const s = db?.getSettings?.() || {};
    const cfg = this._bot.config || {};
    return {
      botName: cfg.bot?.name || "Bot",
      mode: s.botMode || cfg.mode || "public",
      prefix: cfg.command?.prefix || ".",
      autoRead: !!s.autoRead,
      autoTyping: !!s.autoTyping,
    };
  }

  async updateBotSetting(key, value) {
    const db = this._bot.getDatabase?.();
    const cfg = this._bot.config;
    if (!this.getSupportedSettings().includes(key)) {
      return { ok: false, applied: [], error: `Setting "${key}" tidak didukung` };
    }
    try {
      switch (key) {
        case "mode": {
          if (value !== "public" && value !== "self") {
            return { ok: false, applied: [], error: 'Mode hanya "public" atau "self" (bot core belum dukung "private")' };
          }
          db?.setting?.("botMode", value);
          if (cfg) cfg.mode = value;
          break;
        }
        case "prefix": {
          if (typeof value !== "string" || value.length < 1 || value.length > 4) {
            return { ok: false, applied: [], error: "Prefix 1-4 karakter" };
          }
          if (cfg?.command) cfg.command.prefix = value;
          this._bot.invalidatePrefixCache?.();
          break;
        }
        case "botName": {
          if (typeof value !== "string" || value.length < 1 || value.length > 32) {
            return { ok: false, applied: [], error: "Bot name 1-32 karakter" };
          }
          if (cfg?.bot) cfg.bot.name = value;
          break;
        }
        case "autoRead":
          db?.setting?.("autoRead", !!value);
          break;
        case "autoTyping":
          db?.setting?.("autoTyping", !!value);
          break;
      }
      this._emit(EVENTS.BOT_SETTINGS_UPDATED, { key, value });
      return { ok: true, applied: [key] };
    } catch (e) {
      return { ok: false, applied: [], error: e.message };
    }
  }

  // ===== Plugins (hot enable/disable milik bot) =====

  async getPlugins() {
    const seen = new Map();
    for (const p of this._bot.pluginStore?.commands?.values() || []) {
      const cfg = p?.config;
      const rawName = cfg?.name;
      const name = Array.isArray(rawName) ? rawName[0] : rawName;
      if (!name || seen.has(name)) continue;
      seen.set(name, {
        name,
        description: cfg.description || "",
        version: cfg.version || null,
        category: cfg.category || null,
        enabled: cfg.isEnabled !== false,
      });
    }
    return [...seen.values()];
  }

  async enablePlugin(name) {
    try {
      const ok = this._bot.enablePlugin?.(name);
      if (!ok) return { ok: false, error: `Plugin "${name}" tidak ditemukan` };
      this._emit(EVENTS.PLUGIN_UPDATED, { name, enabled: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async disablePlugin(name) {
    try {
      const ok = this._bot.disablePlugin?.(name);
      if (!ok) return { ok: false, error: `Plugin "${name}" tidak ditemukan` };
      this._emit(EVENTS.PLUGIN_UPDATED, { name, enabled: false });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}
