// src/jadibot/server.js — SATU BACKEND untuk semua Jadibot (§2, §81)
// Express API (API-first, nanti APK hanya client) + Admin Dashboard.

import express from "express";
import config from "../../config.js";
import { dashboardHTML } from "./dashboard.js";
import apiRouter from "./api.js";
import { restoreBots } from "./engine.js";
import { startScheduler } from "./scheduler.js";
import { getSocket } from "../connection.js";

let server = null;
let started = false;

export function startJadibot() {
  if (started || config.jadibot?.enabled === false) return null;
  started = true;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  // health
  app.get("/health", (req, res) =>
    res.json({ success: true, data: { service: "miku-jadibot", time: Date.now(), main_bot: !!getSocket?.() } }),
  );

  // Admin Dashboard (§37) — nanti APK memakai API yang sama
  app.get("/admin", (req, res) => res.send(dashboardHTML));

  // API utama
  app.use("/api", apiRouter);

  // error handler — JANGAN kirim stack trace ke client (§63)
  app.use((err, req, res, next) => {
    console.error("[JadibotServer]", err.message);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Kesalahan internal server" },
    });
  });

  const port = Number(config.jadibot?.port) || 3000;
  server = app.listen(port, () => {
    console.log("");
    console.log(`  ┌─────────────────────────────────────────────────┐`);
    console.log(`  │  🤖 MIKU JADIBOT API  →  http://localhost:${port}   │`);
    console.log(`  │  🛡️  Admin Dashboard   →  http://localhost:${port}/admin │`);
    console.log(`  └─────────────────────────────────────────────────┘`);
    console.log("");
  });

  // §69 — pulihkan bot saat boot, jalankan scheduler
  const restored = restoreBots();
  if (restored) console.log(`[Jadibot] ${restored} bot dipulihkan setelah restart`);
  startScheduler();

  return server;
}

export function stopJadibot() {
  if (server) server.close();
  server = null;
  started = false;
}
