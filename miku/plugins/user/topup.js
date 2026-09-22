import config from "../../config.js";
import { getDatabase } from "../../src/lib/miku-database.js";
import {
  topupManager,
  notifyOwnerPayment,
  parseNominal,
  rupiah,
  fmtDate,
} from "../../src/lib/miku-topup.js";

const pluginConfig = {
  name: "topup",
  alias: ["topup", "topupstatus", "topupbatal"],
  category: "user",
  description: "Buat permintaan top up saldo & kirim bukti transfer ke owner",
  usage: ".topup <nominal>",
  example: ".topup 10000",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
};

const STATUS_ICON = {
  PENDING: "⏳",
  APPROVED: "✅",
  REJECTED: "❌",
  CANCELLED: "🚫",
};

/* ==================== INFO PAYMENT (dari config.js) ==================== */

function buildPaymentInfo(prefix) {
  const pay = config.payment || {};
  const methods = (pay.methods || []).filter((m) => m.number);
  const banks = (pay.banks || []).filter((b) => b.number);

  let text = "";
  if (methods.length) {
    text += `\n📱 *E-Wallet:*\n`;
    for (const m of methods) {
      text += `• *${m.name}* → \`${m.number}\`${m.holder ? ` (a/n ${m.holder})` : ""}\n`;
    }
  }
  if (banks.length) {
    text += `\n🏦 *Bank Transfer:*\n`;
    for (const b of banks) {
      text += `• *${b.name}* → \`${b.number}\`${b.holder ? ` (a/n ${b.holder})` : ""}\n`;
    }
  }
  if (pay.qrisUrl) text += `\n📸 *QRIS:* tersedia (lihat gambar)\n`;

  text +=
    `\n📌 *Cara top up:*\n` +
    `1️⃣ Ketik \`${prefix}topup <nominal>\` — contoh: \`${prefix}topup 10000\`\n` +
    `2️⃣ Transfer sesuai nominal di atas\n` +
    `3️⃣ Kirim *foto bukti transfer* ke chat pribadi bot ini\n` +
    `4️⃣ Owner otomatis dinotifikasi & akan review request kamu`;
  return text;
}

async function sendPaymentInfo(m, sock, prefix, header) {
  const pay = config.payment || {};
  const text = header + buildPaymentInfo(prefix);
  if (pay.qrisUrl) {
    try {
      await sock.sendMessage(
        m.chat,
        { image: { url: pay.qrisUrl }, caption: text },
        { quoted: m },
      );
      return;
    } catch {
      // QRIS gagal dikirim → lanjut text saja
    }
  }
  await m.reply(text);
}

/* ==================== HANDLER COMMAND ==================== */

async function handler(m, { sock }) {
  const db = getDatabase();
  const prefix = config.command?.prefix || ".";
  const cmd = m.command;
  const minAmount = config.payment?.topup?.minAmount || 10000;

  /* ---------- .topupbatal [id] ---------- */
  if (cmd === "topupbatal") {
    const pending = topupManager.getByUser(m.sender).filter(
      (r) => r.status === "PENDING",
    );
    if (!pending.length) {
      return m.reply(`📋 *Tidak ada top up aktif untuk dibatalkan.*`);
    }

    const argId = m.args?.[0];
    let target = null;
    if (argId) {
      target = pending.find((r) => r.id === argId);
      if (!target) {
        return m.reply(
          `❌ Request \`${argId}\` tidak ditemukan / bukan milikmu.\n` +
            `ID aktifmu: \`${pending[pending.length - 1].id}\``,
        );
      }
    } else {
      target = pending[pending.length - 1];
    }

    topupManager.update(target.id, {
      status: "CANCELLED",
      reviewReason: "Dibatalkan oleh user",
    });
    return m.reply(
      `🚫 *Top Up Dibatalkan*\n\n` +
        `Top Up ID: \`${target.id}\`\n` +
        `Nominal: ${rupiah(target.nominal)}\n\n` +
        `Buat request baru dengan \`${prefix}topup <nominal>\`.`,
    );
  }

  /* ---------- .topupstatus ---------- */
  if (cmd === "topupstatus") {
    const list = topupManager
      .getByUser(m.sender)
      .slice(-5)
      .reverse();
    if (!list.length) {
      return m.reply(
        `📋 *Belum ada riwayat top up.*\n\nKetik \`${prefix}topup <nominal>\` untuk mulai.`,
      );
    }
    let text = `📋 *Riwayat Top Up Kamu*\n\n`;
    for (const r of list) {
      text +=
        `${STATUS_ICON[r.status] || "•"} \`${r.id}\`\n` +
        `   💰 ${rupiah(r.nominal)} | ${r.status}\n` +
        `   📎 Bukti: ${r.proofPath ? "✅ terkirim" : "belum ada"}\n` +
        `   🕐 ${fmtDate(r.createdAt)}\n\n`;
    }
    if (topupManager.findPendingByUser(m.sender)) {
      text += `⏳ *Kamu masih punya request PENDING.*\nKirim foto bukti transfer ke chat pribadi bot ya!`;
    }
    return m.reply(text);
  }

  /* ---------- .topup / .topup <nominal> ---------- */
  const rawNominal = m.args?.join(" ") || "";
  if (!rawNominal) {
    return await sendPaymentInfo(
      m,
      sock,
      prefix,
      `💳 *TOP UP SALDO*\n\nNominal minimal: *${rupiah(minAmount)}*\n`,
    );
  }

  const nominal = parseNominal(rawNominal);
  if (!nominal || nominal <= 0) {
    return m.reply(
      `❌ Nominal tidak valid!\n\nContoh: \`${prefix}topup 10000\` atau \`${prefix}topup 10k\``,
    );
  }
  if (nominal < minAmount) {
    return m.reply(
      `❌ *Minimal top up ${rupiah(minAmount)}!*\n\nContoh: \`${prefix}topup ${minAmount}\``,
    );
  }

  // Satu request aktif per user
  const existing = topupManager.findPendingByUser(m.sender);
  if (existing) {
    return m.reply(
      `⚠️ *Kamu masih punya top up aktif!*\n\n` +
        `Top Up ID: \`${existing.id}\`\n` +
        `Nominal: ${rupiah(existing.nominal)}\n\n` +
        `📎 Kirim foto bukti transfer ke chat pribadi bot, atau\n` +
        `batalkan dulu: \`${prefix}topupbatal ${existing.id}\``,
    );
  }

  const user = db.getUser(m.sender);
  const request = topupManager.create(m.sender, {
    name: m.pushName || user?.name || "User",
    nominal,
    chat: m.chat,
  });

  m.react("✅");

  await sendPaymentInfo(
    m,
    sock,
    prefix,
    `✅ *PERMINTAAN TOP UP DIBUAT!*\n\n` +
      `🆔 Top Up ID: \`${request.id}\`\n` +
      `💰 Nominal: *${rupiah(nominal)}*\n` +
      `📌 Status: *PENDING*\n\n` +
      `⚠️ Setelah transfer, kirim *foto bukti pembayaran* ke chat pribadi bot ini. ` +
      `Owner otomatis akan dinotifikasi!\n`,
  );
}

/* ==================== CAPTURE BUKTI TRANSFER ==================== */
/**
 * Dipanggil handler untuk setiap pesan non-command.
 * Jika user punya top up PENDING dan mengirim gambar di chat pribadi,
 * gambar dianggap bukti transfer → simpan → notifikasi otomatis ke owner.
 */
async function topupProofAnswerHandler(m, sock) {
  try {
    if (m.isCommand || m.isGroup || m.fromMe) return false;

    const request = topupManager.findPendingByUser(m.sender);
    if (!request) return false;

    const media = m.isImage ? m : m.quoted?.isImage ? m.quoted : null;
    if (!media) return false;

    await m.react("🕕");

    let buffer = null;
    try {
      buffer = await media.download();
    } catch (e) {
      await m.reply(`❌ Gagal mengunduh gambar bukti: ${e.message}\nCoba kirim ulang ya!`);
      return true;
    }
    if (!buffer || !buffer.length) {
      await m.reply(`❌ Gambar bukti kosong/tidak bisa dibaca. Coba kirim ulang ya!`);
      return true;
    }

    const updated = topupManager.saveProof(request.id, buffer, media.mimetype);
    const result = await notifyOwnerPayment(sock, updated);

    if (result.sent > 0) {
      await m.react("✅");
      await m.reply(
        `✅ *Bukti transfer diterima!*\n\n` +
          `🆔 Top Up ID: \`${request.id}\`\n` +
          `💰 Nominal: ${rupiah(request.nominal)}\n` +
          `📌 Status: *PENDING* — menunggu review owner\n\n` +
          `🔔 Owner sudah dinotifikasi (${result.sent}/${result.owners.length}).\n` +
          `Cek status: \`${config.command?.prefix || "."}topupstatus\``,
      );
    } else {
      await m.react("⚠️");
      await m.reply(
        `📎 Bukti transfer untuk \`${request.id}\` tersimpan, tapi *notifikasi owner gagal terkirim*.\n` +
          `Silakan hubungi owner secara manual dan sebutkan Top Up ID di atas.`,
      );
    }
    return true;
  } catch (e) {
    console.error("[Topup] proof handler error:", e.message);
    return false;
  }
}

export { pluginConfig as config, handler, topupProofAnswerHandler };
