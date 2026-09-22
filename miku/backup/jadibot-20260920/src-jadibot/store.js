// src/jadibot/store.js — Atomic JSON store untuk Miku Jadibot (PHASE 1)
// Koleksi: users, bots, topups, transactions, admin_logs, system_logs, settings
// Semua tulisan ATOMIC (tmp + rename) dan sinkron → aman dari double-approval
// dalam satu proses Node (single-threaded + state check).

import fs from "fs";
import path from "path";
import crypto from "crypto";

const DB_ROOT = path.resolve(
  process.env.JADIBOT_DB_DIR || "./database/jadibot",
);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

class Collection {
  constructor(name, initial) {
    this.name = name;
    this.file = path.join(DB_ROOT, `${name}.json`);
    ensureDir(DB_ROOT);
    this.data = initial;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, "utf-8"));
        if (raw && typeof raw === "object") {
          this.data =
            Array.isArray(this.data) && Array.isArray(raw)
              ? raw
              : { ...this.data, ...raw };
        }
      }
    } catch (e) {
      console.error(`[JadibotStore] gagal load ${this.name}:`, e.message);
    }
  }

  /** Atomic write: tulis ke .tmp lalu rename (aman dari file korup saat crash) */
  save() {
    try {
      ensureDir(DB_ROOT);
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error(`[JadibotStore] gagal save ${this.name}:`, e.message);
    }
  }
}

export const store = {
  users: new Collection("users", {}), // id → user
  bots: new Collection("bots", {}), // id → bot
  topups: new Collection("topups", {}), // id → topup_request
  transactions: new Collection("transactions", []), // balance_transactions
  adminLogs: new Collection("admin_logs", []),
  systemLogs: new Collection("system_logs", []),
  settings: new Collection("settings", {}), // key → value (source of truth)
};

/* ==================== ID GENERATOR ==================== */

export function genId(prefix, len = 6) {
  return `${prefix}_${crypto.randomBytes(len).toString("hex")}`;
}

/** Waktu SERVER — satu-satunya sumber waktu (§58) */
export const now = () => Date.now();

/* ==================== HELPERS ==================== */

export const rupiah = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;

export function fmtDate(ts) {
  try {
    return new Date(Number(ts)).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(Number(ts)).toISOString();
  }
}

/* ==================== SYSTEM & ADMIN LOGS (§59, §60) ==================== */

const MAX_LOGS = 5000;

export function systemLog(event, meta = {}) {
  const logs = store.systemLogs.data;
  logs.push({
    id: genId("log"),
    event,
    meta,
    created_at: now(),
  });
  if (logs.length > MAX_LOGS) store.systemLogs.data = logs.slice(-MAX_LOGS);
  store.systemLogs.save();
}

export function adminLog(adminId, action, targetType, targetId, metadata = {}) {
  const logs = store.adminLogs.data;
  logs.push({
    id: genId("alog"),
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
    created_at: now(),
  });
  if (logs.length > MAX_LOGS) store.adminLogs.data = logs.slice(-MAX_LOGS);
  store.adminLogs.save();
}

export default store;
