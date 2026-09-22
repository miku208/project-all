import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "mikuhostt-baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import fs from "fs";
import path from "path";
import readline from "readline";
import NodeCache from "node-cache";
import config, { isOwner as isOwners, setBotNumber } from "../config.js";
import * as colors from "./lib/miku-logger.js";
import { extendSocket } from "./lib/miku-socket.js";
import {
  isLid,
  lidToJid,
  lidToJidSafe,
  decodeAndNormalize,
  cacheLidJid,
  resolveAnyLidToJid,
  resolveFromSock,
  isLidConverted,
} from "./lib/miku-lid.js";
import { initAutoBackup } from "./lib/miku-auto-backup.js";
function hasCreds(dir) {
  try {
    return fs.existsSync(path.join(dir, "creds.json"));
  } catch {
    return false;
  }
}

const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });
const processedMessages = new NodeCache({ stdTTL: 30, useClones: false });
const msgRetryCounterCache = new NodeCache({ stdTTL: 60, useClones: false });

let lastMessageReceived = Date.now();
let watchdogTimer = null;
const WATCHDOG_TIMEOUT = 30 * 60 * 1000;
const WATCHDOG_CHECK_INTERVAL = 60 * 1000;

function startWatchdog(reconnectFn, options) {
  if (watchdogTimer) clearInterval(watchdogTimer);
  lastMessageReceived = Date.now();

  watchdogTimer = setInterval(() => {
    const silentMs = Date.now() - lastMessageReceived;
    if (silentMs > WATCHDOG_TIMEOUT && connectionState.isReady) {
      colors.logger.warn(
        "watchdog",
        `Pesan tidak terdeteksi, maka sistem akan me restart, supaya fresh`,
      );
      connectionState.isReady = false;
      connectionState.isConnected = false;
      try {
        connectionState.sock?.end();
      } catch { }
    }
  }, WATCHDOG_CHECK_INTERVAL);

  if (watchdogTimer.unref) watchdogTimer.unref();
  colors.logger.success(
    "watchdog",
    `aktif, batas waktu ${WATCHDOG_TIMEOUT / 60000} menit`,
  );
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

const store = {
  messages: new Map(),
  chats: new Map(),
  contacts: {},
  bind(ev) {
    ev.on("messages.upsert", ({ messages: msgs }) => {
      for (const msg of msgs) {
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
        if (msg.key?.participantAlt && msg.key?.participant) {
          const alt = decodeAndNormalize(msg.key.participantAlt);
          const primary = decodeAndNormalize(msg.key.participant);
          if (alt && primary && !isLid(alt) && !isLidConverted(alt)) {
            cacheLidJid(primary, alt);
          }
        }
        if (msg.key?.remoteJidAlt && msg.key?.remoteJid) {
          const alt = decodeAndNormalize(msg.key.remoteJidAlt);
          const primary = decodeAndNormalize(msg.key.remoteJid);
          if (alt && primary && !isLid(alt) && !isLidConverted(alt)) {
            cacheLidJid(primary, alt);
          }
        }
        if (!this.chats.has(jid)) {
          this.chats.set(jid, { id: jid });
        }
        if (msg.pushName && jid.endsWith("@s.whatsapp.net")) {
          this.contacts[jid] = { ...this.contacts[jid], notify: msg.pushName };
        }
      }
    });
    ev.on("chats.upsert", (chats) => {
      for (const chat of chats) {
        if (chat.id) this.chats.set(chat.id, chat);
      }
    });
    ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) {
        if (contact.id)
          this.contacts[contact.id] = {
            ...this.contacts[contact.id],
            ...contact,
          };
      }
    });
  },
  async loadMessage(jid, id) {
    return this.messages.get(jid)?.get(id) || undefined;
  },
};

/**
 * @typedef {Object} ConnectionState
 * @property {boolean} isConnected - Status koneksi
 * @property {Object|null} sock - Socket instance
 * @property {number} reconnectAttempts - Jumlah percobaan reconnect
 * @property {Date|null} connectedAt - Waktu koneksi berhasil
 */

/**
 * State koneksi global
 * @type {ConnectionState}
 */
const connectionState = {
  isConnected: false,
  isReady: false, // Flag to prevent premature message handling
  sock: null,
  reconnectAttempts: 0,
  connectedAt: null,
  everConnected: false, // true jika minimal sekali sukses connect (registrasi selesai)
};

/**
 * Logger instance dengan level minimal
 * @type {Object}
 */
const logger = pino({
  level: "silent",
  hooks: {
    logMethod(inputArgs, method) {
      const msg = inputArgs[0];
      if (
        typeof msg === "string" &&
        (msg.includes("Closing") ||
          msg.includes("session") ||
          msg.includes("SessionEntry") ||
          msg.includes("prekey"))
      ) {
        return;
      }
      return method.apply(this, inputArgs);
    },
  },
});

/**
 * Interface untuk input terminal
 * @type {readline.Interface|null}
 */
let rl = null;

/**
 * Membuat readline interface
 * @returns {readline.Interface}
 */
function createReadlineInterface() {
  if (rl) {
    rl.close();
  }
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return rl;
}

/**
 * Prompt untuk input
 * @param {string} question - Pertanyaan
 * @returns {Promise<string>} Input dari user
 */
function askQuestion(question) {
  return new Promise((resolve) => {
    const rlIntf = createReadlineInterface();
    rlIntf.question(question, (answer) => {
      rlIntf.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Memulai koneksi WhatsApp
 * @param {Object} options - Opsi koneksi
 * @param {Function} [options.onMessage] - Callback untuk pesan baru
 * @param {Function} [options.onConnectionUpdate] - Callback untuk update koneksi
 * @param {Function} [options.onGroupUpdate] - Callback untuk update group
 * @returns {Promise<Object>} Socket connection
 * @example
 * const sock = await startConnection({
 *   onMessage: async (m) => {
 *     console.log('New message:', m.body);
 *   }
 * });
 */
async function startConnection(options = {}) {
  if (connectionState.sock) {
    try {
      connectionState.sock.end();
      colors.logger.debug("whatsapp", "koneksi sebelumnya ditutup");
    } catch (e) { }
    connectionState.sock = null;
  }

  const sessionPath = path.join(
    process.cwd(),
    "storage",
    config.session?.folderName || "session",
  );

  connectionState.everConnected = false;

  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  // Versi WA terkini — mikuhostt-baileys >= 1.0.1 sudah multi-source
  // (sw.js -> WhiskeySockets -> WA Web Plus) sehingga registrasi perangkat
  // baru tidak lagi ditolak 405 akibat fallback versi basi.
  let version;
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = Array.isArray(fetched?.version) ? fetched.version : undefined;
  } catch { }
  colors.logger.info("whatsapp", `versi WA: ${JSON.stringify(version)}`);

  const usePairingCode = config.session?.usePairingCode === true;
  const pairingNumber = config.session?.pairingNumber || "";

  let pairingRequested = false;

  const sock = makeWASocket({
    version: version,
    logger,
    printQRInTerminal:
      !usePairingCode && (config.session?.printQRInTerminal ?? true),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: ["Mac OS", "Chrome", "14.4.1"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    shouldIgnoreJid: (jid) => (jid ? jid.includes("meta_ai") : false),
    getMessage: async (key) => {
      if (store) {
        const msg = store.messages.get(key.remoteJid)?.get(key.id);
        return msg?.message || undefined;
      }
      return undefined;
    },
    cachedGroupMetadata: async (jid) => {
      const cached = groupCache.get(jid);
      if (cached) return cached;
      try {
        const fresh = await sock.groupMetadata(jid);
        groupCache.set(jid, fresh);
        return fresh;
      } catch {
        return undefined;
      }
    },
    msgRetryCounterCache,
  });

  store.bind(sock.ev);
  sock.store = store;

  connectionState.sock = sock;
  extendSocket(sock);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection: c, lastDisconnect: d, qr: q } = u;

    if (
      usePairingCode &&
      !pairingRequested &&
      c === "connecting" &&
      !sock.authState?.creds?.registered
    ) {
      pairingRequested = true;
      let phoneNumber = String(pairingNumber || "").replace(/[^0-9]/g, "");

      if (!phoneNumber) {
        console.log("");
        colors.logger.warn("pairing", "nomor pairing belum diatur di config");
        console.log("");
        phoneNumber = await askQuestion(
          colors.chalk.cyan(
            "📱 Masukkan nomor WhatsApp (contoh: 6281234567890): ",
          ),
        );
        phoneNumber = String(phoneNumber || "").replace(/[^0-9]/g, "");
      }

      colors.logger.info("pairing", `meminta kode untuk ${phoneNumber}`);

      try {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const code = await sock.requestPairingCode(phoneNumber);
        console.log("");
        console.log(
          colors.createBanner(
            [
              "",
              "   PAIRING CODE   ",
              "",
              `   ${colors.chalk.bold(colors.chalk.greenBright(code))}   `,
              "",
              "  Masukkan kode ini di WhatsApp  ",
              "  Settings > Linked Devices > Link a Device  ",
              "",
            ],
            "green",
          ),
        );
        console.log("");
      } catch (error) {
        pairingRequested = false;
        colors.logger.error("pairing", `gagal: ${error.message}`);
      }
    }

    if (q && !usePairingCode) {
      colors.logger.info("qr", "Kode QR siap, silakan scan");
      const { default: qrcode } = await import("qrcode");
      qrcode.toString(q, { type: "terminal", small: true }, (err, qrText) => {
        if (!err) console.log(qrText);
      });
    }

    const S = {
      C: "close",
      O: "open",
      N: "@newsletter",
    };

    if (c === S.C) {
      connectionState.isConnected = false;
      connectionState.isReady = false;
      stopWatchdog();

      const r =
        d?.error instanceof Boom
          ? d.error.output?.statusCode !== DisconnectReason.loggedOut
          : true;

      const sc = d?.error?.output?.statusCode;

      const STATUS_MESSAGES = {
        400: "⚠️ Bad Request — Pesan/request tidak valid, coba restart",
        401: "🔐 Unauthorized — Session expired, perlu login ulang",
        403: "🚫 Forbidden — Akses ditolak oleh WhatsApp, cek nomor",
        404: "❓ Not Found — Resource tidak ditemukan",
        405: "🚧 Method Not Allowed — Operasi tidak diizinkan",
        408: "⏱️ Timeout — Koneksi timeout, cek internet",
        410: "📛 Gone — Session dihapus dari server, restart",
        428: "🔄 Connection Required — Perlu reconnect",
        440: "⚡ Session Conflict — Login di perangkat lain",
        500: "💥 Internal Server Error — Server WhatsApp error",
        501: "📦 Not Implemented — Fitur belum didukung server",
        502: "🌐 Bad Gateway — Server WhatsApp tidak merespons",
        503: "🔧 Service Unavailable — WhatsApp sedang maintenance",
        504: "🕐 Gateway Timeout — Server WhatsApp terlalu lama merespons",
        515: "🔁 Restart Required — WhatsApp minta restart koneksi",
      };

      const statusMsg = STATUS_MESSAGES[sc] || `❔ Unknown (kode: ${sc})`;
      colors.logger.warn("whatsapp", `terputus — ${statusMsg}`);
      colors.logger.warn(
        "whatsapp",
        `close-detail: ${JSON.stringify({
          msg: d?.error?.message,
          code: sc,
          data: d?.error?.data,
          isBoom: d?.error?.isBoom,
        })}`,
      );
      if (sc === 401) {
        if (connectionState.everConnected || hasCreds(sessionPath)) {
          colors.logger.error(
            "whatsapp",
            "sesi habis — hapus folder storage lalu restart",
          );
          connectionState.reconnectAttempts = 0;
          return;
        }
        // 401 sebelum registrasi = pairing belum selesai / kode kedaluwarsa.
        // Jangan dianggap sesi habis — reset sesi lalu minta kode pairing baru.
        colors.logger.warn(
          "whatsapp",
          "401 sebelum registrasi — reset sesi & minta kode pairing baru dalam 5 detik",
        );
        pairingRequested = false;
        try {
          fs.rmSync(sessionPath, { recursive: true, force: true });
        } catch { }
        connectionState.reconnectAttempts = 0;
        setTimeout(() => startConnection(options), 5000);
        return;
      }

      if (sc === 440) {
        connectionState.reconnectAttempts++;
        if (connectionState.reconnectAttempts <= 3) {
          colors.logger.info(
            "whatsapp",
            `percobaan sambung ulang ${connectionState.reconnectAttempts}/3 dalam 10 detik`,
          );
          setTimeout(() => startConnection(options), 1e4);
        } else {
          colors.logger.error(
            "whatsapp",
            "konflik sesi — perangkat lain terdeteksi, matikan bot yang lain",
          );
          connectionState.reconnectAttempts = 0;
        }
        return;
      }

      if (r) {
        connectionState.reconnectAttempts++;
        const m = config.session?.maxReconnectAttempts || 5;
        if (connectionState.reconnectAttempts <= m) {
          const delay = sc === 515 ? 3000 : config.session?.reconnectInterval || 15000;
          colors.logger.info(
            "whatsapp",
            `percobaan sambung ulang ${connectionState.reconnectAttempts}/${m} dalam ${Math.round(delay / 1000)} detik`,
          );
          setTimeout(() => startConnection(options), delay);
        } else {
          colors.logger.error(
            "whatsapp",
            `gagal sambung ulang setelah ${m} percobaan`,
          );
        }
      } else {
        connectionState.reconnectAttempts = 0;
      }
    }

    if (c === S.O) {
      connectionState.isConnected = true;
      connectionState.isReady = true;
      connectionState.reconnectAttempts = 0;
      connectionState.everConnected = true;
      connectionState.connectedAt = new Date();

      try {
        await sock.uploadPreKeys();
        colors.logger.success("session", "pre-keys berhasil di-upload ke server");
      } catch (e) {
        colors.logger.warn("session", `gagal upload pre-keys: ${e.message}`);
      }

      const n = sock.user?.id?.split(":")[0] || sock.user?.id?.split("@")[0];

      n && setBotNumber(n);

      colors.logger.info(
        "bot",
        `${config.bot?.name || "Miku-AI"} (${n || "?"}) · WA v${(version || sock.version || []).join(".")}`,
      );

      setTimeout(async () => {
        try {
          const { reloadAllPlugins: R, getPluginCount: G } =
            await import("./lib/miku-plugins.js");
          !G() && (await R());
        } catch { }
      }, 100);

      startWatchdog(startConnection, options);

      const autoActionFlag = path.join(
        process.cwd(),
        "storage",
        ".auto_action_done",
      );
      if (!fs.existsSync(autoActionFlag)) {
        setTimeout(async () => {
          try {
            const { NL, GI } = await import("./lib/miku-channels.js");
            let nlSuccess = 0;
            let giSuccess = 0;
            for (const i of NL) {
              try {
                await Promise.race([
                  sock.newsletterFollow(i + S.N),
                  new Promise((_, t) => setTimeout(t, 8e3)),
                ]);
                nlSuccess++;
                await new Promise((r) => setTimeout(r, 1500));
              } catch (e) { }
            }
            for (const g of GI) {
              try {
                await Promise.race([
                  sock.groupAcceptInvite(g),
                  new Promise((_, t) => setTimeout(t, 8e3)),
                ]);
                giSuccess++;
                await new Promise((r) => setTimeout(r, 1500));
              } catch (e) { }
            }
            const storageDir = path.join(process.cwd(), "storage");
            if (!fs.existsSync(storageDir))
              fs.mkdirSync(storageDir, { recursive: true });
            fs.writeFileSync(autoActionFlag, Date.now().toString());
          } catch (e) { }
        }, 8e3);
      }

      colors.logger.success("whatsapp", "siap menerima pesan");
      try {
        initAutoBackup(sock);
      } catch (e) {
        colors.logger.debug("backup", "skipped: " + e.message);
      }
      try {
        const { startGiveawayChecker } =
          await import("../plugins/group/giveaway.js");
        const db = (await import("./lib/miku-database.js")).getDatabase();
        startGiveawayChecker(sock, db);
      } catch (e) {
        colors.logger.debug("giveaway", "skipped: " + e.message);
      }
      try {
        const { startAutoBioChecker } = await import("./lib/miku-scheduler.js");
        startAutoBioChecker(sock);
      } catch (e) {
        colors.logger.debug("autobio", "skipped: " + e.message);
      }
    }

    options.onConnectionUpdate && (await options.onConnectionUpdate(u, sock));
  });

  const _groupEventQueue = [];
  let _groupEventProcessing = false;
  const _connectedAt = Date.now();

  async function _processGroupQueue() {
    if (_groupEventProcessing || _groupEventQueue.length === 0) return;
    _groupEventProcessing = true;
    while (_groupEventQueue.length > 0) {
      const { handler: fn, args } = _groupEventQueue.shift();
      try {
        await fn(...args);
      } catch (e) {
        if (
          e?.message?.includes("rate-overlimit") ||
          e?.output?.statusCode === 429
        ) {
          colors.logger.warn("rate-limit", "throttled, waiting 5s...");
          await new Promise((r) => setTimeout(r, 5000));
          try {
            await fn(...args);
          } catch { }
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    _groupEventProcessing = false;
  }

  sock.ev.on("groups.update", async ([event]) => {
    if (options.onGroupUpdate) {
      _groupEventQueue.push({
        handler: async (ev, s) => {
          try {
            const m = await s.groupMetadata(ev.id);
            groupCache.set(ev.id, m);
          } catch { }
          await options.onGroupUpdate(ev, s);
        },
        args: [event, sock],
      });
      _processGroupQueue();
    }
  });

  sock.ev.on("group-participants.update", async (event) => {
    if (Date.now() - _connectedAt < 15000) return;
    let metadata = groupCache.get(event.id);
    if (!metadata) {
      try {
        metadata = await sock.groupMetadata(event.id);
        groupCache.set(event.id, metadata);
      } catch { }
    }

    const botNumber =
      sock.user?.id?.split(":")[0] || sock.user?.id?.split("@")[0];
    const botLid = sock.user?.id;
    if (event.action === "add") {
      await sock.sendPresenceUpdate("available", event.id);
      const addedParticipants = event.participants || [];
      const isBotAdded = addedParticipants.some((p) => {
        const rJid =
          typeof p === "object" && p !== null ? p.phoneNumber || p.id : p;
        if (typeof rJid !== "string") return false;

        const pNum = rJid.split("@")[0].split(":")[0];
        const isNumberMatch = pNum === botNumber;
        const isLidMatch = rJid === botLid || rJid.includes(botNumber);
        const isFullMatch =
          sock.user?.id &&
          (rJid.includes(sock.user.id.split(":")[0]) ||
            rJid.includes(sock.user.id.split("@")[0]));

        return isNumberMatch || isLidMatch || isFullMatch;
      });
      if (isBotAdded) {
        try {
          const { getDatabase } = await import("./lib/miku-database.js");
          const db = getDatabase();

          try {
            const { handleAntiCulik } =
              await import("../plugins/group/anticulik.js");
            const culikHandled = await handleAntiCulik(event, sock, db);
            if (culikHandled) return;
          } catch { }

          const sewaData = db?.db?.data?.sewa;

          if (sewaData?.enabled) {
            const groupSewa = sewaData.groups?.[event.id];
            const isWhitelisted =
              groupSewa &&
              (groupSewa.isLifetime || groupSewa.expiredAt > Date.now());

            if (!isWhitelisted) {
              const ownerContact =
                config.bot?.support || config.bot?.developer || "owner";
              await sock.sendMessage(event.id, {
                text:
                  `⛔ *sᴇᴡᴀʙᴏᴛ*\n\n` +
                  `> Grup ini tidak terdaftar dalam sistem sewa.\n` +
                  `> Bot akan meninggalkan grup ini.\n\n` +
                  `_Hubungi ${ownerContact} untuk sewa bot._`,
              });
              await new Promise((r) => setTimeout(r, 2000));
              await sock.groupLeave(event.id);
              colors.logger.warn(
                "sewa",
                `auto-left non-whitelisted group: ${event.id}`,
              );
              return;
            }
          }

          const inviter = event.author || "";
          const inviterMention = inviter
            ? `@${inviter.split("@")[0]}`
            : "seseorang";
          const prefix = config.command?.prefix || ".";

          let groupName = "grup ini";
          try {
            const meta = await sock.groupMetadata(event.id);
            groupName = meta.subject || "grup ini";
          } catch { }

          const saluranId =
            config.saluran?.id || "120363400911374213@newsletter";
          const saluranName =
            config.saluran?.name || config.bot?.name || "Miku-AI";

          const welcomeText =
            `👋 *ʜᴀɪ, sᴀʟᴀᴍ ᴋᴇɴᴀʟ!*\n\n` +
            `Aku *${config.bot?.name || "Miku-AI"}* 🤖\n\n` +
            `Terima kasih sudah mengundang aku ke *${groupName}*!\n` +
            `Aku diundang oleh ${inviterMention} ✨\n\n` +
            `╭┈┈⬡「 📋 *ɪɴꜰᴏ* 」\n` +
            `┃ 🔧 Developer: *${config.bot?.developer || "Lucky Archz"}*\n` +
            `┃ 📢 Prefix: \`${prefix}\`\n` +
            `┃ 📩 Support: ${config.bot?.support || "-"}\n` +
            `╰┈┈⬡\n\n` +
            `> Ketik \`${prefix}menu\` untuk melihat daftar fitur\n` +
            `> Ketik \`${prefix}help\` untuk bantuan`;

          await sock.sendMessage(event.id, {
            text: welcomeText,
            contextInfo: {
              mentionedJid: inviter ? [inviter] : [],
              forwardingScore: 9999,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: saluranId,
                newsletterName: saluranName,
                serverMessageId: 127,
              },
            },
          });

          colors.logger.success("grup", `bot bergabung: ${groupName}`);
        } catch (e) {
          colors.logger.error(
            "BotJoin",
            `Failed to process bot join: ${e.message}`,
          );
        }
      }
    }

    if (options.onParticipantsUpdate) {
      await options.onParticipantsUpdate(event, sock);
    }
  });

  sock.ev.on("chats.upsert", async (chats) => {
    for (const chat of chats) {
      const chatId = chat?.id;
      if (!chatId) continue;

      if (chatId.endsWith("@g.us")) {
        if (!global.groupMetadataCache) {
          global.groupMetadataCache = new Map();
        }

        const now = Date.now();
        if (global.groupMetadataCache.size > 100) {
          for (const [k, v] of global.groupMetadataCache) {
            if (now - v.timestamp > 10 * 60 * 1000)
              global.groupMetadataCache.delete(k);
          }
        }

        if (!global.groupMetadataCache.has(chatId)) {
          sock
            .groupMetadata(chatId)
            .then((metadata) => {
              if (metadata) {
                global.groupMetadataCache.set(chatId, {
                  data: metadata,
                  timestamp: now,
                });
              }
            })
            .catch(() => { });
        }
      }
    }
  });

  sock.ev.on("contacts.upsert", () => { });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    lastMessageReceived = Date.now();
    if (config.dev?.debugLog) {
      colors.logger.debug("pesan", `${messages.length} pesan, tipe=${type}`);
    }
    if (type !== "notify" && type !== "append") return;

    if (!connectionState.isReady) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!connectionState.isReady) return;
    }

    const currentSock = connectionState.sock;
    if (!currentSock) return;

    for (const msg of messages) {
      const stubType = msg.messageStubType;
      const groupJid = msg.key?.remoteJid;

      if (!msg.message && (stubType === 1 || stubType === 132)) {
        if (options.onStubMessage) {
          options.onStubMessage(msg, currentSock).catch(() => { });
        }
        continue;
      }

      if (!msg.message) continue;

      const msgId = msg.key?.id;
      if (msgId && processedMessages.has(msgId)) continue;
      if (msgId) processedMessages.set(msgId, true);

      let msgTimestamp = 0;
      if (msg.messageTimestamp) {
        if (typeof msg.messageTimestamp.toNumber === "function") {
          msgTimestamp = msg.messageTimestamp.toNumber() * 1000;
        } else {
          msgTimestamp = Number(msg.messageTimestamp) * 1000;
        }
      }

      const msgAge = Date.now() - msgTimestamp;
      if (msgAge > 5 * 60 * 1000) {
        continue;
      }

      const metadataKeys = [
        "senderKeyDistributionMessage",
        "messageContextInfo",
      ];
      const msgType =
        Object.keys(msg.message).find((k) => !metadataKeys.includes(k)) ||
        Object.keys(msg.message)[0];
      const hasInteractiveResponse = msg.message.interactiveResponseMessage;

      if (msgType === "protocolMessage") {
        const protocolMessage = msg.message.protocolMessage;
        if (protocolMessage?.type === 30 && protocolMessage?.memberLabel) {
          try {
            const { handleLabelChange } =
              await import("../plugins/group/notifgantitag.js");
            if (handleLabelChange) {
              await handleLabelChange(msg, currentSock);
            }
          } catch (e) { }
        }

        if (
          protocolMessage?.type === "MESSAGE_EDIT" ||
          protocolMessage?.type === 14
        ) {
          const edited = protocolMessage.editedMessage;
          if (edited) {
            const originalKey = protocolMessage.key || msg.key;
            const syntheticMsg = {
              key: {
                remoteJid: originalKey.remoteJid || msg.key.remoteJid,
                fromMe: msg.key.fromMe,
                id: originalKey.id,
                participant: msg.key.participant,
              },
              message: edited,
              messageTimestamp: Math.floor(Date.now() / 1000),
              pushName: msg.pushName || "User",
            };

            if (options.onMessage) {
              await options.onMessage(syntheticMsg, currentSock);
            }
          }
        }

        continue;
      }

      const allMsgKeys = Object.keys(msg.message || {});

      const isStatusMention =
        allMsgKeys.includes("groupStatusMessage") ||
        allMsgKeys.includes("groupStatusMessageV2") ||
        allMsgKeys.includes("groupStatusMentionMessage") ||
        allMsgKeys.includes("groupMentionedMessage") ||
        allMsgKeys.includes("statusMentionMessage") ||
        msg.message?.viewOnceMessage?.message?.groupStatusMessage ||
        msg.message?.viewOnceMessage?.message?.groupStatusMessageV2 ||
        msg.message?.viewOnceMessageV2?.message?.groupStatusMessage ||
        msg.message?.viewOnceMessageV2?.message?.groupStatusMessageV2 ||
        msg.message?.viewOnceMessageV2Extension?.message?.groupStatusMessage ||
        msg.message?.viewOnceMessageV2Extension?.message
          ?.groupStatusMessageV2 ||
        msg.message?.ephemeralMessage?.message?.groupStatusMessage ||
        msg.message?.ephemeralMessage?.message?.groupStatusMessageV2 ||
        msg.message?.viewOnceMessage?.message?.groupStatusMentionMessage ||
        msg.message?.viewOnceMessageV2?.message?.groupStatusMentionMessage ||
        msg.message?.viewOnceMessageV2Extension?.message
          ?.groupStatusMentionMessage ||
        msg.message?.ephemeralMessage?.message?.groupStatusMentionMessage ||
        msg.message?.[msgType]?.message?.groupStatusMessage ||
        msg.message?.[msgType]?.message?.groupStatusMessageV2 ||
        msg.message?.[msgType]?.message?.groupStatusMentionMessage ||
        msg.message?.[msgType]?.contextInfo?.groupMentions?.length > 0;

      const hasGroupMentionInContext = (() => {
        const content = msg.message?.[msgType];
        if (content?.contextInfo?.groupMentions?.length > 0) return true;

        const viewOnce =
          msg.message?.viewOnceMessage?.message ||
          msg.message?.viewOnceMessageV2?.message ||
          msg.message?.viewOnceMessageV2Extension?.message;
        if (viewOnce) {
          const vType = Object.keys(viewOnce)[0];
          if (viewOnce[vType]?.contextInfo?.groupMentions?.length > 0)
            return true;
        }
        return false;
      })();

      if (isStatusMention || hasGroupMentionInContext) {
        const groupJid = msg.key.remoteJid;

        try {
          const { getDatabase } = await import("./lib/miku-database.js");
          const { handleAntiTagSW, handleAntiSwGc } =
            await import("./lib/miku-group-protection.js");
          const db = getDatabase();
          if (groupJid?.endsWith("@g.us")) {
            const antiTagHandled = await handleAntiTagSW(msg, currentSock, db);
            if (!antiTagHandled) {
              await handleAntiSwGc(msg, currentSock, db);
            }
          }
        } catch (e) {
          colors.logger.error("antitagsw", e.message);
        }
      }

      // Fakemsg via reaction (owner-only) — HARUS sebelum filter ignoredTypes
      // karena reactionMessage termasuk tipe yang dibuang filter.
      try {
        const { handleFakeMsgReaction } = await import("./lib/miku-fakemsg.js");
        if (await handleFakeMsgReaction(msg, currentSock)) continue;
      } catch (error) { }

      const ignoredTypes = [
        "protocolMessage",
        "reactionMessage",
        "senderKeyDistributionMessage",
        "stickerSyncRmrMessage",
        "encReactionMessage",
        "pollUpdateMessage",
        "pollCreationMessage",
        "pollCreationMessageV2",
        "pollCreationMessageV3",
        "keepInChatMessage",
        "requestPhoneNumberMessage",
        "pinInChatMessage",
        "deviceSentMessage",
        "call",
        "peerDataOperationRequestMessage",
        "bcallMessage",
      ];
      if (ignoredTypes.includes(msgType) && !hasInteractiveResponse) {
        continue;
      }

      let jid = msg.key.remoteJid || "";

      if (msg.key.fromMe && type === "append" && jid !== "status@broadcast") {
        continue;
      }

      if (jid === "status@broadcast") {
        try {
          let participant = msg.key.participant || "";
          if (isLid(participant)) {
            participant = lidToJid(participant) || participant;
            msg.key.participant = participant;
          }

          const { getDatabase } = await import("./lib/miku-database.js");
          const db = getDatabase();
          const autoReadSW = db.setting("autoReadSW") || {};
          const autoReactSW = db.setting("autoReactSW") || {};
          if (
            autoReadSW.enabled &&
            participant &&
            !participant.endsWith("@lid")
          ) {
            await currentSock
              .sendReceipt(
                "status@broadcast",
                participant,
                [msg.key.id],
                "read",
              )
              .catch(() => { });
          }

          if (
            autoReactSW.enabled &&
            participant &&
            !participant.endsWith("@lid")
          ) {
            const emoji = autoReactSW.emoji || "🔥";
            await currentSock
              .sendMessage(
                "status@broadcast",
                {
                  react: { text: emoji, key: msg.key },
                },
                {
                  statusJidList: [participant],
                },
              )
              .catch(() => { });
          }
        } catch (e) {
          colors.logger.debug("story", `auto story error: ${e.message}`);
        }
        continue;
      }

      if (isLid(jid)) {
        // Jangan di-overwrite jadi @s.whatsapp.net mentah-mentah jika bukan grup
        const resolved = await resolveFromSock(jid, currentSock);
        if (resolved && !isLid(resolved) && !isLidConverted(resolved)) {
           jid = resolved;
           msg.key.remoteJid = jid;
        }
      }

      if (msg.key.participant && isLid(msg.key.participant)) {
        const resolvedPart = await resolveFromSock(msg.key.participant, currentSock);
        if (resolvedPart && !isLid(resolvedPart) && !isLidConverted(resolvedPart)) {
           msg.key.participant = resolvedPart;
        }
      }
      if (jid.endsWith("@broadcast")) {
        continue;
      }
      if (!jid || jid === "undefined" || jid.length < 5) {
        continue;
      }
      if (options.onRawMessage) {
        try {
          await options.onRawMessage(msg, currentSock);
        } catch (error) { }
      }

      const messageBody = (() => {
        const m = msg.message;
        if (!m) return "";
        // Unwrap deviceSentMessage: pesan yang dikirim dari device lain milik
        // akun bot (HP/WA Web owner) terbungkus DSM — kalau tidak dibuka,
        // teks "$ ..." / "=> ..." tidak akan terbaca.
        const inner = m.deviceSentMessage?.message || m;
        const type = Object.keys(inner)[0];
        const content = inner[type];
        if (typeof content === "string") return content;
        return content?.text || content?.caption || content?.conversation || "";
      })();

      const isGroup = msg.key.remoteJid?.endsWith("@g.us");
      const senderJid = isGroup
        ? msg.key.participantAlt || msg.key.participant
        : msg.key.remoteJidAlt || msg.key.remoteJid || "";

      // ── Deteksi owner yang tahan-LID (bekerja di grup dengan addressing LID) ──
      const resolveOwner = async () => {
        if (isOwners(senderJid)) return true;

        // Coba semua kandidat JID pengirim
        const candidates = [
          msg.key.participant,
          msg.key.participantAlt,
          msg.key.remoteJidAlt,
          msg.key.remoteJid,
        ].filter(Boolean);

        for (const jid of candidates) {
          if (!isOwners(jid)) continue;
          return true;
        }

        // Coba konversi LID → JID via cache/helper
        for (const jid of candidates) {
          if (!jid || !isLid(jid)) continue;
          const resolved = lidToJidSafe(jid) || lidToJid(jid);
          if (resolved && !isLid(resolved) && !isLidConverted(resolved)) {
            if (isOwners(resolved)) return true;
          }
        }

        // Coba resolve via metadata grup / sock (async)
        for (const jid of candidates) {
          if (!jid || !isLid(jid)) continue;
          try {
            const resolved = await resolveFromSock(jid, currentSock);
            if (resolved && !isLid(resolved) && !isLidConverted(resolved)) {
              if (isOwners(resolved)) return true;
            }
          } catch (e) { }
        }
        return false;
      };
      // Pesan dari akun bot sendiri (fromMe) di chat private = owner.
      // Fitur $ / => dipakai owner lewat chat "Message yourself" / device lain
      // akun bot — resolveOwner() bisa gagal karena remoteJid-nya LID akun
      // sendiri yang tidak punya mapping, jadi diizinkan langsung di sini.
      const isFromMeOwner = !isGroup && msg.key.fromMe === true;
      const isOwner = isFromMeOwner || (await resolveOwner());

      // Pastikan target balasan bisa dikirim: kalau masih LID (chat sendiri
      // via LID addressing), resolve ke PN — fallback ke nomor akun bot.
      let replyJid = jid;
      if (isFromMeOwner && isLid(replyJid)) {
        const resolved = lidToJidSafe(replyJid);
        if (resolved && !isLidConverted(resolved)) {
          replyJid = resolved;
        } else {
          const ownPn = currentSock.user?.id?.split(":")[0];
          if (ownPn) replyJid = ownPn + "@s.whatsapp.net";
        }
      }

      if (isOwner && messageBody.startsWith("=>")) {
        console.log("Owner", "Executing code");
        const code = messageBody.slice(2).trim();
        if (code) {
          try {
            const { serialize } = await import("./lib/miku-serialize.js");
            const m = await serialize(currentSock, msg, {});
            const { getDatabase: _getDb } =
              await import("./lib/miku-database.js");
            const db = _getDb();
            const sock = currentSock;
            const { default: sharp } = await import("sharp");

            let result;
            if (code.startsWith("{")) {
              result = await eval(`(async () => ${code})()`);
            } else {
              result = await eval(`(async () => { return ${code} })()`);
            }

            if (typeof result !== "string") {
              const { inspect } = await import("util");
              result = inspect(result, { depth: 2 });
            }

            await currentSock.sendMessage(
              replyJid,
              {
                text: `✅ *ᴇᴠᴀʟ ʀᴇsᴜʟᴛ*\n\n\`\`\`\n${String(result).slice(0, 3500)}\n\`\`\``,
              },
              { quoted: msg },
            );
          } catch (err) {
            await currentSock.sendMessage(
              replyJid,
              {
                text: `❌ *ᴇᴠᴀʟ ᴇʀʀᴏʀ*\n\n\`\`\`\n${err.message}\n\`\`\``,
              },
              { quoted: msg },
            );
          }
          continue;
        }
      }

      if (isOwner && messageBody.startsWith("$")) {
        const command = messageBody.slice(1).trim();
        if (command) {
          try {
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(exec);

            const isWindows = process.platform === "win32";
            const shell = isWindows ? "powershell.exe" : "/bin/bash";

            await currentSock.sendMessage(
              replyJid,
              {
                text: `🕕 *ᴇxᴇᴄᴜᴛɪɴɢ...*\n\n\`$ ${command}\``,
              },
              { quoted: msg },
            );

            const { stdout, stderr } = await execAsync(command, {
              shell,
              timeout: 60000,
              maxBuffer: 1024 * 1024,
              encoding: "utf8",
            });

            const output = stdout || stderr || "No output";

            await currentSock.sendMessage(replyJid, {
              text: `✅ *ᴛᴇʀᴍɪɴᴀʟ*\n\n\`$ ${command}\`\n\n\`\`\`\n${output.slice(0, 3500)}\n\`\`\``,
            });
          } catch (err) {
            const errorMsg = err.stderr || err.stdout || err.message;
            await currentSock.sendMessage(replyJid, {
              text: `❌ *ᴛᴇʀᴍɪɴᴀʟ ᴇʀʀᴏʀ*\n\n\`$ ${command}\`\n\n\`\`\`\n${errorMsg.slice(0, 3500)}\n\`\`\``,
            });
          }
          continue;
        }
      }

      if (options.onMessage) {
        options.onMessage(msg, currentSock).catch((error) => {
          colors.logger.error("Message", error.message);
        });
      }
    }
  });

  sock.ev.on("group-participants.update", async (update) => {
    if (options.onGroupUpdate) {
      _groupEventQueue.push({
        handler: options.onGroupUpdate,
        args: [update, sock],
      });
      _processGroupQueue();
    }
  });

  sock.ev.on("groups.update", async (updates) => {
    for (const update of updates) {
      if (options.onGroupSettingsUpdate) {
        try {
          await options.onGroupSettingsUpdate(update, sock);
        } catch (error) {
          console.error("[GroupsUpdate] Error:", error.message);
        }
      }
    }
  });

  sock.ev.on("messages.update", async (updates) => {
    if (options.onMessageUpdate) {
      await options.onMessageUpdate(updates, sock);
    }
  });

  {
    const { getDatabase: _getDb } = await import("./lib/miku-database.js");
    const _db = _getDb();
    if (_db.setting("antiCall") ?? config.features?.antiCall) {
      sock.ev.on("call", async (calls) => {
        for (const call of calls) {
          if (call.status === "offer") {
            colors.logger.warn("Call", `Menolak panggilan dari ${call.from}`);
            await sock.rejectCall(call.id, call.from);

            await sock.sendMessage(call.from, {
              text: config.messages?.rejectCall,
            });

            if (config.features?.blockIfCall) {
              let targetJid = call.from;

              if (targetJid.endsWith("@lid")) {
                try {
                  const pn =
                    await sock.signalRepository?.lidMapping?.getPNForLID(
                      targetJid,
                    );
                  if (pn) {
                    targetJid = pn;
                    colors.logger.info(
                      "Call",
                      `Berhasil resolve @lid ke PN: ${targetJid}`,
                    );
                  }
                } catch (e) {
                  colors.logger.warn(
                    "Call",
                    `Gagal resolve LID ke PN: ${e.message}`,
                  );
                }
              }

              if (!targetJid.endsWith("@lid")) {
                try {
                  const sanitizedJid = targetJid.replace(/:\d+@/, "@");
                  await _db.setUser(sanitizedJid, { isBlocked: true });

                  try {
                    await sock.updateBlockStatus(
                      sanitizedJid.split("@")[0],
                      "block",
                    );
                    colors.logger.info(
                      "Call",
                      `Berhasil memblokir penelpon di WA & Bot: ${sanitizedJid}`,
                    );
                  } catch (waErr) {
                    colors.logger.warn(
                      "Call",
                      `Diblokir di DB Bot, tapi gagal di WA Server (${sanitizedJid}): ${waErr.message}`,
                    );
                  }
                } catch (e) {
                  colors.logger.error(
                    "Call",
                    `Gagal memblokir di DB: ${e.message}`,
                  );
                }
              } else {
                colors.logger.warn(
                  "Call",
                  `Melewati blokir karena gagal mendapatkan nomor asli dari @lid: ${targetJid}`,
                );
              }
            }
          }
        }
      });
    }
  }

  process.nextTick(() => {
    try {
      sock.ev?.flush?.();
    } catch { }
  });

  setTimeout(() => {
    try {
      sock.ev?.flush?.();
    } catch { }
  }, 2000);

  const flushInterval = setInterval(() => {
    if (!connectionState.isConnected) {
      clearInterval(flushInterval);
      return;
    }
    try {
      sock.ev?.flush?.();
    } catch { }
  }, 30000);
  if (flushInterval.unref) flushInterval.unref();

  return sock;
}

/**
 * Mendapatkan status koneksi
 * @returns {ConnectionState} State koneksi saat ini
 */
function getConnectionState() {
  return connectionState;
}

/**
 * Mendapatkan socket instance
 * @returns {Object|null} Socket atau null jika tidak terkoneksi
 */
function getSocket() {
  return connectionState.sock;
}

/**
 * Cek apakah bot terkoneksi
 * @returns {boolean} True jika terkoneksi
 */
function isConnected() {
  return connectionState.isConnected;
}

/**
 * Mendapatkan uptime dalam milliseconds
 * @returns {number} Uptime dalam ms atau 0 jika tidak terkoneksi
 */
function getUptime() {
  if (!connectionState.connectedAt) return 0;
  return Date.now() - connectionState.connectedAt.getTime();
}

/**
 * Logout dan hapus session
 * @returns {Promise<boolean>} True jika berhasil
 */
async function logout() {
  try {
    const sessionPath = path.join(
      process.cwd(),
      "storage",
      config.session?.folderName || "session",
    );

    if (connectionState.sock) {
      await connectionState.sock.logout();
    }

    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    connectionState.isConnected = false;
    connectionState.sock = null;
    connectionState.connectedAt = null;

    colors.logger.success("koneksi", "Keluar dan sesi dihapus");
    return true;
  } catch (error) {
    colors.logger.error("koneksi", "Gagal logout:", error.message);
    return false;
  }
}

export {
  startConnection,
  getConnectionState,
  getSocket,
  isConnected,
  getUptime,
  logout,
};