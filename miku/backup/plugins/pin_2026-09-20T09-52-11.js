import axios from "axios";
import te from "../../src/lib/miku-error.js";

const pluginConfig = {
  name: "pin",
  alias: ["pinsearch", "pinterestsearch", "pins"],
  category: "search",
  description: "Cari gambar di Pinterest",
  usage: ".pin <query>",
  example: ".pin Zhao Lusi",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 1,
  isEnabled: true,
};

const MAX_IMAGES = 5;
const TIMEOUT = 15000;
const API = "https://dezncone.vercel.app/search/pinterest";

async function handler(m, { sock }) {
  const query = m.text?.trim();
  if (!query) {
    return m.reply(
      `🔍 *ᴘɪɴᴛᴇʀᴇsᴛ sᴇᴀʀᴄʜ*\n\n> Contoh:\n\`${m.prefix}pin Zhao Lusi\``,
    );
  }
  m.react("🕕");

  try {
    const { data } = await axios.get(API, {
      params: { query, limit: MAX_IMAGES },
      timeout: TIMEOUT,
    });

    const urls = (data?.result?.results || []).slice(0, MAX_IMAGES);

    if (!urls.length) {
      m.react("❌");
      return m.reply(`❌ Tidak ditemukan hasil untuk: ${query}`);
    }

    for (const url of urls) {
      try {
        await sock.sendMessage(
          m.chat,
          { image: { url } },
          { quoted: m },
        );
      } catch {
        continue;
      }
    }

    m.react("✅");
  } catch (err) {
    console.error("[Pins] Error:", err.message);
    m.react("☢");
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };