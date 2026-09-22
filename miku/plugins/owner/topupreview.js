import config from "../../config.js";
import { getDatabase } from "../../src/lib/miku-database.js";
import {
  topupManager,
  rupiah,
  fmtDate,
} from "../../src/lib/miku-topup.js";

const pluginConfig = {
  name: "topupapprove",
  alias: ["topupapprove", "topupreject", "topuplist", "topupproof"],
  category: "owner",
  description: "Review permintaan top up (approve / reject / list / lihat bukti)",
  usage:
    ".topupapprove <id> | .topupreject <id> [alasan] | .topuplist [pending|approved|rejected|all] | .topupproof <id>",
  example: ".topupapprove topup_xxxxx",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 0,
  energi: 0,
  isEnabled: true,
};

const STATUS_ICON = {
  PENDING: "⏳",
  APPROVED: "✅",
  REJECTED: "❌",
  CANCELLED: "🚫",
};

/* ==================== SUB-COMMANDS ==================== */

async function cmdList(m) {
  const arg = (m.args?.[0] || "pending").toLowerCase();
  const statusMap = {
    pending: "PENDING",
    approved: "APPROVED",
    rejected: "REJECTED",
    cancelled: "CANCELLED",
    all: "all",
  };
  const status = statusMap[arg];
  if (!status) {
    return m.reply(
      `❌ Filter tidak dikenal: \`${arg}\`\n` +
        `Gunakan: pending | approved | rejected | cancelled | all`,
    );
  }

  const list = topupManager.list(status, 15);
  if (!list.length) {
    return m.reply(`📋 *Tidak ada top up* dengan status *${arg.toUpperCase()}*.`);
  }

  let text = `📋 *Daftar Top Up — ${arg.toUpperCase()}*\n\n`;
  for (const r of list) {
    text +=
      `${STATUS_ICON[r.status] || "•"} \`${r.id}\`\n` +
      `   👤 @${r.userName || r.userJid.split("@")[0]} | 💰 ${rupiah(r.nominal)}\n` +
      `   📎 Bukti: ${r.proofPath ? "✅" : "❌"} | 🕐 ${fmtDate(r.createdAt)}\n`;
    if (r.reviewReason) text += `   💬 ${r.reviewReason}\n`;
    text += `\n`;
  }
  text +=
    `*Review:*\n` +
    `• \`${config.command?.prefix || "."}topupapprove <id>\` — setujui (saldo otomatis masuk)\n` +
    `• \`${config.command?.prefix || "."}topupreject <id> [alasan]\` — tolak\n` +
    `• \`${config.command?.prefix || "."}topupproof <id>\` — lihat bukti transfer`;

  await m.reply(text, { mentions: list.map((r) => r.userJid) });
}

async function cmdApprove(m, { sock }) {
  const id = m.args?.[0];
  if (!id) {
    return m.reply(
      `❌ Masukkan Top Up ID!\nContoh: \`${config.command?.prefix || "."}topupapprove topup_xxx\``,
    );
  }

  const request = topupManager.get(id);
  if (!request) return m.reply(`❌ Top Up \`${id}\` tidak ditemukan.`);
  if (request.status !== "PENDING") {
    return m.reply(
      `⚠️ Top Up \`${id}\` sudah diproses sebelumnya.\nStatus: *${request.status}*`,
    );
  }

  const db = getDatabase();

  // Credit saldo user otomatis (1:1 dengan nominal top up)
  const user = db.getUser(request.userJid) || db.setUser(request.userJid);
  const newSaldo = (user.saldo || 0) + request.nominal;
  db.setUser(request.userJid, { saldo: newSaldo });

  topupManager.update(id, {
    status: "APPROVED",
    reviewedBy: m.sender,
    reviewedAt: Date.now(),
  });

  m.react("✅");

  await m.reply(
    `✅ *TOP UP DISETUJUI*\n\n` +
      `🆔 ID: \`${request.id}\`\n` +
      `👤 User: @${request.userName || request.userJid.split("@")[0]}\n` +
      `💰 Nominal: *${rupiah(request.nominal)}*\n` +
      `💼 Saldo user sekarang: *${rupiah(newSaldo)}*`,
    { mentions: [request.userJid] },
  );

  // Kabari user
  try {
    await sock.sendMessage(
      request.userJid,
      {
        text:
          `✅ *TOP UP KAMU DISETUJUI!*\n\n` +
          `🆔 Top Up ID: \`${request.id}\`\n` +
          `💰 Nominal: *${rupiah(request.nominal)}*\n` +
          `💼 Saldo kamu sekarang: *${rupiah(newSaldo)}*\n\n` +
          `Terima kasih sudah top up! 💖`,
      },
    );
  } catch (e) {
    console.error("[TopupReview] gagal kirim notif approve ke user:", e.message);
  }
}

async function cmdReject(m, { sock }) {
  const args = m.args || [];
  if (!args.length) {
    return m.reply(
      `❌ Masukkan Top Up ID!\nContoh: \`${config.command?.prefix || "."}topupreject topup_xxx bukti tidak jelas\``,
    );
  }

  const id = args[0];
  const reason = args.slice(1).join(" ") || "Tidak ada alasan";

  const request = topupManager.get(id);
  if (!request) return m.reply(`❌ Top Up \`${id}\` tidak ditemukan.`);
  if (request.status !== "PENDING") {
    return m.reply(
      `⚠️ Top Up \`${id}\` sudah diproses sebelumnya.\nStatus: *${request.status}*`,
    );
  }

  topupManager.update(id, {
    status: "REJECTED",
    reviewedBy: m.sender,
    reviewedAt: Date.now(),
    reviewReason: reason,
  });

  m.react("✅");

  await m.reply(
    `❌ *TOP UP DITOLAK*\n\n` +
      `🆔 ID: \`${request.id}\`\n` +
      `👤 User: @${request.userName || request.userJid.split("@")[0]}\n` +
      `💰 Nominal: ${rupiah(request.nominal)}\n` +
      `💬 Alasan: _${reason}_`,
    { mentions: [request.userJid] },
  );

  try {
    await sock.sendMessage(
      request.userJid,
      {
        text:
          `❌ *TOP UP KAMU DITOLAK*\n\n` +
          `🆔 Top Up ID: \`${request.id}\`\n` +
          `💰 Nominal: ${rupiah(request.nominal)}\n` +
          `💬 Alasan: _${reason}_\n\n` +
          `Jika ini keliru, hubungi owner dengan menyebutkan Top Up ID kamu.`,
      },
    );
  } catch (e) {
    console.error("[TopupReview] gagal kirim notif reject ke user:", e.message);
  }
}

async function cmdProof(m, { sock }) {
  const id = m.args?.[0];
  if (!id) {
    return m.reply(
      `❌ Masukkan Top Up ID!\nContoh: \`${config.command?.prefix || "."}topupproof topup_xxx\``,
    );
  }

  const request = topupManager.get(id);
  if (!request) return m.reply(`❌ Top Up \`${id}\` tidak ditemukan.`);

  const buffer = topupManager.readProof(id);
  if (!buffer) {
    return m.reply(
      `📎 Bukti transfer untuk \`${id}\` tidak tersedia.\n` +
        `Status request: *${request.status}*`,
    );
  }

  await sock.sendMessage(
    m.chat,
    {
      image: buffer,
      caption:
        `📎 *Bukti Transfer*\n\n` +
        `🆔 ID: \`${request.id}\`\n` +
        `👤 User: @${request.userName || request.userJid.split("@")[0]}\n` +
        `💰 Nominal: ${rupiah(request.nominal)}\n` +
        `📌 Status: *${request.status}*`,
      mentions: [request.userJid],
    },
    { quoted: m },
  );
}

/* ==================== HANDLER ==================== */

async function handler(m, context) {
  const cmd = m.command;

  switch (cmd) {
    case "topupapprove":
      return await cmdApprove(m, context);
    case "topupreject":
      return await cmdReject(m, context);
    case "topupproof":
      return await cmdProof(m, context);
    case "topuplist":
    default:
      return await cmdList(m);
  }
}

export { pluginConfig as config, handler };
