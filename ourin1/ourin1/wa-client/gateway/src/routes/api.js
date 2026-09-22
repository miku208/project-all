import { Router } from "express";
import { adapter, ADAPTER_MODE } from "../adapters/index.js";
import { EVENTS } from "../adapters/botAdapter.js";
import {
  upsertChat,
  listChats,
  getChat,
  setChatUnread,
  listMessages,
  insertMessage,
  updateMessageStatus,
  listContacts,
  getAvatar,
  upsertAvatar,
  getMessage as getStoredMessage,
  countAllMessages,
  countChatsWithMessages,
  deleteChatData,
} from "../db.js";
import { isValidJid, isValidMessageId } from "../utils/jid.js";
import { authRequired, ipRateLimit } from "../middleware/auth.js";
import { broadcast } from "../websocket/index.js";
import { log } from "../utils/logger.js";

const router = Router();

const MAX_MESSAGE_LEN = 8000; // validasi ukuran pesan
const MAX_MEDIA_UPLOAD = 50 * 1024 * 1024; // 50MB

const ALLOWED_MEDIA_TYPES = ["image", "video", "audio", "sticker", "document"];

// Ekstensi -> mimetype (cukup yang umum; sisanya octet-stream)
const EXT_MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mkv": "video/x-matroska", ".webm": "video/webm", ".3gp": "video/3gpp",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".pdf": "application/pdf", ".zip": "application/zip",
  ".apk": "application/vnd.android.package-archive",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function guessMime(fileName) {
  if (!fileName) return null;
  const dot = fileName.lastIndexOf(".");
  if (dot === -1) return null;
  return EXT_MIME[fileName.slice(dot).toLowerCase()] || null;
}

function isSafeFileName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 && name.length <= 255 &&
    !name.includes("/") && !name.includes("\\") && !name.includes("..") &&
    /^[\w\-. ()\[\]]+$/.test(name)
  );
}

// GET /api/status — status bot + gateway (tanpa auth agar APK bisa cek cepat? TIDAK — tetap auth)
router.get("/status", authRequired, (req, res) => {
  const conn = adapter.getConnectionStatus();
  res.json({
    bot: { state: conn.state, uptimeMs: conn.uptimeMs },
    gateway: {
      online: true,
      adapterMode: ADAPTER_MODE,
      uptimeSec: Math.round(process.uptime()),
      // Statistik simpanan history (pantau kapasitas dari APK)
      messagesStored: countAllMessages(),
      chatsStored: countChatsWithMessages(),
    },
    timestamp: Date.now(),
  });
});

// GET /api/chats?search=&limit=&offset=  (default 200, max 500 — jangan sampai grup hilang dari listing)
router.get("/chats", authRequired, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "200", 10) || 200, 500);
    const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);
    const search = String(req.query.search || "").slice(0, 64);

    // Sinkron dari adapter, lalu serve dari DB (single source of truth utk listing)
    const adapterChats = await adapter.getChats();
    for (const c of adapterChats) {
      upsertChat({
        id: c.id,
        name: c.name ?? null,
        lastMessageText: c.lastMessageText ?? null,
        lastMessageTs: c.lastMessageTs ?? null,
        unread: c.unread ?? null,
        pinned: c.pinned ?? null,
        muted: c.muted ?? null,
        isGroup: c.isGroup ?? null,
      });
    }

    res.json({ chats: listChats({ limit, offset, search }) });
  } catch (e) {
    log.error("API", `GET /chats: ${e.message}`);
    res.status(500).json({ error: "Gagal memuat chats" });
  }
});

// GET /api/chats/:chatId
router.get("/chats/:chatId", authRequired, (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  const chat = getChat(chatId);
  if (!chat) return res.status(404).json({ error: "Chat tidak ditemukan" });
  res.json({ chat });
});

// GET /api/chats/:chatId/messages/:messageId/media — download media pesan
// (image/video/audio/sticker/document). Binary langsung; APK tinggal render.
// ?download=1 pakai Content-Disposition attachment (save file).
router.get("/chats/:chatId/messages/:messageId/media", authRequired, ipRateLimit({ max: 60, windowMs: 60 * 1000, name: "getmedia" }), async (req, res) => {
  const chatId = req.params.chatId;
  const messageId = req.params.messageId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  if (!isValidMessageId(messageId)) return res.status(400).json({ error: "messageId tidak valid" });
  try {
    const r = await adapter.getMedia(chatId, messageId);
    if (!r?.ok) return res.status(404).json({ error: r?.error || "Media tidak ditemukan" });
    const { buffer, info } = r;
    const mime = info.mimetype || guessMime(info.fileName) || "application/octet-stream";
    res.set({
      "Content-Type": mime,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=86400",
      "X-Media-Type": info.type || "",
      "X-Media-Name": encodeURIComponent(info.fileName || ""),
      "X-Media-Caption": encodeURIComponent(info.caption || ""),
    });
    if (req.query.download === "1") {
      res.set("Content-Disposition", `attachment; filename="${(info.fileName || messageId).replace(/["\\]/g, "")}"`);
    }
    res.send(buffer);
  } catch (e) {
    log.error("API", `GET media: ${e.message}`);
    res.status(500).json({ error: "Gagal mengambil media" });
  }
});

// POST /api/chats/:chatId/media — kirim media ke chat.
// multipart/form-data: file (wajib), type (image|video|audio|sticker|document),
// caption, fileName, ptt, replyTo. Atau JSON { type, base64, ... }.
router.post("/chats/:chatId/media", authRequired, ipRateLimit({ max: 20, windowMs: 60 * 1000, name: "sendmedia" }), async (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });

  let media = null;
  const ct = req.headers["content-type"] || "";

  if (ct.includes("multipart/form-data")) {
    // Middleware express.raw sudah menampung buffer; parse multipart manual ringan
    // (tanpa dependency busboy): cari boundary, ekstrak part pertama file + fields.
    const boundary = /boundary=(?:(?:"([^"]+)")|([^;]+))/i.exec(ct);
    if (!boundary) return res.status(400).json({ error: "Boundary multipart tidak ditemukan" });
    const delim = "--" + (boundary[1] || boundary[2]);
    const body = req.body; // Buffer dari express.raw
    if (!Buffer.isBuffer(body)) return res.status(400).json({ error: "Body bukan binary" });
    if (body.length > MAX_MEDIA_UPLOAD * 2) return res.status(413).json({ error: "Upload terlalu besar" });

    const parts = [];
    let idx = body.indexOf(delim);
    while (idx !== -1) {
      const start = idx + delim.length;
      if (body.slice(start, start + 2).toString() === "--") break; // closing
      const headEnd = body.indexOf("\r\n\r\n", start);
      if (headEnd === -1) break;
      const next = body.indexOf(delim, headEnd + 4);
      if (next === -1) break;
      parts.push({
        headers: body.slice(start, headEnd).toString("utf8"),
        data: body.slice(headEnd + 4, next - 2), // -2: buang \r\n sebelum boundary
      });
      idx = next;
    }

    let filePart = null;
    const fields = {};
    for (const p of parts) {
      const nameM = /name="([^"]*)"/i.exec(p.headers);
      const name = nameM ? nameM[1] : "";
      if (p.headers.includes("filename=") && name === "file") {
        const fnM = /filename="([^"]*)"/i.exec(p.headers);
        const ctM = /content-type:\s*([^\r\n]+)/i.exec(p.headers);
        filePart = { data: p.data, fileName: fnM ? fnM[1] : "file", contentType: ctM ? ctM[1].trim() : null };
      } else {
        fields[name] = p.data.toString("utf8");
      }
    }
    if (!filePart) return res.status(400).json({ error: "Field file wajib diisi" });
    if (filePart.data.length === 0) return res.status(400).json({ error: "File kosong" });
    if (filePart.data.length > MAX_MEDIA_UPLOAD) return res.status(413).json({ error: "File terlalu besar (maks 50MB)" });

    // Prioritas mimetype: field mimeType eksplisit dari APK → Content-Type part
    // → tebakan dari nama file. Penting: foto tanpa ekstensi tetap terkirim
    // sebagai image (bukan didokument-kan) karena APK kirim MIME dari resolver.
    media = {
      type: fields.type || null,
      buffer: filePart.data,
      mimetype: fields.mimeType || filePart.contentType || guessMime(filePart.fileName) || null,
      fileName: fields.fileName || filePart.fileName || null,
      caption: fields.caption || null,
      ptt: fields.ptt === "true" || fields.ptt === "1",
      replyTo: fields.replyTo || null,
    };
    if (!media.type) {
      const gm = media.mimetype || guessMime(media.fileName);
      media.type = gm && gm.startsWith("image/webp") ? "sticker"
        : gm && gm.startsWith("image/") ? "image"
        : gm && gm.startsWith("video/") ? "video"
        : gm && gm.startsWith("audio/") ? "audio"
        : "document";
    }
  } else if (Buffer.isBuffer(req.body)) {
    // Binary multipart yang gagal diparse (boundary beda format) — tolak dengan jelas
    return res.status(400).json({ error: "Body multipart tidak dapat diparse" });
  } else {
    // JSON: { type, base64, mimetype?, fileName?, caption?, ptt?, replyTo? }
    const b = req.body || {};
    if (typeof b.base64 !== "string" || b.base64.length === 0) {
      return res.status(400).json({ error: "base64 wajib diisi (atau kirim multipart/form-data field file)" });
    }
    let buffer;
    try {
      buffer = Buffer.from(b.base64, "base64");
    } catch {
      return res.status(400).json({ error: "base64 tidak valid" });
    }
    if (buffer.length === 0) return res.status(400).json({ error: "File kosong" });
    if (buffer.length > MAX_MEDIA_UPLOAD) return res.status(413).json({ error: "File terlalu besar (maks 50MB)" });
    media = {
      type: b.type || null,
      buffer,
      mimetype: b.mimetype || guessMime(b.fileName),
      fileName: b.fileName || null,
      caption: b.caption || null,
      ptt: !!b.ptt,
      replyTo: b.replyTo || null,
    };
  }

  if (!media.type || !ALLOWED_MEDIA_TYPES.includes(media.type)) {
    return res.status(400).json({ error: `type harus salah satu dari: ${ALLOWED_MEDIA_TYPES.join(", ")}` });
  }
  if (media.replyTo != null && !isValidMessageId(media.replyTo)) {
    return res.status(400).json({ error: "replyTo (messageId) tidak valid" });
  }

  try {
    const msg = await adapter.sendMedia(chatId, media);
    insertMessage({
      chatId,
      messageId: msg.messageId,
      senderId: msg.senderId ?? "bot",
      senderName: msg.senderName ?? "bot",
      messageType: msg.messageType || media.type,
      text: msg.text ?? null,
      mediaMetadata: msg.mediaMetadata,
      timestamp: msg.timestamp || Date.now(),
      isFromMe: true,
      status: msg.status || "sent",
      replyTo: msg.replyTo ?? null,
    });
    upsertChat({
      id: chatId,
      lastMessageText: msg.text ? `[${msg.messageType === "image" ? "Foto" : msg.messageType}] ${msg.text}` : `[${msg.messageType === "image" ? "Foto" : msg.messageType}]`,
      lastMessageTs: msg.timestamp || Date.now(),
    });
    broadcast(EVENTS.MESSAGE_SENT, msg);
    log.info("WA", `Media ${media.type} terkirim ke ${chatId} (${media.buffer.length} bytes)`);
    res.status(201).json({ message: msg });
  } catch (e) {
    log.error("WA", `sendMedia gagal: ${e.message}`);
    res.status(502).json({ error: `Gagal mengirim media: ${e.message}` });
  }
});

// GET /api/chats/:chatId/messages?limit=&before=&after= (pagination)
// Setiap kali chat dibuka / di-scroll ke atas, minta history-sync ke server WA
// (cooldown 2 menit per chat di adapter) supaya chat lama terus terisi dan
// tersimpan permanen di DB gateway.
router.get("/chats/:chatId/messages", authRequired, (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  const limit = Math.min(parseInt(req.query.limit || "30", 10) || 30, 100);
  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  const after = req.query.after ? parseInt(req.query.after, 10) : null;
  if (before !== null && Number.isNaN(before)) return res.status(400).json({ error: "before tidak valid" });
  if (after !== null && Number.isNaN(after)) return res.status(400).json({ error: "after tidak valid" });
  const messages = listMessages(chatId, { limit, before, after });
  // Fire-and-forget: jangan blokir respons, hasil sync datang via WS event
  try {
    adapter.requestHistory?.(chatId).catch(() => { });
  } catch { }
  res.json({ messages, hasMore: messages.length === limit });
});

// POST /api/chats/:chatId/sync { count? } — paksa tarik history chat dari
// server WA (HISTORY_SYNC_ON_DEMAND). Pesan yang masuk tersimpan permanen
// di DB gateway. Fire-and-forget: hasilnya mengalir via WebSocket.
router.post("/chats/:chatId/sync", authRequired, ipRateLimit({ max: 10, windowMs: 60 * 1000, name: "sync" }), async (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  const count = Math.min(Math.max(parseInt(req.body?.count || "50", 10) || 50, 1), 100);
  try {
    if (typeof adapter.requestHistory !== "function") {
      return res.status(501).json({ error: "Sync history tidak didukung adapter ini" });
    }
    const r = await adapter.requestHistory(chatId, count);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal meminta sync" });
    res.json({ ok: true, queued: !!r.queued, chatId, count });
  } catch (e) {
    log.error("API", `POST sync: ${e.message}`);
    res.status(500).json({ error: "Gagal meminta sync history" });
  }
});

// POST /api/chats/:chatId/messages { text, replyTo? }
router.post(
  "/chats/:chatId/messages",
  authRequired,
  ipRateLimit({ max: 30, windowMs: 60 * 1000, name: "sendmsg" }),
  async (req, res) => {
    const chatId = req.params.chatId;
    if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
    const { text, replyTo } = req.body || {};
    if (typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "text wajib diisi" });
    }
    if (text.length > MAX_MESSAGE_LEN) {
      return res.status(413).json({ error: `Pesan terlalu besar (max ${MAX_MESSAGE_LEN} karakter)` });
    }
    if (replyTo !== undefined && !isValidMessageId(replyTo)) {
      return res.status(400).json({ error: "replyTo (messageId) tidak valid" });
    }
    try {
      const msg = await adapter.sendMessage(chatId, text, { replyTo });
      // Persist + idempotency via UNIQUE(chat_id, message_id)
      insertMessage({
        chatId,
        messageId: msg.messageId,
        senderId: msg.senderId ?? "bot",
        senderName: msg.senderName ?? "bot",
        messageType: msg.messageType || "text",
        text: msg.text ?? text,
        mediaMetadata: msg.mediaMetadata,
        timestamp: msg.timestamp || Date.now(),
        isFromMe: true,
        status: msg.status || "sent",
        replyTo: msg.replyTo ?? replyTo ?? null,
      });
      broadcast(EVENTS.MESSAGE_SENT, msg);
      log.info("WA", `Message sent ke ${chatId}`);
      res.status(201).json({ message: msg });
    } catch (e) {
      log.error("WA", `sendMessage gagal: ${e.message}`);
      res.status(502).json({ error: "Gagal mengirim pesan via adapter" });
    }
  },
);

// GET /api/chats/:chatId/messages/:messageId/text — ambil isi text satu pesan
// (fitur "salin text" di APK; message_id yang tersimpan di gateway DB dipakai).
router.get("/chats/:chatId/messages/:messageId/text", authRequired, async (req, res) => {
  const chatId = req.params.chatId;
  const messageId = req.params.messageId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  if (!isValidMessageId(messageId)) return res.status(400).json({ error: "messageId tidak valid" });
  try {
    let text = null;
    try {
      text = await adapter.getMessageText?.(chatId, messageId);
    } catch { }
    if (text == null) {
      // Fallback: DB gateway (pesan lama yang sudah ter-persist)
      const stored = getStoredMessage(chatId, messageId);
      text = stored?.text ?? null;
    }
    if (text == null) return res.status(404).json({ error: "Pesan tidak ditemukan / bukan pesan teks" });
    res.json({ chatId, messageId, text });
  } catch (e) {
    log.error("API", `GET message text: ${e.message}`);
    res.status(500).json({ error: "Gagal mengambil isi pesan" });
  }
});

// ===== Blokir / unblokir nomor (chat pribadi) =====

// GET /api/blocked — daftar nomor yang diblokir
router.get("/blocked", authRequired, async (req, res) => {
  try {
    const r = await adapter.getBlocked();
    res.json({ blocked: r?.blocked || [] });
  } catch (e) {
    log.error("API", `GET /blocked: ${e.message}`);
    res.status(500).json({ error: "Gagal memuat daftar blokir" });
  }
});

// POST /api/blocked { jid | number } — blokir nomor (WA server + DB bot)
router.post("/blocked", authRequired, ipRateLimit({ max: 20, windowMs: 60 * 1000, name: "block" }), async (req, res) => {
  const { jid, number } = req.body || {};
  const target = jid || number;
  if (!target || typeof target !== "string") return res.status(400).json({ error: "jid atau number wajib diisi" });
  try {
    const r = await adapter.blockContact(String(target).trim());
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal memblokir nomor" });
    log.info("WA", `Blokir nomor: ${target}`);
    res.json({ ok: true, jid: r.jid || target });
  } catch (e) {
    log.error("WA", `Blokir gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal memblokir nomor via adapter" });
  }
});

// DELETE /api/blocked/:jid — buka blokir
router.delete("/blocked/:jid", authRequired, async (req, res) => {
  const jid = req.params.jid;
  if (!jid || typeof jid !== "string") return res.status(400).json({ error: "jid tidak valid" });
  try {
    const r = await adapter.unblockContact(jid);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal membuka blokir" });
    log.info("WA", `Buka blokir: ${jid}`);
    res.json({ ok: true });
  } catch (e) {
    log.error("WA", `Unblock gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal membuka blokir via adapter" });
  }
});

// ===== Profil bot (nomor, nama, bio/status) =====

// GET /api/bot/profile — nomor + nama + bio bot
router.get("/bot/profile", authRequired, async (req, res) => {
  try {
    const r = await adapter.getBotProfile();
    if (!r?.profile) return res.status(502).json({ error: r?.error || "Profil tidak tersedia" });
    res.json({ profile: r.profile });
  } catch (e) {
    log.error("API", `GET /bot/profile: ${e.message}`);
    res.status(500).json({ error: "Gagal memuat profil bot" });
  }
});

// PATCH /api/bot/profile { name?, bio? } — ubah nama &/atau bio bot di WhatsApp
router.patch("/bot/profile", authRequired, async (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body).filter((k) => k === "name" || k === "bio");
  if (keys.length === 0) return res.status(400).json({ error: "Body harus berisi name dan/atau bio" });
  const applied = [];
  const errors = {};
  for (const key of keys) {
    const r = await adapter.updateBotProfile(key, body[key]);
    if (r?.ok) applied.push(key);
    else errors[key] = r?.error || "Gagal diterapkan";
  }
  if (applied.length === 0) return res.status(400).json({ error: "Tidak ada yang diterapkan", errors });
  broadcast(EVENTS.BOT_SETTINGS_UPDATED, { profile: keys });
  res.json({ ok: true, applied, errors: Object.keys(errors).length ? errors : undefined });
});

// ===== Mulai chat pribadi baru dari kontak =====

// POST /api/chats { number } — validasi nomor Indonesia, seed chat pribadi baru.
// Jika nomor diblokir, tolak dengan pesan yang jelas.
router.post("/chats", authRequired, async (req, res) => {
  const { number } = req.body || {};
  if (!number || typeof number !== "string") return res.status(400).json({ error: "number wajib diisi (contoh: 6281234567890 atau 081234567890)" });
  try {
    const r = await adapter.startPrivateChat(number.trim());
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal memulai chat" });
    // Cek blokir: jangan biarkan chat dibuat untuk nomor yang diblokir
    try {
      const blocked = (await adapter.getBlocked())?.blocked || [];
      const target = r.chat?.id;
      if (target && blocked.some((b) => String(b).split("@")[0] === String(target).split("@")[0])) {
        return res.status(400).json({ error: "Nomor ini diblokir. Buka blokir dulu di pengaturan blokir." });
      }
    } catch { }
    if (r.chat) {
      upsertChat({
        id: r.chat.id,
        name: r.chat.name ?? null,
        lastMessageText: r.chat.lastMessageText ?? null,
        lastMessageTs: r.chat.lastMessageTs ?? null,
        unread: 0,
        pinned: null,
        muted: null,
        isGroup: false,
      });
      broadcast(EVENTS.CHAT_UPDATED, { chatId: r.chat.id, name: r.chat.name });
    }
    res.status(201).json({ ok: true, chat: r.chat });
  } catch (e) {
    log.error("API", `POST /chats: ${e.message}`);
    res.status(500).json({ error: "Gagal memulai chat" });
  }
});

// PATCH /api/chats/:chatId/read { unread: 0 }
router.patch("/chats/:chatId/read", authRequired, (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  const unread = req.body?.unread;
  if (unread !== 0) return res.status(400).json({ error: "Hanya mendukung unread=0 (tandai dibaca)" });
  setChatUnread(chatId, 0);
  broadcast(EVENTS.CHAT_READ, { chatId, unread: 0 });
  res.json({ ok: true });
});

// ===== Manajemen chat: keluar grup / hapus pesan / hapus chat =====

// POST /api/chats/:chatId/leave — bot keluar dari grup ini
router.post("/chats/:chatId/leave", authRequired, ipRateLimit({ max: 10, windowMs: 60 * 1000, name: "leavegc" }), async (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  if (!chatId.endsWith("@g.us")) return res.status(400).json({ error: "Hanya grup yang bisa ditinggalkan" });
  try {
    const r = await adapter.leaveGroup(chatId);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal keluar grup" });
    // Hilangkan juga dari DB gateway supaya hilang dari daftar chat APK
    deleteChatData(chatId);
    broadcast(EVENTS.CHAT_UPDATED, { chatId, deleted: true });
    log.info("WA", `Bot keluar grup: ${chatId}`);
    res.json({ ok: true });
  } catch (e) {
    log.error("WA", `leaveGroup gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal keluar grup via adapter" });
  }
});

// POST /api/chats/:chatId/messages/:messageId/delete { scope: "me"|"everyone" }
// scope "me"       = hapus di sisi bot/APK saja
// scope "everyone" = unsend utk semua orang (private: hanya pesan bot;
//                    grup: siapa pun asal bot admin)
router.post("/chats/:chatId/messages/:messageId/delete", authRequired, ipRateLimit({ max: 30, windowMs: 60 * 1000, name: "delmsg" }), async (req, res) => {
  const chatId = req.params.chatId;
  const messageId = req.params.messageId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  if (!isValidMessageId(messageId)) return res.status(400).json({ error: "messageId tidak valid" });
  const scope = req.body?.scope === "everyone" ? "everyone" : "me";
  try {
    const r = await adapter.deleteMessage(chatId, messageId, scope);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal menghapus pesan" });
    broadcast(EVENTS.MESSAGE_DELETED, { chatId, messageId, scope });
    log.info("WA", `Pesan ${messageId} dihapus (scope=${scope}, chat=${chatId})`);
    res.json({ ok: true, scope });
  } catch (e) {
    log.error("WA", `deleteMessage gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal menghapus pesan via adapter" });
  }
});

// DELETE /api/chats/:chatId — hapus chat (nomor/grup) dari bot:
// pesan & data chat hilang dari gateway/APK (tidak menyentuh WA server).
router.delete("/chats/:chatId", authRequired, ipRateLimit({ max: 10, windowMs: 60 * 1000, name: "delchat" }), async (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  try {
    const r = await adapter.deleteChat(chatId);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal menghapus chat" });
    deleteChatData(chatId);
    broadcast(EVENTS.CHAT_UPDATED, { chatId, deleted: true });
    log.info("WA", `Chat dihapus: ${chatId}`);
    res.json({ ok: true });
  } catch (e) {
    log.error("WA", `deleteChat gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal menghapus chat via adapter" });
  }
});

// ===== Kelola member grup (lihat / tambah / kick) =====

// GET /api/chats/:chatId/members — daftar member + status admin
router.get("/chats/:chatId/members", authRequired, ipRateLimit({ max: 30, windowMs: 60 * 1000, name: "members" }), async (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  if (!chatId.endsWith("@g.us")) return res.status(400).json({ error: "Hanya untuk grup" });
  try {
    const r = await adapter.getGroupMembers(chatId);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal memuat member" });
    res.json({ members: r.members, subject: r.subject ?? null });
  } catch (e) {
    log.error("WA", `getGroupMembers gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal memuat member via adapter" });
  }
});

// POST /api/chats/:chatId/members/add { jids: ["62xxx", ...] } — tambah member
router.post("/chats/:chatId/members/add", authRequired, ipRateLimit({ max: 10, windowMs: 60 * 1000, name: "addmember" }), async (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  if (!chatId.endsWith("@g.us")) return res.status(400).json({ error: "Hanya untuk grup" });
  const jids = req.body?.jids;
  if (!Array.isArray(jids) || jids.length === 0) {
    return res.status(400).json({ error: "jids wajib array nomor (62xxx atau 08xxx)" });
  }
  try {
    const r = await adapter.addParticipants(chatId, jids);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal menambah member" });
    log.info("WA", `Member ditambah ke ${chatId}: sukses ${r.added?.length || 0}, gagal ${r.failed?.length || 0}`);
    res.json({ ok: true, added: r.added || [], failed: r.failed || [] });
  } catch (e) {
    log.error("WA", `addParticipants gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal menambah member via adapter" });
  }
});

// POST /api/chats/:chatId/members/remove { jids: [...] } — kick member
// Bot HARUS admin grup; WA menolak dengan error bila bukan.
router.post("/chats/:chatId/members/remove", authRequired, ipRateLimit({ max: 10, windowMs: 60 * 1000, name: "kickmember" }), async (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  if (!chatId.endsWith("@g.us")) return res.status(400).json({ error: "Hanya untuk grup" });
  const jids = req.body?.jids;
  if (!Array.isArray(jids) || jids.length === 0) {
    return res.status(400).json({ error: "jids wajib array nomor (62xxx atau 08xxx)" });
  }
  try {
    const r = await adapter.removeParticipants(chatId, jids);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal kick member" });
    log.info("WA", `Member dikick dari ${chatId}: sukses ${r.removed?.length || 0}, gagal ${r.failed?.length || 0}`);
    res.json({ ok: true, removed: r.removed || [], failed: r.failed || [] });
  } catch (e) {
    log.error("WA", `removeParticipants gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal kick member via adapter" });
  }
});

// POST /api/chats/:chatId/members/admin { jids: [...], action: "promote"|"demote" }
// Jadikan/copot admin grup. Bot HARUS admin grup; WA menolak bila bukan.
// Target superadmin/pembuat grup tidak bisa didemote (WA yang enforce).
router.post("/chats/:chatId/members/admin", authRequired, ipRateLimit({ max: 10, windowMs: 60 * 1000, name: "adminmember" }), async (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  if (!chatId.endsWith("@g.us")) return res.status(400).json({ error: "Hanya untuk grup" });
  const jids = req.body?.jids;
  const action = req.body?.action;
  if (!Array.isArray(jids) || jids.length === 0) {
    return res.status(400).json({ error: "jids wajib array nomor (62xxx atau 08xxx)" });
  }
  if (action !== "promote" && action !== "demote") {
    return res.status(400).json({ error: 'action wajib "promote" atau "demote"' });
  }
  try {
    const r = await adapter.setGroupAdmins(chatId, jids, action);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal mengubah admin" });
    log.info("WA", `${action} admin di ${chatId}: sukses ${r.changed?.length || 0}, gagal ${r.failed?.length || 0}`);
    res.json({ ok: true, changed: r.changed || [], failed: r.failed || [] });
  } catch (e) {
    log.error("WA", `setGroupAdmins gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal mengubah admin via adapter" });
  }
});

// POST /api/chats/:chatId/members/invite { number, message? } — kirim link
// undangan grup ke nomor via chat pribadi. Untuk nomor yang gagal ditambah
// langsung (kode 403: menolak lewat setting privasi — perlu undangan manual).
router.post("/chats/:chatId/members/invite", authRequired, ipRateLimit({ max: 10, windowMs: 60 * 1000, name: "invite" }), async (req, res) => {
  const chatId = req.params.chatId;
  if (!isValidJid(chatId)) return res.status(400).json({ error: "chatId tidak valid" });
  if (!chatId.endsWith("@g.us")) return res.status(400).json({ error: "Hanya untuk grup" });
  const { number, message } = req.body || {};
  if (!number || typeof number !== "string") {
    return res.status(400).json({ error: "number wajib diisi (format: 62xxx / 08xxx)" });
  }
  try {
    const r = await adapter.sendGroupInvite(chatId, number.trim(), message || null);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal mengirim undangan" });
    log.info("WA", `Undangan ${chatId} dikirim ke ${number}`);
    res.json({ ok: true, url: r.url, target: r.target });
  } catch (e) {
    log.error("WA", `sendGroupInvite gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal mengirim undangan via adapter" });
  }
});

// ===== YouTube Music (STREAMING — bukan download) =====

// GET /api/media/youtube/search?q=... — cari video/lagu
router.get("/media/youtube/search", authRequired, ipRateLimit({ max: 30, windowMs: 60 * 1000, name: "ytsearch" }), async (req, res) => {
  const q = String(req.query.q || "").slice(0, 120);
  if (!q.trim()) return res.status(400).json({ error: "q (query) wajib diisi" });
  try {
    const r = await adapter.ytSearch(q);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Pencarian gagal" });
    res.json({ videos: r.videos });
  } catch (e) {
    log.error("API", `ytSearch gagal: ${e.message}`);
    res.status(500).json({ error: "Pencarian gagal" });
  }
});

// GET /api/media/youtube/stream?videoId=...&format=mp3|mp4 — URL stream.
// APK memutar langsung via player (streaming); server TIDAK mengunduh file.
router.get("/media/youtube/stream", authRequired, ipRateLimit({ max: 20, windowMs: 60 * 1000, name: "ytstream" }), async (req, res) => {
  const videoId = String(req.query.videoId || "").slice(0, 200);
  const format = String(req.query.format || "mp3") === "mp4" ? "mp4" : "mp3";
  if (!videoId.trim()) return res.status(400).json({ error: "videoId wajib diisi" });
  try {
    const r = await adapter.getYtStream(videoId, format);
    if (!r?.ok) return res.status(400).json({ error: r?.error || "Gagal mendapatkan stream" });
    log.info("API", `YT stream ${format}: ${videoId}`);
    res.json({ streamUrl: r.streamUrl, title: r.title, format: r.format });
  } catch (e) {
    log.error("API", `getYtStream gagal: ${e.message}`);
    res.status(500).json({ error: "Gagal mendapatkan stream" });
  }
});

// GET /api/avatars/:jid — foto profil (null bila tidak ada / disembunyikan user)
// Cache DB TTL 6 jam (termasuk hasil negatif) supaya tidak spam request ke WA.
// ?fresh=1 = bypass cache (dipakai halaman Settings biar PP bot cepat update).
router.get("/avatars/:jid", authRequired, async (req, res) => {
  const jid = req.params.jid;
  if (!isValidJid(jid)) return res.status(400).json({ error: "jid tidak valid" });
  const fresh = req.query.fresh === "1";
  try {
    if (!fresh) {
      const cached = getAvatar(jid);
      if (cached && Date.now() - cached.updated_at < 6 * 60 * 60 * 1000) {
        return res.json({ jid, url: cached.url });
      }
    }
    let url = null;
    try {
      url = await adapter.getAvatar(jid);
    } catch { }
    upsertAvatar(jid, url);
    res.json({ jid, url });
  } catch (e) {
    log.error("API", `GET /avatars: ${e.message}`);
    res.status(500).json({ error: "Gagal memuat avatar" });
  }
});

// GET /api/bot/avatar — foto profil bot sendiri (untuk Settings/profile)
router.get("/bot/avatar", authRequired, async (req, res) => {
  try {
    let url = null;
    try {
      url = await adapter.getBotAvatar?.() ?? null;
    } catch { }
    res.json({ url });
  } catch (e) {
    log.error("API", `GET /bot/avatar: ${e.message}`);
    res.status(500).json({ error: "Gagal memuat avatar bot" });
  }
});

// GET /api/contacts?search=
router.get("/contacts", authRequired, async (req, res) => {
  try {
    const search = String(req.query.search || "").slice(0, 64);
    const contacts = await adapter.getContacts();
    res.json({ contacts });
  } catch (e) {
    log.error("API", `GET /contacts: ${e.message}`);
    res.status(500).json({ error: "Gagal memuat contacts" });
  }
});

// GET /api/groups
router.get("/groups", authRequired, async (req, res) => {
  try {
    const groups = await adapter.getGroups();
    res.json({ groups });
  } catch (e) {
    log.error("API", `GET /groups: ${e.message}`);
    res.status(500).json({ error: "Gagal memuat groups" });
  }
});

export default router;
