// src/jadibot/jadibot.test.js — Test suite PHASE 1 (§70-§77)
// Jalankan: JADIBOT_TEST=1 node src/jadibot/jadibot.test.js
// WA pairing/koneksi WhatsApp asli TIDAK dites di sini (butuh interaksi
// manual perangkat) → dilaporkan NOT VERIFIED sesuai §78. Sisanya: MOCK sock.

process.env.JADIBOT_TEST = "1";
process.env.JADIBOT_DB_DIR = "./database/jadibot-test";
process.env.JADIBOT_PAYMENTS_DIR = "./payments-test";
process.env.JADIBOT_BOTS_DIR = "./data/jadibot-test";

import fs from "fs";
import assert from "assert";

let passed = 0, failed = 0, skipped = 0;
const results = [];
function check(name, fn) {
  return async () => {
    try {
      await fn();
      passed++;
      results.push(`  ✅ ${name}`);
    } catch (e) {
      failed++;
      results.push(`  ❌ ${name}\n     → ${e.message}`);
    }
  };
}
function notVerified(name, reason) {
  skipped++;
  results.push(`  ⏭️  NOT VERIFIED: ${name} — ${reason}`);
}
function section(title) {
  results.push(`\n${title}`);
}

async function main() {
  // bersihkan data test
  for (const d of ["database/jadibot-test", "payments-test", "data/jadibot-test"]) {
    fs.rmSync(d, { recursive: true, force: true });
  }

  const store = await import("./store.js");
  const auth = await import("./auth.js");
  const mw = await import("./middleware.js");
  const balance = await import("./balance.js");
  const trial = await import("./trial.js");
  const sub = await import("./subscription.js");
  const topup = await import("./topup.js");
  const engine = await import("./engine.js");
  const sched = await import("./scheduler.js");
  const sec = await import("./security.js");

  const tests = [];

  /* ═════════ §70 TEST AUTH ═════════ */
  section("§70 AUTH");
  await check("A: register → role=user, balance=0, status=active", async () => {
    const r = auth.register({ username: "miku", password: "secret123" });
    assert.ok(!r.error, r.error?.message);
    assert.equal(r.user.role, "user");
    assert.equal(r.user.balance, 0);
    assert.equal(r.user.account_status, "active");
    global.__miku = r.user;
    global.__mikuTok = r.tokens;
  })();
  await check("register duplicate username ditolak", async () => {
    assert.ok(auth.register({ username: "miku", password: "xxxxxx" }).error);
  })();
  await check("login password salah → INVALID_CREDENTIALS", async () => {
    assert.equal(auth.login({ username: "miku", password: "wrong" }).error, "INVALID_CREDENTIALS");
  })();
  await check("token invalid → null", async () => {
    assert.equal(auth.verifyAccessToken("garbage.token"), null);
  })();
  await check("suspended → login ditolak", async () => {
    const u = store.store.users.data[global.__miku.id];
    u.account_status = "suspended";
    assert.equal(auth.login({ username: "miku", password: "secret123" }).error, "USER_SUSPENDED");
    u.account_status = "active";
    store.store.users.save();
  })();
  await check("L: user (role=user) → requireAdmin 403 FORBIDDEN", async () => {
    let statusCode = 0, body = null;
    const res = { status(s) { statusCode = s; return { json(b) { body = b; } }; } };
    mw.requireAdmin({ auth: { sub: global.__miku.id, role: "user" } }, res, () => {});
    assert.equal(statusCode, 403);
    assert.equal(body.error.code, "FORBIDDEN");
  })();
  await check("refresh token → token baru", async () => {
    const r = auth.refresh(global.__mikuTok.refresh_token);
    assert.ok(!r.error, r.error?.message);
    assert.ok(r.tokens.access_token);
  })();

  /* ═════════ §71 TEST TRIAL ═════════ */
  section("§71 TRIAL");
  await check("B: create Jadibot → trial mulai, 1 jam", async () => {
    const user = store.store.users.data[global.__miku.id];
    const r = engine.createBot(user, "628111111111");
    assert.ok(!r.error, r.error?.message);
    global.__bot1 = r.bot;
    const u2 = store.store.users.data[global.__miku.id];
    assert.equal(u2.trial_used, true);
    const dur = u2.trial_expires_at - u2.trial_started_at;
    assert.equal(dur, 3600 * 1000); // 1 jam
  })();
  await check("C: trial aktif → bot jalan (status online — MOCK)", async () => {
    const bot = store.store.bots.data[global.__bot1.id];
    assert.equal(bot.status, "online");
  })();
  await check("trial tidak bisa di-reset logout/login", async () => {
    const r = auth.login({ username: "miku", password: "secret123" });
    const u = store.store.users.data[global.__miku.id];
    assert.equal(u.trial_used, true);
    assert.equal(trial.trialInfo(u).used, true);
  })();
  await check("D: trial habis → bot expired + notif SEKALI (idempotent)", async () => {
    const u = store.store.users.data[global.__miku.id];
    u.trial_expires_at = Date.now() - 1000; // simulasikan waktu lewat (server-side)
    store.store.users.save();
    await sched.runSchedulerTick();
    const bot = store.store.bots.data[global.__bot1.id];
    assert.equal(bot.status, "expired");
    assert.equal(u.trial_expired_notified, true);
    await sched.runSchedulerTick(); // tick kedua
    assert.equal(u.trial_expired_notified, true); // tetap sekali
  })();
  await check("trial habis + tanpa subs → operasi bot ditolak (TRIAL_EXPIRED)", async () => {
    const u = store.store.users.data[global.__miku.id];
    const v = trial.validateBotAccess(u, { forControl: true });
    assert.equal(v.allowed, false);
    assert.equal(v.code, "TRIAL_EXPIRED");
  })();
  await check("§74: max bot limit → MAX_BOTS_REACHED", async () => {
    const u = store.store.users.data[global.__miku.id];
    u.subscription_status = "active"; // agar lolos access check
    u.subscription_expires_at = Date.now() + 86400000;
    store.store.users.save();
    const r = engine.createBot(u, "628111111111");
    assert.equal(r.error, "MAX_BOTS_REACHED");
  })();
  notVerified("trial expiry dengan WA asli (pesan self-chat terkirim)", "butuh device WhatsApp manual");

  /* ═════════ §72 TEST BALANCE + TOPUP ═════════ */
  section("§72 BALANCE & TOPUP");
  await check("E: topup Rp10.000 → pending, balance tetap 0", async () => {
    const r = topup.createTopup(global.__miku.id, 10000);
    assert.ok(!r.error, r.error?.message);
    assert.equal(r.topup.status, "pending");
    global.__topup1 = r.topup;
    assert.equal(store.store.users.data[global.__miku.id].balance, 0);
  })();
  await check("topup di bawah minimum → INVALID_AMOUNT", async () => {
    assert.equal(topup.createTopup(global.__miku.id, 500).error, "INVALID_AMOUNT");
  })();
  await check("F: upload bukti (JPEG asli) → tersimpan, PENDING", async () => {
    // JPEG magic bytes + dummy body
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 7)]);
    const r = topup.saveProof(global.__miku.id, global.__topup1.id, jpeg);
    assert.ok(!r.error, r.error?.message);
    assert.ok(r.topup.proof_path.includes("proof.jpg"));
    assert.ok(fs.existsSync(r.topup.proof_path));
  })();
  await check("bukti format .exe ditolak (INVALID_FILE)", async () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(100)]);
    assert.equal(topup.saveProof(global.__miku.id, global.__topup1.id, exe).error, "INVALID_FILE");
  })();
  await check("G: approve → balance += 10000, transaksi tercatat", async () => {
    const r = topup.approveTopup("admin_x", global.__topup1.id);
    assert.ok(!r.error, r.error?.message);
    assert.equal(r.user.balance, 10000);
    assert.equal(r.transaction.type, "topup");
    assert.equal(r.transaction.balance_before, 0);
    assert.equal(r.transaction.balance_after, 10000);
    assert.equal(r.topup.status, "approved");
    global.__adminId = "admin_x";
  })();
  await check("H: approve DUA KALI → TOPUP_ALREADY_REVIEWED, balance tetap", async () => {
    const r = topup.approveTopup("admin_x", global.__topup1.id);
    assert.equal(r.error, "TOPUP_ALREADY_REVIEWED");
    assert.equal(store.store.users.data[global.__miku.id].balance, 10000); // TIDAK nambah lagi
  })();
  await check("user bukan pemilik topup → tidak bisa akses (TOPUP_NOT_FOUND untuk user lain)", async () => {
    const r2 = auth.register({ username: "bob", password: "secret123" });
    global.__bob = r2.user;
    const r = topup.cancelTopup(r2.user.id, global.__topup1.id);
    assert.equal(r.error, "TOPUP_NOT_FOUND");
  })();
  await check("§33: admin remove melebihi balance → INSUFFICIENT_BALANCE", async () => {
    const r = balance.adjustBalance(global.__miku.id, {
      type: "admin_adjustment", amount: -999999, admin_id: "admin_x",
    });
    assert.equal(r.error, "INSUFFICIENT_BALANCE");
  })();
  await check("§34: admin add/remove balance tercatat di transactions", async () => {
    balance.adjustBalance(global.__miku.id, { type: "admin_adjustment", amount: 5000, admin_id: "admin_x", description: "bonus" });
    const tx = balance.getUserTransactions(global.__miku.id);
    assert.equal(tx[0].type, "admin_adjustment");
    assert.equal(tx[0].amount, 5000);
  })();

  /* ═════════ §73 TEST SUBSCRIPTION ═════════ */
  section("§73 SUBSCRIPTION");
  await check("I: beli subs Rp5.000 → balance -5000, aktif +30 hari", async () => {
    // bersihkan subscription PALSU yang dipasang test max-bots sebelumnya
    const u0 = store.store.users.data[global.__miku.id];
    u0.subscription_status = "inactive";
    u0.subscription_expires_at = null;
    store.store.users.save();
    const before = store.store.users.data[global.__miku.id].balance; // 15000
    const r = sub.purchaseSubscription(global.__miku.id);
    assert.ok(!r.error, r.error?.message);
    const u = store.store.users.data[global.__miku.id];
    assert.equal(u.balance, before - 5000);
    assert.equal(u.subscription_status, "active");
    const dur = u.subscription_expires_at - Date.now();
    assert.ok(dur > 29 * 86400000 && dur <= 30.1 * 86400000, "durasi ~30 hari");
  })();
  await check("§15 renewal aktif: +30 hari dari expiry lama", async () => {
    const u = store.store.users.data[global.__miku.id];
    const oldExpiry = u.subscription_expires_at;
    balance.adjustBalance(global.__miku.id, { type: "admin_adjustment", amount: 5000, admin_id: "admin_x" });
    const r = sub.purchaseSubscription(global.__miku.id);
    assert.equal(store.store.users.data[global.__miku.id].subscription_expires_at, oldExpiry + 30 * 86400000);
  })();
  await check("J: balance Rp4.000 → purchase ditolak, balance tetap", async () => {
    balance.adjustBalance(global.__bob.id, { type: "admin_adjustment", amount: 4000, admin_id: "admin_x" });
    const r = sub.purchaseSubscription(global.__bob.id);
    assert.equal(r.error, "INSUFFICIENT_BALANCE");
    assert.equal(store.store.users.data[global.__bob.id].balance, 4000);
  })();

  /* ═════════ §74 TEST JADIBOT (ownership) ═════════ */
  section("§74 JADIBOT OWNERSHIP");
  await check("K: user lain akses bot milik orang → BOT_NOT_OWNER (403)", async () => {
    const rawBot = store.store.bots.data[global.__bot1.id];
    const check = engine.assertBotOwnership(rawBot, { id: global.__bob.id, role: "user" });
    assert.equal(check.error, "BOT_NOT_OWNER");
    // admin bypass boleh (§54)
    assert.ok(!engine.assertBotOwnership(rawBot, { id: "admin_x", role: "admin" }).error);
  })();
  await check("stop bot milik user lain lewat ownership guard", async () => {
    const check = engine.assertBotOwnership(store.store.bots.data[global.__bot1.id], { id: global.__bob.id, role: "user" });
    assert.equal(check.error, "BOT_NOT_OWNER"); // route akan 403, tidak sampai stopBot
  })();
  notVerified("pairing code & koneksi WhatsApp asli", "AUTHENTICATION REQUIRED — butuh interaksi HP manual");
  notVerified("restart safety dengan bot WA online sebenarnya", "butuh koneksi WA asli");

  /* ═════════ §75 TEST COMMAND SECURITY ═════════ */
  section("§75 COMMAND SECURITY");
  const userJid = "628111111111@s.whatsapp.net";
  const ownerJid = (await import("../lib/miku-topup.js")).getOwnerJids()[0];
  await check("M: user biasa → .eval / exec / shell / $ ditolak", async () => {
    for (const c of [".eval m", ".exec ls", ".shell", ".terminal", ".$x", ".test >> file", ".f => x"]) {
      const r = sec.classifyCommand(c, userJid);
      assert.equal(r.allowed, false, `harus ditolak: ${c}`);
      assert.equal(r.category, "OWNER_ONLY");
    }
  })();
  await check("owner JID dari config.js → owner-only ALLOWED", async () => {
    assert.ok(sec.isServerOwner(ownerJid));
    const r = sec.classifyCommand(".eval x", ownerJid);
    assert.equal(r.allowed, true);
  });
  await check("public command (.ping, .menu) → diizinkan semua user", async () => {
    assert.equal(sec.classifyCommand(".ping", userJid).allowed, true);
    assert.equal(sec.classifyCommand(".menu", userJid).allowed, true);
  })();
  await check("display name / username TIDAK bisa jadi owner (validasi JID saja)", async () => {
    assert.equal(sec.isServerOwner("owner-xy@display"), false);
    assert.equal(sec.isServerOwner("miku@s.whatsapp.net"), false);
  })();

  /* ═════════ HASIL ═════════ */
  console.log("\n══════════════════════════════════════════");
  console.log("  MIKU JADIBOT — PHASE 1 TEST RESULTS");
  console.log("══════════════════════════════════════════");
  console.log(results.join("\n"));
  console.log("\n──────────────────────────────────────────");
  console.log(`  PASS: ${passed}   FAIL: ${failed}   NOT VERIFIED: ${skipped}`);
  console.log("──────────────────────────────────────────\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Test runner crash:", e);
  process.exit(1);
});
