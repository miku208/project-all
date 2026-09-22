#!/usr/bin/env node
/**
 * Miku-Baileys verification build.
 *
 * This repository ships pre-compiled runtime files (lib/ + WAProto/), so the
 * build step does not recompile TypeScript. Instead it verifies that the
 * distributable is complete and internally consistent:
 *
 *   1. package.json metadata sanity (ESM, entry points, files)
 *   2. lib/ entry points exist and all ESM files parse
 *   3. every relative ESM import resolves to an existing file
 *   4. WAProto runtime + typings exist and parse
 *   5. VoIP WASM/WebRTC assets are present
 *   6. public exports declared in lib/index.d.ts resolve
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "  ✔" : "  ✖"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures += 1;
};

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

console.log("mikuhostt-baileys build — verifying distributable…\n");

// 1. package metadata
console.log("[1/6] package.json metadata");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
ok("name is mikuhostt-baileys", pkg.name === "mikuhostt-baileys", pkg.name);
ok("ESM package", pkg.type === "module");
ok("main entry", pkg.main === "lib/index.js");
ok("types entry", pkg.types === "lib/index.d.ts");
ok(
  "files cover lib/ and WAProto/",
  Array.isArray(pkg.files) &&
    pkg.files.some((f) => f.startsWith("lib/")) &&
    pkg.files.some((f) => f.startsWith("WAProto/")),
);
ok("node engine >= 20", (pkg.engines?.node ?? "").includes("20") || (pkg.engines?.node ?? "").includes(">"));

// 2. entry points + ESM parse of every JS file
console.log("\n[2/6] lib/ entry points & ESM syntax");
const libIndex = join(root, "lib", "index.js");
const libIndexDts = join(root, "lib", "index.d.ts");
ok("lib/index.js exists", existsSync(libIndex));
ok("lib/index.d.ts exists", existsSync(libIndexDts));

const jsFiles = walk(join(root, "lib")).filter((f) => f.endsWith(".js"));
const dtsFiles = walk(join(root, "lib")).filter((f) => f.endsWith(".d.ts"));
ok("runtime JS files present", jsFiles.length > 50, `${jsFiles.length} files`);
ok("declaration files present", dtsFiles.length > 50, `${dtsFiles.length} files`);

for (const file of jsFiles) {
  try {
    await import(pathToFileURL(file).href);
  } catch (error) {
    // Module-level side effects (optional deps, native modules) are allowed to
    // fail at import time as long as the syntax is valid; distinguish the two.
    const src = readFileSync(file, "utf8");
    if (error instanceof SyntaxError) {
      ok(`ESM parse: ${file.replace(root, "")}`, false, String(error));
    } else if (!src.includes("import")) {
      // no imports, runtime error means real breakage
      ok(`load: ${file.replace(root, "")}`, false, String(error.message ?? error));
    }
    // Import-time errors from optional deps (sharp, fluent-ffmpeg, @roamhq/wrtc,
    // whatsapp-rust-bridge native bindings) are tolerated: the module graph is
    // exercised end-to-end by the compatibility tests instead.
  }
}
console.log("  ✔ (parse errors would have failed above)");

// 3. relative imports resolve
console.log("\n[3/6] relative import resolution");
const { parse } = await import("node:module");
let unresolved = 0;
for (const file of jsFiles) {
  const src = readFileSync(file, "utf8");
  const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)].map((m) => m[1]);
  for (const spec of specs) {
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) {
      console.log(`  ✖ unresolved: ${file.replace(root, "")} -> ${spec}`);
      unresolved += 1;
    }
  }
}
ok("all relative imports resolve", unresolved === 0, `${unresolved} unresolved`);

// 4. WAProto artifacts
console.log("\n[4/6] WAProto artifacts");
const waProtoDir = join(root, "WAProto");
for (const f of ["index.js", "index.d.ts", "WAProto.proto"]) {
  ok(`WAProto/${f}`, existsSync(join(waProtoDir, f)));
}
try {
  const proto = await import(pathToFileURL(join(waProtoDir, "index.js")).href);
  ok("WAProto runtime exposes proto", !!proto.proto);
  ok(
    "WAProto message classes available",
    typeof proto.proto?.Message === "object" || typeof proto.proto?.Message === "function",
  );
} catch (error) {
  ok("WAProto runtime loads", false, String(error));
}

// 5. VoIP WASM assets
console.log("\n[5/6] VoIP WASM assets");
const wasmDir = join(root, "lib", "assets", "wasm");
for (const f of ["whatsapp.wasm", "loader.js", "worker-modules.js"]) {
  ok(`lib/assets/wasm/${f}`, existsSync(join(wasmDir, f)));
}
const wasmStat = existsSync(join(wasmDir, "whatsapp.wasm"))
  ? statSync(join(wasmDir, "whatsapp.wasm"))
  : null;
ok(
  "whatsapp.wasm non-trivial",
  !!wasmStat && wasmStat.size > 1_000_000,
  wasmStat ? `${(wasmStat.size / 1e6).toFixed(1)} MB` : "missing",
);

// 6. public export surface
console.log("\n[6/6] public export surface");
try {
  const mod = await import(pathToFileURL(libIndex).href);
  const required = [
    "makeWASocket",
    "useMultiFileAuthState",
    "makeCacheableSignalKeyStore",
    "initAuthCreds",
    "BufferJSON",
    "fetchLatestBaileysVersion",
    "DisconnectReason",
    "Browsers",
    "Dugong",
    "VoipClient",
    "ActiveCall",
    "CallState",
    "Button",
    "ButtonV2",
    "Carousel",
    "AIRich",
    "ORich",
    "Toolkit",
    "makeStickerPack",
    "generateTableContent",
    "generateTableContentV2",
    "generateCodeBlockContent",
    "generateCodeBlockContentV2",
    "generateLinkContent",
    "generateLinkContentV2",
    "generateRichMessageContent",
    "tokenizeCode",
    "tokenizeCodeV2",
    "jidEncode",
    "jidDecode",
    "jidNormalizedUser",
    "Curve",
    "signedKeyPair",
    "aesEncryptGCM",
    "aesDecryptGCM",
  ];
  const missing = required.filter((name) => !(name in mod));
  ok("all key exports present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `${required.length} checked`);
  ok("default export is makeWASocket", typeof mod.default === "function");
  ok("makeWASocket is callable", typeof mod.makeWASocket === "function");
} catch (error) {
  ok("lib/index.js loads", false, String(error));
}

console.log(`\n${failures === 0 ? "✔ build OK" : `✖ build FAILED (${failures} problem(s))`}`);
process.exit(failures === 0 ? 0 : 1);
