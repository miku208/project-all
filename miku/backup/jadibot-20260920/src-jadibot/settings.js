// src/jadibot/settings.js — Settings DB = source of truth, config.js = default (§56)
import crypto from "crypto";
import config from "../../config.js";
import { store } from "./store.js";

const DEFAULTS = {
  trialDurationHours: config.trial?.durationHours ?? 1,
  subscriptionPrice: config.subscription?.price ?? 5000,
  subscriptionDurationDays: config.subscription?.durationDays ?? 30,
  qrisUrl: config.payment?.qrisUrl ?? "",
  qrisPath: "", // QRIS yang diupload admin (path lokal), prioritas di atas qrisUrl
  minTopup: config.payment?.topup?.minAmount ?? 10000,
  maxTopup: config.payment?.topup?.maxAmount ?? 1000000,
  maxBotsPerUser: config.jadibot?.maxBotsPerUser ?? 1,
};

/** Ambil setting; kalau belum ada di DB, pakai default config lalu persist */
export function getSetting(key) {
  const s = store.settings.data;
  if (s[key] !== undefined) return s[key];
  const def = DEFAULTS[key];
  if (def !== undefined) {
    s[key] = def;
    store.settings.save();
  }
  return def;
}

export function setSetting(key, value) {
  store.settings.data[key] = value;
  store.settings.save();
  return value;
}

export function getAllSettings() {
  for (const k of Object.keys(DEFAULTS)) getSetting(k); // seed defaults
  return { ...store.settings.data };
}

/** Secret internal (untuk signing token) — dibuat sekali & persist */
export function getInternalSecret() {
  let s = store.settings.data.__tokenSecret;
  if (!s) {
    s = crypto.randomBytes(48).toString("hex");
    store.settings.data.__tokenSecret = s;
    store.settings.save();
  }
  return s;
}
