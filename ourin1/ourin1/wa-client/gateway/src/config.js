import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Loader .env sederhana (tanpa dependency dotenv): KEY=VALUE per baris
function loadEnvFile() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile();

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[Config] ENV wajib hilang: ${name}. Copy .env.example ke .env lalu isi.`);
    process.exit(1);
  }
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || "8787", 10),
  host: process.env.HOST || "127.0.0.1",
  jwtSecret: required("JWT_SECRET"),
  botApiKey: required("BOT_API_KEY"),
  adminUser: process.env.ADMIN_USER || "admin",
  adminPassword: required("ADMIN_PASSWORD"),
  accessTokenTtl: parseInt(process.env.ACCESS_TOKEN_TTL || "900", 10),
  refreshTokenTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || "30", 10),
  // dataDir bisa dioverride via DATA_DIR (dipakai test agar tidak menyentuh
  // data produksi — dua proses yang menulis gateway.db sama bisa korup!).
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(__dirname, "..", "data"),
};

// Adapter mode: "mock" untuk dev/testing, "live" = in-process bot utama (belum aktif)
export const ADAPTER_MODE = process.env.ADAPTER_MODE || "mock";

fs.mkdirSync(config.dataDir, { recursive: true });
