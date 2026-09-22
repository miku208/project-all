import { WebSocketServer } from "ws";
import { verifyJwt } from "../auth/crypto.js";
import { config } from "../config.js";
import { getDevice, touchDevice } from "../db.js";
import { adapter } from "../adapters/index.js";
import { log } from "../utils/logger.js";

let wss = null;

const HEARTBEAT_MS = 30 * 1000;

function adapterStatusSafe() {
  try {
    return adapter.getConnectionStatus();
  } catch {
    return null;
  }
}

// Logika koneksi bersama (auth + heartbeat + handler pesan kontrol)
function onConnection(ws, req) {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token") || "";
  const payload = verifyJwt(token, config.jwtSecret);
  if (!payload || payload.type !== "access") {
    ws.close(4001, "unauthorized");
    return;
  }
  const device = getDevice(payload.deviceId);
  if (!device || device.revoked) {
    ws.close(4001, "device revoked");
    return;
  }

  ws.isAlive = true;
  ws.deviceId = payload.deviceId;
  ws.username = payload.username;
  touchDevice(payload.deviceId);
  log.info("WS", `Client connected (${ws.username}, device ${payload.deviceId})`);

  ws.send(
    JSON.stringify({
      type: "connection.updated",
      data: { ws: "connected", bot: adapterStatusSafe() },
    }),
  );

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    // Client hanya boleh kirim kontrol kecil: {type:"ping"}
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch (_e) {
      return;
    }
    if (msg?.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
    }
  });

  ws.on("close", () => log.info("WS", `Client disconnected (${ws.username})`));
  ws.on("error", () => {});
}

function startHeartbeat() {
  setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS).unref();
}

/**
 * Mode standalone: WSS bind langsung ke HTTP server di `path`.
 */
export function initWebSocket(server, path = "/ws") {
  wss = new WebSocketServer({ server, path });
  wss.on("connection", onConnection);
  startHeartbeat();
  log.info("WS", `WebSocket server ready di path ${path}`);
  return wss;
}

/**
 * Mode mounted (panel 8080 sudah punya WSS sendiri di /ws):
 * WSS dibuat tanpa server (noServer), lalu pasang listener 'upgrade'
 * PALING DEPAN (prependListener) supaya path gateway tidak ditelan/ditolak
 * oleh WSS milik panel. Path lain tetap diteruskan ke listener panel.
 */
export function initWebSocketNoServer(path = "/ws") {
  wss = new WebSocketServer({ noServer: true });
  wss.on("connection", onConnection);
  startHeartbeat();
  log.info("WS", `WebSocket (noServer) siap di path ${path}`);
  return wss;
}

export function attachUpgradeListener(server, path = "/ws") {
  server.prependListener("upgrade", (req, socket, head) => {
    let pathname = req.url || "";
    const q = pathname.indexOf("?");
    if (q !== -1) pathname = pathname.slice(0, q);
    if (pathname !== path) return; // bukan path kita -> biarkan listener lain
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
  log.info("WS", `Upgrade listener terpasang (prepend) untuk ${path}`);
}

// Broadcast event ke semua client terautentikasi
export function broadcast(type, data) {
  if (!wss) return;
  const payload = JSON.stringify({ type, data, ts: Date.now() });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

export function connectedCount() {
  return wss ? wss.clients.size : 0;
}
