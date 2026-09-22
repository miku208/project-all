/**
 * Nama Plugin: Meta AI
 * Fungsi: Tambah Meta AI ke grup
 */

const pluginConfig = {
  name: "metaai",
  alias: ["addmeta", "meta"],
  category: "group",
  description: "Tambah Meta AI ke grup",
  usage: ".metaai",
  example: ".metaai",
  cooldown: 5,
  energi: 1,
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  isEnabled: true,
};

const META_AI_JID = "867051314767696@bot";

async function handler(m, { sock }) {
  try {
    m.react("🕐");

    const result = await sock.groupParticipantsUpdate(
      m.chat,
      [META_AI_JID],
      "add"
    );

    const status = result?.[0]?.status;

    if (status === 200) {
      m.react("✅");
      await m.reply("✅ *Meta AI berhasil ditambahkan ke grup!*");
    } else if (status === 403) {
      m.react("❌");
      await m.reply("❌ *Gagal:* Meta AI menolak untuk bergabung ke grup ini.");
    } else if (status === 408) {
      m.react("❌");
      await m.reply("❌ *Gagal:* Meta AI tidak merespons.");
    } else if (status === 409) {
      m.react("⚠️");
      await m.reply("⚠️ *Meta AI sudah ada di grup ini.*");
    } else {
      m.react("❌");
      await m.reply(`❌ *Gagal menambahkan Meta AI.*\nStatus: ${status || "unknown"}`);
    }
  } catch (err) {
    console.error("[MetaAI Error]", err);
    m.react("❌");
    m.reply(`❌ *Error:* ${err.message || "Terjadi kesalahan"}`);
  }
}

export { pluginConfig as config, handler };