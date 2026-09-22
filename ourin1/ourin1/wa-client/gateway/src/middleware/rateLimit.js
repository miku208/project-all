// Rate limiter in-memory (fixed window) — per key.
const buckets = new Map();

// Bersihkan bucket kadaluarsa setiap 10 menit
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now > b.resetAt) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

/**
 * @param {string} key - misal "login:1.2.3.4"
 * @param {number} max - max request dalam window
 * @param {number} windowMs - durasi window
 * @returns {{allowed: boolean, remaining: number, retryAfterSec: number}}
 */
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  const allowed = b.count <= max;
  return {
    allowed,
    remaining: Math.max(0, max - b.count),
    retryAfterSec: allowed ? 0 : Math.ceil((b.resetAt - now) / 1000),
  };
}
