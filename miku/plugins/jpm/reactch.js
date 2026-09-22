/**
 * React Channel WA via Satria React Server 3
 *
 * Credit: xvlovers
 * Base url: https://satriareact.satriadeveloperz.workers.dev
 * Channel WhatsApp untuk info: https://whatsapp.com/channel/0029VbCKJpb6LwHpbtC1mb3E
 */
import axios from "axios";

const pluginConfig = {
  name: "reactch",
  alias: ["reactchannel", "rch"],
  category: "jpm",
  description: "React channel WhatsApp via Satria React server 3",
  usage: ".reactch <link> [emoji] [jumlah] [delay-ms]",
  example: ".reactch https://whatsapp.com/channel/0029... 🔥,❤️ 3 800",
  isOwner: false,
  isPremium: true,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 1,
  isEnabled: true,
};

const BASE_URL = "https://satriareact.satriadeveloperz.workers.dev";
const SERVER = 3;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Content-Type": "application/json",
  Origin: BASE_URL,
  Referer: BASE_URL + "/",
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handshake(server) {
  const response = await axios.post(
    `${BASE_URL}/api/handshake`,
    { server },
    { timeout: 30000, headers: HEADERS, validateStatus: () => true },
  );
  return response.data;
}

async function reactChannel(url, reactions, ticket, server) {
  const response = await axios.post(
    `${BASE_URL}/api/react`,
    {
      url,
      reactions,
      token: ticket?.id,
      ticket,
      server,
    },
    { timeout: 60000, headers: HEADERS, validateStatus: () => true },
  );
  return { status: response.status, data: response.data };
}

async function handler(m, { sock, args }) {
  const link = args[0];
  if (!link) {
    await m.reply(
      `❌ *Format salah!*\n\n` +
        `Penggunaan:\n${pluginConfig.usage}\n\n` +
        `Contoh:\n${pluginConfig.example}\n\n` +
        `Keterangan:\n` +
        `• emoji → pisah dengan koma (default 🔥)\n` +
        `• jumlah → berapa kali react (default 1)\n` +
        `• delay → jeda antar react ms (default 800)`,
    );
    return;
  }

  const emojis = args[1] || "🔥";
  const jumlah = Math.min(Math.max(parseInt(args[2]) || 1, 1), 25);
  const delayMs = Math.min(Math.max(parseInt(args[3]) || 800, 0), 10000);

  const waitMsg = await sock.sendMessage(
    m.chat,
    { text: `⏳ React channel dimulai...\n\n🔗 ${link}\n🎭 ${emojis}\n🔁 ${jumlah}x\n⏱️ delay ${delayMs}ms\n🖥️ server ${SERVER}` },
    { quoted: m },
  );  try {
    let hs;
    try {
      hs = await handshake(SERVER);
    } catch (e) {
      throw new Error(`Handshake gagal: ${e.message}`);
    }

    const ticket = hs?.ticket || null;
    if (!hs?.success || !ticket?.id) {
      throw new Error(hs?.error || hs?.message || "Handshake gagal, server tidak memberi tiket");
    }

    const emojiList = emojis
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    let successCount = 0;
    let failedCount = 0;
    let myTicket = ticket;

    for (let i = 0; i < jumlah; i++) {
      const shuffled = [...emojiList].sort(() => Math.random() - 0.5);
      try {
        const result = await reactChannel(link.trim(), shuffled, myTicket, SERVER);
        if (result.status === 200 && result.data?.success) {
          successCount++;
        } else if (result.status === 403) {
          // tiket expired/invalid → handshake ulang dan ulangi iterasi ini
          const newHs = await handshake(SERVER);
          const newTicket = newHs?.ticket || null;
          if (newHs?.success && newTicket?.id) {
            myTicket = newTicket;
            i--;
            continue;
          }
          failedCount++;
        } else {
          failedCount++;
        }
      } catch (e) {
        failedCount++;
      }
      if (i < jumlah - 1 && delayMs > 0) {
        await delay(delayMs);
      }
    }

    const teks =
      `✅ *REACT CHANNEL SELESAI*\n\n` +
      `🔗 Link : ${link}\n` +
      `🎭 Emoji : ${emojiList.join(", ")}\n` +
      `🖥️ Server : ${SERVER}\n\n` +
      `✨ Berhasil : ${successCount}\n` +
      `💥 Gagal : ${failedCount}\n\n` +
      `${successCount > 0 ? "React berhasil dikirim 🎉" : "Semua react gagal 😢"}`;

    await sock.sendMessage(m.chat, { text: teks, edit: waitMsg.key });
  } catch (error) {
    const teks = `❌ *REACT CHANNEL GAGAL*\n\n${error.message}`;
    try {
      await sock.sendMessage(m.chat, { text: teks, edit: waitMsg.key });
    } catch {
      await m.reply(teks);
    }
  }
}

export { pluginConfig as config, handler };
