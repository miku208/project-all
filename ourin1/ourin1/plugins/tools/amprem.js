import axios from 'axios';
import config from '../../config.js';

// Konfigurasi plugin
const pluginConfig = {
  name: 'amprem',
  alias: ['amprem'],
  category: 'tools',
  description: 'Dapatkan premium Alight Motion 1 tahun via email',
  usage: '.amprem <email>',
  example: '.amprem email@domain.com',
  cooldown: 30, // detik
  energi: 1,
  isEnabled: true,
};

// API endpoints
const BASE_URL = 'https://am.yappi.my.id';
const COOKIE_API = `${BASE_URL}/api/cookie`;
const SEND_API = `${BASE_URL}/api/send`;
const VERIFY_API = `${BASE_URL}/api/verify`;

// State sesi per pengguna (key: nomor pengguna)
const userSessions = new Map();

// --- Helper functions ---
async function getSessionCookie() {
  try {
    const res = await axios.get(COOKIE_API, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36' }
    });
    if (res.data?.ok && res.data?.cookie) return res.data.cookie;
    throw new Error('Gagal mendapatkan session cookie');
  } catch (err) {
    throw new Error(`Cookie API Error: ${err.message}`);
  }
}

async function sendVerificationLink(email, cookie) {
  const res = await axios.post(SEND_API, { email, cookie }, {
    headers: {
      'Content-Type': 'application/json',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
    },
    timeout: 30000
  });
  if (!res.data?.ok) throw new Error(res.data?.error || 'Gagal mengirim link');
  return true;
}

async function verifyMagicLink(email, link, cookie) {
  const res = await axios.post(VERIFY_API, { email, link, cookie }, {
    headers: {
      'Content-Type': 'application/json',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
    },
    timeout: 30000
  });
  if (!res.data?.ok) throw new Error(res.data?.error || 'Verifikasi gagal');
  return { success: true, userData: res.data.data?.user || null };
}

// --- Handler utama ---
async function handler(m, { sock, text }) {
  const sender = m.chat; // atau m.key.remoteJid
  const isCommand = m.text?.startsWith(m.prefix + 'amprem') || m.text?.startsWith(m.prefix + 'alightpremium');
  
  // Cek apakah pengguna memiliki sesi aktif
  const session = userSessions.get(sender);

  // Jika ada sesi dan pesan bukan perintah, proses sebagai balasan link atau cancel
  if (session && !isCommand) {
    const msgText = m.text?.trim() || '';

    // Perintah batal
    if (msgText.toLowerCase() === 'cancel') {
      clearTimeout(session.timeout);
      userSessions.delete(sender);
      await m.reply('❌ Proses dibatalkan.');
      return;
    }

    // Jika sedang menunggu link
    if (session.step === 'waiting_link') {
      // Pastikan link cukup panjang (asumsi URL)
      if (msgText.length < 10) {
        await m.reply('⚠️ Link tidak valid. Pastikan Anda menyalin seluruh link yang diterima di email.');
        return;
      }

      try {
        clearTimeout(session.timeout);
        await m.reply('🔍 Memverifikasi link...');
        const result = await verifyMagicLink(session.email, msgText, session.cookie);
        userSessions.delete(sender);

        let userInfo = JSON.stringify(result.userData, null, 2);
        await m.reply(
          `✅ *VERIFIKASI BERHASIL!*\n\n` +
          `🎉 Akun Anda telah diaktifkan premium untuk 1 tahun.\n` +
          `⏳ Tunggu 1–4 menit agar premium aktif di aplikasi Alight Motion.\n\n` +
          `📊 Data user:\n${userInfo}`
        );
        await m.react('✅');
      } catch (err) {
        userSessions.delete(sender);
        await m.reply(`❌ Verifikasi gagal: ${err.message}`);
        await m.react('❌');
      }
      return;
    }
    // Jika step lain (tidak mungkin), abaikan
    return;
  }

  // Jika bukan perintah .amprem, lewati
  if (!isCommand) return;

  // --- Proses perintah .amprem ---
  const args = m.text?.trim().split(/\s+/);
  if (!args || args.length < 2) {
    await m.reply(`📧 Masukkan email Anda.\nContoh: ${m.prefix}amprem email@domain.com`);
    return;
  }
  const email = args[1];

  // Cegah tumpang tindih sesi
  if (userSessions.has(sender)) {
    await m.reply('⏳ Anda masih dalam proses verifikasi. Selesaikan atau ketik *cancel* untuk membatalkan.');
    return;
  }

  try {
    await m.reply('🔄 Menginisialisasi sesi...');
    const cookie = await getSessionCookie();

    await m.reply(`📨 Mengirim link verifikasi ke ${email}...`);
    await sendVerificationLink(email, cookie);

    // Buat timeout 5 menit
    const timeout = setTimeout(() => {
      if (userSessions.has(sender)) {
        userSessions.delete(sender);
        // Kirim notifikasi kadaluwarsa
        sock.sendMessage(sender, { text: '⏰ Sesi verifikasi kadaluwarsa (5 menit). Ulangi perintah.' });
      }
    }, 5 * 60 * 1000);

    // Simpan sesi
    userSessions.set(sender, {
      email,
      cookie,
      step: 'waiting_link',
      timeout
    });

    await m.reply(
      `✅ Link verifikasi terkirim!\n\n` +
      `📬 Cek *Spam* di ${email}, buka email dari *noreply*, *tekan & tahan* teks "Sign in to Alight Creative", salin link, lalu *balas pesan ini dengan link*.\n\n` +
      `⏳ Anda punya 5 menit. Ketik *cancel* untuk membatalkan.`
    );
    await m.react('📨');
  } catch (err) {
    await m.reply(`❌ Gagal: ${err.message}`);
    await m.react('❌');
  }
}

export { pluginConfig as config, handler };