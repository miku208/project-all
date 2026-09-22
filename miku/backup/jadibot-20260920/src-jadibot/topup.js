// src/jadibot/topup.js — Top Up System (§18-§23, §29-§32, §61, §62):
// create request → QRIS → upload bukti (MIME/magic-bytes/size validation,
// safe path) → status PENDING → OWNER dinotifikasi → admin review.
// Approve/reject IDEMPOTENT: hanya status=pending yang bisa diproses.

import fs from "fs";
import path from "path";
import config from "../../config.js";
import store, { genId, now, systemLog, adminLog, rupiah, fmtDate } from "./store.js";
import { getSetting } from "./settings.js";
import { adjustBalance } from "./balance.js";
import { notifyOwnerTopup } from "./notify-owner.js";

const PAYMENTS_ROOT = path.resolve(
  process.env.JADIBOT_PAYMENTS_DIR || config.jadibot?.paymentsPath || "./payments",
);

const ALLOWED = {
  // magic bytes → extension & mime (JANGAN percaya filename/MIME client, §22)
  jpeg: { ext: "jpg", mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  png: { ext: "png", mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  webp: { ext: "webp", mime: "image/webp", bytes: null }, // cek RIFF....WEBP
};

function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "webp";
  }
  return null;
}

/* ==================== CREATE ==================== */

export function createTopup(userId, amount) {
  const user = store.users.data[userId];
  if (!user) return { error: "USER_NOT_FOUND", message: "User tidak ditemukan" };
  if (user.account_status !== "active") {
    return { error: "USER_SUSPENDED", message: "Akun di-suspend" };
  }

  amount = Math.floor(Number(amount) || 0);
  const min = Number(getSetting("minTopup"));
  const max = Number(getSetting("maxTopup"));
  if (amount < min) {
    return { error: "INVALID_AMOUNT", message: `Minimal top up ${rupiah(min)}` };
  }
  if (amount > max) {
    return { error: "INVALID_AMOUNT", message: `Maksimal top up ${rupiah(max)}` };
  }

  const id = genId("topup", 5);
  const t = now();
  const request = {
    id,
    user_id: userId,
    username: user.username,
    amount,
    status: "pending",
    proof_path: null,
    proof_url: null,
    note: "",
    admin_id: null,
    admin_note: null,
    created_at: t,
    reviewed_at: null,
  };
  store.topups.data[id] = request;
  store.topups.save();
  systemLog("topup_created", { topup_id: id, user_id: userId, amount });

  return { topup: request, qris: getSetting("qrisUrl") };
}

/* ==================== PROOF (§22, §23, §66) ==================== */

export function saveProof(userId, topupId, buffer) {
  const topup = store.topups.data[topupId];
  if (!topup || topup.user_id !== userId) {
    return { error: "TOPUP_NOT_FOUND", message: "Top up tidak ditemukan" };
  }
  if (topup.status !== "pending") {
    return { error: "TOPUP_ALREADY_REVIEWED", message: "Top up sudah diproses admin" };
  }

  const maxBytes = (config.jadibot?.maxProofSizeMb || 5) * 1024 * 1024;
  if (!buffer || !buffer.length) {
    return { error: "INVALID_FILE", message: "File bukti kosong" };
  }
  if (buffer.length > maxBytes) {
    return { error: "INVALID_FILE", message: `Ukuran file maksimal ${config.jadibot?.maxProofSizeMb || 5}MB` };
  }

  const type = detectImageType(buffer);
  if (!type) {
    return { error: "INVALID_FILE", message: "Format harus JPG, JPEG, PNG, atau WEBP" };
  }
  const meta = ALLOWED[type];

  // Safe path: payments/<user_id>/<topup_id>/proof.<ext> — TANPA filename user (§23)
  const dir = path.join(PAYMENTS_ROOT, userId, topupId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `proof.${meta.ext}`); // nama file dari server
  fs.writeFileSync(filePath, buffer);

  topup.proof_path = filePath;
  topup.proof_url = `/api/topups/${topupId}/proof`;
  topup.updated_at = now();
  store.topups.save();
  systemLog("topup_proof_uploaded", { topup_id: topupId, user_id: userId, size: buffer.length, type });

  // §24 — WAJIB: notifikasi otomatis ke OWNER (nomor dari config.js)
  // async, tidak blokir response upload
  notifyOwnerTopup(topup).catch((e) =>
    console.error("[Jadibot] gagal notif owner:", e.message),
  );

  return { topup };
}

export function readProof(topup) {
  try {
    if (!topup?.proof_path) return null;
    const resolved = path.resolve(topup.proof_path);
    if (!resolved.startsWith(PAYMENTS_ROOT)) return null; // path traversal guard
    return fs.readFileSync(resolved);
  } catch {
    return null;
  }
}

/* ==================== REVIEW (§29, §30, §31) ==================== */

export function approveTopup(adminId, topupId, adminNote = "") {
  const topup = store.topups.data[topupId];
  if (!topup) return { error: "TOPUP_NOT_FOUND", message: "Top up tidak ditemukan" };

  // §31 ANTI DOUBLE APPROVAL — hanya pending yang boleh diproses.
  // Sinkron + single-threaded + state check → atomic.
  if (topup.status !== "pending") {
    return {
      error: "TOPUP_ALREADY_REVIEWED",
      message: `Top up sudah diproses (status: ${topup.status}). Balance tidak diubah.`,
    };
  }

  const result = adjustBalance(topup.user_id, {
    type: "topup",
    amount: topup.amount,
    reference_id: topup.id,
    description: `Top up approved (${topup.id})`,
    admin_id: adminId,
  });
  if (result.error) return result;

  topup.status = "approved";
  topup.admin_id = adminId;
  topup.admin_note = adminNote || "";
  topup.reviewed_at = now();
  store.topups.save();

  adminLog(adminId, "ADMIN_APPROVE_TOPUP", "topup", topupId, {
    user_id: topup.user_id,
    amount: topup.amount,
    balance_after: result.user.balance,
  });
  systemLog("topup_approved", { topup_id: topupId, user_id: topup.user_id, amount: topup.amount, admin_id: adminId });

  return { topup, user: result.user, transaction: result.transaction };
}

export function rejectTopup(adminId, topupId, adminNote = "") {
  const topup = store.topups.data[topupId];
  if (!topup) return { error: "TOPUP_NOT_FOUND", message: "Top up tidak ditemukan" };
  if (topup.status !== "pending") {
    return {
      error: "TOPUP_ALREADY_REVIEWED",
      message: `Top up sudah diproses (status: ${topup.status}).`,
    };
  }

  topup.status = "rejected";
  topup.admin_id = adminId;
  topup.admin_note = adminNote || "";
  topup.reviewed_at = now();
  store.topups.save(); // balance TIDAK berubah (§30)

  adminLog(adminId, "ADMIN_REJECT_TOPUP", "topup", topupId, {
    user_id: topup.user_id,
    amount: topup.amount,
    note: adminNote,
  });
  systemLog("topup_rejected", { topup_id: topupId, user_id: topup.user_id, admin_id: adminId });

  return { topup };
}

export function cancelTopup(userId, topupId) {
  const topup = store.topups.data[topupId];
  if (!topup || topup.user_id !== userId) {
    return { error: "TOPUP_NOT_FOUND", message: "Top up tidak ditemukan" };
  }
  if (topup.status !== "pending") {
    return { error: "TOPUP_ALREADY_REVIEWED", message: "Top up sudah diproses admin" };
  }
  topup.status = "cancelled";
  topup.reviewed_at = now();
  store.topups.save();
  return { topup };
}

/* ==================== QUERIES ==================== */

export function getTopup(id) {
  return store.topups.data[id] || null;
}

export function getUserTopups(userId, limit = 50) {
  return Object.values(store.topups.data)
    .filter((t) => t.user_id === userId)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

export function listTopups(status = "all", limit = 100) {
  let list = Object.values(store.topups.data);
  if (status && status !== "all") list = list.filter((t) => t.status === status);
  return list.sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}

export function formatTopup(t) {
  return {
    ...t,
    amount_label: rupiah(t.amount),
    created_at_label: fmtDate(t.created_at),
    reviewed_at_label: t.reviewed_at ? fmtDate(t.reviewed_at) : null,
  };
}
