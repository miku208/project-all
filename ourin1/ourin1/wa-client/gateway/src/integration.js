/**
 * Integrasi in-process — SATU-SATUNYA titik kontak dengan bot utama.
 *
 * Dua mode (dipilih env WA_GATEWAY_MODE):
 *  - "mounted" (default): router gateway di-mount ke Express panel 8080
 *    via mountWaGateway() + WebSocket gateway di-attach ke server HTTP panel
 *    di path /wa-gateway/ws. Hasil: https://mikujadibot.web.id/wa-gateway/*
 *    langsung jalan lewat edge TLS yang sudah ada (edge -> :8080).
 *  - "standalone": gateway listen sendiri di config.port (8787).
 *
 * Pemakaian di index.js bot utama:
 *
 *   if (process.env.WA_GATEWAY === "1" || fs.existsSync("wa-client/ENABLED")) {
 *     import("./wa-client/gateway/src/integration.js")
 *       .then((m) => m.startGatewayInProcess())
 *       .catch((e) => console.error("[WaGateway] gagal start:", e.message));
 *   }
 *
 * Default: TIDAK aktif. Bot utama berjalan normal seperti sebelumnya kecuali
 * env WA_GATEWAY=1 diset ATAU file wa-client/ENABLED ada.
 */
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./utils/logger.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Root bot utama = 2 level di atas wa-client/gateway  ->  /root/ourin
const BOT_ROOT = path.resolve(__dirname, "..", "..", "..");
const MOUNT_PATH = "/wa-gateway";
const WS_PATH = "/wa-gateway/ws";

let started = false;

export async function startGatewayInProcess() {
  if (started) {
    log.warn("Gateway", "Integrasi sudah dijalankan, skip");
    return { alreadyStarted: true };
  }
  started = true;

  // Modul internal bot yang dipakai adapter (semua observe/read saja)
  const connection = await import(path.join(BOT_ROOT, "src", "connection.js"));
  const database = await import(path.join(BOT_ROOT, "src", "lib", "ourin-database.js"));
  const botConfig = (await import(path.join(BOT_ROOT, "config.js"))).default;
  const plugins = await import(path.join(BOT_ROOT, "src", "lib", "ourin-plugins.js"));
  const serialize = await import(path.join(BOT_ROOT, "src", "lib", "ourin-serialize.js"));
  const jadibotServer = await import(path.join(BOT_ROOT, "src", "lib", "ourin-jadibot-server.js"));

  const lid = await import(path.join(BOT_ROOT, "src", "lib", "ourin-lid.js"));

  const botModules = {
    getSocket: connection.getSocket,
    getConnectionState: connection.getConnectionState,
    getDatabase: database.getDatabase,
    store: connection.store,
    resolveLid: lid.resolveAnyLidToJid,
    config: botConfig,
    pluginStore: plugins.pluginStore,
    enablePlugin: plugins.enablePlugin,
    disablePlugin: plugins.disablePlugin,
    invalidatePrefixCache: serialize.invalidatePrefixCache,
  };

  // Kabelkan adapter live ke gateway (adapters/index.js membaca global ini)
  globalThis.__MIKU_BOT_MODULES__ = botModules;

  const mode = process.env.WA_GATEWAY_MODE || "mounted";

  if (mode === "mounted") {
    const { buildGatewayApp } = await import("./standalone.js");
    const { initWebSocketNoServer, attachUpgradeListener } = await import("./websocket/index.js");

    const router = buildGatewayApp(); // express app tanpa listen
    const ok = jadibotServer.mountWaGateway(router);
    if (!ok) {
      throw new Error(
        "Panel 8080 belum siap di-mount (appInstance null). " +
          "Pastikan startJadibotApiServer() sudah dipanggil sebelum integrasi.",
      );
    }
    const httpServer = jadibotServer.getHttpServer();
    if (!httpServer) throw new Error("Server HTTP panel tidak tersedia");
    // noServer + prependListener: WSS panel (/ws) terdaftar lebih dulu dan
    // versi ws di bot menolak path asing dengan 400 — jadi handler upgrade
    // gateway harus dieksekusi SEBELUM listener panel, hanya untuk path-nya.
    initWebSocketNoServer(WS_PATH);
    attachUpgradeListener(httpServer, WS_PATH);

    log.info("Gateway", `Mounted di panel 8080 path ${MOUNT_PATH} (WS: ${WS_PATH}, adapter: live)`);
    return { ok: true, mode: "mounted", mountPath: MOUNT_PATH };
  }

  // mode standalone (fallback)
  const { startStandalone } = await import("./standalone.js");
  await startStandalone();
  log.info("Gateway", `Standalone di port ${config.port} (adapter: live)`);
  return { ok: true, mode: "standalone" };
}
