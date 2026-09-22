import { Router } from "express";
import { adapter } from "../adapters/index.js";
import { EVENTS } from "../adapters/botAdapter.js";
import { getSetting, setSetting, getAllSettings, setPluginEnabled, listPluginSettings } from "../db.js";
import { authRequired } from "../middleware/auth.js";
import { broadcast } from "../websocket/index.js";
import { log } from "../utils/logger.js";

const router = Router();

const SETTING_KEYS = ["botName", "mode", "prefix", "autoRead", "autoTyping"];
const MODES = ["public", "self"]; // bot core belum dukung "private" — didokumentasikan

function validateSetting(key, value) {
  if (!SETTING_KEYS.includes(key)) return `Setting "${key}" tidak dikenal`;
  switch (key) {
    case "mode":
      if (!MODES.includes(value)) return `Mode harus salah satu dari: ${MODES.join(", ")}`;
      break;
    case "prefix":
      if (typeof value !== "string" || value.length === 0 || value.length > 4)
        return "Prefix harus string 1-4 karakter";
      break;
    case "botName":
      if (typeof value !== "string" || value.length === 0 || value.length > 32)
        return "Bot name harus string 1-32 karakter";
      break;
    case "autoRead":
    case "autoTyping":
      if (typeof value !== "boolean") return `${key} harus boolean`;
      break;
  }
  return null;
}

// GET /api/bot/settings
router.get("/bot/settings", authRequired, async (req, res) => {
  try {
    const live = await adapter.getBotSettings();
    // Merge dengan yang tersimpan di gateway DB (botName bisa disimpan lokal)
    const stored = getAllSettings();
    res.json({ settings: { ...stored, ...live }, supported: adapter.getSupportedSettings() });
  } catch (e) {
    // Adapter belum implementasi (live mode) — tetap serve dari gateway DB
    res.json({ settings: getAllSettings(), supported: adapter.getSupportedSettings() });
  }
});

// PATCH /api/bot/settings { key: value, ... }
router.patch("/bot/settings", authRequired, async (req, res) => {
  const body = req.body || {};
  if (typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) {
    return res.status(400).json({ error: "Body harus objek { key: value }" });
  }
  const applied = [];
  const errors = {};
  for (const [key, value] of Object.entries(body)) {
    const err = validateSetting(key, value);
    if (err) {
      errors[key] = err;
      continue;
    }
    const result = await adapter.updateBotSetting(key, value);
    if (result.ok) {
      setSetting(key, value);
      applied.push(key);
      broadcast(EVENTS.BOT_SETTINGS_UPDATED, { key, value });
      log.info("Bot", `Settings updated: ${key}`);
    } else {
      errors[key] = result.error || "Gagal diterapkan ke bot";
    }
  }
  if (applied.length === 0) {
    return res.status(400).json({ error: "Tidak ada setting yang diterapkan", errors });
  }
  res.json({ ok: true, applied, errors: Object.keys(errors).length ? errors : undefined });
});

// GET /api/plugins
router.get("/plugins", authRequired, async (req, res) => {
  try {
    const plugins = await adapter.getPlugins();
    // merge status tersimpan gateway (persist antar restart gateway)
    const saved = Object.fromEntries(listPluginSettings().map((p) => [p.name, !!p.enabled]));
    res.json({
      plugins: plugins.map((p) => ({ ...p, enabled: p.name in saved ? saved[p.name] : p.enabled })),
    });
  } catch (e) {
    log.error("API", `GET /plugins: ${e.message}`);
    res.status(500).json({ error: "Gagal memuat plugins" });
  }
});

// PATCH /api/plugins/:pluginName { enabled: true|false }
router.patch("/plugins/:pluginName", authRequired, async (req, res) => {
  const name = req.params.pluginName;
  if (typeof name !== "string" || name.length === 0 || name.length > 64 || !/^[\w -]+$/.test(name)) {
    return res.status(400).json({ error: "Nama plugin tidak valid" });
  }
  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "Body harus { enabled: boolean }" });
  }
  try {
    const result = enabled ? await adapter.enablePlugin(name) : await adapter.disablePlugin(name);
    if (!result.ok) {
      return res.status(404).json({ error: result.error || "Plugin tidak ditemukan" });
    }
    setPluginEnabled(name, enabled);
    broadcast(EVENTS.PLUGIN_UPDATED, { name, enabled });
    log.info("Plugin", enabled ? "Enabled" : "Disabled", name);
    res.json({ ok: true, name, enabled });
  } catch (e) {
    log.error("Plugin", `Toggle gagal: ${e.message}`);
    res.status(502).json({ error: "Gagal mengubah plugin via adapter" });
  }
});

export default router;
