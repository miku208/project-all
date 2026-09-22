import yts from "yt-search";
import axios from "axios";
import sharp from "sharp";
import { generateWAMessageFromContent } from "mikuhostt-baileys";
import config from "../../config.js";

const pluginConfig = {
  name: "play",
  alias: ["playaudio", "ashimusik"],
  category: "search",
  description: "woy ngentot lu cari dulu bangsat musik nya di YouTube bukan di pornhub tai",
  usage: ".play <query>",
  example: ".play komang",
  cooldown: 10,
  energi: 1,
  isEnabled: true,
};

function formatViews(n) {
  const views = Number(n) || 0;

  if (views >= 1_000_000_000)
    return (views / 1_000_000_000).toFixed(1) + "B";

  if (views >= 1_000_000)
    return (views / 1_000_000).toFixed(1) + "M";

  if (views >= 1_000)
    return (views / 1_000).toFixed(1) + "K";

  return views.toString();
}

function cleanText(text = "") {
  return String(text)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
}

async function getThumbnail(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15_000,
    maxContentLength: 5 * 1024 * 1024,
  });

  return sharp(Buffer.from(response.data))
    .resize(300, 170, {
      fit: "cover",
    })
    .jpeg({
      quality: 85,
    })
    .toBuffer();
}

async function handler(m, { sock, text }) {
  const query = String(text || m.text || "").trim();

  if (!query) {
    return m.reply(
      `🎵 *ASHI MUSIK*\n\n` +
      `Cari musik dari YouTube dengan mudah.\n\n` +
      `> Contoh:\n` +
      `\`${m.prefix}play komang\``
    );
  }

  await m.react("🕐");

  try {
    // =========================
    // SEARCH YOUTUBE
    // =========================
    const search = await yts(query);

    if (!search?.videos?.length) {
      throw new Error("Video tidak ditemukan");
    }

    const video = search.videos[0];

    if (!video?.url) {
      throw new Error("URL video tidak tersedia");
    }

    // =========================
    // THUMBNAIL
    // =========================
    let jpegThumbnail;

    try {
      if (video.thumbnail) {
        jpegThumbnail = await getThumbnail(video.thumbnail);
      }
    } catch (thumbnailError) {
      console.warn(
        "[Ashi Musik] Thumbnail gagal:",
        thumbnailError.message
      );
    }

    // =========================
    // DATA VIDEO
    // =========================
    const title = cleanText(video.title || "Tanpa judul");
    const author = cleanText(video.author?.name || "Unknown");
    const duration = cleanText(
      video.duration?.timestamp || "Tidak diketahui"
    );
    const views = formatViews(video.views);
    const ago = cleanText(video.ago || "Tidak diketahui");

    // =========================
    // INFO
    // =========================
    let info = `🎵 *ASHI MUSIK*\n\n`;
    info += `📌 *${title}*\n\n`;
    info += `*DETAIL VIDEO*\n`;
    info += `👤 Channel: *${author}*\n`;
    info += `⏱️ Durasi: *${duration}*\n`;
    info += `👀 Views: *${views}*\n`;
    info += `📅 Upload: *${ago}*\n\n`;
    info += `Pilih format download di bawah 👇`;

    // =========================
    // BUTTON
    // =========================
    const buttons = [
      {
        buttonId: `${m.prefix}ytmp3 ${video.url}`,
        buttonText: {
          displayText: "🎵 Download MP3",
        },
        type: 1,
      },
      {
        buttonId: `${m.prefix}ytmp4 ${video.url}`,
        buttonText: {
          displayText: "🎬 Download MP4",
        },
        type: 1,
      },
    ];

    // =========================
    // MESSAGE
    // =========================
    const content = {
      buttonsMessage: {
        contentText: info,
        footerText: "Ashi Musik 🗿",
        buttons,
        headerType: 6,

        ...(jpegThumbnail
          ? {
              locationMessage: {
                jpegThumbnail,
                name: title,
                address: `${author} • ${duration}`,
              },
            }
          : {}),
      },
    };

    const msg = generateWAMessageFromContent(
      m.chat,
      content,
      {
        userJid: sock.user?.jid,
      }
    );

    if (!msg?.message) {
      throw new Error("Gagal membuat pesan");
    }

    await sock.relayMessage(
      m.chat,
      msg.message,
      {
        messageId: msg.key.id,
      }
    );

    await m.react("✅");

  } catch (err) {
    console.error("[Ashi Musik - Play]", err);

    await m.react("😭");

    return m.reply(
      `❌ *ASHI MUSIK*\n\n` +
      `Pencarian sedang mengalami kendala.\n` +
      `Coba lagi beberapa saat lagi.\n\n` +
      `> Jangan spam command ya 🗿`
    );
  }
}

export {
  pluginConfig as config,
  handler,
};