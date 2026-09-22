// Entry point standalone gateway: node src/server.js
import { config } from "./config.js";
import { log } from "./utils/logger.js";
import { adapter, ADAPTER_MODE } from "./adapters/index.js";
import { startStandalone } from "./standalone.js";

const { server } = await startStandalone();

// Shutdown handlers HANYA untuk proses standalone.
// Saat in-process (integration.js), sinyal dikelola proses bot utama.
async function shutdown(signal) {
  log.info("Gateway", `${signal}, shutdown...`);
  try {
    await adapter.shutdown();
  } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log.info("Gateway", `Standalone mode siap (adapter: ${ADAPTER_MODE})`);
