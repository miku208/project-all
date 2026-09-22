const ts = () => new Date().toISOString().slice(11, 19);

// quiet mode: dedupe log yang berulang persis sama dalam jendela waktu.
// Polling APK tiap 3 detik + history sync berkala menghasilkan log identik
// ratusan kali per jam -> pm2 log penuh sampai gigabyte. Dengan dedupe,
// pesan yang sama hanya dilog ulang tiap QUIET_WINDOW_MS, sisanya dihitung
// sebagai counter ("xN").
const QUIET_WINDOW_MS = 10 * 60 * 1000; // 10 menit
const lastSeen = new Map(); // key -> { ts, count }

function fmt(tag, msg) {
  return `[${ts()}] [${tag}] ${msg}`;
}

function shouldPrint(key) {
  const now = Date.now();
  const e = lastSeen.get(key);
  if (!e || now - e.ts > QUIET_WINDOW_MS) {
    if (e && e.count > 1) {
      // Pesan sama muncul berkali-kali sebelumnya -> tandai totalnya sekali
      console.log(fmt("…", `${key} (x${e.count} dalam 10 mnt terakhir)`));
    }
    lastSeen.set(key, { ts: now, count: 1 });
    return true;
  }
  e.count++;
  return false;
}

function cleanup() {
  const now = Date.now();
  for (const [k, v] of lastSeen) {
    if (now - v.ts > QUIET_WINDOW_MS * 2) lastSeen.delete(k);
  }
}
setInterval(cleanup, QUIET_WINDOW_MS).unref?.();

function makeLogger(level) {
  return (tag, msg) => {
    if (level === "error") {
      // Error SELALU dilog (jangan pernah hilangkan)
      console.error(fmt(tag, msg));
      return;
    }
    if (shouldPrint(`${level}:${tag}:${msg}`)) {
      (level === "warn" ? console.warn : console.log)(fmt(tag, msg));
    }
  };
}

export const log = {
  info: makeLogger("info"),
  warn: makeLogger("warn"),
  error: (tag, msg) => console.error(fmt(tag, msg)),
};
