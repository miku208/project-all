import { Router } from "express";
import { config } from "../config.js";
import {
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
  randomId,
  sha256,
} from "../auth/crypto.js";
import {
  upsertUser,
  getUserByUsername,
  createDevice,
  getDevice,
  listDevices,
  revokeDevice,
} from "../db.js";
import { authRequired, ipRateLimit } from "../middleware/auth.js";
import { log } from "../utils/logger.js";

const router = Router();

// Pastikan user admin ada & password sinkron dengan .env saat boot
export function ensureAdminUser() {
  upsertUser(config.adminUser, hashPassword(config.adminPassword), "admin");
  log.info("Auth", `Admin user "${config.adminUser}" siap (password dari .env)`);
}

function issueTokens(user, deviceName, deviceId) {
  const id = deviceId || randomId();
  const refreshTtl = config.refreshTokenTtlDays * 24 * 60 * 60;
  const refreshToken = signJwt(
    { sub: String(user.id), username: user.username, type: "refresh", deviceId: id },
    config.jwtSecret,
    refreshTtl,
  );
  createDevice(id, user.id, deviceName || "unknown-device", sha256(refreshToken));
  const accessToken = signJwt(
    { sub: String(user.id), username: user.username, role: user.role, type: "access", deviceId: id },
    config.jwtSecret,
    config.accessTokenTtl,
  );
  return { accessToken, refreshToken, deviceId: id };
}

// POST /auth/login — rate limit ketat: 5 percobaan / 15 menit / IP
router.post("/login", ipRateLimit({ max: 5, windowMs: 15 * 60 * 1000, name: "login" }), async (req, res) => {
  const { username, password, deviceName } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return res.status(400).json({ error: "username dan password wajib diisi" });
  }
  const user = getUserByUsername(username);
  // Verifikasi tetap dijalankan untuk mencegah user enumeration timing
  const stored = user ? user.password_hash : hashPassword("dummy-timing");
  const ok = verifyPassword(password, stored);
  if (!user || !ok) {
    log.warn("Auth", `Login gagal untuk username "${username.slice(0, 32)}"`);
    return res.status(401).json({ error: "Username atau password salah" });
  }
  const tokens = issueTokens(user, deviceName);
  log.info("Auth", `Client authenticated (device ${tokens.deviceId})`);
  res.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    deviceId: tokens.deviceId,
    expiresIn: config.accessTokenTtl,
    user: { username: user.username, role: user.role },
  });
});

// POST /auth/refresh — rotasi refresh token per device
router.post("/refresh", ipRateLimit({ max: 30, windowMs: 60 * 1000, name: "refresh" }), async (req, res) => {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken !== "string") {
    return res.status(400).json({ error: "refreshToken wajib diisi" });
  }
  const payload = verifyJwt(refreshToken, config.jwtSecret);
  if (!payload || payload.type !== "refresh") {
    return res.status(401).json({ error: "Refresh token tidak valid atau kedaluwarsa" });
  }
  const device = getDevice(payload.deviceId);
  if (!device || device.revoked || device.refresh_token_hash !== sha256(refreshToken)) {
    return res.status(401).json({ error: "Device telah dicabut atau token tidak cocok" });
  }
  const user = { id: payload.sub, username: payload.username, role: "admin" };
  const tokens = issueTokens(user, device.name, payload.deviceId);
  res.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: config.accessTokenTtl,
  });
});

// POST /auth/logout — cabut device saat ini
router.post("/logout", authRequired, (req, res) => {
  revokeDevice(req.deviceId, req.user.id);
  log.info("Auth", `Logout, device ${req.deviceId} dicabut`);
  res.json({ ok: true });
});

// GET /auth/devices — daftar device terhubung
router.get("/devices", authRequired, (req, res) => {
  res.json({ devices: listDevices(req.user.id) });
});

// DELETE /auth/devices/:deviceId — revoke device (APK dicuri -> cabut dari server)
router.delete("/devices/:deviceId", authRequired, (req, res) => {
  const ok = revokeDevice(req.params.deviceId, req.user.id);
  if (!ok) return res.status(404).json({ error: "Device tidak ditemukan" });
  log.info("Auth", `Device ${req.params.deviceId} dicabut`);
  res.json({ ok: true });
});

export default router;
