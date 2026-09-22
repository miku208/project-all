// plugins/user/jadibot.js — Command .jadibot (akses WhatsApp ke backend PHASE 1)
// User bisa kelola Jadibot, top up, kirim bukti, beli langganan — semua via WA.
// Bukti transfer juga tetap bisa dikirim sebagai foto polos (tanpa caption)
// via topupProofAnswerHandler di plugins/user/topup.js.

import config from "../../config.js";
import {
  register,
  login,
  getUserById,
  sanitizeUser,
} from "../../src/jadibot/auth.js";
import { trialInfo, validateBotAccess } from "../../src/jadibot/trial.js";
import {
  subscriptionInfo,
  purchaseSubscription,
} from "../../src/jadibot/subscription.js";
import {
  createTopup,
  saveProof,
  readProof,
  getUserTopups,
  cancelTopup,
  getTopup,
  formatTopup,
} from "../../src/jadibot/topup.js";
import {
  createBot,
  getUserBots,
  getBotSafe,
  getPairingInfo,
  refreshPairing,
  getBotLogs,
  startBot,
  stopBot,
  restartBot,
  deleteBot,
  assertBotOwnership,
} from "../../src/jadibot/engine.js";
import { getSetting } from "../../src/jadibot/settings.js";
import { rupiah, fmtDate } from "../../src/jadibot/store.js";

const pluginConfig = {
  name: "jadibot",
  alias: ["jadibot", "jadbot", "jadibotreg", "jadibotlogin", "jadibotlogout"],
  category: "user",
  description: "Kelola akun Jadibot: daftar, login, bot, top up, langganan",
  usage:
    ".jadibot | .jadibot daftar <user> <pass> | .jadibot login <user> <pass> | " +
    ".jadibot bot <nomor> | .jadibot pairing <botId> | .jadibot start|stop|restart|hapus <botId> | " +
    ".jadibot bukti <topupId> (reply foto) | .jadibot topup <nominal> | .jadibot beli | .jadibot status",
  example: ".jadibot",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
};

/* ==================== SESSION PER-SENDER (in-memory) ==================== */
// WA tidak punya "Authorization header" — session token per pengirim disimpan
// di memori; hilang saat bot restart (user login ulang). Token backend asli
// tetap dipakai untuk memanggil fungsi backend.

const sessions = new Map(); // waJid → { userId, token }
const j = (jid) => String(jid || "").split("@")[0].split(":")[0];

function getSession(sender) {
  const s = sessions.get(j(sender));
  if (!s) return null;
  const user = getUserById(s.userId);
  if (!user || user.account_status !== "active") {
    sessions.delete(j(sender));
    return null;
  }
  return { user, userId: s.userId };
}

/* ==================== HELPERS ==================== */

const box = (title) => `╭┈┈⬡「 ${title} 」\n`;
const close = () => `╰┈┈⬡`;

function botLine(b) {
  return (
    `┃ 🆔 \`${b.id}\`\n` +
    `┃ 📱 +${b.phone_number} | ${b.status === "online" ? "🟢" : b.status === "expired" ? "⏰" : "⚪"} *${b.status}*\n`
  );
}

function requireSession(m) {
  const s = getSession(m.sender);
  if (!s) {
    m.reply(
      `🔐 *Belum login akun Jadibot*\n\n` +
        `• Daftar: \`${m.prefix}jadibot daftar <username> <password>\`\n` +
        `• Login:  \`${m.prefix}jadibot login <username> <password>\``,
    );
    return null;
  }
  return s;
}

function ownedBot(m, botId, s) {
  const bot = getBotSafe(botId);
  if (!bot) {
    m.reply(`❌ Bot \`${botId}\` tidak ditemukan.`);
    return null;
  }
  // §43 — via WA: user hanya boleh bot miliknya sendiri
  const check = assertBotOwnership(
    require0StoreBots(botId),
    { id: s.userId, role: "user" },
    { adminBypass: false },
  );
  if (check.error) {
    m.reply(
      check.error === "BOT_NOT_OWNER"
        ? `⛔ Bot \`${botId}\` bukan milik akunmu!`
        : `❌ ${check.message}`,
    );
    return null;
  }
  return bot;
}

// helper kecil: ambil raw bot record (untuk ownership check)
import storeRaw from "../../src/jadibot/store.js";
function require0StoreBots(botId) {
  return storeRaw.bots.data[botId] || null;
}

/* ==================== SUB-HANDLERS ==================== */

async function cmdMenu(m) {
  const s = getSession(m.sender);
  const min = rupiah(getSetting("minTopup"));
  const price = rupiah(getSetting("subscriptionPrice"));
  const days = getSetting("subscriptionDurationDays");
  const hours = getSetting("trialDurationHours");

  let text =
    `🤖 *MIKU JADIBOT*\n\n` +
    `💎 Langganan: *${price}/${days} hari*\n` +
    `⏱️ Trial: *${hours} jam* (sekali, otomatis saat buat bot pertama)\n` +
    `💳 Min. top up: *${min}*\n\n`;

  if (!s) {
    text +=
      `📌 *Mulai di sini:*\n` +
      `• \`${m.prefix}jadibot daftar <user> <pass>\` — buat akun\n` +
      `• \`${m.prefix}jadibot login <user> <pass>\` — masuk\n\n`;
  } else {
    const u = s.user;
    text +=
      `👤 *${u.username}* | Balance: *${rupiah(u.balance)}*\n` +
      `⏱️ Trial: ${u.trial_used ? (trialInfo(u).active ? `aktif (${Math.ceil(trialInfo(u).remaining_ms / 60000)}m)` : "habis") : "belum dipakai"}\n` +
      `💎 Langganan: ${subscriptionInfo(u).status}\n\n`;
  }

  text +=
    `📌 *Perintah:*\n` +
    `• \`${m.prefix}jadbot <nomorWA>\` — buat Jadibot + pairing otomatis 💎\n` +
    `• \`${m.prefix}jadibot pairing <botId>\` — kode pairing\n` +
    `• \`${m.prefix}jadibot start|stop|restart <botId>\`\n` +
    `• \`${m.prefix}jadibot hapus <botId>\`\n` +
    `• \`${m.prefix}jadibot log <botId>\`\n` +
    `• \`${m.prefix}jadibot topup <nominal>\` — buat top up\n` +
    `• \`${m.prefix}jadibot bukti <topupId>\` — reply dengan FOTO bukti\n` +
    `• \`${m.prefix}jadibot status\` — riwayat & status\n` +
    `• \`${m.prefix}jadibot beli\` — beli langganan (dari balance)\n` +
    `• \`${m.prefix}jadibot logout\``;

  await m.reply(text);
}

async function cmdRegister(m, args) {
  if (sessions.has(j(m.sender))) {
    return m.reply(`⚠️ Kamu sudah login sebagai *${getSession(m.sender).user.username}*.`);
  }
  if (args.length < 2) {
    return m.reply(`📝 Contoh: \`${m.prefix}jadibot daftar miku password123\``);
  }
  const [username, password] = args;
  const r = register({ username, password });
  if (r.error) return m.reply(`❌ ${r.message}`);

  sessions.set(j(m.sender), { userId: r.user.id });
  await m.reply(
    `✅ *Akun Jadibot dibuat!*\n\n` +
      box("📋 *AKUN*") +
      `┃ 👤 Username: *${r.user.username}*\n` +
      `┃ 🆔 ID: \`${r.user.id}\`\n` +
      `┃ 💰 Balance: ${rupiah(0)}\n` +
      `${close()}\n\n` +
      `⏱️ Trial *${getSetting("trialDurationHours")} jam* otomatis dimulai saat kamu buat bot pertama:\n` +
      `\`${m.prefix}jadibot bot <nomorWA>\``,
  );
}

async function cmdLogin(m, args) {
  if (args.length < 2) {
    return m.reply(`📝 Contoh: \`${m.prefix}jadibot login miku password123\``);
  }
  const [username, password] = args;
  const r = login({ username, password });
  if (r.error) return m.reply(`❌ ${r.message}`);

  sessions.set(j(m.sender), { userId: r.user.id });
  const u = r.user;
  await m.reply(
    `✅ *Login berhasil!*\n\n` +
      `👤 *${u.username}* | Balance: *${rupiah(u.balance)}*\n` +
      `💎 Langganan: ${subscriptionInfo(u).status}\n\n` +
      `Ketik \`${m.prefix}jadibot\` untuk menu lengkap.`,
  );
}

async function cmdLogout(m) {
  if (sessions.delete(j(m.sender))) return m.reply(`👋 Logout berhasil.`);
  m.reply(`⚠️ Kamu memang belum login.`);
}

/* ==================== BUTTON HELPER ==================== */

/** Kirim pesan dengan tombol quick_reply; fallback ke text biasa jika gagal */
async function sendButtons(m, sock, text, buttons) {
  try {
    await sock.sendMessage(
      m.chat,
      {
        text,
        footer: `🤖 ${config.bot?.name || "Miku Jadibot"}`,
        interactiveButtons: buttons,
      },
      { quoted: m },
    );
  } catch {
    await m.reply(text);
  }
}

async function cmdCreateBot(m, args, sock) {
  const s = requireSession(m);
  if (!s) return;

  // 🔒 KHUSUS PREMIUM & OWNER (isPremium sudah include owner)
  if (!config.isPremium(m.sender)) {
    return m.reply(
      `💎 *Jadibot khusus Premium & Owner!*

` +
        `Jadi premium dengan top up balance lalu beli langganan:
` +
        `• \`${m.prefix}jadibot topup <nominal>\`
` +
        `• \`${m.prefix}jadibot beli\``,
    );
  }

  const phone = String(args[0] || "").replace(/[^0-9]/g, "");
  if (!phone) {
    return m.reply(
      `📝 Contoh: \`${m.prefix}jadbot 6281234567890\`\n\n` +
        `⚠️ Gunakan nomor WhatsApp yang akan jadi bot (bukan nomor bot utama).`,
    );
  }

  // 🚫 Cegah pairing nomor bot utama sendiri (live check via sock)
  const mainLive = String(
    sock?.user?.id || config.session?.pairingNumber || "",
  ).split(":")[0].split("@")[0].replace(/[^0-9]/g, "");
  if (phone === mainLive) {
    return m.reply(
      `🚫 *Nomor bot utama tidak bisa jadi Jadibot!*
\n` +
        `Nomor \`+${phone}\` adalah nomor bot ini sendiri.\n` +
        `2 instance pada 1 akun WA membuat pesan gagal didekripsi ("Menunggu pesan ini").\n\n` +
        `✅ Gunakan **nomor WhatsApp lain** (HP kedua/opsen) untuk Jadibot.`,
    );
  }

  await m.reply(`🔄 *Membuat Jadibot +${phone}...*`);
  const r = createBot(s.user, phone, { notifyJid: m.sender });
  if (r.error) {
    return m.reply(`❌ *${r.error}*\n${r.message}`);
  }
  const u = storeRaw.users.data[s.userId];
  const sisa = u.trial_expires_at ? Math.ceil((u.trial_expires_at - Date.now()) / 60000) : 0;

  // ⏳ Tunggu kode pairing siap (maks ~16 detik), lalu kirim OTOMATIS
  let code = null;
  for (let i = 0; i < 8; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const info = getPairingInfo(r.bot.id);
    if (info?.pairing_code) {
      code = info.pairing_code;
      break;
    }
  }

  if (code) {
    return m.reply(
      `✅ *Jadibot dibuat & siap dipairing!*\n\n` +
        box("🔑 *KODE PAIRING*") +
        `┃\n┃   *${code}*\n┃\n${close()}\n\n` +
        `📱 Buka WhatsApp di HP *+${phone}*:\n` +
        `Settings → Linked Devices → Link a Device → masukkan kode di atas.\n\n` +
        `⏱️ Trial: *${sisa} menit* | 🆔 \`${r.bot.id}\`\n` +
        `⏰ Kode berlaku ±1 menit — segera masukkan!\n` +
        `Reminder otomatis akan dikirim sebelum kode kadaluarsa.`,
    );
  }

  // Kode belum keluar → tombol cek ulang
  await sendButtons(
    m,
    sock,
    `✅ *Jadibot dibuat!* 🆔 \`${r.bot.id}\` | ⏱️ Trial *${sisa} menit*\n\n` +
      `⏳ Kode pairing belum keluar, klik tombol di bawah:`,
    [
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "🔄 Cek Kode Pairing",
          id: `${m.prefix}jadibot pairing ${r.bot.id}`,
        }),
      },
    ],
  );
}

async function cmdPairing(m, args, sock) {
  const s = requireSession(m);
  if (!s) return;
  const bot = ownedBot(m, args[0], s);
  if (!bot) return;

  // Minta kode (pakai yang masih fresh, atau minta baru otomatis)
  const r = refreshPairing(bot.id);
  if (r.error) {
    return m.reply(`❌ *${r.error}*\n${r.message}`);
  }

  if (!r.fresh && r.pairing?.pairing_code) {
    const info = r.pairing;
    const sisa = info.pairing_code_expires_at
      ? Math.max(1, Math.ceil((info.pairing_code_expires_at - Date.now()) / 1000))
      : null;
    return m.reply(
      `🔑 *Pairing ${bot.phone_number}*\n\n` +
        box("🔑 *KODE PAIRING*") +
        `┃\n┃   *${info.pairing_code}*\n┃\n${close()}\n\n` +
        `📱 Buka WhatsApp di HP tujuan:\n` +
        `Settings → Linked Devices → Link a Device → masukkan kode di atas.\n\n` +
        (sisa ? `⏳ Berlaku ±${sisa} detik lagi — segera masukkan!\n` : ``) +
        `Reminder otomatis dikirim sebelum kadaluarsa.`,
    );
  }

  // Kode baru sedang dibuat → tombol cek ulang
  await sendButtons(
    m,
    sock,
    `🔄 *Kode pairing baru sedang dibuat...*\n\n` +
      `Bot \`${bot.id}\` (+${bot.phone_number})\n` +
      `Tunggu ±5 detik lalu klik tombol di bawah:`,
    [
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "🔑 Ambil Kode Baru",
          id: `${m.prefix}jadibot pairing ${bot.id}`,
        }),
      },
    ],
  );
}

async function cmdBotAction(m, args, action) {
  const s = requireSession(m);
  if (!s) return;
  const botId = args[0];
  if (!botId) return m.reply(`📝 Contoh: \`${m.prefix}jadibot ${action} <botId>\``);
  const bot = ownedBot(m, botId, s);
  if (!bot) return;

  if (action === "hapus") {
    const r = deleteBot(botId);
    if (r.error) return m.reply(`❌ ${r.message}`);
    return m.reply(`🗑️ Bot \`${botId}\` dihapus (termasuk sesi auth-nya).`);
  }

  if (action === "start") {
    const u = storeRaw.users.data[s.userId];
    const access = validateBotAccess(u, { forControl: true });
    if (!access.allowed) return m.reply(`⛔ *${access.code}*\n${access.message}`);
    startBot(storeRaw.bots.data[botId]);
    return m.reply(`▶️ Bot \`${botId}\` di-start. Cek: \`${m.prefix}jadibot status\``);
  }
  if (action === "stop") {
    stopBot(botId);
    return m.reply(`⏹️ Bot \`${botId}\` di-stop. Sesi auth tetap aman.`);
  }
  if (action === "restart") {
    const u = storeRaw.users.data[s.userId];
    const access = validateBotAccess(u, { forControl: true });
    if (!access.allowed) return m.reply(`⛔ *${access.code}*\n${access.message}`);
    restartBot(botId);
    return m.reply(`🔄 Bot \`${botId}\` di-restart.`);
  }
}

async function cmdBotLog(m, args) {
  const s = requireSession(m);
  if (!s) return;
  const bot = ownedBot(m, args[0], s);
  if (!bot) return;
  const logs = getBotLogs(bot.id, 15);
  if (!logs.length) return m.reply(`📋 Belum ada log.`);
  const text =
    logs
      .reverse()
      .map((l) => `${new Date(l.ts).toLocaleTimeString("id-ID")} — ${l.msg}`)
      .join("\n") || "-";
  m.reply(box(`📋 *LOG ${bot.id}*`) + text.split("\n").map((l) => `┃ ${l}`).join("\n") + `\n${close()}`);
}

async function cmdStatus(m) {
  const s = requireSession(m);
  if (!s) return;
  const u = storeRaw.users.data[s.userId];
  const bots = getUserBots(s.userId);
  const topups = getUserTopups(s.userId).slice(0, 5);

  let text =
    box("👤 *AKUN*") +
    `┃ 👤 ${u.username} (${u.id})\n` +
    `┃ 💰 Balance: *${rupiah(u.balance)}*\n` +
    `┃ ⏱️ Trial: ${u.trial_used ? (trialInfo(u).active ? `aktif ${Math.ceil(trialInfo(u).remaining_ms / 60000)}m` : "habis") : "belum dipakai"}\n` +
    `┃ 💎 Subs: ${subscriptionInfo(u).status}${subscriptionInfo(u).expires_at ? ` (s/d ${fmtDate(subscriptionInfo(u).expires_at)})` : ""}\n` +
    `${close()}\n\n` +
    box("🤖 *JADIBOT*");
  text += bots.length ? bots.map(botLine).join("") : `┃ (belum ada — \`${m.prefix}jadibot bot <nomor>\`)\n`;
  text += `${close()}\n\n` + box("💳 *TOP UP TERAKHIR*");
  text += topups.length
    ? topups
        .map(
          (t) =>
            `┃ ${t.status === "approved" ? "✅" : t.status === "rejected" ? "❌" : t.status === "cancelled" ? "🚫" : "⏳"} \`${t.id}\` ${t.amount_label} (${t.status})\n`,
        )
        .join("")
    : `┃ (belum ada)\n`;
  text += close();

  await m.reply(text);
}

async function cmdTopup(m, args, sock) {
  const s = requireSession(m);
  if (!s) return;
  const raw = (args.join("") || "").trim();
  if (!raw) {
    return m.reply(
      `💳 *Top Up Balance*\n\nContoh: \`${m.prefix}jadibot topup 10000\`\nMin: ${rupiah(getSetting("minTopup"))}`,
    );
  }
  const nominal = parseInt(raw.replace(/[^\d]/g, ""));
  const r = createTopup(s.userId, nominal);
  if (r.error) return m.reply(`❌ *${r.error}*\n${r.message}`);

  const t = r.topup;
  let text =
    `✅ *Top Up Request Dibuat!*\n\n` +
    box("💳 *DETAIL*") +
    `┃ 🆔 Topup ID: \`${t.id}\`\n` +
    `┃ 💰 Nominal: *${t.amount_label || rupiah(t.amount)}*\n` +
    `┃ 📌 Status: PENDING\n` +
    `${close()}\n\n` +
    `📸 *QRIS:* ${r.qris ? "(lihat gambar)" : "belum diatur admin — hubungi owner"}\n\n` +
    `2️⃣ Transfer sesuai nominal\n` +
    `3️⃣ Kirim bukti: *kirim foto bukti transfer ke chat ini* (boleh reply foto dengan caption \`${m.prefix}jadibot bukti ${t.id}\`)\n` +
    `4️⃣ Owner otomatis dinotifikasi → review → balance masuk`;

  // Kirim QRIS sebagai gambar jika ada
  const { getQrisFilePath } = await import("../../src/jadibot/qris.js");
  const qrisPath = getQrisFilePath();
  if (qrisPath && sock) {
    try {
      await sock.sendMessage(m.chat, { image: { url: qrisPath }, caption: text }, { quoted: m });
      return;
    } catch {}
  }
  await m.reply(text);
}

async function cmdBukti(m, args) {
  const s = requireSession(m);
  if (!s) return;
  const topupId = args[0];
  if (!topupId) return m.reply(`📝 Reply foto bukti dengan: \`${m.prefix}jadibot bukti <topupId>\``);

  const topup = getTopup(topupId);
  if (!topup || topup.user_id !== s.userId) {
    return m.reply(`❌ Top up \`${topupId}\` tidak ditemukan / bukan milikmu.`);
  }
  if (topup.status !== "pending") {
    return m.reply(`⚠️ Top up \`${topupId}\` sudah diproses (status: *${topup.status}*).`);
  }

  const media = m.isImage ? m : m.quoted?.isImage ? m.quoted : null;
  if (!media) {
    return m.reply(
      `📎 *Kirim/reply FOTO bukti transfer.*\n\nCara: kirim foto bukti lalu reply foto itu dengan caption:\n\`${m.prefix}jadibot bukti ${topupId}\``,
    );
  }

  await m.react("🕕");
  let buffer;
  try {
    buffer = await media.download();
  } catch (e) {
    return m.reply(`❌ Gagal mengunduh gambar: ${e.message}`);
  }
  const r = saveProof(s.userId, topupId, buffer);
  if (r.error) return m.reply(`❌ *${r.error}*\n${r.message}`);

  await m.react("✅");
  await m.reply(
    `✅ *Bukti transfer diterima!*\n\n` +
      `🆔 Topup ID: \`${topupId}\`\n` +
      `💰 Nominal: ${rupiah(topup.amount)}\n` +
      `📌 Status: *PENDING — menunggu review*\n\n` +
      `🔔 Owner sudah dinotifikasi otomatis via WhatsApp.`,
  );
}

async function cmdBeli(m) {
  const s = requireSession(m);
  if (!s) return;
  const r = purchaseSubscription(s.userId);
  if (r.error) {
    return m.reply(
      `❌ *${r.error}*\n${r.message}\n\n` +
        `Top up dulu: \`${m.prefix}jadibot topup <nominal>\``,
    );
  }
  const u = storeRaw.users.data[s.userId];
  await m.reply(
    `💎 *Langganan Aktif!*\n\n` +
      box("📋 *DETAIL*") +
      `┃ 💰 Harga: ${rupiah(r.subscription.price)}\n` +
      `┃ 📅 Durasi: ${r.subscription.duration_days} hari\n` +
      `┃ ⏰ Aktif sampai: *${fmtDate(r.subscription.expires_at)}*\n` +
      `┃ 💼 Sisa balance: *${rupiah(u.balance)}*\n` +
      `${close()}\n\n` +
      (r.subscription.renewed ? `🔁 Perpanjangan: +30 hari dari expiry lama.\n` : `🎉 Bot kamu bisa langsung di-start!\n`) +
      `\`${m.prefix}jadibot start <botId>\``,
  );
}

/* ==================== HANDLER UTAMA ==================== */

async function handler(m, context) {
  const sock = context?.sock;
  const args = (m.args || []).slice(); // args[0] = subcommand (karena command = "jadibot")

  // .jadbot <nomor> — shortcut: buat bot + pairing otomatis (premium/owner)
  if (m.command === "jadbot") return await cmdCreateBot(m, args, sock);

  // alias langsung (.jadibotreg / .jadibotlogin)
  if (m.command === "jadibotreg") return await cmdRegister(m, args);
  if (m.command === "jadibotlogin") return await cmdLogin(m, args);

  const sub = (args.shift() || "").toLowerCase();

  switch (sub) {
    case "daftar":
    case "register":
      return await cmdRegister(m, args);
    case "login":
    case "masuk":
      return await cmdLogin(m, args);
    case "logout":
      return await cmdLogout(m);
    case "bot":
    case "buat":
      return await cmdCreateBot(m, args, sock);
    case "pairing":
    case "pair":
      return await cmdPairing(m, args, sock);
    case "start":
    case "stop":
    case "restart":
    case "hapus":
    case "delete":
      return await cmdBotAction(m, args, sub === "delete" ? "hapus" : sub);
    case "log":
    case "logs":
      return await cmdBotLog(m, args);
    case "topup":
    case "deposit":
      return await cmdTopup(m, args, sock);
    case "bukti":
    case "proof":
      return await cmdBukti(m, args);
    case "beli":
    case "belisubs":
    case "subscribe":
      return await cmdBeli(m);
    case "status":
    case "saldo":
    case "info":
      return await cmdStatus(m);
    default:
      return await cmdMenu(m);
  }
}

export { pluginConfig as config, handler };
