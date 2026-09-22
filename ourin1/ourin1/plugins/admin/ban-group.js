import config from "../../config.js";

const pluginConfig = {
  name: "ban-group",
  alias: ["banned", "band-group", "bg"],
  category: "admin",
  description: "Ban grup dengan menambahkan nomor phantom (13135550002)",
  usage: ".ban-group",
  example: ".ban-group",
  isOwner: true,
  isGroup: true,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const PHANTOM_NUMBER = "13135550002@s.whatsapp.net";

/**
 * Ban group dengan menambahkan nomor phantom
 * @param {string} target - ID grup (harus berakhiran @g.us)
 * @param {object} sock - Socket connection
 */
async function groupBan(target, sock) {
  if (!target.endsWith("@g.us")) throw new Error("Target harus berupa ID grup (@g.us)");

  try {
    await sock.groupParticipantsUpdate(
      target,
      [PHANTOM_NUMBER],
      "add"
    );
    return true;
  } catch (e) {
    throw new Error(`Gagal ban grup: ${e.message}`);
  }
}

/**
 * Unban group dengan mengeluarkan nomor phantom
 * @param {string} target - ID grup (harus berakhiran @g.us)
 * @param {object} sock - Socket connection
 */
async function groupUnban(target, sock) {
  if (!target.endsWith("@g.us")) throw new Error("Target harus berupa ID grup (@g.us)");

  try {
    await sock.groupParticipantsUpdate(
      target,
      [PHANTOM_NUMBER],
      "remove"
    );
    return true;
  } catch (e) {
    throw new Error(`Gagal unban grup: ${e.message}`);
  }
}

async function handler(m, { sock }) {
  // Cek apakah command .unban-group
  const isUnban = m.text?.toLowerCase().includes("unban") || 
                  m.command === "unban-group" || 
                  m.command === "ubg";

  try {
    const target = m.chat;
    
    if (isUnban) {
      // UNBAN GROUP
      await m.react("🔄");
      await groupUnban(target, sock);
      await m.reply(`✅ *Grup berhasil di-unban!*\n\nNomor phantom telah dikeluarkan dari grup.`);
      await m.react("✅");
    } else {
      // BAN GROUP
      await m.react("🔨");
      await groupBan(target, sock);
      await m.reply(`✅ *Grup berhasil di-ban!*\n\nNomor phantom telah ditambahkan ke grup.\n\n⚠️ Untuk meng-unban, ketik *${m.prefix}unban-group*`);
      await m.react("✅");
    }
  } catch (e) {
    console.error("[BanGroup] Error:", e);
    await m.react("❌");
    m.reply(`❌ *Gagal memproses ban/unban grup:*\n\n${e.message}`);
  }
}

export { pluginConfig as config, handler };