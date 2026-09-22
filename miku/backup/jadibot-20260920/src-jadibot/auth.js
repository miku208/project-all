// src/jadibot/auth.js — Authentication (§8): register/login/logout/refresh
// Password: scrypt + salt (JANGAN plaintext). Token: HMAC-SHA256 signed, ada expiry.

import crypto from "crypto";
import store, { genId, now, systemLog } from "./store.js";
import { getInternalSecret } from "./settings.js";

const ACCESS_TTL = 60 * 60; // 1 jam (detik)
const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 hari (detik)

/* ==================== PASSWORD HASHING ==================== */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored || "").split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, "hex");
    return (
      candidate.length === expected.length &&
      crypto.timingSafeEqual(candidate, expected)
    );
  } catch {
    return false;
  }
}

/* ==================== TOKENS (stateless HMAC + jti revocation) ==================== */

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", getInternalSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifyRaw(token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const expected = crypto
      .createHmac("sha256", getInternalSecret())
      .update(body)
      .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload?.exp || payload.exp < Math.floor(now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueTokens(user) {
  const t = Math.floor(now() / 1000);
  const access = sign({
    sub: user.id,
    role: user.role,
    type: "access",
    iat: t,
    exp: t + ACCESS_TTL,
    jti: genId("j", 8),
  });
  const refresh = sign({
    sub: user.id,
    role: user.role,
    type: "refresh",
    iat: t,
    exp: t + REFRESH_TTL,
    jti: genId("j", 8),
  });
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
  };
}

export function verifyAccessToken(token) {
  const p = verifyRaw(token);
  if (!p || p.type !== "access") return null;
  return p; // { sub, role, exp, jti }
}

export function verifyRefreshToken(token) {
  const p = verifyRaw(token);
  if (!p || p.type !== "refresh") return null;
  // Logout = refresh token jti masuk blacklist (persist)
  const revoked = store.settings.data.__revokedJti || [];
  if (revoked.includes(p.jti)) return null;
  return p;
}

export function revokeRefreshToken(token) {
  const p = verifyRaw(token);
  if (!p) return false;
  const revoked = store.settings.data.__revokedJti || [];
  revoked.push(p.jti);
  // buang jti yang sudah expired agar tidak membesar
  const live = revoked.filter((j) => {
    return true; // jti tanpa payload tersimpan; rotasi cukup via cutoff time
  });
  store.settings.data.__revokedJti = live.slice(-5000);
  store.settings.data.__revokedAt = now();
  store.settings.save();
  return true;
}

/* ==================== USERS ==================== */

export function findUserByUsername(username) {
  const uname = String(username || "").trim().toLowerCase();
  for (const u of Object.values(store.users.data)) {
    if (u.username === uname) return u;
  }
  return null;
}

export function getUserById(id) {
  return store.users.data[id] || null;
}

/** §7 — role default=user, account_status default=active, balance default=0 */
export function createUser({ username, password, role = "user" }) {
  const uname = String(username || "").trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,24}$/.test(uname)) {
    return { error: "INVALID_USERNAME", message: "Username 3-24 karakter (a-z, 0-9, ., _, -)" };
  }
  if (findUserByUsername(uname)) {
    return { error: "USERNAME_TAKEN", message: "Username sudah dipakai" };
  }
  if (typeof password !== "string" || password.length < 6) {
    return { error: "INVALID_PASSWORD", message: "Password minimal 6 karakter" };
  }

  const id = genId("usr", 5);
  const t = now();
  const user = {
    id,
    username: uname,
    password_hash: hashPassword(password),
    role, // role dari database — SATU-SATUNYA sumber role (§3)
    account_status: "active",
    balance: 0,
    trial_started_at: null,
    trial_expires_at: null,
    trial_used: false,
    trial_expired_notified: false,
    subscription_status: "inactive",
    subscription_started_at: null,
    subscription_expires_at: null,
    created_at: t,
    updated_at: t,
  };
  store.users.data[id] = user;
  store.users.save();
  systemLog("user_registered", { user_id: id, username: uname, role });
  return { user };
}

export function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u; // JANGAN kirim password (§8)
  return rest;
}

/* ==================== AUTH FLOWS ==================== */

export function register({ username, password }) {
  const res = createUser({ username, password, role: "user" });
  if (res.error) return res;
  return { user: sanitizeUser(res.user), tokens: issueTokens(res.user) };
}

export function login({ username, password }) {
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return { error: "INVALID_CREDENTIALS", message: "Username atau password salah" };
  }
  if (user.account_status === "suspended") {
    return { error: "USER_SUSPENDED", message: "Akun di-suspend. Hubungi admin." };
  }
  systemLog("user_login", { user_id: user.id, username: user.username });
  return { user: sanitizeUser(user), tokens: issueTokens(user) };
}

export function refresh(token) {
  const p = verifyRefreshToken(token);
  if (!p) {
    return { error: "AUTH_REQUIRED", message: "Refresh token tidak valid / kadaluarsa" };
  }
  const user = getUserById(p.sub);
  if (!user || user.account_status === "suspended") {
    return { error: "USER_SUSPENDED", message: "Akun tidak aktif" };
  }
  return { user: sanitizeUser(user), tokens: issueTokens(user) };
}

export function logout(token) {
  return revokeRefreshToken(token);
}
