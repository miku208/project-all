// src/jadibot/engine.js — Jadibot Core (§42-§48, §67-§69)
// Satu instance bot per user, mikuhostt-baileys, sesi TERISOLASI per bot:
//   <dataPath>/<usr_id>/<bot_id>/auth/
// Ownership WAJIB: bot.owner_id == user.id (§43). Auth tidak pernah expose (§67).

import fs from "fs";
import path from "path";
import config from "../../config.js";
import store, { genId, now, systemLog } from "./store.js";
import { getSetting } from "./settings.js";
import { startTrial, validateBotAccess } from "./trial.js";
import { classifyCommand } from "./security.js";
import { rupiah } from "./store.js";

const TEST_MODE = process.env.JADIBOT_TEST === "1";

const DATA_ROOT = path.resolve(
  process.env.JADIBOT_BOTS_DIR || config.jadibot?.dataPath || "./data/jadibot",
);

/** Map botId → { sock, saveCreds, retries, pairingCode } */
const active = new Map();
/** Map botId → ring buffer log terakhir (in-memory) */
const botLogs = new Map();

const STATUSES = [
  "creating", "pairing", "connecting", "online",
  "offline", "stopped", "expired", "error",
];

/** Kode pairing WhatsApp berlaku ±1 menit */
const PAIRING_CODE_TTL_MS = 60_000;

/* ==================== HELPERS ==================== */

function authDir(bot) {
  // §44 — path terisolasi per user & per bot; tanpa input user
  return path.join(DATA_ROOT, bot.owner_id, bot.id, "auth");
}

function logBot(botId, msg) {
  const arr = botLogs.get(botId) || [];
  arr.push({ ts: now(), msg });
  if (arr.length > 200) arr.splice(0, arr.length - 200);
  botLogs.set(botId, arr);
}

function setBotStatus(bot, status) {
  bot.status = STATUSES.includes(status) ? status : "error";
  bot.updated_at = now();
  store.bots.save();
}

function getBotRecord(botId) {
  return store.bots.data[botId] || null;
}

function sanitizeBot(bot) {
  if (!bot) return null;
  const { auth_path, ...safe } = bot; // §67 — auth path tidak pernah expose
  return { ...safe, is_running: active.has(bot.id) };
}

/* ==================== LIFECYCLE ==================== */

/**
 * Buat bot baru (§46). Create bot pertama = mulai trial (§10, Skenario B).
 * @param {object} opts.notifyJid - WA JID pembuat (untuk reminder pairing)
 */
export function createBot(user, phoneNumber, opts = {}) {
  if (user.account_status !== "active") {
    return { error: "USER_SUSPENDED", message: "Akun di-suspend" };
  }

  const access = validateBotAccess(user, { forCreation: true });
  if (!access.allowed) {
    return { error: access.code, message: access.message };
  }

  const max = Number(getSetting("maxBotsPerUser"));
  const owned = Object.values(store.bots.data).filter(
    (b) => b.owner_id === user.id,
  );
  if (owned.length >= max) {
    return {
      error: "MAX_BOTS_REACHED",
      message: `Maksimal ${max} bot per user`,
    };
  }

  const phone = String(phoneNumber || "").replace(/[^0-9]/g, "");
  if (phone.length < 8) {
    return { error: "INVALID_PHONE", message: "Nomor WhatsApp tidak valid" };
  }

  // 🚫 BLOK: nomor bot utama tidak boleh jadi Jadibot — 2 instance baileys
  // dalam 1 akun WA menyebabkan konflik session ("Menunggu pesan ini")
  const mainNumbers = [
    config.session?.pairingNumber,
    config.bot?.number,
  ]
    .map((n) => String(n || "").replace(/[^0-9]/g, ""))
    .filter(Boolean);
  if (mainNumbers.includes(phone)) {
    return {
      error: "SAME_AS_MAIN_BOT",
      message:
        "Nomor bot utama tidak bisa dijadikan Jadibot! " +
        "Gunakan nomor WhatsApp LAIN (HP kedua/opsen) — 2 instance pada 1 akun " +
        "menyebabkan pesan gagal didekripsi.",
    };
  }

  // 🚫 BLOK: nomor sudah dipakai bot aktif lain (siapa pun ownernya)
  const activeStatuses = ["online", "connecting", "pairing", "creating"];
  const duplicate = Object.values(store.bots.data).find(
    (b) =>
      b.phone_number === phone &&
      activeStatuses.includes(b.status) &&
      b.id !== idPreview,
  );
  if (duplicate) {
    return {
      error: "PHONE_ALREADY_BOT",
      message: `Nomor +${phone} sudah dipakai bot aktif lain (${duplicate.id}). Hapus dulu bot lama jika ingin ulang.`,
    };
  }

  // Trial dimulai di sini (sekali seumur akun, waktu server)
  if (access.mode === "trial_start") {
    const r = startTrial(user.id);
    if (r.error) return r;
  }

  const id = genId("bot", 5);
  const idPreview = id;
  const dir = path.join(DATA_ROOT, user.id, id, "auth");
  fs.mkdirSync(dir, { recursive: true });

  const bot = {
    id,
    owner_id: user.id, // §43 — WAJIB
    phone_number: phone,
    status: "creating",
    auth_path: dir,
    notify_jid: opts.notifyJid || null, // WA JID untuk notifikasi pairing
    created_at: now(),
    updated_at: now(),
  };
  store.bots.data[id] = bot;
  store.bots.save();
  systemLog("bot_created", { bot_id: id, owner_id: user.id, phone });

  startBot(bot);
  return { bot: sanitizeBot(bot), trial: store.users.data[user.id].trial_expires_at };
}

/** Jalankan instance baileys untuk bot (dengan validasi akses) */
export function startBot(bot, { skipAccess = false } = {}) {
  if (active.has(bot.id)) return { ok: true, status: bot.status };

  const user = store.users.data[bot.owner_id];
  if (!user) return { error: "USER_NOT_FOUND", message: "Owner bot tidak ditemukan" };

  if (!skipAccess) {
    const access = validateBotAccess(user, { forControl: true });
    if (!access.allowed) {
      setBotStatus(bot, "expired");
      return { error: access.code, message: access.message };
    }
  }

  fs.mkdirSync(authDir(bot), { recursive: true });
  setBotStatus(bot, "connecting");
  logBot(bot.id, "starting instance (mikuhostt-baileys)");

  systemLog("bot_started", { bot_id: bot.id, owner_id: bot.owner_id });

  if (TEST_MODE) {
    // Mode test: sock tiruan — TANPA koneksi WhatsApp sungguhan
    const mock = {
      __mock: true,
      user: { id: `${bot.phone_number}@s.whatsapp.net` },
      sent: [],
      async sendMessage(jid, content) {
        this.sent.push({ jid, content, ts: now() });
        logBot(bot.id, `MOCK send → ${jid}`);
        return { key: { id: genId("msg") } };
      },
      ev: { on() {} },
      async end() { active.delete(bot.id); },
    };
    active.set(bot.id, { sock: mock, retries: 0 });
    setBotStatus(bot, "online"); // dipakai untuk test lifecycle tanpa WA
    logBot(bot.id, "MOCK online (JADIBOT_TEST=1)");
    return { ok: true, status: bot.status, mock: true };
  }

  // Instance asli — async, tidak memblokir API
  (async () => {
    try {
      const {
        makeWASocket,
        useMultiFileAuthState,
        makeCacheableSignalKeyStore,
        fetchLatestBaileysVersion,
        DisconnectReason,
      } = await import("mikuhostt-baileys");
      const { default: pino } = await import("pino");

      const logger = pino({ level: "silent" });
      const { state, saveCreds } = await useMultiFileAuthState(authDir(bot));
      let version;
      try {
        const v = await fetchLatestBaileysVersion();
        version = Array.isArray(v?.version) ? v.version : undefined;
      } catch {}

      const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        browser: ["Mac OS", "Chrome", "14.4.1"],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        shouldIgnoreJid: (jid) => (jid ? jid.includes("meta_ai") : false),
      });

      const entry = active.get(bot.id) || { retries: 0 };
      entry.sock = sock;
      entry.saveCreds = saveCreds;
      active.set(bot.id, entry);

      sock.ev.on("creds.update", saveCreds);

      let pairingRequested = false;

      sock.ev.on("connection.update", async (u) => {
        const { connection, lastDisconnect } = u;

        // §46 — pairing code dari nomor bot (user memasukkan nomornya sendiri)
        if (
          connection === "connecting" &&
          !pairingRequested &&
          !sock.authState?.creds?.registered
        ) {
          pairingRequested = true;
          setBotStatus(bot, "pairing");
          try {
            await new Promise((r) => setTimeout(r, 2000));
            const code = await sock.requestPairingCode(bot.phone_number);
            entry.pairingCode = code;
            entry.pairingCodeAt = now();
            entry.reminded = false; // flag reminder (sekali per kode)
            entry.expiredNotified = false;
            logBot(bot.id, `pairing code dibuat: ${code}`);
          } catch (e) {
            pairingRequested = false;
            logBot(bot.id, `gagal pairing: ${e.message}`);
          }
        }

        if (connection === "open") {
          entry.retries = 0;
          entry.pairingCode = null;
          entry.pairingCodeAt = null;
          setBotStatus(bot, "online");
          logBot(bot.id, `TERHUBUNG sebagai +${bot.phone_number}`);
          systemLog("bot_connected", { bot_id: bot.id, owner_id: bot.owner_id });
        }

        if (connection === "close") {
          const code = lastDisconnect?.error?.output?.statusCode;
          const reconnect = code !== DisconnectReason.loggedOut;
          const maxRetries = Number(config.jadibot?.maxReconnectAttempts || 3);

          if (reconnect && (entry.retries || 0) < maxRetries) {
            entry.retries = (entry.retries || 0) + 1;
            logBot(bot.id, `reconnect (${entry.retries}/${maxRetries})`);
            setTimeout(() => {
              if (active.has(bot.id) && bot.status !== "expired") {
                startBot(bot, { skipAccess: true });
              }
            }, 5000 * entry.retries);
          } else {
            active.delete(bot.id);
            setBotStatus(bot, code === DisconnectReason.loggedOut ? "offline" : "error");
            logBot(bot.id, `terputus (code=${code})`);
            systemLog("bot_disconnected", { bot_id: bot.id, code });
          }
        }
      });

      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
          try {
            if (msg.key?.fromMe) continue;
            await handleIncomingMessage(bot, sock, msg);
          } catch (e) {
            logBot(bot.id, `msg error: ${e.message}`);
          }
        }
      });
    } catch (e) {
      console.error(`[JadibotEngine] start ${bot.id} gagal:`, e.message);
      setBotStatus(bot, "error");
      logBot(bot.id, `start error: ${e.message}`);
      active.delete(bot.id);
    }
  })();

  return { ok: true, status: bot.status };
}

export function stopBot(botId, { status = "stopped", reason = "" } = {}) {
  const bot = getBotRecord(botId);
  if (!bot) return { error: "BOT_NOT_FOUND", message: "Bot tidak ditemukan" };

  const entry = active.get(botId);
  if (entry?.sock?.end) {
    try {
      entry.sock.end(); // graceful shutdown (§12)
    } catch {}
  }
  active.delete(botId);
  setBotStatus(bot, status);
  logBot(botId, `dihentikan ${reason ? `(${reason})` : ""}`);
  systemLog("bot_stopped", { bot_id: botId, owner_id: bot.owner_id, reason, status });
  return { bot: sanitizeBot(bot) };
}

export function restartBot(botId) {
  const bot = getBotRecord(botId);
  if (!bot) return { error: "BOT_NOT_FOUND", message: "Bot tidak ditemukan" };
  stopBot(botId, { status: "offline", reason: "restart" });
  return startBot(bot, { skipAccess: true }); // restart tidak re-validasi trial (sudah tervalidasi saat start awal)
}

export function deleteBot(botId) {
  const bot = getBotRecord(botId);
  if (!bot) return { error: "BOT_NOT_FOUND", message: "Bot tidak ditemukan" };
  stopBot(botId, { status: "stopped", reason: "delete" });
  // §12 — auth/session TIDAK dihapus otomatis saat expired; delete memang menghapus
  try {
    fs.rmSync(path.join(DATA_ROOT, bot.owner_id, bot.id), { recursive: true, force: true });
  } catch {}
  delete store.bots.data[botId];
  store.bots.save();
  logBot(botId, "bot dihapus");
  return { deleted: true };
}

/* ==================== OWNERSHIP (§43, §54) ==================== */

/** Wajib dipanggil di semua route bot: bot.owner_id == current_user.id */
export function assertBotOwnership(bot, user, { adminBypass = true } = {}) {
  if (!bot) return { error: "BOT_NOT_FOUND", message: "Bot tidak ditemukan" };
  const isAdmin = adminBypass && user?.role === "admin";
  if (!isAdmin && bot.owner_id !== user?.id) {
    return { error: "BOT_NOT_OWNER", message: "Bot ini bukan milik Anda" };
  }
  return { ok: true };
}

/* ==================== MESSAGES & COMMAND SECURITY ==================== */

async function handleIncomingMessage(bot, sock, msg) {
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    "";
  if (!text || !text.startsWith(".")) return;

  const senderJid = msg.key?.participant || msg.key?.remoteJid || "";
  const cls = classifyCommand(text, senderJid);
  logBot(bot.id, `cmd ${cls.command || "-"} [${cls.category}] allowed=${cls.allowed} from=${senderJid}`);

  if (cls.isCommand && !cls.allowed) {
    // §75 — REJECTED untuk user biasa
    await sock.sendMessage(msg.key.remoteJid, {
      text: `⛔ Command \`${cls.command}\` ditolak (OWNER_ONLY).`,
    });
    return;
  }

  const selfJid = `${bot.phone_number}@s.whatsapp.net`;

  switch (cls.command) {
    case "ping":
      await sock.sendMessage(msg.key.remoteJid, { text: "🏓 pong!" });
      break;
    case "menu":
    case "help":
      await sock.sendMessage(msg.key.remoteJid, {
        text:
          `🤖 *Jadibot ${bot.phone_number}*\n\n` +
          `.ping — cek bot hidup\n.status — status bot\n.id — info chat\n.trial — sisa trial\n.menu — pesan ini\n\n` +
          `_Command berbahaya (exec/eval/shell) hanya owner server._`,
      });
      break;
    case "status":
      await sock.sendMessage(msg.key.remoteJid, {
        text: `📊 Status: *${bot.status}* | Mode: ${active.has(bot.id) ? "running" : "stopped"}`,
      });
      break;
    case "id":
      await sock.sendMessage(msg.key.remoteJid, {
        text: `🆔 Chat ID: \`${msg.key.remoteJid}\`\nSender: \`${senderJid}\``,
      });
      break;
    case "trial":
    case "saldo":
    case "balance": {
      const user = store.users.data[bot.owner_id];
      const remaining = user?.trial_expires_at
        ? Math.max(0, Math.floor((user.trial_expires_at - now()) / 60000))
        : 0;
      await sock.sendMessage(msg.key.remoteJid, {
        text:
          `👤 Akun: @${user?.username}\n` +
          `💰 Balance: ${rupiah(user?.balance)}\n` +
          `⏱️ Sisa trial: ${user?.trial_used ? `${remaining} menit` : "belum dimulai"}\n` +
          `💎 Subscription: ${user?.subscription_status === "active" && user.subscription_expires_at > now() ? "aktif" : "tidak aktif"}`,
      });
      break;
    }
    default:
      if (cls.category === "OWNER_ONLY" && cls.allowed) {
        // Owner server lolos klasifikasi, TAPI eksekusi exec/eval tetap
        // hanya di bot utama — instance jadibot milik user (§52 konsisten).
        await sock.sendMessage(msg.key.remoteJid, {
          text: `ℹ️ \`${cls.command}\` adalah owner-only command — jalankan via bot utama, bukan instance jadibot user.`,
        });
      }
    // PUBLIC/USER tak dikenal → abaikan
  }
}

/* ==================== NOTIFY VIA BOT (§13) ==================== */

/** Kirim pesan ke pemilik bot (self-chat) — dipakai notif trial expired */
export async function notifyBotOwner(bot, text) {
  const entry = active.get(bot.id);
  if (!entry?.sock) return false;
  try {
    const jid = entry.sock.user?.id || `${bot.phone_number}@s.whatsapp.net`;
    await entry.sock.sendMessage(jid, { text });
    logBot(bot.id, "notifikasi → self chat");
    return true;
  } catch (e) {
    logBot(bot.id, `notif gagal: ${e.message}`);
    return false;
  }
}

/* ==================== QUERIES ==================== */

export function getUserBots(userId) {
  return Object.values(store.bots.data)
    .filter((b) => b.owner_id === userId)
    .map(sanitizeBot);
}

export function getAllBots() {
  return Object.values(store.bots.data).map(sanitizeBot);
}

export function getBotSafe(botId) {
  return sanitizeBot(getBotRecord(botId));
}

export function getPairingInfo(botId) {
  const bot = getBotRecord(botId);
  if (!bot) return null;
  const entry = active.get(botId);
  const codeAt = entry?.pairingCodeAt || null;
  return {
    bot_id: botId,
    status: bot.status,
    phone_number: bot.phone_number,
    pairing_code: entry?.pairingCode || null,
    pairing_code_created_at: codeAt,
    pairing_code_expires_at: codeAt ? codeAt + PAIRING_CODE_TTL_MS : null,
    hint: entry?.pairingCode
      ? "Buka WhatsApp di HP → Settings → Linked Devices → Link a Device → masukkan kode"
      : "Menunggu kode pairing…",
  };
}

/**
 * Minta kode pairing baru bila kode lama sudah kadaluarsa/hilang.
 * Restart instance → baileys otomatis request kode baru (bot belum registered).
 */
export function refreshPairing(botId) {
  const bot = getBotRecord(botId);
  if (!bot) return { error: "BOT_NOT_FOUND", message: "Bot tidak ditemukan" };
  if (bot.status === "online") {
    return { error: "ALREADY_PAIRED", message: "Bot sudah terhubung, tidak perlu pairing lagi" };
  }

  const entry = active.get(botId);
  const age = entry?.pairingCodeAt ? now() - entry.pairingCodeAt : Infinity;

  // Kode masih fresh → pakai yang lama, tidak perlu restart
  if (entry?.pairingCode && age < PAIRING_CODE_TTL_MS) {
    return { ok: true, fresh: false, pairing: getPairingInfo(botId) };
  }

  stopBot(botId, { status: "connecting", reason: "refresh pairing code" });
  const r = startBot(bot, { skipAccess: true });
  if (r.error) return r;
  logBot(bot.id, "kode pairing lama kadaluarsa — minta kode baru");
  return { ok: true, fresh: true, pairing: null }; // kode baru menyusul ±3-5 detik
}

export function getBotLogs(botId, limit = 50) {
  return (botLogs.get(botId) || []).slice(-limit).reverse();
}

export function countBots() {
  const all = Object.values(store.bots.data);
  return {
    total: all.length,
    online: all.filter((b) => b.status === "online" && active.has(b.id)).length,
  };
}

/* ==================== BOOT RESTORE (§69) ==================== */

/** Pulihkan bot dengan akses aktif setelah restart VPS. Auth TIDAK dihapus. */
export function restoreBots() {
  let restored = 0;
  for (const bot of Object.values(store.bots.data)) {
    active.delete(bot.id);
    if (["online", "connecting", "pairing"].includes(bot.status)) {
      const user = store.users.data[bot.owner_id];
      const access = user ? validateBotAccess(user, { forControl: true }) : { allowed: false };
      if (access.allowed && !TEST_MODE) {
        setBotStatus(bot, "offline");
        startBot(bot, { skipAccess: true });
        restored++;
      } else if (!access.allowed) {
        // trial/subscription habis saat server mati → tandai expired, auth disimpan
        setBotStatus(bot, "expired");
      }
    }
  }
  if (restored) systemLog("bots_restored", { count: restored });
  return restored;
}

export const engineInternals = { active, setBotStatus, getBotRecord, authDir, TEST_MODE, PAIRING_CODE_TTL_MS };
