// src/jadibot/trial.js — Trial System (§10-§13): 1 jam, SEKALI pakai,
// waktu SERVER, tidak bisa di-reset dengan logout/login (disimpan di DB).

import store, { now, systemLog } from "./store.js";
import { getSetting } from "./settings.js";

/** Mulai trial — hanya sekali seumur akun. Trial dimulai saat create bot pertama (§46). */
export function startTrial(userId) {
  const user = store.users.data[userId];
  if (!user) return { error: "USER_NOT_FOUND", message: "User tidak ditemukan" };
  if (user.trial_used) {
    return { error: "TRIAL_ALREADY_USED", message: "Trial sudah pernah digunakan" };
  }

  const t = now();
  const hours = Number(getSetting("trialDurationHours")) || 1;
  user.trial_started_at = t;
  user.trial_expires_at = t + hours * 60 * 60 * 1000;
  user.trial_used = true; // sekali set — tidak bisa direset user (§61)
  user.trial_expired_notified = false;
  user.updated_at = t;
  store.users.save();

  systemLog("trial_started", {
    user_id: userId,
    trial_expires_at: user.trial_expires_at,
  });
  return { user };
}

export function isTrialActive(user) {
  return (
    !!user.trial_used &&
    Number(user.trial_expires_at) > now()
  );
}

export function isSubscriptionActive(user) {
  return (
    user.subscription_status === "active" &&
    Number(user.subscription_expires_at) > now()
  );
}

/**
 * §11 — Validasi setiap operasi Jadibot.
 * @param {object} user
 * @param {object} opts
 *   - forCreation: true → boleh jika trial BELUM dipakai (akan dimulai),
 *     trial aktif, atau subscription aktif.
 *   - forControl: true → butuh trial aktif ATAU subscription aktif.
 */
export function validateBotAccess(user, { forCreation = false, forControl = false } = {}) {
  if (!user) return { allowed: false, code: "USER_NOT_FOUND", message: "User tidak ditemukan" };
  if (user.account_status !== "active") {
    return { allowed: false, code: "USER_SUSPENDED", message: "Akun di-suspend" };
  }

  if (isSubscriptionActive(user)) return { allowed: true, mode: "subscription" };
  if (isTrialActive(user)) return { allowed: true, mode: "trial" };

  if (forCreation && !user.trial_used) {
    return { allowed: true, mode: "trial_start" }; // create bot pertama = mulai trial
  }

  if (user.trial_used) {
    return {
      allowed: false,
      code: "TRIAL_EXPIRED",
      message:
        "Trial 1 jam telah habis. Silakan top up & beli langganan untuk melanjutkan.",
    };
  }
  return {
    allowed: false,
    code: "SUBSCRIPTION_EXPIRED",
    message: "Tidak ada langganan aktif. Silakan top up & beli langganan.",
  };
}

/** Info trial untuk user */
export function trialInfo(user) {
  if (!user.trial_used) {
    return { used: false, active: false, expires_at: null, remaining_ms: null };
  }
  const active = isTrialActive(user);
  return {
    used: true,
    active,
    expires_at: user.trial_expires_at,
    remaining_ms: active ? user.trial_expires_at - now() : 0,
    notified: !!user.trial_expired_notified,
  };
}
