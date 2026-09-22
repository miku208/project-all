import config from "../../config.js";

const pluginConfig = {
  name: "ban-group",
  alias: ["banned", "band-group", "bg", "unban-group", "unband", "unbg"],
  category: "admin",
  description:
    "Ban grup via nomor phantom (13135550002) — bisa di grup sendiri atau via link grup",
  usage:
    ".ban-group | .ban-group <link_grup> | .unban-group | .unban-group <link_grup>",
  example: ".ban-group https://chat.whatsapp.com/xxxx",
  isOwner: true,
  isGroup: false, // opsi URL bisa dipakai dari chat pribadi
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const PHANTOM_NUMBER = "13135550002@s.whatsapp.net";
const LEAVE_DELAY_MS = 3000;

/* ==================== HELPERS ==================== */

/** Ambil kode invite dari link grup / kode mentah */
function extractInviteCode(text) {
  const s = String(text || "").trim();
  const link = s.match(
    /chat\.whatsapp\.com\/(?:invite\/)?([0-9A-Za-z_-]{16,})/i,
  );
  if (link) return link[1];
  const bare = s.match(/^([0-9A-Za-z_-]{16,})$/);
  return bare ? bare[1] : null;
}

function normalizeGroupJid(id) {
  return String(id || "").includes("@") ? id : `${id}@g.us`;
}

function isUnbanCommand(m) {
  return (
    m.command?.startsWith("unban") ||
    m.command === "unbg" ||
    m.text?.toLowerCase().includes("unban")
  );
}

/**
 * Tambah (ban) / keluarkan (unban) nomor phantom di grup target.
 * @returns {{target, name, joined, action}}
 */
async function applyPhantom(sock, target, action) {
  if (action === "ban") {
    await sock.groupParticipantsUpdate(target, [PHANTOM_NUMBER], "add");
  } else {
    await sock.groupParticipantsUpdate(target, [PHANTOM_NUMBER], "remove");
  }
}

function friendlyError(e) {
  const msg = String(e?.message || e || "").toLowerCase();
  if (msg.includes("not-authorized") || msg.includes("403")) {
    return "Bot harus menjadi *ADMIN* di grup tersebut untuk menambah/mengeluarkan phantom.";
  }
  if (msg.includes("not-in-group") || msg.includes("404")) {
    return "Bot bukan anggota grup tersebut.";
  }
  if (msg.includes("conflict") || msg.includes("409")) {
    return "Phantom sedang diproses / status anggota bentrok. Coba beberapa saat lagi.";
  }
  return e?.message || "Unknown error";
}

/* ==================== HANDLER ==================== */

async function handler(m, { sock }) {
  const unban = isUnbanCommand(m);
  const action = unban ? "unban" : "ban";
  const argStr = (m.args || []).join(" ");
  const inviteCode = extractInviteCode(argStr);

  let target = m.chat;
  let name = m.isGroup ? "grup ini" : null;
  let viaUrl = false;
  let joined = false;

  await m.react("🔄");

  try {
    if (inviteCode) {
      /* ---------- OPSI URL ---------- */
      viaUrl = true;
      let info;
      try {
        info = await sock.groupGetInviteInfo(inviteCode);
      } catch {
        throw new Error("Link invite tidak valid / sudah kedaluarsa");
      }
      target = normalizeGroupJid(info.id);
      name = info.subject || "Unknown";

      // Masuk dulu ke grup (kalau bot belum jadi anggota)
      try {
        await sock.groupAcceptInvite(inviteCode);
        joined = true;
        await new Promise((r) => setTimeout(r, 1500)); // beri waktu sinkron
      } catch (e) {
        const msg = String(e?.message || "").toLowerCase();
        if (!msg.includes("already") && !msg.includes("409")) {
          throw new Error(`Gagal masuk grup: ${e.message}`);
        }
      }
    } else if (!m.isGroup) {
      // Tanpa argumen link & bukan di grup → tampilkan cara pakai
      await m.react("ℹ️");
      return m.reply(
        `🔨 *BAN / UNBAN GRUP* (phantom 13135550002)\n\n` +
          `📌 *Di grup saat ini:*\n` +
          `• \`${m.prefix}ban-group\` — ban grup ini\n` +
          `• \`${m.prefix}unban-group\` — unban grup ini\n\n` +
          `🌐 *Via URL (dari mana saja):*\n` +
          `• \`${m.prefix}ban-group <link_grup>\` — masuk → ban → keluar\n` +
          `• \`${m.prefix}unban-group <link_grup>\` — masuk → unban → keluar\n\n` +
          `⚠️ Bot harus *admin* di grup target.`,
      );
    }

    /* ---------- EKSEKUSI ---------- */
    await applyPhantom(sock, target, action);

    let text =
      (action === "ban"
        ? `✅ *Grup berhasil di-ban!*`
        : `✅ *Grup berhasil di-unban!*`) +
      `\n\n` +
      `📌 Grup: *${name}*\n` +
      `🆔 \`${target}\`\n` +
      `👻 Phantom: ${PHANTOM_NUMBER.split("@")[0]}\n` +
      (viaUrl ? `🌐 Via: URL invite\n` : "");

    if (viaUrl && joined) {
      text +=
        action === "ban"
          ? `\n⚠️ Untuk meng-unban: \`${m.prefix}unban-group <link>\``
          : `\n✅ Grup sudah normal kembali.`;

      // Bot keluar lagi (masuk cuma untuk proses)
      await m.reply(text);
      await new Promise((r) => setTimeout(r, LEAVE_DELAY_MS));
      try {
        await sock.groupLeave(target);
      } catch {}
      await m.react("✅");
      return;
    }

    if (action === "ban") {
      text += `\n\n⚠️ Untuk meng-unban, ketik *${m.prefix}unban-group*`;
    }
    await m.reply(text);
    await m.react("✅");
  } catch (e) {
    console.error("[BanGroup] Error:", e);
    await m.react("❌");
    await m.reply(
      `❌ *Gagal ${action} grup:*\n\n${friendlyError(e)}\n\n` +
        (viaUrl ? `🌐 Target: *${name}* (\`${target}\`)` : `📌 Grup: *${name}*`),
    );
  }
}

export { pluginConfig as config, handler };
