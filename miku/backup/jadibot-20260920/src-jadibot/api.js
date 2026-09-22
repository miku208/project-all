// src/jadibot/api.js — REST API (API-first untuk APK PHASE 2, §2)
// Format response: {success, data} / {success, error:{code, message}} (§63)

import fs from "fs";
import express from "express";
import config from "../../config.js";
import * as auth from "./auth.js";
import {
  authenticateUser,
  requireUser,
  requireAdmin,
  rateLimit,
  ok,
  fail,
} from "./middleware.js";
import {
  getUserTransactions,
  adjustBalance,
  formatBalance,
} from "./balance.js";
import { startTrial, trialInfo, validateBotAccess } from "./trial.js";
import {
  subscriptionInfo,
  purchaseSubscription,
} from "./subscription.js";
import {
  createTopup,
  saveProof,
  readProof,
  getTopup,
  getUserTopups,
  listTopups,
  approveTopup,
  rejectTopup,
  cancelTopup,
  formatTopup,
} from "./topup.js";
import {
  createBot,
  startBot,
  stopBot,
  restartBot,
  deleteBot,
  assertBotOwnership,
  getUserBots,
  getAllBots,
  getBotSafe,
  getPairingInfo,
  getBotLogs,
} from "./engine.js";
import store, { genId, now, systemLog, adminLog, rupiah } from "./store.js";
import { getAllSettings, setSetting, getSetting } from "./settings.js";
import { saveQrisImage, getQrisFilePath } from "./qris.js";

const router = express.Router();

/* ==================== AUTH (§8) ==================== */

router.post("/auth/register", rateLimit("register", 5), (req, res) => {
  const { username, password } = req.body || {};
  const result = auth.register({ username, password });
  if (result.error) return fail(res, 400, result.error, result.message);
  return ok(res, { user: result.user, ...result.tokens }, 201);
});

router.post("/auth/login", rateLimit("login", 10), (req, res) => {
  const { username, password } = req.body || {};
  const result = auth.login({ username, password });
  if (result.error) {
    return fail(res, result.error === "USER_SUSPENDED" ? 403 : 401, result.error, result.message);
  }
  return ok(res, { user: result.user, ...result.tokens });
});

router.post("/auth/refresh", rateLimit("refresh", 30), (req, res) => {
  const { refresh_token } = req.body || {};
  const result = auth.refresh(refresh_token);
  if (result.error) return fail(res, 401, result.error, result.message);
  return ok(res, { user: result.user, ...result.tokens });
});

router.post("/auth/logout", authenticateUser, (req, res) => {
  const { refresh_token } = req.body || {};
  auth.logout(refresh_token);
  return ok(res, { logged_out: true });
});

/* ==================== USER PROFILE / TRIAL / SUBSCRIPTION ==================== */

router.get("/me", authenticateUser, requireUser, (req, res) => {
  const user = auth.getUserById(req.auth.sub);
  if (!user) return fail(res, 401, "AUTH_REQUIRED", "User tidak ditemukan");
  return ok(res, {
    user: auth.sanitizeUser(user),
    trial: trialInfo(user),
    subscription: subscriptionInfo(user),
    access: validateBotAccess(user, { forCreation: true }),
    balance_label: formatBalance(user.balance),
  });
});

router.get("/transactions", authenticateUser, requireUser, (req, res) => {
  const tx = getUserTransactions(req.auth.sub).map((t) => ({
    ...t,
    amount_label: (t.amount > 0 ? "+ " : "- ") + rupiah(Math.abs(t.amount)),
  }));
  return ok(res, { transactions: tx });
});

router.post("/subscription/purchase", authenticateUser, requireUser, rateLimit("purchase", 5), (req, res) => {
  const result = purchaseSubscription(req.auth.sub);
  if (result.error) return fail(res, 400, result.error, result.message);
  return ok(res, { subscription: subscriptionInfo(result.user), balance: result.user.balance });
});

/* ==================== PAYMENT / TOPUP (§18-§22) ==================== */

// QRIS image terbaru untuk user (dari upload admin, §20)
router.get("/payment/qris/image", authenticateUser, requireUser, (req, res) => {
  const p = getQrisFilePath();
  if (!p) return fail(res, 404, "NOT_FOUND", "QRIS belum diupload admin");
  const mime = p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg";
  res.setHeader("Content-Type", mime);
  return res.send(fs.readFileSync(p));
});

router.get("/payment/qris", authenticateUser, requireUser, (req, res) => {
  return ok(res, {
    qris_url: getSetting("qrisUrl") || null,
    qris_image: getSetting("qrisPath") ? "/api/payment/qris/image" : null,
    min_topup: getSetting("minTopup"),
    max_topup: getSetting("maxTopup"),
  });
});

router.post("/topups", authenticateUser, requireUser, rateLimit("topup", 10), (req, res) => {
  const { amount } = req.body || {};
  const result = createTopup(req.auth.sub, amount);
  if (result.error) return fail(res, 400, result.error, result.message);
  return ok(res, { topup: formatTopup(result.topup), qris: result.qris }, 201);
});

router.get("/topups", authenticateUser, requireUser, (req, res) => {
  return ok(res, { topups: getUserTopups(req.auth.sub).map(formatTopup) });
});

router.get("/topups/:id/proof", authenticateUser, (req, res) => {
  const topup = getTopup(req.params.id);
  const isAdmin = req.auth.role === "admin";
  if (!topup || (!isAdmin && topup.user_id !== req.auth.sub)) {
    return fail(res, 404, "TOPUP_NOT_FOUND", "Top up tidak ditemukan");
  }
  const buf = readProof(topup);
  if (!buf) return fail(res, 404, "TOPUP_NOT_FOUND", "Bukti belum di-upload");
  const mime = topup.proof_path?.endsWith(".png")
    ? "image/png"
    : topup.proof_path?.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  res.setHeader("Content-Type", mime);
  return res.send(buf);
});

// Upload bukti — body RAW image (image/jpeg|png|webp), bukan multipart:
// filename client tidak dipercaya sama sekali (§22, §66)
router.post(
  "/topups/:id/proof",
  authenticateUser,
  requireUser,
  rateLimit("proof", 10),
  express.raw({ type: () => true, limit: (config.jadibot?.maxProofSizeMb || 5) * 1024 * 1024 + 1024 }),
  (req, res) => {
    const result = saveProof(req.auth.sub, req.params.id, req.body);
    if (result.error) {
      const status = result.error === "INVALID_FILE" ? 400 : 404;
      return fail(res, status, result.error, result.message);
    }
    return ok(res, { topup: formatTopup(result.topup), owner_notified: true });
  },
);

router.post("/topups/:id/cancel", authenticateUser, requireUser, (req, res) => {
  const result = cancelTopup(req.auth.sub, req.params.id);
  if (result.error) return fail(res, 400, result.error, result.message);
  return ok(res, { topup: formatTopup(result.topup) });
});

/* ==================== BOTS (§42-§47, §54) ==================== */

router.get("/bots", authenticateUser, requireUser, (req, res) => {
  return ok(res, { bots: getUserBots(req.auth.sub) });
});

router.post("/bots", authenticateUser, requireUser, rateLimit("createbot", 5), (req, res) => {
  const { phone_number } = req.body || {};
  const user = auth.getUserById(req.auth.sub);
  const result = createBot(user, phone_number);
  if (result.error) return fail(res, 400, result.error, result.message);
  return ok(res, { bot: result.bot, trial_expires_at: result.trial }, 201);
});

/** Semua akses bot WAJIB lewat ownership check ini (§43, §54) */
function withOwnedBot(req, res, { adminBypass = false } = {}) {
  const bot = getBotSafe(req.params.id);
  const rawBot = store.bots.data[req.params.id];
  const user = auth.getUserById(req.auth.sub);
  const check = assertBotOwnership(rawBot, { id: req.auth.sub, role: req.auth.role }, { adminBypass });
  if (check.error) {
    fail(res, check.error === "BOT_NOT_FOUND" ? 404 : 403, check.error, check.message);
    return null;
  }
  return { bot, user };
}

router.get("/bots/:id", authenticateUser, requireUser, (req, res) => {
  const ctx = withOwnedBot(req, res);
  if (!ctx) return;
  return ok(res, { bot: ctx.bot });
});

router.post("/bots/:id/start", authenticateUser, requireUser, rateLimit("botctl", 20), (req, res) => {
  const ctx = withOwnedBot(req, res);
  if (!ctx) return;
  const access = validateBotAccess(ctx.user, { forControl: true });
  if (!access.allowed) return fail(res, 403, access.code, access.message);
  const result = startBot(store.bots.data[req.params.id]);
  if (result.error) return fail(res, 403, result.error, result.message);
  return ok(res, { bot: getBotSafe(req.params.id) });
});

router.post("/bots/:id/stop", authenticateUser, requireUser, rateLimit("botctl", 20), (req, res) => {
  const ctx = withOwnedBot(req, res);
  if (!ctx) return;
  const result = stopBot(req.params.id);
  if (result.error) return fail(res, 404, result.error, result.message);
  return ok(res, { bot: result.bot });
});

router.post("/bots/:id/restart", authenticateUser, requireUser, rateLimit("botctl", 20), (req, res) => {
  const ctx = withOwnedBot(req, res);
  if (!ctx) return;
  const access = validateBotAccess(ctx.user, { forControl: true });
  if (!access.allowed) return fail(res, 403, access.code, access.message);
  const result = restartBot(req.params.id);
  if (result.error) return fail(res, 404, result.error, result.message);
  return ok(res, { bot: getBotSafe(req.params.id) });
});

router.delete("/bots/:id", authenticateUser, requireUser, (req, res) => {
  const ctx = withOwnedBot(req, res);
  if (!ctx) return;
  const result = deleteBot(req.params.id);
  if (result.error) return fail(res, 404, result.error, result.message);
  return ok(res, { deleted: true });
});

router.get("/bots/:id/pairing", authenticateUser, requireUser, (req, res) => {
  const ctx = withOwnedBot(req, res);
  if (!ctx) return;
  return ok(res, { pairing: getPairingInfo(req.params.id) });
});

router.get("/bots/:id/logs", authenticateUser, requireUser, (req, res) => {
  const ctx = withOwnedBot(req, res);
  if (!ctx) return;
  return ok(res, { logs: getBotLogs(req.params.id) });
});

/* ==================== ADMIN (§9, §28-§41, §53) ==================== */

const adminRate = rateLimit("admin", 120);

router.get("/admin/overview", authenticateUser, requireAdmin, adminRate, (req, res) => {
  // §38 — data REAL, bukan angka dummy
  const users = Object.values(store.users.data);
  const bots = Object.values(store.bots.data);
  const topups = Object.values(store.topups.data);
  const t = now();
  return ok(res, {
    total_users: users.length,
    active_users: users.filter((u) => u.account_status === "active").length,
    suspended_users: users.filter((u) => u.account_status === "suspended").length,
    total_bots: bots.length,
    online_bots: bots.filter((b) => b.status === "online").length,
    pending_topups: topups.filter((tp) => tp.status === "pending").length,
    active_subscriptions: users.filter(
      (u) => u.subscription_status === "active" && Number(u.subscription_expires_at) > t,
    ).length,
    total_balance: users.reduce((s, u) => s + (Number(u.balance) || 0), 0),
  });
});

/* ---------- USER CRUD (§39, §41) ---------- */

router.get("/admin/users", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const q = String(req.query.q || "").toLowerCase();
  let users = Object.values(store.users.data);
  if (q) users = users.filter((u) => u.username.includes(q) || u.id.includes(q));
  return ok(res, { users: users.map(auth.sanitizeUser) });
});

router.post("/admin/users", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const { username, password, role } = req.body || {};
  const result = auth.createUser({
    username,
    password,
    role: role === "admin" ? "admin" : "user", // role dari database, bukan asumsi (§3)
  });
  if (result.error) return fail(res, 400, result.error, result.message);
  adminLog(req.auth.sub, "ADMIN_CREATE_USER", "user", result.user.id, { role: result.user.role });
  return ok(res, { user: auth.sanitizeUser(result.user) }, 201);
});

router.get("/admin/users/:id", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const user = auth.getUserById(req.params.id);
  if (!user) return fail(res, 404, "USER_NOT_FOUND", "User tidak ditemukan");
  const bots = getUserBots(user.id);
  return ok(res, {
    user: auth.sanitizeUser(user),
    trial: trialInfo(user),
    subscription: subscriptionInfo(user),
    bot_count: bots.length,
    bots,
    topups: getUserTopups(user.id).map(formatTopup),
    transactions: getUserTransactions(user.id).slice(0, 25),
  });
});

router.patch("/admin/users/:id", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const user = auth.getUserById(req.params.id);
  if (!user) return fail(res, 404, "USER_NOT_FOUND", "User tidak ditemukan");
  const { role, account_status, username } = req.body || {};

  if (role !== undefined) {
    if (!["user", "admin"].includes(role)) {
      return fail(res, 400, "INVALID_ROLE", "Role harus user/admin");
    }
    user.role = role;
  }
  if (account_status !== undefined) {
    if (!["active", "suspended"].includes(account_status)) {
      return fail(res, 400, "INVALID_STATUS", "Status harus active/suspended");
    }
    user.account_status = account_status;
    // §41 — suspend: user tidak bisa mengontrol bot
    if (account_status === "suspended") {
      for (const b of getUserBots(user.id)) stopBot(b.id, { status: "stopped", reason: "user suspended" });
    }
  }
  if (username !== undefined && username !== user.username) {
    const exists = auth.findUserByUsername(username);
    if (exists) return fail(res, 400, "USERNAME_TAKEN", "Username sudah dipakai");
    user.username = String(username).trim().toLowerCase();
  }

  user.updated_at = now();
  store.users.save();
  adminLog(req.auth.sub, "ADMIN_UPDATE_USER", "user", user.id, { role, account_status, username });
  return ok(res, { user: auth.sanitizeUser(user) });
});

router.delete("/admin/users/:id", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const user = auth.getUserById(req.params.id);
  if (!user) return fail(res, 404, "USER_NOT_FOUND", "User tidak ditemukan");
  if (user.id === req.auth.sub) {
    return fail(res, 400, "FORBIDDEN", "Tidak bisa menghapus akun sendiri");
  }
  for (const b of getUserBots(user.id)) deleteBot(b.id);
  delete store.users.data[user.id];
  store.users.save();
  adminLog(req.auth.sub, "ADMIN_DELETE_USER", "user", user.id, { username: user.username });
  return ok(res, { deleted: true });
});

/* ---------- BALANCE (§32-§34) ---------- */

router.post("/admin/users/:id/balance", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const { amount, reason } = req.body || {};
  const amt = Math.floor(Number(amount) || 0);
  if (amt === 0) return fail(res, 400, "INVALID_AMOUNT", "Amount tidak boleh nol");

  const result = adjustBalance(req.params.id, {
    type: "admin_adjustment",
    amount: amt,
    description: reason || (amt > 0 ? "Admin add balance" : "Admin remove balance"),
    admin_id: req.auth.sub,
  });
  if (result.error) {
    return fail(res, result.error === "INSUFFICIENT_BALANCE" ? 400 : 404, result.error, result.message);
  }

  adminLog(
    req.auth.sub,
    amt > 0 ? "ADMIN_ADD_BALANCE" : "ADMIN_REMOVE_BALANCE",
    "user",
    req.params.id,
    { amount: amt, balance_after: result.user.balance, reason },
  );
  return ok(res, {
    user_id: req.params.id,
    balance: result.user.balance,
    balance_label: formatBalance(result.user.balance),
    transaction: result.transaction,
  });
});

/* ---------- TOPUP REVIEW (§28-§31) ---------- */

router.get("/admin/topups", authenticateUser, requireAdmin, adminRate, (req, res) => {
  return ok(res, { topups: listTopups(req.query.status || "all").map(formatTopup) });
});

router.post("/admin/topups/:id/approve", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const result = approveTopup(req.auth.sub, req.params.id, req.body?.admin_note);
  if (result.error) {
    return fail(res, result.error === "TOPUP_NOT_FOUND" ? 404 : 409, result.error, result.message);
  }
  return ok(res, {
    topup: formatTopup(result.topup),
    balance: result.user.balance,
    transaction: result.transaction,
  });
});

router.post("/admin/topups/:id/reject", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const result = rejectTopup(req.auth.sub, req.params.id, req.body?.admin_note);
  if (result.error) {
    return fail(res, result.error === "TOPUP_NOT_FOUND" ? 404 : 409, result.error, result.message);
  }
  return ok(res, { topup: formatTopup(result.topup) });
});

/* ---------- TRANSACTIONS / BOTS / SETTINGS / LOGS (§36, §56, §59) ---------- */

router.get("/admin/transactions", authenticateUser, requireAdmin, adminRate, (req, res) => {
  let tx = [...store.transactions.data].sort((a, b) => b.created_at - a.created_at);
  if (req.query.user_id) tx = tx.filter((t) => t.user_id === req.query.user_id);
  if (req.query.type) tx = tx.filter((t) => t.type === req.query.type);
  return ok(res, { transactions: tx.slice(0, Number(req.query.limit) || 200) });
});

router.get("/admin/bots", authenticateUser, requireAdmin, adminRate, (req, res) => {
  return ok(res, { bots: getAllBots() });
});

router.post("/admin/bots/:id/:action(start|stop|restart)", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const bot = store.bots.data[req.params.id];
  if (!bot) return fail(res, 404, "BOT_NOT_FOUND", "Bot tidak ditemukan");
  const action = req.params.action;
  let result;
  if (action === "start") result = startBot(bot);
  else if (action === "stop") result = stopBot(bot.id, { reason: "admin control" });
  else result = restartBot(bot.id);
  if (result.error) return fail(res, 400, result.error, result.message);
  adminLog(req.auth.sub, `ADMIN_${action.toUpperCase()}_BOT`, "bot", req.params.id, {});
  return ok(res, { bot: getBotSafe(req.params.id) });
});

router.get("/admin/settings", authenticateUser, requireAdmin, adminRate, (req, res) => {
  return ok(res, { settings: getAllSettings() });
});

router.put("/admin/settings", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const allowed = [
    "trialDurationHours", "subscriptionPrice", "subscriptionDurationDays",
    "qrisUrl", "minTopup", "maxTopup", "maxBotsPerUser",
  ];
  const updates = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!allowed.includes(k)) continue;
    updates[k] = setSetting(k, v);
  }
  adminLog(req.auth.sub, "ADMIN_UPDATE_SETTINGS", "settings", "global", updates);
  return ok(res, { settings: getAllSettings() });
});

// Upload QRIS baru (raw image) — admin dapat mengganti QRIS (§20)
router.post(
  "/admin/settings/qris",
  authenticateUser,
  requireAdmin,
  adminRate,
  express.raw({ type: () => true, limit: 5 * 1024 * 1024 }),
  (req, res) => {
    const result = saveQrisImage(req.body);
    if (result.error) return fail(res, 400, result.error, result.message);
    adminLog(req.auth.sub, "ADMIN_UPDATE_QRIS", "settings", "qris", {});
    return ok(res, { qris_image: "/api/payment/qris/image" });
  },
);

router.get("/admin/logs", authenticateUser, requireAdmin, adminRate, (req, res) => {
  const type = req.query.type === "admin" ? "adminLogs" : "systemLogs";
  const logs = [...store[type].data].sort((a, b) => b.created_at - a.created_at);
  return ok(res, { logs: logs.slice(0, Number(req.query.limit) || 200) });
});

/* ==================== 404 fallback ==================== */
router.use((req, res) => fail(res, 404, "NOT_FOUND", "Endpoint tidak ditemukan"));

export default router;
