import axios from "axios";
import ytdl, { fallbackToMp3Buffer } from "../../src/scraper/ytdl.js";

const pluginConfig = {
  name: "ytmp3",
  alias: ["youtubemp3", "ytaudio"],
  category: "download",
  description: "Download audio YouTube ke MP3",
  usage: ".ytmp3 <url>",
  example: ".ytmp3 https://youtube.com/watch?v=xxx",
  cooldown: 20,
  energi: 2,
  isEnabled: true,
};

const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;

async function getAudioDownload(url) {
  // 1. API Utama Izuka
  try {
    const { data } = await axios.get(
      `https://my.izuka-api.xyz/api/downloader/ytmp3?url=${encodeURIComponent(url)}`,
      { timeout: 60000 }
    );
    const download = data?.result?.download_url;
    const title = data?.result?.title;
    if (download && title) return { download, title, isFallback: false };
  } catch (e) {
    console.log("[YTMP3 API] Gagal:", e.message);
  }

  // 2. Fallback ytdl
  const fallback = await ytdl(url, "mp3");
  if (fallback?.status && fallback?.dl) {
    return { download: fallback.dl, title: fallback.title, isFallback: true };
  }

  throw new Error(fallback?.mess || "Gagal mendapatkan link audio");
}

async function handler(m, { sock }) {
  const url = m.text?.trim();
  if (!url) return m.reply(`❌ Contoh: ${m.prefix}ytmp3 https://youtube.com/watch?v=xxx`);
  if (!ytRegex.test(url)) return m.reply("❌ URL tidak valid. Harus link YouTube");

  m.react("🕕");

  try {
    const result = await getAudioDownload(url);
    const title = result.title || "audio";
    const caption = `🎵 *${title}*\n${result.isFallback ? "_Mode: Fallback_" : "_Mode: API_"}`;

    if (result.isFallback) {
      // Download jadi buffer dulu biar stabil di WA
      const mp3Buffer = await fallbackToMp3Buffer(result.download);
      await sock.sendMessage(m.chat, {
        audio: mp3Buffer,
        mimetype: "audio/mpeg",
        ptt: false,
        fileName: `${title}.mp3`,
        caption
      }, { quoted: m });
    } else {
      // Kirim via URL langsung, lebih hemat ram
      await sock.sendMessage(m.chat, {
        audio: { url: result.download },
        mimetype: "audio/mpeg",
        ptt: false,
        fileName: `${title}.mp3`,
        caption
      }, { quoted: m });
    }
    m.react("✅");
  } catch (err) {
    console.error("[YTMP3 ERROR]", err);
    m.react("❌");
    m.reply(`Gagal mengunduh audio: ${err.message}`);
  }
}

export { pluginConfig as config, handler };