// src/jadibot/subscription.js — Subscription (§14, §15): beli pakai balance,
// harga & durasi dari settings DB (default config.js), waktu server.

import store, { now, systemLog } from "./store.js";
import { getSetting } from "./settings.js";
import { adjustBalance } from "./balance.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function subscriptionInfo(user) {
  const active =
    user.subscription_status === "active" &&
    Number(user.subscription_expires_at) > now();
  return {
    status: active ? "active" : "inactive",
    started_at: user.subscription_started_at,
    expires_at: active ? user.subscription_expires_at : null,
    price: Number(getSetting("subscriptionPrice")),
    duration_days: Number(getSetting("subscriptionDurationDays")),
  };
}

/**
 * Beli / perpanjang subscription via balance.
 * Idempotent: pemotongan balance & pencatatan hanya lewat adjustBalance
 * yang satu titik; state dicek dulu (§62).
 */
export function purchaseSubscription(userId) {
  const user = store.users.data[userId];
  if (!user) return { error: "USER_NOT_FOUND", message: "User tidak ditemukan" };
  if (user.account_status !== "active") {
    return { error: "USER_SUSPENDED", message: "Akun di-suspend" };
  }

  const price = Number(getSetting("subscriptionPrice"));
  const days = Number(getSetting("subscriptionDurationDays"));

  if ((Number(user.balance) || 0) < price) {
    return {
      error: "INSUFFICIENT_BALANCE",
      message: `Saldo tidak mencukupi. Butuh Rp${price.toLocaleString("id-ID")}`,
    };
  }

  // §15 — renewal: masih aktif → +30 hari dari expiry; sudah expired → dari sekarang
  const t = now();
  const stillActive =
    user.subscription_status === "active" &&
    Number(user.subscription_expires_at) > t;
  const base = stillActive ? Number(user.subscription_expires_at) : t;
  const newExpiry = base + days * DAY_MS;

  const result = adjustBalance(userId, {
    type: "subscription",
    amount: -price,
    reference_id: null,
    description: `Subscription ${days} hari`,
  });
  if (result.error) return result;

  user.subscription_status = "active";
  user.subscription_started_at = stillActive ? user.subscription_started_at : t;
  user.subscription_expires_at = newExpiry;
  user.updated_at = t;
  store.users.save();

  systemLog("subscription_purchased", {
    user_id: userId,
    price,
    days,
    subscription_expires_at: newExpiry,
    renewed: stillActive,
  });

  return {
    user,
    subscription: {
      status: "active",
      expires_at: newExpiry,
      price,
      duration_days: days,
      renewed: stillActive,
      transaction: result.transaction,
    },
  };
}
