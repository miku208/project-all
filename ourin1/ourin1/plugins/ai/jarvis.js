/**
 * Nama Plugin: Jarvis AI
 * Fungsi: Chat AI dengan kepribadian Jarvis
 */

import axios from "axios";
import { AIRich } from "../../src/lib/ourin-builder.js";

const pluginConfig = {
  name: "jarvis",
  alias: ["ai", "claude", "gpt", "ask"],
  category: "ai",
  description: "Chat dengan Jarvis AI",
  usage: ".jarvis <pertanyaan>",
  example: ".jarvis siapa kamu?",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 1,
  isEnabled: true,
};

const JARVIS_PROMPT = `Kamu adalah JARVIS, asisten AI canggih milik bot WhatsApp ini.
Kepribadianmu:
- Cerdas, elegan, dan sedikit sarkastik seperti JARVIS di Iron Man
- Selalu memanggil user dengan "Tuan" atau "Nyonya"
- Jawab dalam Bahasa Indonesia yang natural dan santai
- Sesekali sisipkan humor halus
- Jangan pernah bilang kamu adalah Claude atau AI lain
- Kamu adalah JARVIS, asisten pribadi yang setia
- Jawaban singkat dan padat kecuali diminta detail`;

async function askJarvis(text) {
  const prompt = `${JARVIS_PROMPT}\n\nUser: ${text}\nJARVIS:`;
  const { data } = await axios.get(
    `https://api.nexray.eu.cc/ai/claude?text=${encodeURIComponent(prompt)}`
  );
  if (!data?.status || !data?.result) {
    throw new Error("AI tidak merespons");
  }
  return data.result;
}

async function handler(m, { sock }) {
  const query = m.text?.trim();

  if (!query) {
    return m.reply(
      `🤖 *JARVIS AI*\n\n` +
      `_"At your service, Tuan."_\n\n` +
      `*Penggunaan:*\n` +
      `• \`${m.prefix}jarvis <pertanyaan>\`\n\n` +
      `*Contoh:*\n` +
      `• \`${m.prefix}jarvis siapa kamu?\`\n` +
      `• \`${m.prefix}jarvis jelaskan teori relativitas\``
    );
  }

  m.react("🕐");

  try {
    const reply = await askJarvis(query);

    // Pisahkan teks biasa dan blok kode
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    const codeBlocks = [];
    let cleanReply = reply.replace(codeBlockRegex, (match, lang, code) => {
      codeBlocks.push({ lang: lang || "text", code: code.trim() });
      return `[KODE_${codeBlocks.length - 1}]`;
    });

    // Kirim teks utama via tabel AIRich
    const builder = new AIRich(sock);
    builder.addTable([
      ["🤖 JARVIS", cleanReply.trim()],
    ]);
    await builder.send(m.chat, { quoted: m });

    // Kirim setiap blok kode sebagai pesan terpisah
    for (const { lang, code } of codeBlocks) {
      await sock.sendMessage(
        m.chat,
        { text: `\`\`\`${lang}\n${code}\n\`\`\`` },
        { quoted: m }
      );
    }
    m.react("✅");
  } catch (err) {
    console.error("[Jarvis Error]", err);
    m.react("❌");
    m.reply(`❌ *JARVIS Error:* ${err.message || "Terjadi kesalahan"}`);
  }
}

export { pluginConfig as config, handler };