import fs from "fs";
import path from "path";
import os from "os";
import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const pluginConfig = {
  name: "4k",
  alias: ["upscale", "uhd"],
  description: "Upscale foto/video ke 4K",
  usage: ".4k"
};

const tmp = (ext) =>
  path.join(
    os.tmpdir(),
    `4k_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  );

async function ffmpegExists() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function processImage(input, output) {
  await sharp(input)
    .resize(3840, 2160, {
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3
    })
    .jpeg({
      quality: 95,
      chromaSubsampling: "4:4:4"
    })
    .toFile(output);
}

async function processVideo(input, output) {
  if (!(await ffmpegExists())) {
    throw new Error("FFmpeg belum terpasang di server.");
  }

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", input,

    "-vf",
    "scale=3840:2160:force_original_aspect_ratio=decrease," +
    "pad=3840:2160:(ow-iw)/2:(oh-ih)/2",

    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",

    "-c:a", "aac",
    "-b:a", "192k",

    "-movflags", "+faststart",

    output
  ]);
}

const handler = async (m, { conn, reply }) => {
  const quoted = m.quoted;

  if (!quoted) {
    return reply(
      "❌ Reply foto atau video terlebih dahulu.\n\n" +
      "Contoh:\n" +
      "Reply foto/video → *.4k*"
    );
  }

  const mime =
    quoted.mimetype ||
    quoted.msg?.mimetype ||
    quoted.message?.imageMessage?.mimetype ||
    quoted.message?.videoMessage?.mimetype ||
    "";

  const image = mime.startsWith("image/");
  const video = mime.startsWith("video/");

  if (!image && !video) {
    return reply("❌ Media yang direply bukan foto atau video.");
  }

  let input;
  let output;

  try {
    await reply(
      image
        ? "🖼️ Mengubah foto menjadi 4K..."
        : "🎬 Mengubah video menjadi 4K...\n⏳ Tunggu sebentar."
    );

    /*
     * Coba beberapa method download yang umum digunakan
     * oleh wrapper WhatsApp.
     */
    let buffer;

    if (typeof quoted.download === "function") {
      buffer = await quoted.download();
    } else if (typeof quoted.downloadMedia === "function") {
      buffer = await quoted.downloadMedia();
    } else if (typeof conn.downloadMediaMessage === "function") {
      buffer = await conn.downloadMediaMessage(quoted);
    } else {
      throw new Error(
        "Method download media tidak ditemukan pada bot."
      );
    }

    if (!buffer) {
      throw new Error("Media gagal didownload.");
    }

    input = tmp(image ? "jpg" : "mp4");
    output = tmp(image ? "jpg" : "mp4");

    fs.writeFileSync(input, buffer);

    if (image) {
      await processImage(input, output);

      await conn.sendMessage(
        m.chat,
        {
          image: fs.readFileSync(output),
          mimetype: "image/jpeg",
          caption: "✅ Selesai!\n📐 Resolusi: 3840×2160 (4K UHD)"
        },
        { quoted: m }
      );
    } else {
      await processVideo(input, output);

      await conn.sendMessage(
        m.chat,
        {
          video: fs.readFileSync(output),
          mimetype: "video/mp4",
          caption: "✅ Selesai!\n📐 Resolusi: 3840×2160 (4K UHD)"
        },
        { quoted: m }
      );
    }

  } catch (err) {
    console.error("[4K]", err);

    await reply(
      `❌ Gagal memproses media.\n\n${err.message}`
    );

  } finally {
    for (const file of [input, output]) {
      try {
        if (file && fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch {}
    }
  }
};

handler.help = ["4k"];
handler.tags = ["tools"];
handler.command = /^(4k|upscale|uhd)$/i;

export { pluginConfig };
export default handler;