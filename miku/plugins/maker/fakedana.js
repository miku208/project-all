/**
 * ✧ Name    : Fake Saldo Dana
 * ✧ Creator : Rin imup
 * ✧ Link    : https://whatsapp.com/channel/0029Vb6EHtR5Ui2gHMW9zX2x
 * ✧ Note    : Jangan hapus wm ya, hargai dari sumber share nya
 */

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import axios from "axios";

const pluginConfig = {
  name: "fakedana",
  alias: ["fakedan", "fakesaldodana"],
  category: "maker",
  description: "Buat fake saldo DANA",
  usage: ".fakedana <nominal>",
  example: ".fakedana 50.000",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 1,
  isEnabled: true,
};

const ASSETS_DIR = join(process.cwd(), "assets", "fakedana");
const FONTS_DIR = join(ASSETS_DIR, "fonts");
const FONT_PATH = join(FONTS_DIR, "PlusJakartaSans-SemiBold.ttf");
const BG_LOCAL = join(ASSETS_DIR, "fkedana.png");
const EYE_LOCAL = join(ASSETS_DIR, "eye_icon.jpg");
const TMP_DIR = join(process.cwd(), "tmp");

const TTF_URL = "https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-600-normal.ttf";
const BG_URL = "https://raw.githubusercontent.com/ryyntwx/Image-rinn/refs/heads/main/fkedana.png";
const EYE_URL = "https://raw.githubusercontent.com/ryyntwx/Image-rinn/refs/heads/main/IMG-20260726-WA1031.jpg";

async function downloadFile(url, dest) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  await writeFile(dest, Buffer.from(res.data));
}

async function ensureAssets() {
  await mkdir(FONTS_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });

  if (!existsSync(FONT_PATH)) await downloadFile(TTF_URL, FONT_PATH);
  if (!existsSync(BG_LOCAL)) await downloadFile(BG_URL, BG_LOCAL);
  if (!existsSync(EYE_LOCAL)) await downloadFile(EYE_URL, EYE_LOCAL);

  GlobalFonts.registerFromPath(FONT_PATH, "DANA");
}

async function buildCanvas(inputSaldo) {
  const bgImg = await loadImage(BG_LOCAL);
  const eyeImg = await loadImage(EYE_LOCAL);

  const canvas = createCanvas(bgImg.width, bgImg.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);

  const valX = 138;
  const valY = 52;
  const maxFontSize = 37;
  const eyeGap = 7;
  const eyeScale = 1.3;
  const maxAllowedWidth = canvas.width - valX - 100;

  let currentFontSize = maxFontSize;
  ctx.font = `600 ${currentFontSize}px DANA`;
  let textWidth = ctx.measureText(inputSaldo).width;

  while (textWidth > maxAllowedWidth && currentFontSize > 16) {
    currentFontSize -= 2;
    ctx.font = `600 ${currentFontSize}px DANA`;
    textWidth = ctx.measureText(inputSaldo).width;
  }

  // Tulis nominal saldo
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(inputSaldo, valX, valY);

  // Icon mata di samping saldo
  const eyeHeight = currentFontSize * eyeScale;
  const eyeWidth = (eyeImg.width / eyeImg.height) * eyeHeight;
  const eyeX = valX + textWidth + eyeGap;
  const eyeY = valY + (currentFontSize - eyeHeight) / 2;

  ctx.drawImage(eyeImg, eyeX, eyeY, eyeWidth, eyeHeight);

  return canvas.encode("png");
}

async function handler(m, { sock }) {
  const inputSaldo = m.text?.trim();

  if (!inputSaldo) {
    return m.reply(
      `💸 *FAKE SALDO DANA*\n\n` +
      `*Format:*\n` +
      `\`${m.prefix}fakedana <nominal>\`\n\n` +
      `*Contoh:*\n` +
      `\`${m.prefix}fakedana 50.000\`\n` +
      `\`${m.prefix}fakedana 1.500.000\``
    );
  }

  m.react("🕐");

  try {
    await ensureAssets();

    const buffer = await buildCanvas(inputSaldo);
    const outPath = join(TMP_DIR, `fakedana-${Date.now()}.png`);
    await writeFile(outPath, buffer);

    await sock.sendMessage(
      m.chat,
      {
        image: buffer,
        caption: `— *FAKE SALDO DANA* —\n\n✎ *Nominal:* Rp ${inputSaldo}`,
      },
      { quoted: m }
    );

    if (existsSync(outPath)) unlinkSync(outPath);

    m.react("✅");
  } catch (err) {
    console.error("[FakeDana Error]", err);
    m.react("❌");
    m.reply(`❌ *Gagal membuat canvas Fake DANA*\n${err.message}`);
  }
}

export { pluginConfig as config, handler };