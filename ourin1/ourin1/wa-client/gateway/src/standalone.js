/**
 * Dua mode start gateway:
 *  - buildGatewayApp(): express app siap mount (dipakai integration.js mounted
 *    ke panel 8080 via mountWaGateway)
 *  - startStandalone(): app + listen sendiri di config.port (dipakai server.js)
 *
 * Event wiring adapter -> DB -> broadcast WS dipasang sekali di attachEventWiring().
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { log } from "./utils/logger.js";
import { adapter, ADAPTER_MODE } from "./adapters/index.js";
import { EVENTS } from "./adapters/botAdapter.js";
import { initWebSocket, broadcast } from "./websocket/index.js";
import { insertMessage, upsertChat, updateMessageStatus, markMessageDeleted, migrateLidHistory } from "./db.js";
import authRoutes, { ensureAdminUser } from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import botRoutes from "./routes/bot.js";
import { rateLimit } from "./middleware/rateLimit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let wiringAttached = false;

function attachEventWiring() {
  if (wiringAttached) return;
  wiringAttached = true;

  // ===== Event adapter -> persist ke DB + broadcast WS =====
  // Idempotency: UNIQUE(chat_id, message_id) mencegah duplikat saat reconnect/replay.
  adapter.onEvent((type, data) => {
    try {
      if (type === EVENTS.MESSAGE_RECEIVED || type === EVENTS.MESSAGE_SENT) {
        if (data?.chatId && data?.messageId) {
          insertMessage({
            chatId: data.chatId,
            messageId: data.messageId,
            senderId: data.senderId ?? null,
            senderName: data.senderName ?? null,
            messageType: data.messageType || "text",
            text: data.text ?? null,
            mediaMetadata: data.mediaMetadata ?? null,
            timestamp: data.timestamp || Date.now(),
            isFromMe: type === EVENTS.MESSAGE_SENT,
            status: data.status ?? null,
            replyTo: data.replyTo ?? null,
          });
          upsertChat({
            id: data.chatId,
            lastMessageText: data.text ?? null,
            lastMessageTs: data.timestamp || Date.now(),
          });
          broadcast(type, data);
        }
      } else if (type === EVENTS.MESSAGE_UPDATED) {
        if (data?.chatId && data?.messageId && data?.status) {
          updateMessageStatus(data.chatId, data.messageId, data.status);
        }
        broadcast(type, data);
      } else if (type === EVENTS.MESSAGE_DELETED) {
        // Anti-delete: pesan dihapus pengirim tetap disimpan di DB gateway
        // (cuma ditandai status 'deleted') supaya chat history utuh untuk
        // dipantau dari APK — inilah guna gateway punya simpanan sendiri.
        if (data?.chatId && data?.messageId) {
          markMessageDeleted(data.chatId, data.messageId);
        }
        broadcast(type, data);
      } else if (
        type === EVENTS.CONNECTION_UPDATED ||
        type === EVENTS.BOT_SETTINGS_UPDATED ||
        type === EVENTS.PLUGIN_UPDATED ||
        type === EVENTS.CHAT_UPDATED ||
        type === EVENTS.CHAT_READ
      ) {
        broadcast(type, data);
      }
    } catch (e) {
      log.error("Event", e.message);
    }
  });
}

export function buildGatewayApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" })); // validasi ukuran body
  // Raw body khusus upload media multipart (maks 55MB; file 50MB + overhead boundary)
  // diterapkan PER-ROUTE via router-level middleware di bawah — tidak global
  // supaya endpoint JSON lain tetap cepat.
  app.use("/api", (req, res, next) => {
    if (req.method === "POST" && /^\/chats\/[^/]+\/media$/.test(req.path)) {
      return express.raw({ type: "*/*", limit: "55mb" })(req, res, next);
    }
    next();
  });
  app.set("trust proxy", true); // di belakang proxy/edge, agar req.ip = IP klien asli

  // Security headers minimal
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });

  // Global rate limit per klien: 300 req/menit
  app.use((req, res, next) => {
    const ip = req.ip || "unknown";
    const r = rateLimit(`global:${ip}`, 300, 60 * 1000);
    if (!r.allowed) {
      res.set("Retry-After", String(r.retryAfterSec));
      return res.status(429).json({ error: "Terlalu banyak permintaan" });
    }
    next();
  });

  // Health check tanpa auth (untuk monitoring)
  app.get("/health", (req, res) => res.json({ ok: true }));

  // Routes
  app.use("/auth", authRoutes);
  app.use("/api", apiRoutes);
  app.use("/api", botRoutes);

  // Serve web test client (debug)
  const testClientDir = path.resolve(__dirname, "..", "..", "test-client");
  app.use("/test-client", express.static(testClientDir));

  // 404 JSON
  app.use((req, res) => res.status(404).json({ error: "Not found" }));

  // Error handler
  app.use((err, req, res, next) => {
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ error: "Payload terlalu besar" });
    }
    log.error("Server", err.message);
    res.status(500).json({ error: "Internal error" });
  });

  attachEventWiring();
  ensureAdminUser();

  // Migrasi sekali jalan: riwayat chat lama yang tersimpan under chatId @lid
  // dipindah ke chatId nomor asli (pakai cache LID milik bot). Ini perbaikan
  // bug "riwayat chat sebagian nomor tidak muncul / hilang".
  try {
    const r = migrateLidHistory((lidJid) => adapter.resolveJid?.(lidJid));
    if (!r?.skipped && r?.ok && r.chatsFixed > 0) {
      log.info("Gateway", `Riwayat LID dimigrasi: ${r.chatsFixed} chat diperbaiki`);
    }
  } catch { }

  return app;
}

export async function startStandalone() {
  const app = buildGatewayApp();

  const server = app.listen(config.port, config.host, () => {
    log.info("Gateway", `Started di ${config.host}:${config.port} (adapter: ${ADAPTER_MODE})`);
  });

  initWebSocket(server);

  return { app, server };
}
