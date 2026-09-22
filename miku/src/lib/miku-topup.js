import fs from "fs";
import path from "path";
import moment from "moment-timezone";
import config from "../../config.js";
import { getDatabase } from "./miku-database.js";
import { logger } from "./miku-logger.js";

/* ═══════════════════════════════════════════════════════════════════════════
   MIKU TOP UP — Permintaan top up + notifikasi bukti pembayaran ke OWNER
   ─────────────────────────────────────────────────────────────────────────
   • Semua nomor owner diambil dari config.js (config.owner.number).
     JANGAN hardcode nomor owner di file lain.
   • Alur: user buat request (.topup) → kirim bukti transfer (gambar) →
     bukti disimpan → notifikasi otomatis ke owner → owner review
     (.topupapprove / .topupreject).
   ═══════════════════════════════════════════════════════════════════════ */

const SETTING_KEY = "topup_requests";
const PROOF_DIR = path.resolve(
  config.database?.path || "./database/main",
  "topup_proofs",
);

/* ==================== HELPERS ==================== */

const rupiah = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;
const fmtDate = (ts) =>
  moment(Number(ts)).tz("Asia/Jakarta").format("D MMMM YYYY, HH:mm");

function cleanNumber(x) {
  return String(x || "").split(":")[0].split("@")[0].replace(/[^0-9]/g, "");
}

/**
 * Ambil daftar JID owner dari config.js (satu-satunya sumber).
 * Mendukung config.owner.number berupa array atau string.
 */
function getOwnerJids() {
  const raw = config.owner?.number;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const numbers = [
    ...new Set(list.map(cleanNumber).filter((n) => n.length > 0)),
  ];
  return numbers.map((n) => `${n}@s.whatsapp.net`);
}

/** Parse nominal fleksibel: "10.000", "10000", "10k", "10rb" → number */
function parseNominal(str) {
  const s = String(str || "").trim().toLowerCase();
  if (!s) return 0;
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(k|rb|ribu)?$/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  if (m[2]) n *= 1000; // k / rb / ribu
  return Math.floor(n);
}

function genTopupId() {
  return `topup_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function extFromMime(mime) {
  if (mime) {
    if (mime.includes("png")) return ".png";
    if (mime.includes("webp")) return ".webp";
  }
  return ".jpg";
}

/* ==================== MANAGER (penyimpanan di database) ==================== */

class TopupManager {
  _db() {
    try {
      return getDatabase();
    } catch {
      return null;
    }
  }

  _all() {
    try {
      return this._db()?.setting(SETTING_KEY) || {};
    } catch {
      return {};
    }
  }

  _write(data) {
    try {
      this._db()?.setting(SETTING_KEY, data);
    } catch (e) {
      logger.error("topup", `gagal simpan request: ${e.message}`);
    }
  }

  create(userJid, { name, nominal, chat } = {}) {
    const all = this._all();
    const request = {
      id: genTopupId(),
      userJid,
      userName: name || "Unknown",
      nominal: Number(nominal) || 0,
      status: "PENDING",
      proofPath: null,
      proofMime: null,
      chat: chat || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
    };
    if (!all[userJid]) all[userJid] = [];
    all[userJid].push(request);
    this._write(all);
    return request;
  }

  get(id) {
    if (!id) return null;
    for (const userJid of Object.keys(this._all())) {
      const found = this._all()[userJid]?.find((r) => r.id === id);
      if (found) return found;
    }
    return null;
  }

  getByUser(userJid) {
    return this._all()[userJid] || [];
  }

  /** Request milik user yang masih menunggu bukti/review */
  findPendingByUser(userJid) {
    const list = this.getByUser(userJid)
      .filter((r) => r.status === "PENDING")
      .sort((a, b) => b.createdAt - a.createdAt);
    return list[0] || null;
  }

  /** Semua request (flat) terbaru dulu */
  list(status = null, limit = 10) {
    let flat = [];
    for (const userJid of Object.keys(this._all())) {
      flat.push(...this._all()[userJid]);
    }
    flat.sort((a, b) => b.createdAt - a.createdAt);
    if (status && status !== "all") flat = flat.filter((r) => r.status === status);
    return flat.slice(0, limit);
  }

  update(id, patch) {
    const all = this._all();
    for (const userJid of Object.keys(all)) {
      const idx = all[userJid]?.findIndex((r) => r.id === id);
      if (idx !== -1 && idx !== undefined) {
        all[userJid][idx] = { ...all[userJid][idx], ...patch, updatedAt: Date.now() };
        this._write(all);
        return all[userJid][idx];
      }
    }
    return null;
  }

  /* ---------- Bukti transfer (disimpan sebagai file) ---------- */

  saveProof(id, buffer, mime) {
    const request = this.get(id);
    if (!request || !buffer) return null;
    try {
      fs.mkdirSync(PROOF_DIR, { recursive: true });
      const ext = extFromMime(mime);
      const filePath = path.join(PROOF_DIR, `${id}${ext}`);
      fs.writeFileSync(filePath, buffer);
      return this.update(id, { proofPath: filePath, proofMime: mime || null });
    } catch (e) {
      logger.error("topup", `gagal simpan bukti ${id}: ${e.message}`);
      return null;
    }
  }

  readProof(id) {
    const request = this.get(id);
    if (!request?.proofPath) return null;
    try {
      return fs.readFileSync(request.proofPath);
    } catch {
      return null;
    }
  }
}

/* ==================== NOTIFIKASI OWNER ==================== */

/**
 * Bangun teks notifikasi 💰 PAYMENT REQUEST sesuai format standar.
 */
function buildNotificationText(request) {
  const userId = cleanNumber(request.userJid);
  const proofLabel = request.proofPath ? "[gambar bukti pembayaran ✅]" : "[belum ada bukti]";

  return (
    `💰 *PAYMENT REQUEST*\n\n` +
    `User:\n@${request.userName || userId}\n` +
    `User ID:\n${userId}\n\n` +
    `Nominal:\n${rupiah(request.nominal)}\n` +
    `Top Up ID:\n\`${request.id}\`\n` +
    `Status:\n*${request.status}*\n\n` +
    `Waktu:\n${fmtDate(request.createdAt)}\n\n` +
    `Bukti Transfer:\n${proofLabel}\n\n` +
    `Silakan review:\n` +
    `• \`${config.command?.prefix || "."}topupapprove ${request.id}\` untuk setujui\n` +
    `• \`${config.command?.prefix || "."}topupreject ${request.id}\` untuk tolak`
  );
}

/**
 * Kirim notifikasi payment request ke SEMUA owner (dari config.js).
 * - Jika bukti tersedia: kirim sebagai image message + caption.
 * - Jika kirim gambar gagal (error/ukuran/file): kirim notifikasi text
 *   tetap berisi reference ID topup.
 *
 * @returns {Promise<{sent: number, failed: number, owners: string[]}>}
 */
async function notifyOwnerPayment(sock, request) {
  const ownerJids = getOwnerJids();
  const result = { sent: 0, failed: 0, owners: ownerJids };

  if (!ownerJids.length) {
    logger.warn("topup", "config.owner.number kosong — notifikasi owner dilewati");
    return result;
  }

  const text = buildNotificationText(request);
  const proofBuffer = topupManager.readProof(request.id);

  for (const jid of ownerJids) {
    let delivered = false;

    // 1) Coba kirim gambar bukti + caption
    if (proofBuffer) {
      try {
        await sock.sendMessage(
          jid,
          {
            image: proofBuffer,
            caption: text,
            mentions: [request.userJid],
          },
        );
        delivered = true;
      } catch (e) {
        logger.error(
          "topup",
          `gagal kirim gambar bukti ke owner ${cleanNumber(jid)}: ${e.message}`,
        );
      }
    }

    // 2) Fallback: tetap kirim notifikasi text + reference ID topup
    if (!delivered) {
      try {
        const fallbackNote = proofBuffer
          ? `\n\n⚠️ _Gambar bukti gagal terkirim. Bukti tetap tersimpan — lihat via \`${config.command?.prefix || "."}topupproof ${request.id}\`._`
          : `\n\nℹ️ _User belum mengirim gambar bukti transfer._`;
        await sock.sendMessage(jid, {
          text: text + fallbackNote,
          mentions: [request.userJid],
        });
        delivered = true;
      } catch (e) {
        logger.error(
          "topup",
          `gagal kirim notifikasi text ke owner ${cleanNumber(jid)}: ${e.message}`,
        );
      }
    }

    delivered ? result.sent++ : result.failed++;
  }

  return result;
}

/* ==================== EXPORT ==================== */

const topupManager = new TopupManager();

export {
  topupManager,
  notifyOwnerPayment,
  buildNotificationText,
  getOwnerJids,
  parseNominal,
  rupiah,
  fmtDate,
};
export default topupManager;
