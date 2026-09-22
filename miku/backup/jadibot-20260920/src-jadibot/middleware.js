// src/jadibot/middleware.js — Authorization (§9), rate limit (§65), format API (§63)
import { verifyAccessToken } from "./auth.js";

/* ==================== FORMAT API (§63, §64) ==================== */

export function ok(res, data = {}, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function fail(res, status, code, message) {
  return res.status(status).json({
    success: false,
    error: { code: code || "ERROR", message: message || "Terjadi kesalahan" },
  });
  // Tidak pernah mengirim stack trace ke client (§63)
}

/* ==================== AUTHORIZATION MIDDLEWARE ==================== */

export function authenticateUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return fail(res, 401, "AUTH_REQUIRED", "Token tidak diberikan");

  const payload = verifyAccessToken(token);
  if (!payload) return fail(res, 401, "AUTH_REQUIRED", "Token tidak valid / kadaluarsa");

  req.auth = payload; // { sub, role, jti }
  next();
}

export function requireUser(req, res, next) {
  if (!req.auth?.sub) return fail(res, 401, "AUTH_REQUIRED", "Belum login");
  next();
}

/** Semua admin endpoint WAJIB middleware ini (§9, §53) */
export function requireAdmin(req, res, next) {
  if (!req.auth) return fail(res, 401, "AUTH_REQUIRED", "Belum login");
  if (req.auth.role !== "admin") {
    return fail(res, 403, "FORBIDDEN", "Akses khusus admin");
  }
  next();
}

/* ==================== RATE LIMIT (§65) — in-memory sliding window ==================== */

const buckets = new Map(); // key → { count, resetAt }

export function rateLimit(name, max, windowMs = 60_000) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "?";
    const key = `${name}:${ip}`;
    const t = Date.now();
    let b = buckets.get(key);
    if (!b || t > b.resetAt) {
      b = { count: 0, resetAt: t + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      return fail(res, 429, "RATE_LIMITED", "Terlalu banyak permintaan, coba lagi nanti");
    }
    // housekeeping ringan
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) if (t > v.resetAt) buckets.delete(k);
    }
    next();
  };
}
