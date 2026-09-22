import {
  generateWAMessage,
  generateWAMessageFromContent,
  jidNormalizedUser,
} from "mikuhostt-baileys";
import axios from "axios";
import crypto from "crypto";
import te from "../../src/lib/miku-error.js";

const pluginConfig = {
  name: "pin",
  alias: ["pinsearch", "pinterestsearch", "pins"],
  category: "search",
  description: "Cari gambar di Pinterest (album)",
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

const MAX_IMAGES = 10;
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

    const userJid = jidNormalizedUser(sock.user.id);
    const upload = sock.waUploadToServer || sock.updateMediaMessage;

    if (!upload) {
      throw new Error("waUploadToServer tidak tersedia");
    }

    const opener = generateWAMessageFromContent(
      m.chat,
      {
        messageContextInfo: { messageSecret: crypto.randomBytes(32) },
        albumMessage: {
          expectedImageCount: urls.length,
          expectedVideoCount: 0,
        },
      },
      { userJid, quoted: m, upload },
    );

    await sock.relayMessage(opener.key.remoteJid, opener.message, {
      messageId: opener.key.id,
    });

    for (const url of urls) {
      const msg = await generateWAMessage(
        opener.key.remoteJid,
        { image: { url } },
        { upload },
      );

      msg.message.messageContextInfo = {
        messageSecret: crypto.randomBytes(32),
        messageAssociation: {
          associationType: 1,
          parentMessageKey: opener.key,
        },
      };

      await sock.relayMessage(msg.key.remoteJid, msg.message, {
        messageId: msg.key.id,
      });
    }

    m.react("✅");
  } catch (err) {
    console.error("[Pins] Error:", err.message);
    m.react("☢");
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };