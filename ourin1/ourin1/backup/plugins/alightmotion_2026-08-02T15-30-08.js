/**
 * Nama Plugin: Alight Motion Premium Generator
 * Fungsi: Generate premium Alight Motion via magic link
 * Credit: RafaelXD (https://am.rafaelxd.my.id)
 */

import axios from "axios";

const BASE_URL = "https://am.rafaelxd.my.id";
const TIMEOUT = 60000;

const pluginConfig = {
  name: "alightmotion",
  alias: ["alight", "am", "amgen"],
  category: "tools",
  description: "Generate akun premium Alight Motion",
  usage: ".alight <email> | .alight <email> <link>",
  example: ".alight user@gmail.com",
  isOwner: false,
  isPremium: true,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 500,
  isEnabled: true,
};

async function sendMagicLink(email) {
  const { data } = await axios.post(
    `${BASE_URL}/api/send`,
    { email },
    {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      timeout: TIMEOUT,
    }
  );
  return data;
}

async function verifyMagicLink(email, rawLink) {
  const { data } = await axios.post(
    `${BASE_URL}/api/verify`,
    { email, rawLink },
    {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      timeout: TIMEOUT,
    }
  );
  return data;
}

async function handler(m, { sock }) {
  const args = m.text?.trim().split(/\s+/);

  if (!args || args.length === 0 || !args[0]) {
    return m.reply(
      `✨ *ALIGHT MOTION PREMIUM*\n\n` +
      `*Step 1 — Kirim magic link:*\n` +
      `\`${m.prefix}alight email@gmail.com\`\n\n` +
      `*Step 2 — Verifikasi link:*\n` +
      `\`${m.prefix}alight email@gmail.com https://...\`\n\n` +
      `📌 *Cara dapat link:*\n` +
      `• Buka inbox email (cek Spam juga)\n` +
      `• Cari email dari *Alight Motion / Alight Creative*\n` +
      `• Tekan tahan tombol *"Login ke Alight Creative"*\n` +
      `• Pilih *"Salin URL"* — jangan diklik langsung\n` +
      `• Paste link-nya di Step 2`
    );
  }

  const email = args[0];
  const rawLink = args[1] || null;

  // Validasi format email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return m.reply("❌ Format email tidak valid.");
  }

  m.react("🕐");

  try {
    if (!rawLink) {
      // Step 1: Kirim magic link
      const result = await sendMagicLink(email);

      m.react("📧");
      await m.reply(
        `✅ *Magic link berhasil dikirim!*\n\n` +
        `📧 *Email:* ${email}\n` +
        `📝 *Pesan:* ${result.message || "Link berhasil dikirim"}\n\n` +
        `*Langkah selanjutnya:*\n` +
        `1️⃣ Buka inbox email kamu (cek folder *Spam* juga)\n` +
        `2️⃣ Cari email dari *Alight Motion / Alight Creative*\n` +
        `3️⃣ Tekan tahan tombol *"Login ke Alight Creative"*\n` +
        `4️⃣ Pilih *"Salin URL"* — jangan diklik langsung!\n` +
        `5️⃣ Kirim dengan format:\n` +
        `\`${m.prefix}alight ${email} <link_yang_dicopy>\``
      );
    } else {
      // Step 2: Verifikasi link
      const result = await verifyMagicLink(email, rawLink);

      m.react("✅");
      await m.reply(
        `🎉 *Alight Motion Premium Berhasil!*\n\n` +
        `📧 *Email:* ${email}\n` +
        `✅ *Status:* ${result.message || "Account verified successfully"}\n` +
        `👑 *Premium:* Aktif\n` +
        `⏳ *Durasi:* 1 Tahun\n\n` +
        (result.oobCode ? `🔑 *oobCode:* \`${result.oobCode}\`\n` : "") +
        (result.idToken ? `🪙 *idToken:* \`${result.idToken.substring(0, 30)}...\`\n` : "") +
        `\n_Segera login ke Alight Motion dengan email ini._`
      );
    }
  } catch (err) {
    console.error("[AlightMotion Error]", err);
    m.react("❌");
    m.reply(
      `❌ *Gagal memproses request*\n` +
      `${err.response?.data?.message || err.message || "Terjadi kesalahan"}`
    );
  }
}

export { pluginConfig as config, handler };