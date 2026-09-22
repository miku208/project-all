import config from "../../config.js";
import { getDatabase } from "../../src/lib/miku-database.js";

const pluginConfig = {
  name: "cfmj",
  alias: ["fakemsg", "setfakemsg", "cfakemsg"],
  category: "owner",
  description: "Kelola aturan fakemsg-by-reaction (multi-emoji)",
  usage: ".cfmj <pesan> --emoji <emoji>",
  example: ".cfmj halo --emoji 😁",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 0,
  energi: 0,
  isEnabled: true,
};

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
function getReaction(m) {
  return (
    m?.message?.reactionMessage ||
    m?.msg?.reactionMessage ||
    (m?.mtype === "reactionMessage" ? m.message?.reactionMessage : null) ||
    null
  );
}
function isOwnerUser(m) {
  if (typeof m?.isOwner === "boolean") return m.isOwner;
  const sender = String(
    m?.sender || m?.key?.participant || m?.key?.remoteJid || ""
  ).replace(/\D/g, "");
  const ownerCfg = config?.owner || config?.owners || config?.ownerNumber || [];
  const list = Array.isArray(ownerCfg) ? ownerCfg : [ownerCfg];
  if (list.length === 0) return true;
  return list.some((o) => String(o).replace(/\D/g, "") === sender);
}

/**
 * Cari pesan asli di berbagai bentuk message store Baileys.
 * Return: proto.Message | null
 */
function findOriginalMessage(sock, key) {
  if (!key?.id || !key?.remoteJid) return null;
  const stores = [
    sock?.store,
    sock?.msgStore,
    global?.store,
    global?.conn?.store,
    global?.db?.store,
  ];
  for (const store of stores) {
    if (!store?.messages) continue;
    try {
      const bucket = store.messages[key.remoteJid];
      if (!bucket) continue;

      if (Array.isArray(bucket)) {
        const found = bucket.find(
          (x) => x?.key?.id === key.id || x?.id === key.id
        );
        if (found) return found.message || found.msg || found;
      }
      if (typeof bucket.get === "function") {
        const found = bucket.get(key.id);
        if (found) return found.message || found.msg || found;
      }
      if (bucket[key.id]) {
        const found = bucket[key.id];
        return found.message || found.msg || found;
      }
    } catch {}
  }
  return null;
}

async function safeReact(sock, chatJid, key, emoji) {
  try {
    await sock.sendMessage(chatJid, {
      react: {
        text: emoji,
        key: {
          remoteJid: chatJid,
          fromMe: key?.fromMe ?? true,
          id: key?.id || "",
        },
      },
    });
  } catch {}
}

/* ================== HANDLE REACTION ================== */
async function handleReaction(m, sock, reaction) {
  const db = getDatabase();
  const saved = db.setting("fakemsg") || {};
  const rules = Array.isArray(saved.rules)
    ? saved.rules
    : config.fakemsg?.rules || [];
  const enabled =
    typeof saved.enabled === "boolean"
      ? saved.enabled
      : config.fakemsg?.enabled !== false;
  if (!enabled) return;

  const emoji = reaction?.text;
  if (!emoji) return;

  const rule = rules.find((r) => r.emoji === emoji);
  if (!rule) return;

  const targetKey = reaction.key;
  if (!targetKey?.id) return;

  const chatJid = m.chat || targetKey.remoteJid || m.key?.remoteJid;
  if (!chatJid) return;

  const quoteKey = {
    remoteJid: targetKey.remoteJid || chatJid,
    fromMe: !!targetKey.fromMe,
    id: targetKey.id,
  };
  if (targetKey.participant) quoteKey.participant = targetKey.participant;

  /* --- mode hapus --- */
  if (rule.hapus) {
    try {
      await sock.sendMessage(chatJid, { delete: quoteKey });
    } catch (err) {
      console.error("[fakemsg] gagal hapus:", err?.message || err);
    }
    await safeReact(sock, chatJid, m.key, "");
    return;
  }

  /* --- cari pesan asli utk quote (KUNCI FIX CRASH) --- */
  const original = findOriginalMessage(sock, quoteKey);

  try {
    if (original) {
      await sock.sendMessage(
        chatJid,
        { text: String(rule.pesan) },
        { quoted: { key: quoteKey, message: original } }
      );
    } else {
      // fallback: kirim tanpa quote agar TIDAK crash klien WA
      await sock.sendMessage(chatJid, { text: String(rule.pesan) });
      console.warn(
        "[fakemsg] pesan asli tidak ditemukan di store, kirim tanpa quote"
      );
    }
  } catch (err) {
    console.error("[fakemsg] gagal kirim reply:", err?.message || err);
  }
}

/* ================== HANDLER UTAMA ================== */
async function handler(m, { sock } = {}) {
  try {
    const reaction = getReaction(m);

    if (reaction) {
      handleReaction(m, sock, reaction).catch((err) => {
        console.error("[fakemsg] reaction crash:", err?.message || err);
      });
      return;
    }

    if (!isOwnerUser(m)) return;

    const db = getDatabase();
    const args = m.args || [];
    const sub = (args[0] || "").toLowerCase();

    const saved = db.setting("fakemsg") || {};
    const baseRules = Array.isArray(saved.rules)
      ? saved.rules.map((r) => ({ ...r }))
      : (config.fakemsg?.rules || []).map((r) => ({ ...r }));

    const persist = (extra = {}) => {
      const cur = db.setting("fakemsg") || {};
      db.setting("fakemsg", { ...cur, rules: baseRules, ...extra });
      db.save();
    };

    // ... (list / on / off / del / reset / hapus TIDAK DIUBAH, sama seperti sebelumnya)
    // (saya ringkas agar fokus ke fix)

    if (["list", "daftar"].includes(sub)) {
      const enabledSaved =
        typeof saved.enabled === "boolean" ? saved.enabled : null;
      const enabledNow =
        enabledSaved !== null
          ? enabledSaved
          : config.fakemsg?.enabled !== false;
      if (baseRules.length === 0) {
        return m.reply(
          "📭 Belum ada aturan fakemsg.\nTambah: *.cfmj <pesan> --emoji 😁*"
        );
      }
      const lines = baseRules.map((r, i) => {
        const efek = r.hapus ? "🗑️ *mode hapus*" : truncate(r.pesan, 60);
        return `${i + 1}. ${r.emoji} → ${efek}`;
      });
      return m.reply(
        `⚙️ *Fakemsg Rules*\nStatus: ${
          enabledNow ? "✅ ON" : "❌ OFF"
        }${enabledSaved === null ? " (default config)" : ""}\nTotal: ${
          baseRules.length
        }\nEmoji hapus: ${
          saved.hapusEmoji || config.fakemsg?.hapusEmoji || "🗑️"
        }\n\n${lines.join("\n")}`
      );
    }
    if (["on", "aktif"].includes(sub)) {
      persist({ enabled: true });
      await safeReact(sock, m.chat, m.key, "✅");
      return m.reply("✅ Fitur *fakemsg* diaktifkan");
    }
    if (["off", "nonaktif", "mati"].includes(sub)) {
      persist({ enabled: false });
      await safeReact(sock, m.chat, m.key, "✅");
      return m.reply("❌ Fitur *fakemsg* dinonaktifkan");
    }
    if (["del", "hapus", "delete"].includes(sub)) {
      const rest = args.slice(1).join(" ");
      const emoji = extractEmoji(rest);
      if (!emoji)
        return m.reply("❌ Contoh: *.cfmj del 😁*");
      const idx = baseRules.findIndex((r) => r.emoji === emoji);
      if (idx === -1)
        return m.reply(`❌ Emoji ${emoji} tidak terdaftar.`);
      baseRules.splice(idx, 1);
      persist();
      await safeReact(sock, m.chat, m.key, "✅");
      return m.reply(`🗑️ Aturan ${emoji} dihapus. Sisa: ${baseRules.length}`);
    }
    if (["reset", "default"].includes(sub)) {
      const defRules = (config.fakemsg?.rules || []).map((r) => ({ ...r }));
      const cur = db.setting("fakemsg") || {};
      db.setting("fakemsg", { ...cur, rules: defRules });
      db.save();
      await safeReact(sock, m.chat, m.key, "✅");
      return m.reply(`♻️ Reset ke config (${defRules.length} aturan)`);
    }
    if (sub === "hapus" || sub === "delmsg") {
      const restH = args.slice(1).join(" ") || "";
      const emoji = extractEmoji(restH);
      if (!emoji) {
        const cur = saved.hapusEmoji || config.fakemsg?.hapusEmoji || "🗑️";
        return m.reply(
          `❓ *.cfmj hapus --emoji <emoji>*\nEmoji hapus saat ini: *${cur}*`
        );
      }
      const idx = baseRules.findIndex((r) => r.emoji === emoji);
      if (idx !== -1) baseRules[idx] = { emoji, hapus: true };
      else baseRules.push({ emoji, hapus: true });
      persist();
      await safeReact(sock, m.chat, m.key, "✅");
      return m.reply(`🗑️ Mode hapus ${emoji} ditambahkan.`);
    }

    /* --- tambah/ubah rule --- */
    const fullText = String(m.body || m.text || "").trim();
    let rest = fullText.replace(/^[^\s]+\s*/, "");
    if (!rest)
      return m.reply(`❓ Format: *.cfmj <pesan> --emoji <emoji>*`);

    let emoji, pesan;
    if (/--emoji\b/.test(rest)) {
      const [before, after] = rest.split(/--emoji\b/);
      pesan = (before || "").trim();
      emoji = extractEmoji(after) || extractEmoji(pesan);
    } else {
      emoji = extractEmoji(rest);
      if (emoji) pesan = rest.replace(emoji, "").trim();
    }

    if (!emoji) return m.reply("❌ Emoji tidak ditemukan.");
    if (!pesan) return m.reply("❌ Pesan kosong.");

    const idx = baseRules.findIndex((r) => r.emoji === emoji);
    const isUpdate = idx !== -1;
    if (isUpdate) {
      baseRules[idx].pesan = pesan;
      delete baseRules[idx].hapus;
    } else baseRules.push({ emoji, pesan });

    persist();
    await safeReact(sock, m.chat, m.key, "✅");
    return m.reply(
      `${isUpdate ? "🔄" : "✅"} Aturan ${emoji} ${
        isUpdate ? "diperbarui" : "ditambahkan"
      } (${baseRules.length} total):\n${emoji} → ${truncate(pesan, 80)}`
    );
  } catch (err) {
    console.error("[fakemsg] handler crash:", err?.message || err);
    try {
      await m.reply("⚠️ Terjadi error, coba lagi.");
    } catch {}
  }
}

export { pluginConfig as config, handler };