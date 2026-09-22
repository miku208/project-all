// src/jadibot/scheduler.js — Scheduler (§57): trial/subscription expiry,
// expired bot, notifikasi (SEKALI), cleanup. Idempotent — jalan tiap 30s
// tapi tidak pernah double-notify / double-stop.

import store, { now, systemLog, rupiah } from "./store.js";
import config from "../../config.js";
import { getSetting } from "./settings.js";
import {
  engineInternals,
  stopBot,
  notifyBotOwner,
  countBots,
} from "./engine.js";

let timer = null;

/** Kirim reminder via bot utama ke WA pembuat bot */
async function sendViaMain(bot, text) {
  if (engineInternals.TEST_MODE) return;
  try {
    const { getSocket } = await import("../connection.js");
    const sock = getSocket?.();
    if (!sock || !bot.notify_jid) return;
    await sock.sendMessage(bot.notify_jid, { text });
  } catch (e) {
    console.error("[JadibotScheduler] reminder gagal:", e.message);
  }
}

/** Reminder kode pairing: hampir kadaluarsa (sekali) & kadaluarsa (sekali) */
async function pairingReminderTick() {
  const prefix = config.command?.prefix || ".";
  const ttl = engineInternals.PAIRING_CODE_TTL_MS;

  for (const [botId, entry] of engineInternals.active) {
    if (!entry?.pairingCode || !entry?.pairingCodeAt) continue;
    const bot = engineInternals.getBotRecord(botId);
    if (!bot || bot.status !== "pairing") continue;

    const age = now() - entry.pairingCodeAt;

    // ⏰ hampir kadaluarsa — ±20 detik sebelum, dikirim SEKALI
    if (age >= ttl - 20_000 && !entry.reminded) {
      entry.reminded = true;
      const sisa = Math.max(1, Math.ceil((ttl - age) / 1000));
      await sendViaMain(
        bot,
        `⏰ *KODE PAIRING HAMPIR KADALUARSA!*\n\n` +
          `🆔 \`${bot.id}\` (+${bot.phone_number})\n` +
          `🔑 Kode: *${entry.pairingCode}*\n` +
          `⏳ Sisa ±${sisa} detik!\n\n` +
          `Segera masukkan di HP: Settings → Linked Devices → Link a Device\n\n` +
          `Kadaluarsa? \`${prefix}jadibot pairing ${bot.id}\` untuk kode baru.`,
      );
      logInfo(botId, "reminder pairing dikirim");
    }

    // ❌ kadaluarsa — bersihkan kode, info cara minta baru (sekali)
    if (age >= ttl && !entry.expiredNotified) {
      entry.expiredNotified = true;
      entry.pairingCode = null;
      entry.pairingCodeAt = null;
      await sendViaMain(
        bot,
        `❌ *Kode pairing kadaluarsa*\n\n` +
          `🆔 \`${bot.id}\` (+${bot.phone_number})\n\n` +
          `Minta kode baru:\n\`${prefix}jadibot pairing ${bot.id}\``,
      );
      logInfo(botId, "kode pairing kadaluarsa — dibersihkan");
    }
  }
}

function logInfo(botId, msg) {
  console.log(`[JadibotPairing] ${botId}: ${msg}`);
}

function trialExpiredMessage(user) {
  return (
    `⏰ *TRIAL HABIS*\n\n` +
    `Trial ${getSetting("trialDurationHours")} jam kamu telah berakhir.\n\n` +
    `Silakan top up & beli langganan *${rupiah(getSetting("subscriptionPrice"))}/${getSetting("subscriptionDurationDays")} hari* ` +
    `untuk melanjutkan penggunaan Jadibot.\n\n` +
    `Session bot kamu aman — setelah langganan aktif, bot bisa langsung di-start kembali.`
  );
}

function subscriptionExpiredMessage(user) {
  return (
    `⏰ *LANGGANAN BERAKHIR*\n\n` +
    `Langganan Jadibot kamu telah habis.\n` +
    `Perpanjang dengan top up balance lalu beli langganan *${rupiah(getSetting("subscriptionPrice"))}/${getSetting("subscriptionDurationDays")} hari*.\n\n` +
    `Session bot kamu aman dan bisa langsung dipakai setelah perpanjangan.`
  );
}

async function tick() {
  const t = now();

  await pairingReminderTick();

  for (const user of Object.values(store.users.data)) {
    if (user.account_status !== "active") continue;

    const bots = Object.values(store.bots.data).filter((b) => b.owner_id === user.id);

    /* ---------- TRIAL EXPIRED (§12, §13) ---------- */
    if (
      user.trial_used &&
      !user.trial_expired_notified &&
      Number(user.trial_expires_at) <= t
    ) {
      // Kirim notif SEKALI — flag disimpan dulu (idempotent walau kirim gagal,
      // tidak spam; §57 memprioritaskan idempotency)
      user.trial_expired_notified = true;
      user.updated_at = t;
      store.users.save();

      systemLog("trial_expired", { user_id: user.id });

      for (const bot of bots) {
        if (["online", "connecting", "pairing"].includes(bot.status)) {
          try {
            await notifyBotOwner(bot, trialExpiredMessage(user));
          } catch {}
          stopBot(bot.id, { status: "expired", reason: "trial habis" });
          systemLog("bot_expired", { bot_id: bot.id, reason: "trial_expired" });
        }
      }
    }

    /* ---------- SUBSCRIPTION EXPIRED ---------- */
    if (
      user.subscription_status === "active" &&
      Number(user.subscription_expires_at) > 0 &&
      Number(user.subscription_expires_at) <= t
    ) {
      user.subscription_status = "inactive";
      user.updated_at = t;
      store.users.save();
      systemLog("subscription_expired", { user_id: user.id });

      const trialStillActive =
        user.trial_used && Number(user.trial_expires_at) > t;

      for (const bot of bots) {
        if (["online", "connecting", "pairing"].includes(bot.status)) {
          if (!trialStillActive) {
            try {
              await notifyBotOwner(bot, subscriptionExpiredMessage(user));
            } catch {}
            stopBot(bot.id, { status: "expired", reason: "langganan habis" });
            systemLog("bot_expired", { bot_id: bot.id, reason: "subscription_expired" });
          }
        }
      }
    }
  }

  /* ---------- CLEANUP: bot stuck connecting > 5 menit ---------- */
  for (const [botId, entry] of engineInternals.active) {
    const bot = engineInternals.getBotRecord(botId);
    if (!bot) continue;
    if (bot.status === "connecting" && t - bot.updated_at > 5 * 60 * 1000) {
      stopBot(botId, { status: "offline", reason: "stuck connecting" });
    }
  }
}

export function startScheduler() {
  if (timer) return timer;
  timer = setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.error("[JadibotScheduler]", e.message);
    }
  }, 30_000);
  if (timer.unref) timer.unref();
  console.log("[Jadibot] scheduler aktif (interval 30s)");
  return timer;
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function schedulerStats() {
  return { bots: countBots(), running_interval: !!timer };
}

/** Untuk test: jalankan satu tick manual */
export const runSchedulerTick = tick;
