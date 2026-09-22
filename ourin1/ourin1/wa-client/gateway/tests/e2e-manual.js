/**
 * Test e2e gateway (mode mock) — dipakai manual: node tests/e2e-manual.js
 * Spawn server di port acak dengan DATA_DIR terpisah (tidak menyentuh data
 * produksi — dua proses menulis gateway.db yang sama bisa bikin DB korup!),
 * login admin, cek endpoint youtube/invite/members. Exit 0 = semua lulus.
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3900 + Math.floor(Math.random() * 400);

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Env minimal utk server — DATA_DIR terpisah supaya test TIDAK menulis
  // gateway.db produksi (root cause DB korup sebelumnya).
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "gw-test-"));
  const env = {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    ADAPTER_MODE: "mock",
    DATA_DIR: tmpData,
  };
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  const base = `http://127.0.0.1:${PORT}`;
  try {
    // Tunggu server siap
    let up = false;
    for (let i = 0; i < 40; i++) {
      await wait(250);
      try {
        const h = await fetch(`${base}/health`);
        if (h.ok) {
          up = true;
          break;
        }
      } catch {}
    }
    if (!up) throw new Error(`Server tidak mau start:\n${serverLog.slice(-500)}`);

    // Login admin dari .env (baca manual, tanpa dotenv)
    const envFile = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const get = (k) => (envFile.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: get("ADMIN_USER") || "admin", password: get("ADMIN_PASSWORD") }),
    });
    const loginBody = await login.json();
    if (!loginBody.accessToken) throw new Error(`Login gagal: ${JSON.stringify(loginBody).slice(0, 120)}`);
    const auth = { Authorization: `Bearer ${loginBody.accessToken}` };

    let fails = 0;
    const check = (name, cond, detail) => {
      console.log(`${cond ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
      if (!cond) fails++;
    };

    // 1. YouTube search
    const ys = await fetch(`${base}/api/media/youtube/search?q=lofi`, { headers: auth });
    const yb = await ys.json();
    check("youtube search", ys.ok && Array.isArray(yb.videos) && yb.videos.length > 0, `${yb.videos?.length} hasil, #1: ${yb.videos?.[0]?.title?.slice(0, 40)}`);

    // 2. Stream URL di mock memang tidak ada — route balik 400 + pesan jelas (bukan crash)
    const vid = yb.videos?.[0]?.videoId || "MOCK1";
    const ss = await fetch(`${base}/api/media/youtube/stream?videoId=${vid}&format=mp3`, { headers: auth });
    const sb = await ss.json();
    check("youtube stream (mock)", ss.status === 400 && typeof sb.error === "string", `HTTP ${ss.status}, error: ${sb.error?.slice(0, 60)}`);

    // 3. Invite
    const iv = await fetch(`${base}/api/chats/120363050000000000%40g.us/members/invite`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ number: "628123456789" }),
    });
    const ib = await iv.json();
    check("kirim undangan", iv.ok && ib.ok === true && typeof ib.url === "string", ib.url);

    // 4. Add members — mock: nomor 08xxx disimulasikan 403 (privasi tolak) utk verifikasi hint UI
    const am = await fetch(`${base}/api/chats/120363050000000000%40g.us/members/add`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ jids: ["628111111111@s.whatsapp.net", "08123456789"] }),
    });
    const ab = await am.json();
    const has403 = (ab.failed || []).some((f) => String(f.error).includes("403"));
    check("tambah member (mock 403)", am.ok && (ab.added?.length || 0) >= 1 && has403, `added=${ab.added?.length}, failed=${JSON.stringify(ab.failed)?.slice(0, 80)}`);

    // 5. Promote/demote admin
    const pa = await fetch(`${base}/api/chats/120363050000000000%40g.us/members/admin`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ jids: ["628111111111@s.whatsapp.net"], action: "promote" }),
    });
    const pb = await pa.json();
    check("promote admin", pa.ok && pb.ok === true && (pb.changed?.length || 0) === 1, JSON.stringify(pb).slice(0, 90));

    const da = await fetch(`${base}/api/chats/120363050000000000%40g.us/members/admin`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ jids: ["628111111111@s.whatsapp.net"], action: "demote" }),
    });
    const db2 = await da.json();
    check("demote admin", da.ok && db2.ok === true && (db2.changed?.length || 0) === 1, JSON.stringify(db2).slice(0, 90));

    // 6. Validasi: action selain promote/demote harus ditolak
    const va = await fetch(`${base}/api/chats/120363050000000000%40g.us/members/admin`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ jids: ["628111111111@s.whatsapp.net"], action: "hacks" }),
    });
    check("validasi action invalid", va.status === 400, `HTTP ${va.status}`);

    console.log(fails === 0 ? "\nSEMUA TES LULUS ✓" : `\n${fails} TES GAGAL ✗`);
    process.exit(fails === 0 ? 0 : 1);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  } finally {
    server.kill("SIGTERM");
    // Bersihkan data test
    try {
      fs.rmSync(tmpData, { recursive: true, force: true });
    } catch {}
  }
}

main();
