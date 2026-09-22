import { DatabaseSync } from "node:sqlite";
import path from "path";
import { config } from "./config.js";
import { log } from "./utils/logger.js";

const db = new DatabaseSync(path.join(config.dataDir, "gateway.db"));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  name TEXT,
  last_message_text TEXT,
  last_message_ts INTEGER,
  unread INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  is_group INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  media_metadata TEXT,
  timestamp INTEGER NOT NULL,
  is_from_me INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  reply_to TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, timestamp);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT,
  notify TEXT,
  status TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_settings (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS avatars (
  jid TEXT PRIMARY KEY,
  url TEXT,
  updated_at INTEGER NOT NULL
);
`);

// Kolom 'hidden' ditambah belakangan (fix riwayat chat LID) — ALTER TABLE untuk
// database lama yang belum punya kolom ini (database baru sudah punya lewat
// CREATE TABLE di atas).
try { db.exec(`ALTER TABLE chats ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`); } catch { }

export function upsertUser(username, passwordHash, role = "admin") {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role`,
  ).run(username, passwordHash, role, now);
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
}

export function getUserByUsername(username) {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
}

export function createDevice(id, userId, name, refreshTokenHash) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO devices (id, user_id, name, refresh_token_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET refresh_token_hash = excluded.refresh_token_hash, revoked = 0`,
  ).run(id, userId, name, refreshTokenHash, now, now);
}

export function getDevice(id) {
  return db.prepare(`SELECT * FROM devices WHERE id = ?`).get(id);
}

export function listDevices(userId) {
  return db
    .prepare(
      `SELECT id, name, created_at, last_seen_at, revoked FROM devices WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId);
}

export function revokeDevice(id, userId) {
  const r = db
    .prepare(`UPDATE devices SET revoked = 1 WHERE id = ? AND user_id = ?`)
    .run(id, userId);
  return r.changes > 0;
}

export function touchDevice(id) {
  db.prepare(`UPDATE devices SET last_seen_at = ? WHERE id = ?`).run(Date.now(), id);
}

// ===== Chats =====
export function upsertChat(chat) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO chats (id, name, last_message_text, last_message_ts, unread, pinned, muted, is_group, updated_at)
     VALUES (@id, @name, @lastText, @lastTs, COALESCE(@unread, 0), COALESCE(@pinned, 0), COALESCE(@muted, 0), COALESCE(@isGroup, 0), @now)
     ON CONFLICT(id) DO UPDATE SET
       name = COALESCE(@name, chats.name),
       last_message_text = COALESCE(@lastText, chats.last_message_text),
       last_message_ts = COALESCE(@lastTs, chats.last_message_ts),
       unread = COALESCE(@unread, chats.unread),
       pinned = COALESCE(@pinned, chats.pinned),
       muted = COALESCE(@muted, chats.muted),
       is_group = COALESCE(@isGroup, chats.is_group),
       updated_at = @now`,
  ).run({
    id: chat.id,
    name: chat.name ?? null,
    lastText: chat.lastMessageText ?? null,
    lastTs: chat.lastMessageTs ?? null,
    unread: chat.unread == null ? null : Number(chat.unread),
    pinned: chat.pinned == null ? null : (chat.pinned ? 1 : 0),
    muted: chat.muted == null ? null : (chat.muted ? 1 : 0),
    isGroup: chat.isGroup == null ? null : (chat.isGroup ? 1 : 0),
    now,
  });
}

export function listChats({ limit = 50, offset = 0, search = "" } = {}) {
  let sql = `SELECT * FROM chats WHERE hidden = 0`;
  const params = [];
  if (search) {
    sql += ` AND (name LIKE ? OR id LIKE ? OR last_message_text LIKE ?)`;
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  // Chat dgn pesan: urut ts terbaru di atas. Chat tanpa pesan: paling bawah.
  sql += ` ORDER BY COALESCE(last_message_ts, 0) DESC, updated_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export function getChat(id) {
  return db.prepare(`SELECT * FROM chats WHERE id = ?`).get(id);
}

export function setChatUnread(chatId, unread) {
  db.prepare(`UPDATE chats SET unread = ?, updated_at = ? WHERE id = ?`).run(
    unread,
    Date.now(),
    chatId,
  );
}

export function countChats() {
  return db.prepare(`SELECT COUNT(*) as c FROM chats`).get().c;
}

// ===== Messages =====
// Upsert idempotent: saat duplicate (replay/backfill), perbaiki field lama yang
// masih NULL/unknown (teks & nama pengirim baru ter-resolve belakangan).
export function insertMessage(m) {
  db.prepare(
    `INSERT INTO messages (chat_id, message_id, sender_id, sender_name, message_type, text, media_metadata, timestamp, is_from_me, status, reply_to, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id, message_id) DO UPDATE SET
       sender_id = COALESCE(excluded.sender_id, sender_id),
       sender_name = COALESCE(excluded.sender_name, sender_name),
       message_type = CASE WHEN excluded.message_type IS NULL OR excluded.message_type = 'unknown' THEN message_type ELSE excluded.message_type END,
       text = COALESCE(excluded.text, text),
       media_metadata = COALESCE(excluded.media_metadata, media_metadata),
       status = COALESCE(excluded.status, status),
       reply_to = COALESCE(excluded.reply_to, reply_to)`,
  ).run(
    m.chatId,
    m.messageId,
    m.senderId ?? null,
    m.senderName ?? null,
    m.messageType ?? "text",
    m.text ?? null,
    m.mediaMetadata ? JSON.stringify(m.mediaMetadata) : null,
    m.timestamp,
    m.isFromMe ? 1 : 0,
    m.status ?? null,
    m.replyTo ?? null,
    Date.now(),
  );
  return true;
}

export function listMessages(chatId, { limit = 30, before = null, after = null } = {}) {
  let sql = `SELECT * FROM messages WHERE chat_id = ?`;
  const params = [chatId];
  if (before) {
    sql += ` AND timestamp < ?`;
    params.push(before);
  }
  if (after) {
    sql += ` AND timestamp > ?`;
    params.push(after);
  }
  sql += ` ORDER BY timestamp DESC, id DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.reverse(); // oldest first
}

export function countMessages(chatId) {
  return db.prepare(`SELECT COUNT(*) as c FROM messages WHERE chat_id = ?`).get(chatId).c;
}

export function updateMessageStatus(chatId, messageId, status) {
  const r = db
    .prepare(`UPDATE messages SET status = ? WHERE chat_id = ? AND message_id = ?`)
    .run(status, chatId, messageId);
  return r.changes > 0;
}

export function deleteMessage(chatId, messageId) {
  const r = db
    .prepare(`DELETE FROM messages WHERE chat_id = ? AND message_id = ?`)
    .run(chatId, messageId);
  return r.changes > 0;
}

// Ambil satu pesan (untuk fitur salin text / detail pesan).
export function getMessage(chatId, messageId) {
  return db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND message_id = ?`).get(chatId, messageId);
}

// Anti-delete: pesan yang dihapus pengirim TIDAK dihapus dari DB gateway
// (history tetap utuh untuk dipantau), cuma ditandai. APK bisa menampilkan
// "pesan ini dihapus" sambil tetap bisa membaca isinya.
export function markMessageDeleted(chatId, messageId) {
  const r = db
    .prepare(`UPDATE messages SET status = 'deleted' WHERE chat_id = ? AND message_id = ? AND status IS NOT 'deleted'`)
    .run(chatId, messageId);
  return r.changes > 0;
}

// Statistik penyimpanan (monitoring kapasitas history).
export function countAllMessages() {
  return db.prepare(`SELECT COUNT(*) as c FROM messages`).get().c;
}

// ===== Hapus chat (fitur APK: hapus nomor/chat dari bot) =====
// Menghapus chat + seluruh pesannya + avatar dari DB gateway. Dipanggil
// adapter saat user APK minta "hapus chat". TIDAK menyentuh WA server —
// hanya membersihkan data tampilan bot/gateway.
export function deleteChatData(chatId) {
  db.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(chatId);
  db.prepare(`DELETE FROM chats WHERE id = ?`).run(chatId);
  db.prepare(`DELETE FROM avatars WHERE jid = ?`).run(chatId);
}

export function countChatsWithMessages() {
  return db.prepare(`SELECT COUNT(DISTINCT chat_id) as c FROM messages`).get().c;
}

// ===== Avatars (foto profil, cache 6 jam) =====
export function getAvatar(jid) {
  return db.prepare(`SELECT url, updated_at FROM avatars WHERE jid = ?`).get(jid);
}

export function upsertAvatar(jid, url) {
  db.prepare(
    `INSERT INTO avatars (jid, url, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at`,
  ).run(jid, url ?? null, Date.now());
}

// ===== Contacts =====
export function upsertContact(c) {
  db.prepare(
    `INSERT INTO contacts (id, name, notify, status, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = COALESCE(@name, contacts.name),
       notify = COALESCE(@notify, contacts.notify),
       status = COALESCE(@status, contacts.status),
       updated_at = excluded.updated_at`,
  ).run({
    id: c.id,
    name: c.name ?? null,
    notify: c.notify ?? null,
    status: c.status ?? null,
    updatedAt: Date.now(),
  });
}

export function listContacts({ limit = 100, offset = 0, search = "" } = {}) {
  let sql = `SELECT * FROM contacts`;
  const params = [];
  if (search) {
    sql += ` WHERE (name LIKE ? OR notify LIKE ? OR id LIKE ?)`;
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  sql += ` ORDER BY COALESCE(name, notify, id) LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

// ===== Bot settings =====
export function getSetting(key) {
  const row = db.prepare(`SELECT value FROM bot_settings WHERE key = ?`).get(key);
  return row ? JSON.parse(row.value) : undefined;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), Date.now());
}

export function getAllSettings() {
  const rows = db.prepare(`SELECT key, value FROM bot_settings`).all();
  const out = {};
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

// ===== Plugin settings =====
export function listPluginSettings() {
  return db.prepare(`SELECT name, enabled FROM plugin_settings ORDER BY name`).all();
}

export function setPluginEnabled(name, enabled) {
  db.prepare(
    `INSERT INTO plugin_settings (name, enabled, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
  ).run(name, enabled ? 1 : 0, Date.now());
}

export const logDb = (msg) => log.info("DB", msg);

// ===== Migrasi riwayat LID -> nomor asli (fix "riwayat chat sebagian nomor hilang") =====
// WhatsApp kini mengirim banyak chat memakai LID (xxx@lid) alih-alih nomor asli.
// Riwayat lama tersimpan under chatId @lid sementara chat baru under
// @s.whatsapp.net — hasilnya daftar chat & riwayat tidak nyambung.
// Fungsi ini memindahkan seluruh pesan ke chatId nomor asli (idempotent,
// UNIQUE(chat_id, message_id) mencegah duplikat).
const MIGRATION_KEY = "lid_migration_done_v1";

export function migrateLidHistory(resolver) {
  if (typeof resolver !== "function") return { ok: false, error: "resolver tidak valid" };
  if (getSetting(MIGRATION_KEY)) return { ok: true, skipped: true };

  const moveMsg = db.prepare(
    `INSERT INTO messages (chat_id, message_id, sender_id, sender_name, message_type, text, media_metadata, timestamp, is_from_me, status, reply_to, created_at)
     SELECT ?, message_id, sender_id, sender_name, message_type, text, media_metadata, timestamp, is_from_me, status, reply_to, created_at
     FROM messages WHERE chat_id = ?
     ON CONFLICT(chat_id, message_id) DO UPDATE SET
       text = COALESCE(excluded.text, messages.text),
       sender_name = COALESCE(excluded.sender_name, messages.sender_name),
       status = COALESCE(excluded.status, messages.status)`,
  );
  const markMigrated = db.prepare(`UPDATE chats SET hidden = 1 WHERE id = ?`);

  let chatsFixed = 0;
  let msgsMoved = 0;
  try {
    const lidChats = db
      .prepare(`SELECT * FROM chats WHERE id LIKE '%@lid' AND hidden = 0`)
      .all();
    db.exec("BEGIN");
    try {
      for (const c of lidChats) {
        const pn = resolver(c.id);
        if (!pn || pn === c.id || String(pn).endsWith("@lid")) continue;
        // Buat/merge chat nomor asli (upsertChat sudah benar menggabungkan
        // metadata tanpa menimpa yang sudah ada)
        upsertChat({
          id: pn,
          name: c.name || String(pn).split("@")[0],
          lastMessageText: c.last_message_text,
          lastMessageTs: c.last_message_ts,
          unread: c.unread,
          pinned: !!c.pinned,
          muted: !!c.muted,
          isGroup: !!c.is_group,
        });
        const r = moveMsg.run(pn, c.id);
        msgsMoved += r.changes;
        markMigrated.run(c.id);
        chatsFixed++;
      }
      db.exec("COMMIT");
    } catch (txErr) {
      db.exec("ROLLBACK");
      throw txErr;
    }
  } catch (e) {
    log.warn("DB", `migrateLidHistory gagal: ${e.message}`);
    return { ok: false, error: e.message, chatsFixed, msgsMoved };
  }
  if (chatsFixed > 0) {
    log.info("DB", `Migrasi riwayat LID: ${chatsFixed} chat, ${msgsMoved} pesan dipindah ke nomor asli`);
  }
  setSetting(MIGRATION_KEY, { chatsFixed, msgsMoved, at: Date.now() });
  return { ok: true, chatsFixed, msgsMoved };
}
