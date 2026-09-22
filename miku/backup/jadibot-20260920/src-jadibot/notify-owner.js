// src/jadibot/notify-owner.js — OWNER PAYMENT NOTIFICATION (§24-§27).
// WAJIB: setiap bukti transfer di-upload → notifikasi otomatis ke OWNER.
// Nomor owner SATU-SATUNYA dari config.js (config.owner.number) —
// tidak ada nomor hardcoded di file ini.
// Kirim via sock bot utama (src/connection.js → getSocket()).

import config from "../../config.js";
import { getOwnerJids } from "../lib/miku-topup.js"; // sumber owner terpusat
import { rupiah, fmtDate, systemLog } from "./store.js";

const TEST_MODE = process.env.JADIBOT_TEST === "1";

/**
 * Bangun teks 💰 PAYMENT REQUEST (format §25).
 */
export function buildOwnerMessage(topup) {
  return (
    `💰 *PAYMENT REQUEST*\n\n` +
    `User:\n@${topup.username || topup.user_id}\n` +
    `User ID:\n${topup.user_id}\n\n` +
    `Nominal:\n${rupiah(topup.amount)}\n` +
    `Topup ID:\n\`${topup.id}\`\n` +
    `Status:\n*${String(topup.status).toUpperCase()}*\n\n` +
    `Waktu:\n${fmtDate(topup.created_at)}\n\n` +
    `Silakan review melalui Admin Dashboard.`
  );
}

/**
 * Kirim notifikasi ke semua owner:
 * - bukti tersedia → image message + caption
 * - gagal kirim image → tetap kirim TEXT notifikasi + topup_id (§26)
 * @returns {Promise<{sent:number, failed:number, owners:string[]}>}
 */
export async function notifyOwnerTopup(topup) {
  const ownerJids = getOwnerJids();
  const result = { sent: 0, failed: 0, owners: ownerJids };
  if (!ownerJids.length) {
    console.warn("[Jadibot] config.owner.number kosong — notif owner dilewati");
    return result;
  }

  if (TEST_MODE) {
    return { ...result, skipped: true };
  }

  // Lazy import agar mode test tidak memuat koneksi WA
  const { getSocket } = await import("../connection.js");
  const sock = getSocket?.();
  if (!sock) {
    console.warn("[Jadibot] bot utama belum connect — notif owner ditunda (topup tetap tersimpan)");
    return result;
  }

  const text = buildOwnerMessage(topup);

  // baca bukti dari disk (disimpan oleh topup.saveProof)
  let proofBuffer = null;
  try {
    const { readProof } = await import("./topup.js");
    proofBuffer = readProof(topup);
  } catch {}

  for (const jid of ownerJids) {
    let delivered = false;

    if (proofBuffer) {
      try {
        await sock.sendMessage(jid, {
          image: proofBuffer,
          caption: text,
        });
        delivered = true;
      } catch (e) {
        console.error(`[Jadibot] gagal kirim image bukti ke owner: ${e.message}`);
      }
    }

    if (!delivered) {
      // Fallback WAJIB (§26): tetap kirim text + reference ID
      try {
        await sock.sendMessage(jid, {
          text:
            text +
            (proofBuffer
              ? `\n\n⚠️ _Gambar bukti gagal terkirim — buka bukti via Admin Dashboard (Topup ID di atas)._`
              : `\n\nℹ️ _Bukti belum di-upload — admin dapat melihatnya via Admin Dashboard._`),
        });
        delivered = true;
      } catch (e) {
        console.error(`[Jadibot] gagal kirim text ke owner: ${e.message}`);
      }
    }

    delivered ? result.sent++ : result.failed++;
  }

  if (result.sent > 0) {
    systemLog("owner_payment_notified", {
      topup_id: topup.id,
      sent: result.sent,
      with_image: !!proofBuffer,
    });
  }
  return result;
}
