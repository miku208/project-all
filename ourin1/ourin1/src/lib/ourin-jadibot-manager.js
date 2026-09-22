import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import { saluranCtx } from "./ourin-context.js";
import {
  delay,
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState,
} from "ourin";
import { logger } from "./ourin-logger.js";
import {
  addJadibotOwner,
  isJadibotSelf,
  setJadibotSelf,
} from "./ourin-jadibot-database.js";
import { extendSocket } from "./ourin-socket.js";
import { getAssetBuffer } from "./ourin-asset-manager.js";
import { addJadibotLog, getJadibotLogs, getAllJadibotLogs, clearJadibotLogs } from "./ourin-jadibot-logs.js";

// Ini yang bikin log di web viewer = log terminal beneran, bukan cuma
// event pilihan. Dipanggil di semua tempat yang sebelumnya cuma
// logger.info/error("Jadibot", ...) — perilaku terminal PERSIS sama
// kayak sebelumnya (tetap kepanggil), cuma sekalian disimpan per-id
// biar admin/owner bisa lihat lewat dashboard.
function logJadibot(id, type, message) {
  if (type === "error") logger.error("Jadibot", message);
  else logger.info("Jadibot", message);
  addJadibotLog(id, type, message);
}
const JADIBOT_AUTH_FOLDER = path.join(process.cwd(), "session", "jadibot");
const jadibotSessions = new Map();
const reconnectAttempts = new Map();
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_INTERVAL = 5000;

if (!fs.existsSync(JADIBOT_AUTH_FOLDER)) {
  fs.mkdirSync(JADIBOT_AUTH_FOLDER, { recursive: true });
}

function getJadibotAuthPath(jid) {
  const id = jid.replace(/@.+/g, "");
  return path.join(JADIBOT_AUTH_FOLDER, id);
}

// true kalau nomor ini PERNAH berhasil pairing (creds.registered === true
// di creds.json-nya), walaupun sekarang lagi offline/gak ada di memori.
// Dipakai buat bedain "bot beneran, cuma lagi offline" vs "pairing yang
// gak pernah kelar discan" — biar yang pertama gak ke-anggap basi.
function isJadibotRegistered(jid) {
  try {
    const credsPath = path.join(getJadibotAuthPath(jid), "creds.json");
    if (!fs.existsSync(credsPath)) return false;
    const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    return !!creds?.registered;
  } catch {
    return false;
  }
}

function isJadibotActive(jid) {
  const id = jid.replace(/@.+/g, "");
  return jadibotSessions.has(id);
}

function getActiveJadibots() {
  return Array.from(jadibotSessions.entries()).map(([id, data]) => ({
    id,
    jid: id + "@s.whatsapp.net",
    ...data,
  }));
}

function getAllJadibotSessions() {
  const sessions = [];
  if (!fs.existsSync(JADIBOT_AUTH_FOLDER)) return sessions;

  const dirs = fs.readdirSync(JADIBOT_AUTH_FOLDER);
  for (const dir of dirs) {
    const credsPath = path.join(JADIBOT_AUTH_FOLDER, dir, "creds.json");
    if (fs.existsSync(credsPath)) {
      sessions.push({
        id: dir,
        jid: dir + "@s.whatsapp.net",
        isActive: jadibotSessions.has(dir),
        credsPath,
      });
    }
  }
  return sessions;
}

function createJadibotStore() {
  return {
    messages: new Map(),
    chats: new Map(),
    contacts: {},
    bind(ev) {
      ev.on("messages.upsert", ({ messages }) => {
        for (const msg of messages || []) {
          const jid = msg.key?.remoteJid;
          if (!jid) continue;
          if (!this.messages.has(jid)) this.messages.set(jid, new Map());
          const chat = this.messages.get(jid);
          if (msg.key?.id) {
            chat.set(msg.key.id, msg);
            if (chat.size > 200) {
              const keys = [...chat.keys()];
              for (let i = 0; i < keys.length - 150; i++) chat.delete(keys[i]);
            }
          }
          if (!this.chats.has(jid)) {
            this.chats.set(jid, { id: jid });
          }
          if (msg.pushName && jid.endsWith("@s.whatsapp.net")) {
            this.contacts[jid] = {
              ...this.contacts[jid],
              notify: msg.pushName,
            };
          }
        }
      });
      ev.on("chats.upsert", (chats) => {
        for (const chat of chats || []) {
          if (chat.id) this.chats.set(chat.id, chat);
        }
      });
      ev.on("contacts.upsert", (contacts) => {
        for (const contact of contacts || []) {
          if (contact.id) {
            this.contacts[contact.id] = {
              ...this.contacts[contact.id],
              ...contact,
            };
          }
        }
      });
    },
    async loadMessage(jid, id) {
      return this.messages.get(jid)?.get(id) || undefined;
    },
  };
}

const rateLimit = new Map();

const ERROR_MESSAGES = {
  401: {
    reason: "Nomor tidak terdaftar WhatsApp",
    action: "Pastikan nomor ini aktif di WhatsApp",
    fatal: true,
  },
  403: {
    reason: "Akses ditolak/dibanned",
    action: "Nomor ini mungkin terkena banned WhatsApp",
    fatal: true,
  },
  405: {
    reason: "Metode tidak diizinkan",
    action: "Coba lagi nanti",
    fatal: true,
  },
  406: {
    reason: "Nomor dibatasi",
    action: "Nomor ini dibatasi oleh WhatsApp, tunggu beberapa jam",
    fatal: true,
  },
  408: {
    reason: "Request timeout",
    action: "Koneksi lambat, akan mencoba reconnect",
    fatal: false,
  },
  409: {
    reason: "Konflik session",
    action: "Session sedang digunakan di device lain",
    fatal: true,
  },
  411: {
    reason: "Autentikasi gagal",
    action: "Perlu scan ulang QR/pairing",
    fatal: true,
  },
  428: {
    reason: "Rate limit",
    action: "Terlalu banyak request, tunggu beberapa menit",
    fatal: true,
  },
  440: {
    reason: "Login required",
    action: "Session expired, perlu login ulang",
    fatal: true,
  },
  500: {
    reason: "Server error WhatsApp",
    action: "Server WhatsApp bermasalah",
    fatal: false,
  },
  501: {
    reason: "Tidak diimplementasi",
    action: "Fitur belum didukung",
    fatal: true,
  },
  503: {
    reason: "Layanan tidak tersedia",
    action: "WhatsApp sedang maintenance",
    fatal: false,
  },
  515: {
    reason: "Stream error",
    action: "Akan mencoba reconnect",
    fatal: false,
  },
};

const CONNECTION_CLOSED_REASONS = [
  {
    match: /Connection Closed/i,
    reason: "Koneksi ditutup",
    action: "Kemungkinan nomor dibanned atau ada masalah jaringan",
    fatal: true,
  },
  {
    match: /write EOF/i,
    reason: "Koneksi terputus",
    action: "Masalah jaringan, akan mencoba reconnect",
    fatal: false,
  },
  {
    match: /ECONNRESET/i,
    reason: "Reset koneksi",
    action: "Jaringan tidak stabil",
    fatal: false,
  },
  {
    match: /ETIMEDOUT/i,
    reason: "Timeout",
    action: "Koneksi lambat",
    fatal: false,
  },
  {
    match: /logged out/i,
    reason: "Logged out",
    action: "Akun di-logout dari perangkat",
    fatal: true,
  },
  {
    match: /replaced/i,
    reason: "Session replaced",
    action: "Login di perangkat lain",
    fatal: true,
  },
  {
    match: /Multidevice mismatch/i,
    reason: "Session tidak valid",
    action: "Perlu scan ulang",
    fatal: true,
  },
  {
    match: /restart required/i,
    reason: "Restart diperlukan",
    action: "Akan restart otomatis",
    fatal: false,
  },
  {
    match: /bad session/i,
    reason: "Session rusak",
    action: "Perlu scan ulang",
    fatal: true,
  },
];

function parseDisconnectError(lastDisconnect) {
  const statusCode = lastDisconnect?.error?.output?.statusCode;
  const errorMessage = lastDisconnect?.error?.message || "Unknown error";

  if (statusCode && ERROR_MESSAGES[statusCode]) {
    return {
      ...ERROR_MESSAGES[statusCode],
      code: statusCode,
      message: errorMessage,
    };
  }

  for (const pattern of CONNECTION_CLOSED_REASONS) {
    if (pattern.match.test(errorMessage)) {
      return {
        code: statusCode || "N/A",
        reason: pattern.reason,
        action: pattern.action,
        fatal: pattern.fatal,
        message: errorMessage,
      };
    }
  }

  return {
    code: statusCode || "N/A",
    reason: "Error tidak dikenal",
    action: "Hubungi admin jika berulang",
    fatal: false,
    message: errorMessage,
  };
}

function isSocketAlive(sock) {
  try {
    if (!sock) return false;
    if (sock.ws && sock.ws.readyState === 1) return true;
    if (sock.user?.id) return true;
    return false;
  } catch {
    return false;
  }
}

async function safeSend(sock, jid, content, options = {}) {
  try {
    if (!jid) return null;
    if (!isSocketAlive(sock)) return null;
    return await sock.sendMessage(jid, content, options);
  } catch {
    return null;
  }
}

async function startJadibot(sock, m = null, userJid, usePairing = true) {
  if (
    !userJid ||
    typeof userJid !== "string" ||
    !userJid.includes("@s.whatsapp.net")
  ) {
    throw new Error("Invalid User JID");
  }

  const id = userJid.replace(/@.+/g, "");

  if (usePairing) {
    const lastAttempt = rateLimit.get(id) || 0;
    if (Date.now() - lastAttempt < 60000) {
      throw new Error("Tunggu 1 menit sebelum mencoba lagi.");
    }
    rateLimit.set(id, Date.now());
  }

  const authPath = getJadibotAuthPath(userJid);

  if (jadibotSessions.has(id)) {
    throw new Error("Jadibot sudah aktif untuk nomor ini!");
  }

  if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const {
    default: makeWASocket,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
  } = await import("ourin");
  const { version } = await fetchLatestBaileysVersion();
  const pinoModule = await import("pino");
  const pinoLogger = pinoModule.default({ level: "silent" });
  const childStore = createJadibotStore();
  const groupMetadataCache = new Map();

  const childSock = makeWASocket({
    version,
    logger: pinoLogger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
    },
    browser: ["Ubuntu", "Chrome", "20.0.0"],
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: true,
    defaultQueryTimeoutMs: 20000,
    connectTimeoutMs: 20000,
    keepAliveIntervalMs: 10000,
    retryRequestDelayMs: 150,
    getMessage: async (key) => {
      return (await childStore.loadMessage(key.remoteJid, key.id))?.message;
    },
    cachedGroupMetadata: async (jid) => {
      const cached = groupMetadataCache.get(jid);
      if (cached) return cached;
      try {
        const fresh = await childSock.groupMetadata(jid);
        groupMetadataCache.set(jid, fresh);
        return fresh;
      } catch {
        return undefined;
      }
    },
    fireInitQueries: true,
    emitOwnEvents: true,
    shouldSyncHistoryMessage: () => false,
    transactionOpts: { maxCommitRetries: 5, delayBetweenTriesMs: 500 },
  });

  childStore.bind(childSock.ev);
  childSock.store = childStore;
  await extendSocket(childSock);

  let qrCount = 0;
  let lastQRMsg = null;
  let pairingCode = null;
  let heartbeatInterval = null;
  let sessionRemoved = false;

  // Bungkus saveCreds - kalau folder session udah dihapus (misal abis 401 fatal),
  // saveCreds bawaan Baileys bisa masih nyoba nulis creds.json dan ENOENT.
  // Itu bikin unhandled promise rejection kalau nggak ditangkep di sini.
  const safeSaveCreds = async () => {
    if (sessionRemoved) return;
    try {
      await saveCreds();
    } catch (e) {
      if (e?.code !== "ENOENT") {
        logJadibot(id, "error", `Gagal simpan creds ${id}: ${e.message}`);
      }
    }
  };

  childSock.ev.on("creds.update", safeSaveCreds);

  childSock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usePairing) {
      qrCount++;
      if (qrCount > 3) {
        await safeSend(sock, m?.chat, {
          text: "❌ QR Code expired! Silakan coba lagi.",
        });
        if (lastQRMsg?.key) {
          await safeSend(sock, m?.chat, { delete: lastQRMsg.key });
        }
        jadibotSessions.delete(id);
        reconnectAttempts.delete(id);
        try {
          childSock.ws.close();
        } catch { }
        return;
      }

      try {
        const qrBuffer = await QRCode.toBuffer(qr, {
          scale: 8,
          margin: 4,
          width: 256,
          color: { dark: "#000000ff", light: "#ffffffff" },
        });

        if (lastQRMsg?.key) {
          await safeSend(sock, m?.chat, { delete: lastQRMsg.key });
        }

        if (!m?.chat) return;
        lastQRMsg = await sock.sendMessage(
          m.chat,
          {
            image: qrBuffer,
            caption:
              `🤖 *ᴊᴀᴅɪʙᴏᴛ — Qʀ ᴄᴏᴅᴇ*\n\n` +
              `Scan kode QR ini untuk menjadi bot.\n\n` +
              `> ⏱️ Expired dalam 20 detik\n` +
              `> 📊 QR Count: ${qrCount}/3`,
          },
          { quoted: m },
        );
      } catch (e) {
        logJadibot(id, "error", "Failed to send QR: " + e.message);
      }
    }

    if (connection === "open") {
      logJadibot(id, "connect", `Connected: ${id}`);

      reconnectAttempts.delete(id);

      jadibotSessions.set(id, {
        sock: childSock,
        jid: childSock.user?.jid || userJid,
        startedAt: Date.now(),
        ownerJid: m?.sender || userJid,
        status: "connected",
        connectionReady: true,
        pendingMessages: [],
        name: childSock.user?.name || childSock.user?.verifiedName || null,
        photo: null,
        paused: false,
      });

      // Foto profil diambil belakangan, jangan blokir alur connect —
      // kalau gagal (mis. privasi profil dikunci) biarin null, frontend
      // sudah fallback ke avatar default.
      childSock
        .profilePictureUrl(userJid, "image")
        .then((url) => {
          const s = jadibotSessions.get(id);
          if (s) s.photo = url;
        })
        .catch(() => { });

      heartbeatInterval = setInterval(() => {
        try {
          if (!isSocketAlive(childSock)) {
            clearInterval(heartbeatInterval);
          }
        } catch { }
      }, 30000);

      const session = jadibotSessions.get(id);
      if (session) {
        session.heartbeatInterval = heartbeatInterval;
      }

      childSock.sendPresenceUpdate("available").catch(() => { });

      addJadibotOwner(id, m?.sender || userJid);

      // Kalau dipicu dari chat (m ada), balas di chat itu.
      // Kalau dipicu dari API/web (m null), kabari langsung ke DM nomor itu sendiri.
      const notifyTarget = m?.chat || userJid;
      safeSend(sock, notifyTarget, {
        text:
          `✅ *ᴊᴀᴅɪʙᴏᴛ ᴛᴇʀʜᴜʙᴜɴɢ*\n\n` +
          `> 📱 Nomor: *@${id}*\n` +
          `> 🟢 Status: *Online*\n` +
          `> ⏱️ Mulai: *${new Date().toLocaleTimeString("id-ID")}*\n\n` +
          `Bot kamu aktif dan siap menerima perintah!\n\n` +
          `> ℹ️ Ketik \`${m?.prefix || "."}stopjadibot\` untuk menghentikan`,
        mentions: [userJid],
      }).catch((e) => {
        logJadibot(id, "error", `Failed to send connected notification: ${e.message}`);
      });

      if (lastQRMsg?.key && m?.chat) {
        safeSend(sock, m.chat, { delete: lastQRMsg.key }).catch(() => { });
      }
    }

    if (connection === "close") {
      const errorInfo = parseDisconnectError(lastDisconnect);

      logJadibot(id, "disconnect", `Disconnected: ${id}, code: ${errorInfo.code}, reason: ${errorInfo.reason}`);

      const session = jadibotSessions.get(id);
      if (session?.heartbeatInterval) {
        clearInterval(session.heartbeatInterval);
      }

      const attempts = reconnectAttempts.get(id) || 0;

      if (errorInfo.fatal || attempts >= MAX_RECONNECT_ATTEMPTS) {
        jadibotSessions.delete(id);
        reconnectAttempts.delete(id);

        if (errorInfo.fatal) {
          sessionRemoved = true;
          try {
            childSock.ev.removeAllListeners("creds.update");
          } catch { }
          try {
            if (fs.existsSync(authPath)) {
              fs.rmSync(authPath, { recursive: true, force: true });
            }
          } catch { }
        }

        let statusEmoji = "❌";
        if (errorInfo.code === 403 || errorInfo.reason?.includes("banned")) {
          statusEmoji = "🚫";
        } else if (
          errorInfo.code === 406 ||
          errorInfo.reason?.includes("dibatasi")
        ) {
          statusEmoji = "⚠️";
        }

        await safeSend(sock, m?.chat || userJid, {
          text:
            `${statusEmoji} *ᴊᴀᴅɪʙᴏᴛ ᴅɪsᴄᴏɴɴᴇᴄᴛᴇᴅ*\n\n` +
            `> 📱 Nomor: *@${id}*\n` +
            `> 🔢 Code: \`${errorInfo.code}\`\n` +
            `> 📋 Alasan: *${errorInfo.reason}*\n` +
            `> ℹ️ ${errorInfo.action}\n\n` +
            (errorInfo.fatal
              ? `> ⚠️ Session dihapus. Gunakan \`.jadibot\` untuk memulai ulang.`
              : ""),
          mentions: [userJid],
        });
      } else {
        reconnectAttempts.set(id, attempts + 1);

        logJadibot(id, "reconnect", `Percobaan ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS}: ${errorInfo.reason}`);

        await safeSend(sock, m?.chat || userJid, {
          text:
            `🔄 *ᴊᴀᴅɪʙᴏᴛ ʀᴇᴄᴏɴɴᴇᴄᴛɪɴɢ...*\n\n` +
            `> 📱 Nomor: *@${id}*\n` +
            `> 📋 Alasan: *${errorInfo.reason}*\n` +
            `> 🔁 Percobaan: *${attempts + 1}/${MAX_RECONNECT_ATTEMPTS}*\n\n` +
            `> Reconnect dalam ${RECONNECT_INTERVAL / 1000} detik...`,
          mentions: [userJid],
        });

        setTimeout(() => {
          startJadibot(sock, m, userJid, false).catch((e) => {
            logJadibot(id, "error", `Reconnect failed for ${id}: ${e.message}`);
            jadibotSessions.delete(id);
            reconnectAttempts.delete(id);
          });
        }, RECONNECT_INTERVAL);
      }
    }
  });

  const processedMessages = new Map();

  childSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (!childSock.user || !childSock.user.id) {
      childSock.user = {
        id: jidNormalizedUser(id),
        name: "Jadibot",
      };
    }

    if (type !== "notify" && type !== "append") return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const msgId = msg.key?.id;
      if (msgId && processedMessages.has(msgId)) continue;
      if (msgId) processedMessages.set(msgId, Date.now());

      if (msg.key && msg.key.remoteJid === "status@broadcast") continue;

      const msgTimestamp = msg.messageTimestamp
        ? Number(msg.messageTimestamp) * 1000
        : Date.now();
      const msgAge = Date.now() - msgTimestamp;
      if (msgAge > 60 * 60 * 1000) continue;

      const metadataKeys = [
        "senderKeyDistributionMessage",
        "messageContextInfo",
      ];
      const msgType =
        Object.keys(msg.message).find((k) => !metadataKeys.includes(k)) ||
        Object.keys(msg.message)[0];
      const ignoredTypes = [
        "protocolMessage",
        "senderKeyDistributionMessage",
        "reactionMessage",
        "stickerSyncRmrMessage",
        "encReactionMessage",
        "pollUpdateMessage",
        "pollCreationMessage",
        "pollCreationMessageV2",
        "pollCreationMessageV3",
        "keepInChatMessage",
        "deviceSentMessage",
        "call",
        "peerDataOperationRequestMessage",
      ];
      if (ignoredTypes.includes(msgType)) continue;

      if (isJadibotSelf(id) && !msg.key?.fromMe) continue;

      if (!isSocketAlive(childSock)) continue;

      const session = jadibotSessions.get(id);
      if (session && !session.connectionReady) {
        session.pendingMessages = session.pendingMessages || [];
        session.pendingMessages.push(msg);
        continue;
      }

      // Bot lagi dijeda user (bukan diputus) — koneksi WA tetap hidup,
      // cuma gak diproses jadi command apa pun. Ini beda dari disconnect.
      if (session?.paused) continue;

      const senderNum = (msg.key?.participant || msg.key?.remoteJid || "").replace(/[^0-9]/g, "") || "unknown";
      const textPreview =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "[media/lainnya]";
      addJadibotLog(id, "message", `Dari ${senderNum}: ${String(textPreview).slice(0, 120)}`);

      try {
        const { messageHandler } = await import("../handler.js");
        await messageHandler(msg, childSock, {
          isJadibot: true,
          jadibotId: id,
        });
      } catch (e) {
        if (
          e.message?.includes("Connection Closed") ||
          e.message?.includes("428")
        ) {
          logJadibot(id, "info", `${id} connection closed during handler, skipping`);
          break;
        }
        logJadibot(id, "error", `Handler error for ${id}: ${e.message}`);
      }
    }

    const fiveMinAgo = Date.now() - 300000;
    for (const [key, time] of processedMessages) {
      if (time < fiveMinAgo) processedMessages.delete(key);
    }
  });

  if (usePairing && !state.creds?.registered) {
    try {
      await delay(3000);
      pairingCode = await childSock.requestPairingCode(id);
      pairingCode = pairingCode.match(/.{1,4}/g)?.join("-") || pairingCode;

      if (m && m.chat) {
        let thumbnail = null;
        try {
          if (!!getAssetBuffer("ourin2")) {
            thumbnail = getAssetBuffer("ourin2");
          }
        } catch { }

        await sock.sendMessage(
          m.chat,
          {
            text:
              `🔗 *ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ*\n\n` +
              `Masukkan kode berikut di WhatsApp kamu:\n\n` +
              `> 📱 *Settings → Linked Devices → Link a Device*\n\n` +
              `\`\`\`${pairingCode}\`\`\`\n\n` +
              `> 🕕 Kode berlaku beberapa menit\n` +
              `> ⚠️ Jangan bagikan kode ini ke siapapun`,
            contextInfo: saluranCtx(),
            interactiveButtons: [
              {
                name: "cta_copy",
                buttonParamsJson: JSON.stringify({
                  display_text: "📋 Copy Pairing Code",
                  copy_code: pairingCode.replace(/-/g, ""),
                }),
              },
            ],
          },
          { quoted: m },
        );
      } else {
        logger.info("Jadibot", `Pairing Code for ${id}: ${pairingCode}`);
        addJadibotLog(id, "info", "Pairing code dibuat (kode tidak ditampilkan di log demi keamanan).");
      }
    } catch (e) {
      logJadibot(id, "error", "Failed to get pairing code: " + e.message);

      let errorMsg = "Gagal mendapatkan pairing code";
      if (
        e.message?.includes("rate") ||
        e.message?.includes("limit") ||
        e.message?.includes("428")
      ) {
        errorMsg = "Rate limited! Tunggu 5-10 menit.";
      } else if (
        e.message?.includes("banned") ||
        e.message?.includes("blocked")
      ) {
        errorMsg = "Nomor mungkin dibanned WhatsApp.";
      } else if (
        e.message?.includes("Connection Closed") ||
        e.message?.includes("closed")
      ) {
        errorMsg = "Koneksi terputus. Coba lagi.";
      }

      await safeSend(sock, m?.chat || userJid, {
        text: `❌ *ᴊᴀᴅɪʙᴏᴛ ɢᴀɢᴀʟ*\n\n> ${errorMsg}`,
      });

      try {
        childSock.end?.();
      } catch { }
      jadibotSessions.delete(id);
      reconnectAttempts.delete(id);
      throw new Error(errorMsg);
    }
  }

  return { sock: childSock, pairingCode };
}

// Dipakai endpoint web: user masukin nomor -> panggil ini -> balikin pairing code.
// sock = socket bot utama (dipakai buat notifikasi WA setelah terhubung, bukan buat kirim pairing code).
// phoneNumber bisa format apa aja, otomatis dibersihkan jadi angka saja.
async function requestJadibotPairing(sock, phoneNumber) {
  const digits = String(phoneNumber || "").replace(/[^0-9]/g, "");

  if (!digits || digits.length < 8) {
    return { success: false, error: "Nomor tidak valid" };
  }

  const userJid = digits + "@s.whatsapp.net";

  if (isJadibotActive(userJid)) {
    return { success: false, error: "Jadibot sudah aktif untuk nomor ini" };
  }

  try {
    const { pairingCode } = await startJadibot(sock, null, userJid, true);
    return {
      success: true,
      id: digits,
      jid: userJid,
      pairingCode,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function stopJadibot(jid, deleteSession = false) {
  const id = jid.replace(/@.+/g, "");
  const session = jadibotSessions.get(id);

  if (session) {
    try {
      if (session.heartbeatInterval) {
        clearInterval(session.heartbeatInterval);
      }
      session.sock.ev.removeAllListeners();
      session.sock.ws.close();
    } catch { }
    jadibotSessions.delete(id);
  }

  reconnectAttempts.delete(id);

  if (deleteSession) {
    const authPath = getJadibotAuthPath(jid);
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
    clearJadibotLogs(id);
  }

  return true;
}

async function stopAllJadibots() {
  const stopped = [];
  for (const [id, session] of jadibotSessions) {
    try {
      if (session.heartbeatInterval) {
        clearInterval(session.heartbeatInterval);
      }
      session.sock.ev.removeAllListeners();
      session.sock.ws.close();
    } catch { }
    stopped.push(id);
  }
  jadibotSessions.clear();
  reconnectAttempts.clear();
  return stopped;
}

async function restartJadibotSession(sock, sessionId) {
  const userJid = sessionId + "@s.whatsapp.net";
  try {
    logJadibot(sessionId, "info", `Restoring session: ${sessionId}`);

    const dbPath = path.join(JADIBOT_AUTH_FOLDER, sessionId, "data.json");
    let ownerJid = userJid;
    try {
      if (fs.existsSync(dbPath)) {
        const data = JSON.parse(fs.readFileSync(dbPath, "utf8"));
        if (data.owners?.[0]) ownerJid = data.owners[0] + "@s.whatsapp.net";
      }
    } catch { }

    const mockM = {
      chat: ownerJid,
      sender: ownerJid,
      prefix: ".",
      key: {
        remoteJid: ownerJid,
        fromMe: false,
        id: "restart-" + Date.now(),
      },
      reply: async (text) => {
        await safeSend(sock, ownerJid, { text });
      },
      react: async () => { },
    };
    await startJadibot(sock, mockM, userJid, false);
  } catch (e) {
    logJadibot(sessionId, "error", `Failed to restore ${sessionId}: ${e.message}`);
  }
}

function isJadibotSelfMode(jid) {
  const id = jid.replace(/@.+/g, "");
  return isJadibotSelf(id);
}

// Dipanggil bot utama sebelum membalas pesan seseorang.
// Return true kalau orang itu punya jadibot aktif dalam mode self,
// artinya jadibot dia sendiri yang akan menangani, bot utama harus diam.
function shouldMainBotSkip(jid) {
  if (!jid) return false;
  const id = jid.replace(/@.+/g, "");
  if (!jadibotSessions.has(id)) return false;
  return isJadibotSelf(id);
}

function getJadibotStatus(jid) {
  const id = jid.replace(/@.+/g, "");
  const session = jadibotSessions.get(id);
  if (!session) return null;

  // Dihitung ulang dari session.startedAt setiap kali endpoint ini dipanggil,
  // jadi selalu akurat dari sisi server — tidak peduli browser di-refresh,
  // ditutup, atau tab freeze. runtimeSeconds ini yang dibaca dashboard.js/admin.js.
  const uptimeMs = Date.now() - session.startedAt;

  return {
    id,
    jid: session.jid,
    status: session.status || "unknown",
    paused: !!session.paused,
    startedAt: session.startedAt,
    connectedAt: new Date(session.startedAt).toISOString(),
    ownerJid: session.ownerJid,
    uptime: uptimeMs,
    runtimeSeconds: Math.floor(uptimeMs / 1000),
    name: session.name || null,
    photo: session.photo || null,
  };
}

// Jeda: koneksi WA TETAP hidup (bukan disconnect), cuma bot berhenti
// memproses pesan/command. Bisa dilanjut lagi tanpa pairing ulang.
function pauseJadibot(jid) {
  const id = jid.replace(/@.+/g, "");
  const session = jadibotSessions.get(id);
  if (!session) return { success: false, error: "Bot tidak aktif." };
  session.paused = true;
  session.status = "paused";
  addJadibotLog(id, "pause", "Bot dijeda oleh user.");
  return { success: true };
}

function resumeJadibot(jid) {
  const id = jid.replace(/@.+/g, "");
  const session = jadibotSessions.get(id);
  if (!session) return { success: false, error: "Bot tidak aktif, silakan pairing ulang." };
  session.paused = false;
  session.status = "connected";
  addJadibotLog(id, "resume", "Bot dilanjutkan oleh user.");
  return { success: true };
}

export {
  JADIBOT_AUTH_FOLDER,
  jadibotSessions,
  getJadibotAuthPath,
  isJadibotRegistered,
  isJadibotActive,
  getActiveJadibots,
  getAllJadibotSessions,
  startJadibot,
  requestJadibotPairing,
  stopJadibot,
  stopAllJadibots,
  restartJadibotSession,
  getJadibotStatus,
  pauseJadibot,
  resumeJadibot,
  getJadibotLogs,
  getAllJadibotLogs,
  isJadibotSelfMode,
  setJadibotSelf,
  shouldMainBotSkip,
  isSocketAlive,
  safeSend,
};