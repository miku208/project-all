import fs from "fs";
import path from "path";

const LOG_PATH = path.join(process.cwd(), "database", "jadibot-logs.json");
const MAX_PER_BOT = 200;

let cache = null;
let writeScheduled = false;

function ensure() {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, JSON.stringify({}));
}

function readAll() {
  ensure();
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
    } catch {
      cache = {};
    }
  }
  return cache;
}

// Debounce nulis ke disk biar gak I/O tiap ada 1 pesan masuk ke jadibot.
function schedulePersist() {
  if (writeScheduled) return;
  writeScheduled = true;
  setTimeout(() => {
    writeScheduled = false;
    try {
      fs.writeFileSync(LOG_PATH, JSON.stringify(cache));
    } catch { }
  }, 2000);
}

function addJadibotLog(id, type, message) {
  const all = readAll();
  if (!all[id]) all[id] = [];
  all[id].push({ time: new Date().toISOString(), type, message });
  if (all[id].length > MAX_PER_BOT) all[id] = all[id].slice(-MAX_PER_BOT);
  schedulePersist();
}

function getJadibotLogs(id, limit = 100) {
  if (!id) return [];
  const all = readAll();
  const logs = all[id] || [];
  return logs.slice(-limit).reverse(); // terbaru duluan
}

function getAllJadibotLogs(limit = 200) {
  const all = readAll();
  const merged = [];
  for (const id of Object.keys(all)) {
    for (const entry of all[id]) merged.push({ id, ...entry });
  }
  merged.sort((a, b) => new Date(b.time) - new Date(a.time));
  return merged.slice(0, limit);
}

function clearJadibotLogs(id) {
  const all = readAll();
  delete all[id];
  schedulePersist();
}

export { addJadibotLog, getJadibotLogs, getAllJadibotLogs, clearJadibotLogs };
