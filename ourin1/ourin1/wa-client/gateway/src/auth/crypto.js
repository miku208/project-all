import crypto from "crypto";

// ===== Password hashing (scrypt, salted — bukan plaintext) =====
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

// ===== JWT (HS256) — implementasi minimal tanpa dependency =====
function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function signJwt(payload, secret, ttlSeconds) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    }),
  );
  return `${header}.${body}.${sign(`${header}.${body}`, secret)}`;
}

export function verifyJwt(token, secret) {
  try {
    const [header, body, sig] = String(token).split(".");
    if (!header || !body || !sig) return null;
    const expected = sign(`${header}.${body}`, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomId() {
  return crypto.randomUUID();
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
