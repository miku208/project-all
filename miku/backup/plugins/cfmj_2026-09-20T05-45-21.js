import config from "../../config.js";
import { getDatabase } from "../../src/lib/miku-database.js";

const pluginConfig = {
  name: "cfmj",
  alias: ["fakemsg", "setfakemsg", "cfakemsg"],
  category: "owner",
  description:
    "Kelola aturan fakemsg-by-reaction (multi-emoji): tambah pasangan emoji → pesan, aktif/nonaktif, hapus, reset",
  usage:
    ".cfmj <pesan> --emoji <emoji>\n.cfmj hapus --emoji <emoji>\n.cfmj list\n.cfmj del <emoji>\n.cfmj on | .cfmj off\n.cfmj reset",
  example: ".cfmj halo --emoji 😁",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
};

// Emoji grapheme: inti + modifier skin-tone / variation selector / ZWJ-sequence
const EMOJI_RE =
  /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?))*/u;

function extractEmoji(str) {
  const found = String(str || "").match(EMOJI_RE);
  return found ? found[0] : null;
}

function truncate(s, n = 40) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function handler(m, { sock }) {
  const db = getDatabase();
  const args = m.args || [];
  const sub = (args[0] || "").toLowerCase();

  const saved = db.setting("fakemsg") || {};
  const savedHasRules = Array.isArray(saved.rules);
  const baseRules = savedHasRules
    ? saved.rules.map((r) => ({ ...r }))
    : (config.fakemsg?.rules || []).map((r) => ({ ...r }));

  const persist = (extra = {}) => {
    db.setting("fakemsg", { ...saved, rules: baseRules, ...extra });
    db.save();
  };

  // ---------- LIST ----------
  if (["list", "daftar"].includes(sub)) {
    const enabledSaved = typeof saved.enabled === "boolean" ? saved.enabled : null;
    const enabledNow =
      enabledSaved !== null ? enabledSaved : config.fakemsg?.enabled !== false;
    if (baseRules.length === 0) {
      return m.reply("📭 Belum ada aturan fakemsg.\nTambah: *.cfmj <pesan> --emoji 😁*");
    }
    const lines = baseRules.map((r, i) => {
      const efek = r.hapus ? "🗑️ *mode hapus*" : truncate(r.pesan, 60);
      return `${i + 1}. ${r.emoji} → ${efek}`;
    });
    return m.reply(
      `⚙️ *Fakemsg Rules*\nStatus: ${enabledNow ? "✅ ON" : "❌ OFF"}${enabledSaved === null ? " (default config)" : ""}\nTotal: ${baseRules.length}\nEmoji hapus: ${saved.hapusEmoji || config.fakemsg?.hapusEmoji || "🗑️"}\n\n${lines.join("\n")}\n\n• Tambah/ubah: .cfmj <pesan> --emoji <emoji>\n• Mode hapus: .cfmj hapus --emoji <emoji>\n• Hapus aturan: .cfmj del <emoji>\n• On/Off: .cfmj on | .cfmj off\n• Reset ke config: .cfmj reset`,
    );
  }

  // ---------- ON / OFF ----------
  if (["on", "aktif"].includes(sub)) {
    persist({ enabled: true });
    await m.react("✅");
    return m.reply("✅ Fitur *fakemsg* diaktifkan");
  }
  if (["off", "nonaktif", "mati"].includes(sub)) {
    persist({ enabled: false });
    await m.react("✅");
    return m.reply("❌ Fitur *fakemsg* dinonaktifkan");
  }

  // ---------- DEL ----------
  if (["del", "hapus", "delete"].includes(sub)) {
    const rest = args.slice(1).join(" ");
    const emoji = extractEmoji(rest);
    if (!emoji) return m.reply("❌ Sebutkan emoji yang mau dihapus.\nContoh: *.cfmj del 😁*");
    const idx = baseRules.findIndex((r) => r.emoji === emoji);
    if (idx === -1)
      return m.reply(`❌ Emoji ${emoji} tidak terdaftar. Cek: *.cfmj list*`);
    baseRules.splice(idx, 1);
    persist();
    await m.react("✅");
    return m.reply(`🗑️ Aturan ${emoji} dihapus. Sisa: ${baseRules.length} aturan`);
  }

  // ---------- RESET ----------
  if (["reset", "default"].includes(sub)) {
    const defRules = (config.fakemsg?.rules || []).map((r) => ({ ...r }));
    db.setting("fakemsg", { ...saved, rules: defRules });
    db.save();
    await m.react("✅");
    return m.reply(`♻️ Aturan direset ke config.js (${defRules.length} aturan)`);
  }

  // ---------- HAPUS-MODE (reaction → delete pesan sasaran) ----------
  if (sub === "hapus" || sub === "delmsg") {
    const restH = args.slice(1).join(" ") || "";
    const emoji = extractEmoji(restH);
    if (!emoji) {
      const cur = saved.hapusEmoji || config.fakemsg?.hapusEmoji || "🗑️";
      return m.reply(
        `❓ Format: *.cfmj hapus --emoji <emoji>*\nEmoji hapus bawaan saat ini: *${cur}*\n\nContoh: .cfmj hapus --emoji 🚫`,
      );
    }
    const idx = baseRules.findIndex((r) => r.emoji === emoji);
    if (idx !== -1) baseRules[idx] = { emoji, hapus: true };
    else baseRules.push({ emoji, hapus: true });
    persist();
    await m.react("✅");
    return m.reply(
      `🗑️ Aturan hapus ${emoji} ditambahkan (${baseRules.length} total).\nReact ${emoji} ke pesan → pesan itu dihapus bot (reaksinya ikut terhapus).`,
    );
  }

  // ---------- ADD / UPDATE (default) ----------
  // Ambil teks setelah token perintah pertama (pertahankan newline)
  const fullText = String(m.body || m.text || "").trim();
  let rest = fullText.replace(/^[^\s]+\s*/, "");

  if (!rest) {
    return m.reply(
      `❓ Format:\n*.cfmj <pesan> --emoji <emoji>*\n\nContoh:\n.cfmj segera gunakan https://example.com --emoji 😁\n\nLainnya: .cfmj list | del 😁 | on | off | reset`,
    );
  }

  let emoji, pesan;
  if (/--emoji\b/.test(rest)) {
    const [before, after] = rest.split(/--emoji\b/);
    pesan = (before || "").trim();
    emoji = extractEmoji(after) || extractEmoji(pesan);
  } else {
    emoji = extractEmoji(rest);
    if (emoji) pesan = rest.replace(emoji, "").trim();
  }

  if (!emoji)
    return m.reply("❌ Emoji tidak ditemukan. Sertakan emoji, contoh: *.cfmj halo --emoji 😁*");
  if (!pesan)
    return m.reply("❌ Pesan kosong. Contoh: *.cfmj halo --emoji 😁*");

  const idx = baseRules.findIndex((r) => r.emoji === emoji);
  const isUpdate = idx !== -1;
  if (isUpdate) {
    baseRules[idx].pesan = pesan;
    delete baseRules[idx].hapus;
  } else baseRules.push({ emoji, pesan });

  persist();
  await m.react("✅");
  return m.reply(
    `${isUpdate ? "🔄" : "✅"} Aturan ${emoji} ${isUpdate ? "diperbarui" : "ditambahkan"} (${baseRules.length} total):\n${emoji} → ${truncate(pesan, 80)}\n\nCara pakai: react ${emoji} ke pesan sasaran.`,
  );
}

export { pluginConfig as config, handler };
