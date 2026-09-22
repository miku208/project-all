/**
 * Nama Plugin: Alight Motion Premium Generator (AlightPro)
 * Credit: hazeloffc (t.me/hazeloffc)
 * Base URL: https://www.alightpro.my.id
 */

import crypto from "crypto";

const CONFIG = {
  BASE_URL: "https://www.alightpro.my.id",
  SECRET: "amprem-human-v3-secret-2026",
  UA: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  TIMEOUT: 45000,
};

const pluginConfig = {
  name: "alightmotion",
  alias: ["alight", "am", "amgen", "alightpro"],
  category: "tools",
  description: "Generate akun premium Alight Motion",
  usage: ".alight <email> | .alight <email> <link>",
  example: ".alight user@gmail.com",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 15,
  energi: 1,
  isEnabled: true,
};

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function getSession() {
  const res = await fetch(`${CONFIG.BASE_URL}/api/session`, {
    signal: AbortSignal.timeout(CONFIG.TIMEOUT),
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Cache-Control": "no-store",
      "User-Agent": CONFIG.UA,
      Origin: CONFIG.BASE_URL,
      Referer: CONFIG.BASE_URL + "/",
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new Error(`Session endpoint HTTP ${res.status}`);

  const setCookie = res.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  const data = await res.json();

  if (!data.status || !data.token || !data.nonce) {
    throw new Error("Session token/nonce tidak valid dari server");
  }

  return { ...data, cookie };
}

function solvePow({ sessionId, nonce, timestamp, email, action, humanProof, difficulty }) {
  const base = `${sessionId}:${nonce}:${timestamp}:${email.toLowerCase()}:${action}:${humanProof}:`;
  for (let i = 0; i < 500000; i++) {
    if (sha256(base + i).startsWith(difficulty)) return String(i);
  }
  return Date.now().toString();
}

async function callAlight(body) {
  const s = await getSession();
  const delay = 2300 - (Date.now() - parseInt(s.timestamp, 10));
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));

  const humanProof = sha256(
    `human:${s.sessionId}:${s.nonce}:${s.timestamp}:${body.email.toLowerCase()}:5:${CONFIG.SECRET}`
  );
  const pow = solvePow({ ...s, email: body.email, action: body.action, humanProof });

  const res = await fetch(`${CONFIG.BASE_URL}/api/alight-motion`, {
    method: "POST",
    signal: AbortSignal.timeout(CONFIG.TIMEOUT),
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-Amprem-Token": s.token,
      "X-Amprem-Nonce": s.nonce,
      "X-Amprem-Pow": pow,
      "X-Amprem-Human-Proof": humanProof,
      Cookie: s.cookie,
      "User-Agent": CONFIG.UA,
      Origin: CONFIG.BASE_URL,
      Referer: CONFIG.BASE_URL + "/",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { success: false, error: `non-json HTTP ${res.status}` };
  }

  return { http: res.status, data };
}

async function sendMagicLink(email) {
  const { http, data } = await callAlight({ action: "send", email });
  if (!data.status) {
    throw new Error(data.msg || `Gagal kirim link (HTTP ${http})`);
  }
  return data.msg || "Link berhasil dikirim";
}

async function applyPremium(email, link) {
  const { http, data } = await callAlight({ action: "verify", email, link: link.trim() });
  if (!data.status || !data.data) {
    throw new Error(data.msg || `Gagal verifikasi (HTTP ${http})`);
  }
  const premium = data.data.premium?.result;
  return {
    message: data.msg || "Premium activated!",
    data: data.data,
    accountLinkStatus: premium?.accountLinkStatus,
    expiryTimeMillis: premium?.expiryTimeMillis,
    autoRenewing: premium?.autoRenewing,
  };
}

function formatExpiry(ms) {
  if (!ms) return "1 Tahun";
  const d = new Date(parseInt(ms));
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

async function handler(m, { sock }) {
  const args = m.text?.trim().split(/\s+/);

  if (!args || !args[0]) {
    return m.reply(
      `✨ *ALIGHT MOTION PREMIUM*\n\n` +
      `*Step 1 — Kirim magic link:*\n` +
      `\`${m.prefix}alight email@gmail.com\`\n\n` +
      `*Step 2 — Verifikasi link:*\n` +
      `\`${m.prefix}alight email@gmail.com https://...\`\n\n` +
      `📌 *Cara dapat link:*\n` +
      `• Buka inbox email (cek Spam juga)\n` +
      `• Cari email dari *AlightPro / Alight Creative*\n` +
      `• Tekan tahan tombol *"Login ke Alight Creative"*\n` +
      `• Pilih *"Salin URL"* — jangan diklik langsung\n` +
      `• Paste link-nya di Step 2`
    );
  }

  const email = args[0];
  const rawLink = args.slice(1).join(" ") || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return m.reply("❌ Format email tidak valid.");
  }

  m.react("🕐");

  try {
    if (!rawLink) {
      // Step 1: Kirim magic link
      const msg = await sendMagicLink(email);

      m.react("📧");
      await m.reply(
        `✅ *Magic link berhasil dikirim!*\n\n` +
        `📧 *Email:* ${email}\n` +
        `📝 *Pesan:* ${msg}\n\n` +
        `*Langkah selanjutnya:*\n` +
        `1️⃣ Buka inbox email kamu (cek folder *Spam* juga)\n` +
        `2️⃣ Cari email dari *AlightPro / Alight Creative*\n` +
        `3️⃣ Tekan tahan tombol *"Login ke Alight Creative"*\n` +
        `4️⃣ Pilih *"Salin URL"* — jangan diklik langsung!\n` +
        `5️⃣ Kirim dengan format:\n` +
        `\`${m.prefix}alight ${email} <link_yang_dicopy>\``
      );
    } else {
      // Step 2: Verifikasi dan aktifkan premium
      const result = await applyPremium(email, rawLink);

      m.react("✅");
      await m.reply(
        `🎉 *Alight Motion Premium Berhasil!*\n\n` +
        `📧 *Email:* ${email}\n` +
        `✅ *Status:* ${result.message}\n` +
        `👑 *Premium:* Aktif\n` +
        `⏳ *Expired:* ${formatExpiry(result.expiryTimeMillis)}\n` +
        `🔄 *Auto Renew:* ${result.autoRenewing ? "Ya" : "Tidak"}\n` +
        (result.accountLinkStatus ? `🔗 *Account Link:* ${result.accountLinkStatus}\n` : "") +
        `\n_Segera login ke Alight Motion dengan email ini._`
      );
    }
  } catch (err) {
    console.error("[AlightMotion Error]", err);
    m.react("❌");
    m.reply(`❌ *Gagal memproses request*\n${err.message || "Terjadi kesalahan"}`);
  }
}

export { pluginConfig as config, handler };