# 📘 Panduan Membuat Bot dengan Miku-Baileys

Panduan lengkap membuat bot WhatsApp sendiri menggunakan `mikuhostt-baileys` — dari nol sampai siap produksi.

> **Bahasa**: Indonesia · **Level**: Pemula s.d. Menengah · **Node.js**: >= 20

---

## Daftar Isi

1. [Apa itu Miku-Baileys?](#1-apa-itu-mikuhostt-baileys)
2. [Cara Kerjanya (Konsep Dasar)](#2-cara-kerjanya-konsep-dasar)
3. [Setup Project](#3-setup-project)
4. [Koneksi Pertama (QR & Pairing Code)](#4-koneksi-pertama)
5. [Memahami Event](#5-memahami-event)
6. [Membuat Command Bot](#6-membuat-command-bot)
7. [Kirim Media & Pesan Lengkap](#7-kirim-media--pesan-lengkap)
8. [Fitur Interaktif (Button, Album, Rich Message)](#8-fitur-interaktif)
9. [Voice Call / VoIP](#9-voice-call--voip)
10. [Persistensi Sesi (Production)](#10-persistensi-sesi-production)
11. [Auto-Reconnect & Anti-Crash](#11-auto-reconnect--anti-crash)
12. [Deploy (VPS/PM2/Docker)](#12-deploy)
13. [Tips Keamanan & Etika](#13-tips-keamanan--etika)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Apa itu Miku-Baileys?

**Miku-Baileys** adalah library Node.js untuk berinteraksi dengan WhatsApp Web secara programatik. Dia bukan official API — dia *emulasi* WhatsApp Web di dalam Node.js.

**Apa yang bisa dilakukan bot kamu:**
- Kirim/terima semua tipe pesan (teks, gambar, video, audio, sticker, dokumen, lokasi, kontak, poll)
- Button & menu interaktif (native flow WhatsApp)
- Album multi-media
- Rich response bergaya Meta AI (tabel, code block, link embed)
- Voice call (VoIP) — fitur unggulan build ini
- Kelola grup, komunitas, newsletter/channel, katalog bisnis
- Status/story (termasuk mention di status)
- LID mapping, retry pesan, session recovery otomatis

**Silsilah project ini:**

```
Baileys (WhatsApp Web API library)
        └── mikuhostt-baileys  (interactive messages, album, rich response, VoIP — by MikuHost)
```

Semua fitur upstream tetap utuh; mikuhostt-baileys hanya rebrand + perbaikan metadata/deklarasi TypeScript.

> ⚠️ **Disclaimer**: Tidak berafiliasi dengan WhatsApp/Meta. Gunakan untuk edukasi dan kepatuhan terhadap Terms of Service WhatsApp. Risiko banned akun ditanggung pengguna.

---

## 2. Cara Kerja (Konsep Dasar)

```
┌──────────────┐   WebSocket + Noise    ┌──────────────┐
│  Bot Node.js │ ◄────────────────────► │ WhatsApp Web │
│ (mikuhostt-baileys)│   encryption (Signal)  │   Server     │
└──────────────┘                        └──────────────┘
```

Konsep yang perlu kamu pahami:

| Konsep | Penjelasan |
|---|---|
| **WebSocket** | Koneksi persisten ke server WA (`wss://web.whatsapp.com/ws/chat`) |
| **Noise Protocol** | Handshake enkripsi lapis 1 (Curve25519 + AES-GCM) |
| **Signal Protocol** | Enkripsi pesan per-pengguna (pre-key, session, sender-key) |
| **Binary Node** | Format data XML-like biner yang dipakai WA (`<iq>`, `<message>`, dst.) |
| **JID** | Identitas WhatsApp: `628xxx@s.whatsapp.net` (personal), `xxx@g.us` (grup), `xxx@newsletter` (channel), `xxx@lid` (Linked ID — identitas baru WA) |
| **Auth State** | Kredensial + kunci sesi yang disimpan agar bot tidak login ulang |
| **Event Emitter** | Bot menerima data via event: `messages.upsert`, `connection.update`, dst. |

**Alur koneksi:**
1. WebSocket connect → Noise handshake
2. Auth: QR **atau** pairing code (masukkan nomor, WA kirim 8 digit)
3. `CB:success` → upload pre-keys → sinkron chat
4. Event `connection.update` dengan `connection: "open"` → bot siap

---

## 3. Setup Project

```bash
mkdir bot-ku && cd bot-ku
npm init -y
npm install mikuhostt-baileys pino qrcode-terminal
```

**PENTING**: package ini ESM-only. Ubah `package.json` — tambah `"type": "module"`:

```json
{
  "name": "bot-ku",
  "type": "module",
  "dependencies": {
    "mikuhostt-baileys": "latest",
    "pino": "^9.0.0",
    "qrcode-terminal": "^0.12.0"
  }
}
```

Struktur folder yang disarankan:

```
bot-ku/
├── package.json
├── index.js          ← entry point bot
├── commands/         ← (opsional) modul command terpisah
└── session/          ← dibuat otomatis: file auth state
```

---

## 4. Koneksi Pertama

### Opsi A — QR Code

```js
// index.js
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} from "mikuhostt-baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";

const logger = pino({ level: "silent" }); // ganti "debug" kalau mau lihat log

async function startBot() {
  // simpan sesi di folder ./session (dibuat otomatis)
  const { state, saveCreds } = await useMultiFileAuthState("./session");

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu("Chrome"), // identitas browser ke server WA
    syncFullHistory: false,             // jangan tarik seluruh riwayat chat
  });

  // simpan kredensial setiap kali diperbarui
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log("Scan QR ini dari WhatsApp: Perangkat Tertaut → Tautkan Perangkat");
    }
    if (connection === "open") console.log("✅ Bot terhubung!");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("Koneksi terputus, reconnect...");
        startBot(); // reconnect otomatis
      } else {
        console.log("Sesi logout. Hapus folder ./session lalu scan ulang.");
      }
    }
  });
}

startBot();
```

Jalankan `node index.js` → scan QR → done.

### Opsi B — Pairing Code (cocok untuk VPS tanpa kamera)

```js
sock.ev.on("connection.update", async ({ connection }) => {
  if (connection === "connecting") {
    const code = await sock.requestPairingCode("6281234567890"); // nomor kamu
    console.log("Masukkan kode ini di WA kamu:", code); // contoh: A1B2-C3D4
  }
});
```

Di HP: WhatsApp → Perangkat Tertaut → **Tautkan dengan Nomor Telepon** → ketik kode.

> Custom 8-char juga bisa: `sock.requestPairingCode("628xxx", "MIKU2026")`

---

## 5. Memahami Event

Semua data masuk lewat `sock.ev`:

```js
// Pesan masuk (terpenting!)
sock.ev.on("messages.upsert", async ({ messages, type }) => {
  // type: "notify" (pesan baru) | "append" (riwayat)
  for (const msg of messages) {
    if (msg.key.fromMe) continue;           // skip pesan dari bot sendiri
    if (!msg.message) continue;             // skip pesan kosong/protokol

    const jid = msg.key.remoteJid;          // pengirim (chat/grup)
    const text =
      msg.message.conversation ||                    // chat biasa
      msg.message.extendedTextMessage?.text || ""    // reply/mention
      ;

    console.log(`[${jid}] ${text}`);
  }
});

// Status koneksi
sock.ev.on("connection.update", ({ connection, qr }) => { /* ... */ });

// Kerangka lengkap event lain:
// messages.update        → status pesan (delivered/read/edited)
// messages.delete        → pesan dihapus
// messages.reaction      → reaksi
// group-participants.update → anggota grup join/leave/promote
// groups.update          → metadata grup berubah
// call                   → ada panggilan masuk
// presence.update        → online/typing
```

Helper ekstraksi pesan (grup + LID aware):

```js
function getText(message) {
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ""
  );
}
```

---

## 6. Membuat Command Bot

Pola handler sederhana yang scalable:

```js
// commands/handler.js
export const commands = {
  ping: async (sock, msg) => {
    await sock.sendMessage(msg.key.remoteJid, { text: "Pong! 🏓" });
  },
  halo: async (sock, msg) => {
    await sock.sendMessage(msg.key.remoteJid, { text: "Halo juga! 👋" });
  },
  info: async (sock, msg) => {
    await sock.sendMessage(msg.key.remoteJid, {
      text: `🤖 Bot Aktif\n⏰ ${new Date().toLocaleString("id-ID")}`,
    });
  },
};
```

```js
// index.js (tambahan)
import { commands } from "./commands/handler.js";

sock.ev.on("messages.upsert", async ({ messages }) => {
  const msg = messages[0];
  if (msg.key.fromMe || !msg.message) return;

  const text = (msg.message.conversation ||
    msg.message.extendedTextMessage?.text || "").trim();
  if (!text.startsWith(".")) return; // prefix "."

  const [cmd, ...args] = text.slice(1).split(" ");
  const handler = commands[cmd.toLowerCase()];
  if (handler) {
    try {
      await handler(sock, msg, args);
    } catch (e) {
      console.error("Command error:", e);
      await sock.sendMessage(msg.key.remoteJid, { text: "❌ Terjadi error." });
    }
  }
});
```

Balas pesan tertentu (quoted reply):

```js
await sock.sendMessage(jid, { text: "Ini balasan", }, { quoted: msg });
```

---

## 7. Kirim Media & Pesan Lengkap

```js
// Gambar + caption
await sock.sendMessage(jid, { image: { url: "./foto.jpg" }, caption: "Keren!" });

// Video
await sock.sendMessage(jid, { video: { url: "./video.mp4" }, caption: "Cek ini" });

// Voice note (ptt = push to talk)
await sock.sendMessage(jid, {
  audio: { url: "./audio.ogg" },
  mimetype: "audio/ogg; codecs=opus",
  ptt: true,
});

// Sticker
await sock.sendMessage(jid, { sticker: { url: "./sticker.webp" } });

// Dokumen
await sock.sendMessage(jid, {
  document: { url: "./laporan.pdf" },
  fileName: "Laporan-2026.pdf",
  mimetype: "application/pdf",
});

// Lokasi
await sock.sendMessage(jid, {
  location: { degreesLatitude: -6.2, degreesLongitude: 106.8, name: "Jakarta" },
});

// Kontak (vCard)
await sock.sendMessage(jid, {
  contacts: {
    displayName: "Kontak",
    contacts: [{ vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:Budi\nTEL:+628xxx\nEND:VCARD" }],
  },
});

// Poll
await sock.sendMessage(jid, {
  poll: { name: "Pilih:", values: ["A", "B", "C"], selectableCount: 1 },
});

// Mention
await sock.sendMessage(jid, {
  text: "Halo @628xxx!",
  mentions: ["628xxx@s.whatsapp.net"],
});

// Reaction / Delete / Edit
await sock.sendMessage(jid, { react: { key: msg.key, text: "👍" } });
await sock.sendMessage(jid, { delete: msg.key });
await sock.sendMessage(jid, { text: "Teks baru", edit: msg.key });
```

**Dari URL internet** — download dulu jadi buffer:

```js
const res = await fetch("https://example.com/gambar.jpg");
const buffer = Buffer.from(await res.arrayBuffer());
await sock.sendMessage(jid, { image: buffer, caption: "dari URL" });
```

---

## 8. Fitur Interaktif

### Button (native flow)

```js
await sock.sendMessage(jid, {
  interactiveMessage: {
    title: "Menu Utama",
    footer: "Powered by MikuHost",
    buttons: [
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({ display_text: "Ping", id: ".ping" }),
      },
      {
        name: "cta_url",
        buttonParamsJson: JSON.stringify({
          display_text: "Website",
          url: "https://example.com",
        }),
      },
      {
        name: "cta_copy",
        buttonParamsJson: JSON.stringify({
          display_text: "Salin Kode",
          copy_code: "MIKU2026",
        }),
      },
    ],
  },
});
```

### Menu List (single_select)

```js
await sock.sendMessage(jid, {
  interactiveMessage: {
    title: "Pilih Kategori",
    buttons: [{
      name: "single_select",
      buttonParamsJson: JSON.stringify({
        title: "MENU",
        sections: [{
          title: "Umum",
          rows: [
            { title: "Ping", id: ".ping" },
            { title: "Info", id: ".info" },
          ],
        }],
      }),
    }],
  },
});
```

### Album

```js
await sock.sendMessage(jid, {
  albumMessage: [
    { image: { url: "./1.jpg" }, caption: "Foto 1" },
    { image: { url: "./2.jpg" }, caption: "Foto 2" },
    { video: { url: "./clip.mp4" }, caption: "Video" },
  ],
});
```

### Rich Response (tabel bergaya Meta AI)

```js
await sock.sendTable(
  jid,
  "Perbandingan",                        // judul
  ["Fitur", "Free", "Pro"],              // header
  [                                       // rows
    ["Speed", "1x", "5x"],
    ["Support", "-", "24/7"],
  ],
  null,                                   // quoted (null = tidak reply)
  { headerText: "Paket:", footer: "Terima kasih!" },
);

// Code block dengan syntax highlighting
await sock.sendCodeBlock(jid, `console.log("Hello")`, null, {
  language: "javascript",
  footer: "Powered by MikuHost",
});
```

### Builder ORich (chaining)

```js
import { ORich } from "mikuhostt-baileys";

const rich = new ORich(sock)
  .addText("Ini *rich response* dari bot kamu!")
  .addCode("javascript", 'console.log("hi")')
  .addSuggest(["Lagi", "Stop"]);

await rich.send(jid);
```

---

## 9. Voice Call / VoIP

Fitur andalan build ini — panggilan suara native tanpa package tambahan (WASM/WebRTC sudah bundled).

```js
import { VoipClient, CallState } from "mikuhostt-baileys";

let voip = null;

// inisialisasi SEKALI, setelah koneksi open
sock.ev.on("connection.update", async ({ connection }) => {
  if (connection === "open" && !voip) {
    voip = new VoipClient();
    await voip.connectWithSocket(sock);   // pakai socket yang sama, no double login
    console.log("📞 VoIP siap");
  }
});

// panggil nomor
const call = await voip.call("6281234567890", {
  durationMs: 60000,        // auto-hangup 60 detik
  audioSource: "silence",   // "mic" butuh hardware; "file" butuh ffmpeg
});

call.on("ringing",  () => console.log("Berdering..."));
call.on("connected", () => console.log("Terhubung!"));
call.on("ended", (reason) => console.log("Selesai:", reason));

await call.waitForEnd();
```

---

## 10. Persistensi Sesi (Production)

`useMultiFileAuthState` nyaman untuk development, tapi untuk production sebaiknya simpan di database/Redis agar aman dari crash & mudah di-backup:

```js
import { initAuthCreds, makeCacheableSignalKeyStore, BufferJSON } from "mikuhostt-baileys";

// contoh: simpan di Map (ganti dengan DB/Redis kamu)
const store = new Map(); // db.get/set

const creds = store.get("creds") || initAuthCreds();

const keys = makeCacheableSignalKeyStore({
  get: async (type, ids) => {
    const data = {};
    for (const id of ids) data[id] = store.get(`${type}:${id}`);
    return data;
  },
  set: async (data) => {
    for (const category in data)
      for (const id in data[category])
        store.set(`${category}:${id}`, data[category][id]);
  },
});

const state = { creds, keys };

const saveCreds = async () => {
  // BufferJSON wajib agar Buffer terserialisasi dengan benar
  store.set("creds", JSON.parse(JSON.stringify(creds, BufferJSON.replacer), BufferJSON.reviver));
};

const sock = makeWASocket({ auth: state, logger, browser: Browsers.ubuntu("Chrome") });
sock.ev.on("creds.update", saveCreds);
```

**Aturan emas:**
- ✅ Selalu panggil `saveCreds` di event `creds.update`
- ✅ Backup folder session / DB secara berkala
- ❌ Jangan commit folder `session/` ke git (berisi kunci privat!)
- ❌ Jangan pakai 1 sesi untuk banyak bot sekaligus

---

## 11. Auto-Reconnect & Anti-Crash

```js
import { DisconnectReason } from "mikuhostt-baileys";

sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
  if (connection === "close") {
    const code = lastDisconnect?.error?.output?.statusCode;

    if (code === DisconnectReason.loggedOut) {
      console.log("Sesi dicabut dari HP. Scan ulang.");
      process.exit(1);
    }

    const delays = {
      [DisconnectReason.connectionClosed]: 2000,
      [DisconnectReason.connectionLost]: 5000,
      [DisconnectReason.restartRequired]: 0,
      [DisconnectReason.timedOut]: 3000,
    };
    const delay = delays[code] ?? 5000;
    console.log(`Terputus (code ${code}). Reconnect dalam ${delay}ms`);
    setTimeout(startBot, delay);
  }
});

// jaga proses tetap hidup saat ada error tak terduga
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
```

Kode `DisconnectReason` penting:

| Kode | Arti | Aksi |
|---|---|---|
| `loggedOut` (401) | Sesi dicabut dari HP | Scan ulang |
| `connectionClosed` (428) | Koneksi ditutup server | Reconnect |
| `connectionLost` (408) | Jaringan hilang | Reconnect |
| `timedOut` (408) | Timeout handshake | Reconnect |
| `restartRequired` (515) | Server minta restart | Reconnect segera |

---

## 12. Deploy

### PM2 (paling umum di VPS)

```bash
npm install -g pm2
pm2 start index.js --name bot-ku
pm2 save && pm2 startup   # auto-start saat reboot
pm2 logs bot-ku           # lihat log
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "index.js"]
```

```bash
docker build -t bot-ku .
docker run -d --name bot-ku -v $(pwd)/session:/app/session bot-ku
```

> Volume `-v` penting agar session tersimpan walau container di-recreate.

### Checklist production

- [ ] Session di-persist (DB/volume), bukan hilang tiap restart
- [ ] Auto-reconnect aktif
- [ ] Log level `"silent"` atau `"warn"` di production
- [ ] Set `syncFullHistory: false` agar sinkronisasi cepat
- [ ] Sediakan command admin untuk logout/reset sesi

---

## 13. Tips Keamanan & Etika

1. **Jangan spam** — WhatsApp mem-ban nomor yang kirim pesan massal tidak diminta. Tambahkan rate limit di bot.
2. **Nomor khusus bot** — gunakan nomor sekunder, bukan nomor pribadi.
3. **Session = kunci rumah** — siapa pun yang punya folder session bisa memakai nomor kamu.
4. **Jangan hardcode rahasia** — token/DB URL di environment variable.
5. **Banned risk** — aktivitas otomatis agresif (broadcast massal, groupblast, call spam) berisiko banned permanen. Gunakan akun "gunakan dulu seperti manusia" (baca chat, balas manual sesekali) untuk nomor baru.
6. **Privasi pengguna** — jangan simpan/forward data pribadi tanpa izin.

---

## 14. Troubleshooting

| Masalah | Penyebab & Solusi |
|---|---|
| `ERR_MODULE_NOT_FOUND` | Pastikan `"type": "module"` di package.json dan import pakai nama package `mikuhostt-baileys` |
| QR tidak muncul / langsung close | Hapus folder `./session`, jalankan ulang |
| Pairing code error 405 | Ganti `browser: Browsers.windows("Chrome")` atau `Browsers.macOS("Chrome")` |
| Pesan tidak terkirim ke grup | Pastikan bot adalah anggota grup; cek JID harus `@g.us` |
| `Bad MAC` / decrypt error berulang | Implementasikan hook `getMessage` di config socket agar retry manager bisa restore pesan |
| Bot mati setelah beberapa jam | Cek kode reconnect (lihat bagian 11); pastikan VPS tidak sleep |
| VoIP error "Not connected" | Panggil `connectWithSocket(sock)` setelah `connection === "open"` |
| Log terlalu ramai | `pino({ level: "silent" })` |

---

## Selamat Membuat Bot! 🎉

Referensi API lengkap ada di [README utama](README.md). Contoh di panduan ini sudah diuji terhadap `mikuhostt-baileys@1.0.0`.

```bash
npm install mikuhostt-baileys
```

```js
import makeWASocket from "mikuhostt-baileys"; // dan mulai kreasikan 🐱
```
