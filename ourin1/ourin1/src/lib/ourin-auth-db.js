/**
 * ourin-auth-db.js
 * Database auth super simple berbasis file JSON (database/auth.json).
 * Dipakai oleh ourin-jadibot-server.js untuk login/register/session/admin.
 *
 * Akun admin default (dibuat otomatis saat file belum ada):
 *   email: admin
 *   password: admin123
 * -> SEGERA GANTI password admin ini lewat endpoint register+promote manual,
 *    atau edit langsung database/auth.json setelah hash pertama dibuat.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const DB_DIR = path.join(process.cwd(), "database");
const DB_PATH = path.join(DB_DIR, "auth.json");

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

function genId() {
  return crypto.randomBytes(8).toString("hex");
}

function genToken() {
  return crypto.randomBytes(32).toString("hex");
}

function defaultData() {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    users: [
      {
        id: genId(),
        email: "admin",
        name: "Admin",
        password: hashPassword("admin123", salt),
        salt,
        role: "admin",
        status: "active",
        botNumber: null,
        createdAt: new Date().toISOString(),
      },
    ],
    sessions: {}, // token -> { userId, expiresAt }
    logs: [],
    settings: {
      maxBot: 1,
      maintenance: false,
      maxBotPerUser: 1, // catatan: struktur data user saat ini cuma 1 slot bot per user
      autoDeleteSessionHours: 0, // 0 = nonaktif
      autoLogoutMinutes: 0, // 0 = pakai default (7 hari)
    },
  };
}

function ensureDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultData(), null, 2));
  }
}

let cache = null;

function readDb() {
  ensureDb();
  if (!cache) cache = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  return cache;
}

function writeDb(data) {
  cache = data;
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password, salt, ...safe } = u;
  return safe;
}

/* ---------------- users ---------------- */

function findUserByEmail(email) {
  const db = readDb();
  return db.users.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase(),
  );
}

function findUserById(id) {
  const db = readDb();
  return db.users.find((u) => String(u.id) === String(id));
}

function createUser({ email, password, name, role = "user" }) {
  if (findUserByEmail(email)) {
    return { success: false, error: "Email sudah terdaftar." };
  }
  const db = readDb();
  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: genId(),
    email,
    name: name || email.split("@")[0],
    password: hashPassword(password, salt),
    salt,
    role,
    status: "active",
    botNumber: null,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  writeDb(db);
  return { success: true, user: sanitizeUser(user) };
}

function verifyPassword(user, password) {
  if (!user) return false;
  return hashPassword(password, user.salt) === user.password;
}

function listUsers() {
  return readDb().users.map(sanitizeUser);
}

function setUserBanned(id, banned) {
  const db = readDb();
  const user = db.users.find((u) => String(u.id) === String(id));
  if (!user) return { success: false, error: "User tidak ditemukan." };
  user.status = banned ? "banned" : "active";
  writeDb(db);
  return { success: true, user: sanitizeUser(user) };
}

function deleteUser(id) {
  const db = readDb();
  const idx = db.users.findIndex((u) => String(u.id) === String(id));
  if (idx === -1) return { success: false, error: "User tidak ditemukan." };
  db.users.splice(idx, 1);
  writeDb(db);
  return { success: true };
}

function setUserBotNumber(id, number) {
  const db = readDb();
  const user = db.users.find((u) => String(u.id) === String(id));
  if (!user) return;
  user.botNumber = number;
  // dicatat supaya server bisa lepas reservasi otomatis kalau user
  // generate pairing code tapi gak pernah discan (lihat releaseStaleReservations
  // di ourin-jadibot-server.js)
  user.botReservedAt = number ? Date.now() : null;
  writeDb(db);
}

function findUserByBotNumber(number) {
  const db = readDb();
  return db.users.find((u) => u.botNumber === number);
}

/* ---------------- sessions ---------------- */

function createSession(userId, ttlMs) {
  const db = readDb();
  const token = genToken();
  db.sessions[token] = { userId, expiresAt: Date.now() + (ttlMs || TOKEN_TTL_MS) };
  writeDb(db);
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const db = readDb();
  const session = db.sessions[token];
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    delete db.sessions[token];
    writeDb(db);
    return null;
  }
  return findUserById(session.userId) || null;
}

function destroySession(token) {
  const db = readDb();
  delete db.sessions[token];
  writeDb(db);
}

/* ---------------- logs ---------------- */

function addLog(userEmail, activity) {
  const db = readDb();
  db.logs.unshift({ user: userEmail, activity, date: new Date().toISOString() });
  db.logs = db.logs.slice(0, 200);
  writeDb(db);
}

function getLogs() {
  return readDb().logs;
}

/* ---------------- settings ---------------- */

function getSettings() {
  // biar instalasi lama yang auth.json-nya dibuat sebelum field baru ini
  // ada tetap punya default yang wajar, bukan undefined.
  const DEFAULT_SETTINGS = {
    maxBot: 1,
    maintenance: false,
    maxBotPerUser: 1,
    autoDeleteSessionHours: 0,
    autoLogoutMinutes: 0,
  };
  return { ...DEFAULT_SETTINGS, ...readDb().settings };
}

function updateSettings(patch) {
  const db = readDb();
  db.settings = { ...db.settings, ...patch };
  writeDb(db);
  return db.settings;
}

export {
  findUserByEmail,
  findUserById,
  findUserByBotNumber,
  createUser,
  verifyPassword,
  listUsers,
  setUserBanned,
  deleteUser,
  setUserBotNumber,
  createSession,
  getUserByToken,
  destroySession,
  addLog,
  getLogs,
  getSettings,
  updateSettings,
  sanitizeUser,
};