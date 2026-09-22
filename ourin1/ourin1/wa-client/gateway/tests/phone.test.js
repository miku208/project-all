// Test normalisasi nomor telepon internasional.
// Jalankan: node --test tests/phone.test.js
//
// Latar: sebelumnya _normalizeIdNumber menolak nomor non-Indonesia
// ("Nomor harus diawali 62 atau 08"). Sekarang semua country code diterima.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveBotAdapter } from "../src/adapters/liveAdapter.js";

// Pakai method via prototype — konstruktor butuh botModules dari proses bot.
const validator = {
  _validatePrivateJid: LiveBotAdapter.prototype._validatePrivateJid,
  _normalizeIdNumber: LiveBotAdapter.prototype._normalizeIdNumber,
};
const norm = (raw) =>
  LiveBotAdapter.prototype._normalizeIdNumber.call(validator, raw);
const toJid = (raw) =>
  LiveBotAdapter.prototype._normalizeParticipantJid.call(validator, raw);

test("nomor Indonesia: +62 / 62 / 08 tetap didukung", () => {
  assert.equal(norm("+628123456789"), "628123456789");
  assert.equal(norm("628123456789"), "628123456789");
  assert.equal(norm("081234567890"), "6281234567890"); // trunk lokal -> 62
});

test("nomor internasional: UK & Jepang tidak dikonversi ke 62", () => {
  assert.equal(norm("+447911123456"), "447911123456");
  assert.equal(norm("447911123456"), "447911123456");
  assert.equal(norm("+819012345678"), "819012345678");
  assert.equal(norm("819012345678"), "819012345678");
});

test("JID penuh @s.whatsapp.net diteruskan apa adanya", () => {
  assert.equal(norm("447911123456@s.whatsapp.net"), "447911123456");
  assert.equal(norm("628123456789@s.whatsapp.net"), "628123456789");
});

test("spasi, strip, kurung, dan leading + dibersihkan", () => {
  assert.equal(norm("+62 812-3456-789"), "628123456789");
  assert.equal(norm("+44 (7911) 123-456"), "447911123456");
  assert.equal(norm("  +81 90-1234-5678 "), "819012345678");
});

test("input invalid ditolak tanpa crash", () => {
  assert.equal(norm(""), null);
  assert.equal(norm(null), null);
  assert.equal(norm("abc"), null);
  assert.equal(norm("12345"), null); // terlalu pendek
  assert.equal(norm("javascript:alert(1)"), null);
  assert.equal(norm("intent://x"), null);
});

test("_normalizeParticipantJid menghasilkan JID @s.whatsapp.net", () => {
  assert.equal(toJid("+447911123456"), "447911123456@s.whatsapp.net");
  assert.equal(toJid("081234567890"), "6281234567890@s.whatsapp.net");
  assert.equal(toJid("447911123456:12@s.whatsapp.net"), "447911123456@s.whatsapp.net"); // device suffix dibuang
  assert.equal(toJid("628123456789@s.whatsapp.net"), "628123456789@s.whatsapp.net");
});
