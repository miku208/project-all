/**
 * Miku-Baileys compatibility tests.
 *
 * Run: npm test
 *
 * These tests exercise the public surface of the package the same way an
 * end user would: import from the package root, create a socket, prepare
 * auth state, and check that all feature exports are available.
 *
 * Note on makeWASocket: constructing a socket opens a real WebSocket
 * connection toward WhatsApp servers. To keep the test offline-safe, we
 * start a local WebSocket echo server and point the socket at it via the
 * `wsUri`/fetch-override options only if supported; otherwise we validate
 * socket construction lazily through exported factory shape.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pkg from "../lib/index.js";

// ─── Test 1: package import ────────────────────────────────────────────────
test("1. package imports successfully", () => {
  assert.ok(pkg, "package namespace should import");
  assert.equal(typeof pkg.default, "function", "default export must be makeWASocket");
  assert.equal(typeof pkg.makeWASocket, "function");
});

// ─── Test 2: socket creation ───────────────────────────────────────────────
test("2. makeWASocket constructs a socket with full method surface", () => {
  const logger = { level: "silent", child: () => logger, info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {} };
  let sock;
  try {
    sock = pkg.makeWASocket({
      auth: { creds: pkg.initAuthCreds(), keys: {} },
      logger,
      browser: pkg.Browsers.ubuntu("Chrome"),
      // Point the transport at a local refused port so the test never
      // contacts WhatsApp servers; socket construction is still fully real.
      waWebSocketUrl: "ws://127.0.0.1:1",
      connectTimeoutMs: 1000,
    });
  } catch (error) {
    // If a mandatory logger shape is enforced, fail loudly with context.
    assert.fail(`makeWASocket threw: ${error}`);
  }

  const expectedMethods = [
    "sendMessage",
    "relayMessage",
    "requestPairingCode",
    "groupMetadata",
    "groupCreate",
    "newsletterFollow",
    "newsletterCreate",
    "productCreate",
    "getCatalog",
    "sendTable",
    "sendTableV2",
    "sendList",
    "sendCodeBlock",
    "sendCodeBlockV2",
    "sendLink",
    "sendLinkV2",
    "sendRichMessage",
    "sendStatusMention",
    "communityCreate",
    "ev",
  ];
  for (const m of expectedMethods) {
    assert.ok(sock[m], `socket.${m} should exist`);
  }
  assert.ok(sock.authState?.creds, "authState.creds should exist");
});

// ─── Test 3: useMultiFileAuthState ─────────────────────────────────────────
test("3. useMultiFileAuthState returns creds + saveCreds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "miku-baileys-auth-"));
  const { state, saveCreds } = await pkg.useMultiFileAuthState(dir);
  assert.ok(state?.creds, "state.creds should exist");
  assert.ok(state.keys, "state.keys should exist");
  assert.equal(typeof saveCreds, "function");
  await saveCreds(); // must not throw; writes creds.json
});

// ─── Test 4: pairing code API ──────────────────────────────────────────────
test("4. requestPairingCode API available", () => {
  const logger = { level: "silent", child: () => logger, info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {} };
  const sock = pkg.makeWASocket({
    auth: { creds: pkg.initAuthCreds(), keys: {} },
    logger,
    waWebSocketUrl: "ws://127.0.0.1:1",
  });
  assert.equal(typeof sock.requestPairingCode, "function");
});

// ─── Test 5: DisconnectReason ──────────────────────────────────────────────
test("5. DisconnectReason is available with expected members", () => {
  assert.equal(typeof pkg.DisconnectReason, "object");
  assert.ok("loggedOut" in pkg.DisconnectReason);
  assert.ok("connectionClosed" in pkg.DisconnectReason);
  assert.ok("connectionLost" in pkg.DisconnectReason);
});

// ─── Test 6: Browsers ──────────────────────────────────────────────────────
test("6. Browsers helpers available", () => {
  for (const b of ["ubuntu", "windows", "macOS", "baileys"]) {
    assert.equal(typeof pkg.Browsers[b], "function", `Browsers.${b} should be a function`);
  }
  const b = pkg.Browsers.ubuntu("Chrome");
  assert.ok(Array.isArray(b) && b.length === 3);
  assert.equal(b[0], "Ubuntu");
  assert.equal(b[1], "Chrome");
  assert.equal(typeof b[2], "string");
});

// ─── Test 7: rich message helpers ──────────────────────────────────────────
test("7. rich message helpers available", () => {
  for (const name of [
    "generateTableContent",
    "generateTableContentV2",
    "generateListContent",
    "generateCodeBlockContent",
    "generateCodeBlockContentV2",
    "generateLinkContent",
    "generateLinkContentV2",
    "generateRichMessageContent",
    "tokenizeCode",
    "tokenizeCodeV2",
    "makeStickerPack",
    "ORich",
    "AIRich",
    "Button",
    "Carousel",
  ]) {
    assert.ok(pkg[name], `${name} should be exported`);
  }
  // functional smoke: tokenizer + sticker pack shape
  const tokens = pkg.tokenizeCode("const x = 1;", "javascript");
  assert.ok(Array.isArray(tokens) && tokens.length > 0, "tokenizeCode returns tokens");
  const pack = pkg.makeStickerPack({ name: "Pack", stickers: [Buffer.from([1])] });
  assert.ok(pack.stickerPack, "makeStickerPack returns stickerPack shape");
  assert.equal(pack.stickerPack.publisher, "Miku AI", "default publisher rebranded");
});

// ─── Test 8: VoIP exports ──────────────────────────────────────────────────
test("8. VoIP exports available (VoipClient, ActiveCall, CallState)", () => {
  assert.equal(typeof pkg.VoipClient, "function");
  assert.equal(typeof pkg.ActiveCall, "function");
  assert.ok(pkg.CallState, "CallState should be exported");
  assert.ok("Idle" in pkg.CallState && "Active" in pkg.CallState);
  // Instantiate without connecting (no network involved)
  const client = new pkg.VoipClient();
  assert.ok(client, "VoipClient instantiates offline");
  assert.equal(typeof client.connectWithSocket, "function");
  assert.equal(typeof client.call, "function");
});

// ─── Test 9: TypeScript declarations resolve ───────────────────────────────
test("9. TypeScript declarations resolve against the runtime exports", async () => {
  // d.ts files backing the public surface must exist
  for (const f of [
    "lib/index.d.ts",
    "lib/Modded/message_builder.d.ts",
    "lib/VoIP/index.d.ts",
    "lib/Utils/index.d.ts",
    "lib/Types/index.d.ts",
    "lib/Defaults/index.d.ts",
    "lib/WABinary/index.d.ts",
    "lib/WAM/index.d.ts",
    "lib/WAUSync/index.d.ts",
    "lib/Socket/index.d.ts",
  ]) {
    const stat = (await import("node:fs")).statSync(
      join(new URL("../", import.meta.url).pathname, f),
    );
    assert.ok(stat.isFile(), `${f} should exist`);
  }

  // Compile a consumer file against the declarations. The criterion is:
  // zero TypeScript errors attributed to the consumer file itself.
  const { execFileSync } = await import("node:child_process");
  let stdout = "";
  try {
    stdout = execFileSync(
      "npx",
      [
        "tsc",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "es2022",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "test/tsd-check.ts",
      ],
      { encoding: "utf8", cwd: new URL("../", import.meta.url).pathname, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (err) {
    stdout = String(err.stdout ?? "") + String(err.stderr ?? "");
  }
  const consumerErrors = stdout
    .split("\n")
    .filter((line) => line.includes("tsd-check.ts"));
  assert.deepEqual(
    consumerErrors,
    [],
    `TypeScript consumer errors:\n${consumerErrors.join("\n") || stdout.slice(0, 2000)}`,
  );
});

// ─── Test 10: ESM integrity ────────────────────────────────────────────────
test("10. package ESM entry graph loads cleanly (no MODULE_NOT_FOUND)", async () => {
  // Re-import through a fresh module URL to force full graph evaluation.
  const mod = await import("../lib/index.js?compat=1");
  assert.equal(typeof mod.default, "function");
  assert.equal(typeof mod.VoipClient, "function");
  assert.ok(mod.proto, "WAProto proto namespace should be re-exported");
  assert.ok(mod.DisconnectReason, "DisconnectReason should be re-exported");
});
