import { config } from "../config.js";
import { verifyJwt } from "../auth/crypto.js";
import { getDevice, touchDevice } from "../db.js";
import { rateLimit } from "./rateLimit.js";

// Autentikasi access token (Bearer) + cek device tidak revoked.
export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Token tidak ada" });
  }
  const payload = verifyJwt(token, config.jwtSecret);
  if (!payload || payload.type !== "access") {
    return res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
  }
  const device = getDevice(payload.deviceId);
  if (!device || device.revoked) {
    return res.status(401).json({ error: "Device telah dicabut" });
  }
  req.user = { id: payload.sub, username: payload.username, role: payload.role };
  req.deviceId = payload.deviceId;
  touchDevice(payload.deviceId);
  next();
}

// Rate limit generik per IP
export function ipRateLimit({ max, windowMs, name }) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const r = rateLimit(`${name}:${ip}`, max, windowMs);
    if (!r.allowed) {
      res.set("Retry-After", String(r.retryAfterSec));
      return res.status(429).json({ error: "Terlalu banyak permintaan", retryAfter: r.retryAfterSec });
    }
    next();
  };
}
