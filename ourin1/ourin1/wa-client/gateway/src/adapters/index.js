import { config, ADAPTER_MODE } from "../config.js";
import { MockBotAdapter } from "./mockAdapter.js";
import { log } from "../utils/logger.js";

/**
 * Factory adapter tunggal. Mode ditentukan otomatis:
 *  1. globalThis.__MIKU_BOT_MODULES__ ada -> LIVE (in-process dari bot utama,
 *     diset oleh integration.js SEBELUM module ini di-load via dynamic import)
 *  2. ADAPTER_MODE=live tanpa botModules -> error jujur, exit (bukan pura-pura jalan)
 *  3. selain itu -> MOCK (data dummy untuk dev/test)
 */
let adapter;

if (globalThis.__MIKU_BOT_MODULES__) {
  const { LiveBotAdapter } = await import("./liveAdapter.js");
  adapter = new LiveBotAdapter({ botModules: globalThis.__MIKU_BOT_MODULES__ });
} else if (ADAPTER_MODE === "live") {
  log.error(
    "Adapter",
    'ADAPTER_MODE=live tapi tidak dijalankan dalam proses bot utama. Gunakan ADAPTER_MODE=mock, atau lihat integration.js untuk integrasi in-process.',
  );
  process.exit(1);
} else {
  adapter = new MockBotAdapter();
}

await adapter.init();
const ACTIVE_MODE = globalThis.__MIKU_BOT_MODULES__ ? "live" : ADAPTER_MODE;
log.info("Adapter", `Mode: ${ACTIVE_MODE}`);

export { adapter, ACTIVE_MODE as ADAPTER_MODE };
