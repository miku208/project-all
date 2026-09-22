import {
  generateWAMessage,
  generateWAMessageFromContent,
  jidNormalizedUser,
} from "mikuhostt-baileys";
import axios from "axios";
import crypto from "crypto";
import te from "../../src/lib/miku-error.js";
import { f } from "../../src/lib/miku-http.js";

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
const MIN_SIZE = 1000;
const TIMEOUT = 15000;

async function fetchImage(url) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: TIMEOUT,
      maxContentLength: 10 * 1024 * 1024,
    });
    const buf = Buffer.from(res.data);
    return buf.length > MIN_SIZE ? { image: buf } : null;
  } catch {
    return null;
  }
}

async function handler(m, { sock }) {
  const query = m.text?.trim();
  if (!query) {
    return m.reply(
      `🔍 *ᴘɪɴᴛᴇʀᴇsᴛ sᴇᴀʀᴄʜ*\n\n> Contoh:\n\`${m.prefix}pin Zhao Lusi\``,
    );
  }
  m.react("🕕");

  try {
    const data = await f(
      `https://dezncone.vercel.app/search/pinterest?query=${encodeURIComponent(query)}&limit=${MAX_IMAGES}`,
    );

    const urls = (data?.results || [])
      .filter((u) => typeof u === "string" && u.startsWith("http"))
      .slice(0, MAX_IMAGES);

    if (!urls.length) {
      m.react("❌");
      return m.reply(`❌ Tidak ditemukan hasil untuk: ${query}`);
    }

    const downloaded = await Promise.all(urls.map(fetchImage));
    const mediaList = downloaded.filter(Boolean);

    if (!mediaList.length) {
      m.react("❌");
      return m.reply("❌ Gagal memuat gambar");
    }

    try {
      const opener = generateWAMessageFromContent(
        m.chat,
        {
          messageContextInfo: { messageSecret: crypto.randomBytes(32) },
          albumMessage: {
            expectedImageCount: mediaList.length,
            expectedVideoCount: 0,
          },
        },
        {
          userJid: jidNormalizedUser(sock.user.id),
          quoted: m,
          upload: sock.waUploadToServer,
        },
      );

      await sock.relayMessage(opener.key.remoteJid, opener.message, {
        messageId: opener.key.id,
      });

      await Promise.all(
        mediaList.map(async (content) => {
          const msg = await generateWAMessage(opener.key.remoteJid, content, {
            upload: sock.waUploadToServer,
          });

          msg.message.messageContextInfo = {
            messageSecret: crypto.randomBytes(32),
            messageAssociation: {
              associationType: 1,
              parentMessageKey: opener.key,
            },
          };

          return sock.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id,
          });
        }),
      );
    } catch (albumErr) {
      console.log("[Pins] Album gagal, kirim satu-satu:", albumErr.message);

      const saluranId = config.saluran?.id || "120363400911374213@newsletter";
      const saluranName =
        config.saluran?.name || config.bot?.name || "Miku-AI";

      await Promise.all(
        mediaList.map((content) =>
          sock.sendMessage(
            m.chat,
            {
              image: content.image,
              contextInfo: {
                forwardingScore: 9999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: saluranId,
                  newsletterName: saluranName,
                  serverMessageId: 127,
                },
              },
            },
            { quoted: m },
          ),
        ),
      );
    }

    m.react("✅");
  } catch (err) {
    console.error("[Pins] Error:", err.message);
    m.react("☢");
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };