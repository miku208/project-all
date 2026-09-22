// src/jadibot/balance.js — Balance (§16, §17): semua perubahan balance WAJIB
// lewat sini (satu titik mutasi) dan selalu mencatat balance_transactions.
// Tidak ada jalur lain yang boleh menyentuh user.balance langsung.

import store, { genId, now, systemLog, rupiah } from "./store.js";

export const TX_TYPES = ["topup", "subscription", "refund", "admin_adjustment"];

/**
 * Penyesuaian balance atomik.
 * amount positif = tambah, negatif = kurang. Result tidak boleh negatif (§33).
 * @returns {{user, transaction}} atau {error, message}
 */
export function adjustBalance(userId, { type, amount, reference_id = null, description = "", admin_id = null }) {
  const user = store.users.data[userId];
  if (!user) return { error: "USER_NOT_FOUND", message: "User tidak ditemukan" };
  if (!TX_TYPES.includes(type)) {
    return { error: "INVALID_TRANSACTION_TYPE", message: "Tipe transaksi tidak valid" };
  }
  amount = Math.floor(Number(amount) || 0);
  if (amount === 0) {
    return { error: "INVALID_AMOUNT", message: "Nominal tidak boleh nol" };
  }

  const balance_before = Number(user.balance) || 0;
  const balance_after = balance_before + amount;
  if (balance_after < 0) {
    return { error: "INSUFFICIENT_BALANCE", message: "Saldo tidak mencukupi" };
  }

  // Titik mutasi tunggal — sinkron, satu proses → atomic (§31, §62)
  user.balance = balance_after;
  user.updated_at = now();

  const transaction = {
    id: genId("trx"),
    user_id: userId,
    type,
    amount,
    balance_before,
    balance_after,
    reference_id,
    description: description || type,
    admin_id: admin_id || null,
    created_at: now(),
  };
  store.transactions.data.push(transaction);
  store.users.save();
  store.transactions.save();

  systemLog("balance_changed", {
    user_id: userId,
    type,
    amount,
    balance_before,
    balance_after,
    reference_id,
    admin_id,
  });

  return { user, transaction };
}

/** Riwayat transaksi user (terbaru dulu) */
export function getUserTransactions(userId, limit = 50) {
  return store.transactions.data
    .filter((t) => t.user_id === userId)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

export function formatBalance(n) {
  return rupiah(n);
}
