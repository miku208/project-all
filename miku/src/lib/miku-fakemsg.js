/**
 * Fakemsg via Reaction (tanpa jejak) — multi-emoji
 * ------------------------------------------------
 * Owner me-react pesan sasaran dengan salah satu emoji terdaftar:
 *   1. Bot kirim pesan sementara (teks kosong) untuk mendapat slot ID pesan.
 *   2. Bot "mengedit" pesan sementara itu menjadi teks fakemsg, TAPI dengan
 *      messageId = ID pesan sasaran (stanzaId) — sehingga klien menampilkan
 *      teks itu seolah-olah berasal dari pesan sasaran.
 *   3. Semua jejak dihapus: pesan sementara, pesan sasaran, dan reaksi.
 *
 * Aturan emoji → pesan disimpan di database (db.setting "fakemsg"),
 * dikelola via perintah .cfmj. Fallback: config.fakemsg.rules.
 *
 * Sumber konsep: https://snippet.zellrayy.com/cMe98trkQ5
 * Diadaptasi untuk arsitektur Miku (hook di raw stream connection.js karena
 * reactionMessage tidak sampai ke messageHandler).
 */
import config from "../../config.js";
import { getDatabase } from "./miku-database.js";
import { isLid, lidToJid } from "./miku-lid.js";

// Dedupe sederhana — WA kadang mengirim ulang reaction yang sama saat reconnect.
const processed = new Set();
const PROCESSED_MAX = 200;

function digits(jid) {
  return String(jid || "").split("@")[0].replace(/[^0-9]/g, "");
}

function isOwnerSender(rawJid) {
  if (!rawJid) return false;
  let jid = String(rawJid);
  if (isLid(jid)) jid = lidToJid(jid) || jid;
  const sender = digits(jid);
  if (!sender) return false;

  const ownerNumbers = [
    ...(config.owner?.number || []),
    config.bot?.number,
  ]
    .filter(Boolean)
    .map((n) => String(n).replace(/[^0-9]/g, ""));

  return ownerNumbers.some(
    (o) => sender.startsWith(o) || o.startsWith(sender),
  );
}

/** Aktif/nonaktif: override database (.cfmj off) > config.fakemsg.enabled */
function isEnabled() {
  try {
    const db = getDatabase();
    const saved = db?.ready ? db.setting("fakemsg") : undefined;
    if (saved && typeof saved.enabled === "boolean") return saved.enabled;
  } catch { }
  return config.fakemsg?.enabled !== false;
}

/** Daftar rules gabungan: database (utama) + config (fallback) */
function getRules() {
  const rules = [];
  try {
    const db = getDatabase();
    const saved = db?.ready ? db.setting("fakemsg") : undefined;
    if (Array.isArray(saved?.rules)) rules.push(...saved.rules);
  } catch { }
  if (rules.length === 0 && Array.isArray(config.fakemsg?.rules)) {
    rules.push(...config.fakemsg.rules);
  }
  return rules.filter((r) => r?.emoji && typeof r.pesan === "string");
}

/** Emoji pemicu hapus (override db > config > bawaan 🗑️) */
function getHapusEmoji() {
  try {
    const db = getDatabase();
    const saved = db?.ready ? db.setting("fakemsg") : undefined;
    if (saved?.hapusEmoji) return saved.hapusEmoji;
  } catch { }
  return config.fakemsg?.hapusEmoji || "🗑️";
}

/**
 * @param {object} msg - pesan reaction mentah
 * @param {object} sock - socket WA aktif
 * @returns {Promise<boolean>} true jika reaction ditangani sebagai fakemsg/hapus
 */
export async function handleFakeMsgReaction(msg, sock) {
  try {
    if (!isEnabled()) return false;

    const reaction = msg.message?.reactionMessage;
    if (!reaction) return false;

    const rules = getRules();
    const rule = rules.find((r) => r.emoji === reaction.text);
    const isHapus = reaction.text === getHapusEmoji() || rule?.hapus === true;
    if (!rule && !isHapus) return false;

    const chat = msg.key?.remoteJid || "";
    if (!chat || chat.endsWith("@broadcast") || chat.endsWith("@newsletter")) {
      return false;
    }

    // Owner-only: reaksi dari bot sendiri diizinkan; selain itu harus nomor owner.
    const reactionSender =
      msg.key?.participant || msg.participant || (msg.key?.fromMe ? null : chat);
    if (!msg.key?.fromMe && !isOwnerSender(reactionSender)) return false;

    // Dedupe
    const dedupeKey = `${msg.key?.id || ""}|${reaction.key?.id || ""}`;
    if (processed.has(dedupeKey)) return true;
    processed.add(dedupeKey);
    if (processed.size > PROCESSED_MAX) processed.clear();

    const targetKey = reaction.key || {};
    const stanzaId = targetKey.id; // ID pesan sasaran yang direact
    const participant = targetKey.participant; // pengirim pesan sasaran (di grup)
    if (!stanzaId) return false;

    console.log(
      `[fakemsg] dipicu oleh ${reactionSender || "bot-sendiri"} di ${chat} → sasaran ${stanzaId} (emoji: ${rule?.emoji || reaction.text}${isHapus ? ", mode: hapus" : ""})`,
    );

    // ---- MODE HAPUS: hapus pesan sasaran + reaksinya, tanpa mengganti teks ----
    if (isHapus) {
      const botNum = digits(sock.user?.id) || digits(config.bot?.number);
      const targetIsOwn = !participant || digits(participant) === botNum;
      // Coba flag yang paling mungkin; fallback dikirim sekaligus (allSettled) —
      // yang gagal diabaikan diam-diam.
      const attempts = targetIsOwn
        ? [
            { delete: { remoteJid: chat, id: stanzaId, fromMe: true } },
            participant
              ? { delete: { remoteJid: chat, id: stanzaId, fromMe: false, participant } }
              : null,
          ].filter(Boolean)
        : [
            { delete: { remoteJid: chat, id: stanzaId, fromMe: false, participant } },
            { delete: { remoteJid: chat, id: stanzaId, fromMe: true } },
          ];
      // Hapus juga reaksi pemicunya
      attempts.push({
        delete: {
          remoteJid: chat,
          id: msg.key.id,
          fromMe: false,
          participant: msg.key.participant || msg.participant,
        },
      });
      await Promise.allSettled(attempts.map((d) => sock.sendMessage(chat, d)));
      return true;
    }

    // 1) Pesan sementara (teks kosong) untuk mendapatkan ID pesan
    const temp = await sock.sendMessage(
      chat,
      { text: "", contextInfo: { isGroupStatus: true } },
      { quoted: msg },
    );
    const tempId = temp?.key?.id;
    if (!tempId) return false;

    // 2) Edit pesan sementara -> teks fakemsg, dengan messageId = ID sasaran
    await sock.sendMessage(
      chat,
      { text: rule.pesan, edit: { id: tempId } },
      { messageId: stanzaId },
    );

    // 3) Hapus semua jejak: pesan sementara, pesan sasaran, reaksi
    await Promise.allSettled([
      sock.sendMessage(chat, {
        delete: { remoteJid: chat, id: tempId, fromMe: true },
      }),
      sock.sendMessage(chat, {
        delete: {
          remoteJid: chat,
          id: stanzaId,
          fromMe: true,
          participant,
        },
      }),
      sock.sendMessage(chat, {
        delete: {
          remoteJid: chat,
          id: msg.key.id,
          fromMe: false,
          participant: msg.key.participant || msg.participant,
        },
      }),
    ]);

    return true;
  } catch (e) {
    console.error("[fakemsg]", e?.message || e);
    return false;
  }
}
