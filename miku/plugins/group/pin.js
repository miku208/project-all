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
const TIMEOUT = 20000;
const API = "https://denzcnv2-silk.vercel.app/search/pinterestv2";

const extractText = (val) => {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object") {
    return val.format || val.text || val.string || "";
  }
  return "";
};

const truncate = (str, max = 100) => {
  if (!str) return "";
  return str.length > max ? str.slice(0, max).trim() + "..." : str;
};

async function handler(m, { sock }) {
  const query = m.text?.trim();

  if (!query) {
    return m.reply(
      `🔍 *ᴘɪɴᴛᴇʀᴇsᴛ sᴇᴀʀᴄʜ*\n\n` +
        `> Masukkan kata kunci pencarian\n\n` +
        `*Contoh:*\n` +
        `\`${m.prefix}pin Zhao Lusi\`\n` +
        `\`${m.prefix}pin anime aesthetic\``,
    );
  }

  m.react("🕕");

  try {
    const { data } = await axios.get(API, {
      params: { query, limit: MAX_IMAGES + 5 },
      timeout: TIMEOUT,
    });

    if (!data?.status || !data?.result?.results?.length) {
      m.react("❌");
      return m.reply(`❌ Tidak ada hasil untuk: *${query}*`);
    }

    const results = data.result.results
      .filter((item) => item.image && /^https?:\/\//.test(item.image))
      .slice(0, MAX_IMAGES);

    if (!results.length) {
      m.react("❌");
      return m.reply(
        `❌ Hasil ditemukan tapi tidak ada gambar valid untuk: *${query}*`,
      );
    }

    const userJid = jidNormalizedUser(sock.user.id);
    const upload = sock.waUploadToServer || sock.updateMediaMessage;

    if (!upload) throw new Error("waUploadToServer tidak tersedia");

    const total = results.length;
    const source = data.result.domain_used || "pinterest";

    const opener = generateWAMessageFromContent(
      m.chat,
      {
        messageContextInfo: { messageSecret: crypto.randomBytes(32) },
        albumMessage: {
          expectedImageCount: total,
          expectedVideoCount: 0,
        },
      },
      { userJid, quoted: m, upload },
    );

    await sock.relayMessage(opener.key.remoteJid, opener.message, {
      messageId: opener.key.id,
    });

    for (const item of results) {
      try {
        const title = extractText(item.title) || "Pinterest";
        const caption = `📌 *${truncate(title, 80)}*\n👤 ${
          item.username || "Unknown"
        }\n🔗 ${item.link || "-"}`;

        const msg = await generateWAMessage(
          opener.key.remoteJid,
          {
            image: { url: item.image },
            caption,
          },
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
      } catch (err) {
        console.error("[Pin] Gagal kirim gambar:", err.message);
        continue;
      }
    }

    m.react("✅");
  } catch (err) {
    console.error("[Pin] Error:", err.message);
    m.react("☢");

    const errMsg =
      err.code === "ECONNABORTED"
        ? "⏱ Request timeout, coba lagi nanti"
        : te(m.prefix, m.command, m.pushName);

    m.reply(errMsg);
  }
}

export { pluginConfig as config, handler };