import te from "../../src/lib/miku-error.js";

const pluginConfig = {
  name: "dsmg",
  alias: ["delmsg", "fakedelete", "revoke", "hapus"],
  category: "tools",
  description: "Bikin pesan orang keliatan kehapus (fake delete for everyone)",
  usage: ".dsmg (reply pesan target)",
  example: ".dsmg",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 1,
  isEnabled: true,
};

const PROTOCOL_REVOKE = 0;

const buildTargetKey = (m) => ({
  remoteJid: m.chat,
  fromMe: m.quoted.fromMe,
  id: m.quoted.id,
  participant: m.quoted.sender,
});

const buildRevokeMessage = (targetKey) => ({
  protocolMessage: {
    key: targetKey,
    type: PROTOCOL_REVOKE,
  },
});

const validate = (m) => {
  if (!m.quoted) return "❌ Reply pesan yang mau dihilangkan.";
  if (!m.quoted.id) return "❌ Pesan target tidak valid.";
  if (m.quoted.fromMe && m.quoted.id === m.key.id)
    return "❌ Tidak bisa hapus pesan command sendiri.";
  return null;
};

async function handler(m, { sock }) {
  const invalid = validate(m);
  if (invalid) return m.reply(invalid);

  m.react("🕕");

  const targetKey = buildTargetKey(m);
  const payload = buildRevokeMessage(targetKey);

  try {
    await sock.relayMessage(m.chat, payload, {});
    m.react("✅");
  } catch (err) {
    console.error("[DSMG] Gagal:", err.message);
    m.react("☢");

    const msg =
      err.message?.includes("not-authorized") || err.message?.includes("403")
        ? "❌ Bot tidak punya izin. Jadikan bot admin grup."
        : err.message?.includes("not-found")
        ? "❌ Pesan target sudah tidak ada."
        : te(m.prefix, m.command, m.pushName);

    m.reply(msg);
  }
}

export { pluginConfig as config, handler };