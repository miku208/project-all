// src/jadibot/qris.js — QRIS settings (§20): QRIS disimpan di backend/database,
// admin dapat mengganti via dashboard, user selalu melihat QRIS terbaru.
// Tidak ada QRIS yang di-hardcode di client/APK.

import fs from "fs";
import path from "path";
import config from "../../config.js";
import { setSetting, getSetting } from "./settings.js";

const PAYMENTS_ROOT = path.resolve(
  process.env.JADIBOT_PAYMENTS_DIR || config.jadibot?.paymentsPath || "./payments",
);

function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

/** Simpan QRIS image hasil upload admin (raw buffer) */
export function saveQrisImage(buffer) {
  const type = detectImageType(buffer);
  if (!type) return { error: "INVALID_FILE", message: "QRIS harus JPG/PNG/WEBP" };
  if (buffer.length > 5 * 1024 * 1024) {
    return { error: "INVALID_FILE", message: "Ukuran QRIS maksimal 5MB" };
  }
  fs.mkdirSync(PAYMENTS_ROOT, { recursive: true });
  const filePath = path.join(PAYMENTS_ROOT, `qris.${type}`);
  fs.writeFileSync(filePath, buffer);
  setSetting("qrisPath", filePath);
  return { ok: true, path: filePath };
}

/** Path QRIS aktif (file upload) atau null */
export function getQrisFilePath() {
  const p = getSetting("qrisPath");
  if (!p) return null;
  try {
    const resolved = path.resolve(p);
    if (!resolved.startsWith(PAYMENTS_ROOT)) return null;
    return fs.existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}
