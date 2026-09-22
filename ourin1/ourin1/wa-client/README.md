# MikuWA Client — Custom WhatsApp Client untuk Bot Utama

Project **terpisah** dari bot utama (`/root/ourin`). Bot utama **tidak diubah** —
gateway berjalan sebagai proses sendiri (isolasi penuh: session, config, port, DB).

```
/root/ourin/                 ← BOT UTAMA (JANGAN DIUBAH, pm2: "gw")
├── index.js, config.js, src/, plugins/, storage/session/ ...
└── wa-client/               ← PROJECT BARU (ini)
    ├── gateway/             ← Gateway REST + WebSocket (port 8787, internal)
    │   ├── src/
    │   │   ├── server.js        Entry point
    │   │   ├── config.js        Env loader + validasi
    │   │   ├── db.js            SQLite (node:sqlite): users, devices, chats, messages...
    │   │   ├── auth/crypto.js   scrypt password + JWT HS256 (tanpa dependency)
    │   │   ├── middleware/      authRequired, rate limit
    │   │   ├── routes/          auth.js, api.js (chats/messages/contacts), bot.js (settings/plugins)
    │   │   ├── adapters/        BotAdapter (interface) + Mock + Live (belum aktif)
    │   │   ├── websocket/       /ws dengan auth, heartbeat 30s
    │   │   └── utils/           logger, jid validator
    │   ├── data/                gateway.db (di-gitignore)
    │   └── .env                 secret lokal (JANGAN commit)
    ├── test-client/         ← Web debug client (bukan produk final)
    └── android/             ← APK Kotlin+Compose (belum dibuat)
```

## Menjalankan Gateway

```bash
cd /root/ourin/wa-client/gateway
npm install
node src/server.js        # atau: pm2 start src/server.js --name wa-gateway
```

- URL internal: `http://127.0.0.1:8787`
- Adapter mode: `mock` (dummy data jujur untuk dev) / `live` (belum aktif, lihat bawah)
- Login: user `ADMIN_USER` + `ADMIN_PASSWORD` dari `.env`

## Endpoint

| Method | Path | Ket |
|---|---|---|
| POST | `/auth/login` | rate limit 5/15 menit/IP |
| POST | `/auth/refresh` | rotasi refresh token |
| POST | `/auth/logout` | cabut device saat ini |
| GET | `/auth/devices` | daftar device |
| DELETE | `/auth/devices/:id` | revoke device |
| GET | `/api/status` | status bot+gateway |
| GET | `/api/chats` | `?search=&limit=&offset=` |
| GET | `/api/chats/:chatId` | validasi JID ketat |
| GET | `/api/chats/:chatId/messages` | `?limit=&before=&after=` (pagination, auto-trigger history sync) |
| POST | `/api/chats/:chatId/sync` | `{ count? }` — paksa tarik history chat dari server WA |
| POST | `/api/chats/:chatId/messages` | `{ text, replyTo? }`, max 8000 char |
| PATCH | `/api/chats/:chatId/read` | `{ unread: 0 }` |
| GET | `/api/contacts` | `?search=` |
| GET | `/api/groups` | |
| GET | `/api/bot/settings` | |
| PATCH | `/api/bot/settings` | `{ mode, prefix, autoRead, ... }` |
| GET | `/api/bot/profile` | nomor + nama + bio bot (WA asli) |
| GET | `/api/bot/avatar` | foto profil bot sendiri |
| PATCH | `/api/bot/profile` | `{ name?, bio? }` — ubah nama/bio via WA |
| GET | `/api/blocked` | daftar nomor yang diblokir |
| POST | `/api/blocked` | `{ jid \| number }` — blokir nomor (WA + DB bot) |
| DELETE | `/api/blocked/:jid` | buka blokir nomor |
| GET | `/api/chats/:chatId/messages/:messageId/text` | isi text satu pesan (fitur salin) |
| GET | `/api/chats/:chatId/messages/:messageId/media` | **BARU** — download media pesan (img/vid/audio/sticker/doc), `?download=1` utk simpan file |
| POST | `/api/chats/:chatId/media` | **BARU** — kirim media: multipart (`file`, `type`, `caption`) atau JSON `{ base64, type }`. Maks 50MB |
| POST | `/api/chats` | `{ number }` — mulai chat pribadi (62xxx/08xxx) |
| GET | `/api/plugins` | |
| PATCH | `/api/plugins/:name` | `{ enabled: bool }` |
| WS | `/ws?token=<accessToken>` | event realtime |

WebSocket events: `message.received`, `message.sent`, `chat.updated`, `chat.read`,
`connection.updated`, `bot.settings.updated`, `plugin.updated`.

## Status Integrasi ke Bot Utama — LIVE ✅

Gateway berjalan **in-process** di dalam proses bot utama (adapter mode `live`).
Chats, groups, contacts, settings, plugins = data WhatsApp asli.

Cara kerja:
- `index.js` bot memuat blok integrasi ber-guard: aktif hanya jika env
  `WA_GATEWAY=1` **atau** file `wa-client/ENABLED` ada.
- `integration.js` mengambil `getSocket`, `getConnectionState`, `getDatabase`,
  `pluginStore`, `enablePlugin/disablePlugin`, `invalidatePrefixCache` dari bot
  (semua observe/read — tidak mengubah logic bot).
- `LiveBotAdapter` bind ke event socket bot (`messages.upsert/update/delete`,
  `connection.update`, `groups.update`) dan membungkus semua handler dengan
  try/catch agar bot tidak pernah crash karena gateway.

**Aktifkan/Nonaktifkan:**
```bash
touch /root/ourin/wa-client/ENABLED && pm2 restart gw   # aktif
rm /root/ourin/wa-client/ENABLED && pm2 restart gw      # nonaktif
```

### Limitasi live mode (jujur, dari struktur bot core)
- Mode `private` tidak dikenal `checkMode()` → hanya `public`/`self`
- `botName` & `prefix` hanya in-memory (kembali ke config setelah restart bot)
- `autoRead`/`autoTyping` disimpan di database bot; perilaku autoTyping belum
  ada handler-nya di bot core (nilai tersimpan, efek menyusul)
- Plugin enable/disable bersifat in-memory di bot (reset setelah restart bot)
- Chat list terisi progresif (chat muncul setelah ada aktivitas pesan) + seed grup;
  history lama tidak di-backfill (bisa ditambah nanti via `store` bot)

## Keamanan

- Password scrypt+salt (tidak plaintext), JWT HS256, access token 15 menit
- Refresh token di-hash SHA-256 di DB, device bisa di-revoke per device
- Rate limit: login 5/15min, kirim pesan 30/min, global 300/min
- Validasi JID strict, max body 256KB, max pesan 8000 char
- Secret hanya di `.env` server; APK hanya tahu `GATEWAY_URL`
- TLS/WSS via **edge proxy** (154.12.117.162, nginx 1.26.3) yang terminate
  HTTPS dengan sertifikat Let's Encrypt valid dan meneruskan ke panel 8080

## Publik: https://mikujadibot.web.id/wa-gateway

Gateway di-mount **in-process** ke Express panel 8080 (`mountWaGateway`),
jadi semua trafik publik lewat: `edge TLS → :8080 (panel) → /wa-gateway/*`.

- REST: `https://mikujadibot.web.id/wa-gateway/api/*` & `/auth/*`
- WebSocket: `wss://mikujadibot.web.id/wa-gateway/ws?token=<accessToken>`
- Web debug client: `https://mikujadibot.web.id/wa-gateway/test-client/`
- APK v0.2.0: default URL `https://mikujadibot.web.id` (auto-append `/wa-gateway`)

Detail teknis WS mounted: WSS gateway pakai `noServer: true` +
`prependListener('upgrade')` agar tidak bentrok dengan WSS panel (`/ws`) —
keduanya hidup di satu HTTP server yang sama tanpa saling mengganggu.

## Limitasi yang didokumentasikan (dari inspeksi bot utama)

- Mode `private` tidak dikenal `checkMode()` bot core → hanya `public`/`self`
- Plugin enable/disable bot bersifat in-memory (hilang setelah restart bot)
- Prefix bot di-cache 30 detik (perlu `invalidatePrefixCache()` saat ubah)
- autoTyping/autoRecording belum ada di bot core → disimpan gateway dulu
- Blokir via `updateBlockStatus()` WA + flag `isBlocked` di database bot
- Nama pengirim grup diambil dari pushname/contacts/participant metadata;
  chat lama yang belum tersinkron bisa tampil sebagai nomor dulu
- Foto profil di-cache 6 jam di DB gateway (termasuk hasil negatif)
- Salin text pesan keluar baru tersimpan di memori adapter (maks 200/chat)
  sampai pesan balik dari WA mengonfirmasi store

## Penyimpanan Chat History (anti "tenggelam")

Semua pesan yang lewat bot tersimpan **permanen di SQLite gateway**
(`wa-client/gateway/data/gateway.db`, mode WAL) — terpisah dari store in-memory
bot yang otomatis membuang pesan lama. Jadi chat yang ramai tidak "tenggelam":

- Upsert idempotent via `UNIQUE(chat_id, message_id)` — aman dari replay/reconnect.
- History sync on-demand: `GET /api/chats/:chatId/messages` otomatis memicu
  `fetchMessageHistory` (HISTORY_SYNC_ON_DEMAND) ke server WA (cooldown 2 menit
  per chat). Bisa dipaksa manual: `POST /api/chats/:chatId/sync { count: 50 }`.
- **Anti-delete**: pesan yang dihapus pengirim TIDAK dihapus dari DB gateway,
  cuma ditandai `status='deleted'` — isi pesan tetap bisa dibaca di APK.
- Statistik kapasitas: `GET /api/status` → `gateway.messagesStored` &
  `gateway.chatsStored`.
- Statistik pinggir: backfill awal dari store bot tetap jalan saat gateway start.

## Fitur APK v0.5.0

- **Launcher icon** custom (bubble chat + titik online, semua density)
- **Identitas pengirim grup lengkap**: foto profil + nama + nomor HP di setiap
  bubble pesan grup (avatar di kiri bubble, nama aksen + nomor di dalam)
- **Foto profil bot** di Settings (endpoint `/api/bot/avatar`, JID bot dibersihkan
  dari suffix device yang bikin 404)
- **UX: page dulu, data belakang** — list tampil instan dengan loading, data
  dimuat background, **auto-refresh per 3 detik** (chats & chat detail, merge
  by messageId, tidak mengganggu posisi scroll saat baca chat lama)
- **Notifikasi pesan baru**: permission `POST_NOTIFICATIONS` diminta saat
  login pertama; event WS `message.received` → notifikasi heads-up; tap
  notifikasi membuka chat terkait; chat yang sedang dibuka tidak dinotifkan
- Search chat pakai debounce 600ms; log gateway quiet-mode (dedupe 10 menit)
  supaya polling 3 detik tidak membanjiri log pm2

## Fitur APK v0.6.0 — Media Support 🖼️🎬✨

- **Baca media di chat**: gambar, sticker, dan video (thumbnail) dirender langsung
  di bubble pesan — bukan lagi `[image]` polos. Audio/dokumen tampil sebagai chip
  dengan tombol simpan ke folder Download.
- **Kirim media dari APK**: tombol 📎 di composer → pilih gambar/video/audio/dokumen
  dari HP → dikirim sebagai pesan WhatsApp asli (image/video/audio/sticker/document).
  Caption diambil dari teks yang sedang diketik. Maks 50MB, upload multipart.
- **Preview chat list**: `[Foto]`, `[Video]`, `[Stiker]`, `[Audio]`, `[Dokumen]` —
  persis tampilan WhatsApp asli (caption mengikuti label).
- **Download media otomatis ter-cache** di APK (LRU ~48MB) — scroll chat lama
  tidak re-download.
- **Gateway**: endpoint baru `GET .../messages/:id/media` + `POST .../media`
  (multipart parser ringan tanpa dependency; `sendMedia()` + `getMedia()` di
  LiveBotAdapter pakai `downloadContentFromMessage` Baileys, sticker otomatis
  dikonversi webp + EXIF packname via helper bot).
- **WS tidak berubah** — event `message.received/sent` kini menyertakan
  `mediaMetadata` (mimetype, fileName, ukuran) sehingga APK tahu kapan harus
  fetch binary via REST (binary TIDAK lewat WebSocket).

## Fitur APK v0.6.1 — Simpan Media ke Galeri 💾

- **Tap gambar/stiker di bubble** → langsung tersimpan ke galeri
  (`Pictures/MikuWA`), ada spinner di atas gambar selama proses simpan.
- **Long-press bubble → "💾 Galeri"** untuk pesan gambar/sticker — media
  di-fetch dulu dari gateway bila belum termuat di cache.
- Foto disimpan sebagai JPEG (kualitas 95), stiker statis sebagai PNG
  (transparansi dipertahankan).
- Stiker animasi (webp animasi tak bisa didecode jadi Bitmap) otomatis
  di-fallback: webp mentah disimpan ke folder Download.
- Android 10+ pakai MediaStore/scoped storage (tanpa permission tambahan);
  Android 9- tulis langsung ke Pictures/MikuWA.

## Fix v0.6.2 — “Media tidak tersedia” & foto terkirim aneh 🔧

**Akar masalah 1 — bubble "media tidak tersedia" setelah kirim foto:**
media yang dikirim dari APK tidak disimpan gateway; `GET /media` mencari di
store bot yang echo-nya sering belum masuk (atau sudah terbuang) → 404.
**Fix:** disk cache media permanen di `gateway/data/media/` (bin + sidecar json).
`sendMedia` menulis cache, `getMedia` cek cache DULU sebelum store bot.
Auto-prune di 500MB (file tertua dibuang dulu). APK juga prime cache memori
setelah kirim → bubble langsung render tanpa request ulang.

**Akar masalah 2 — foto terkirim “aneh”/jadi dokumen:** file picker sering kasih
nama tanpa ekstensi (`IMG_1234`), deteksi tipe lama cuma lihat ekstensi → jatuh
ke `document`. **Fix:** APK kirim MIME resolver + deteksi magic bytes
(JPEG/PNG/GIF/WEBP/MP4/OGG/MP3/PDF); gateway juga terima field `mimeType` &
Content-Type part multipart, lalu diteruskan utuh ke Baileys.

**Fix bonus — stiker animasi:** webp animasi memang tidak bisa didecode
`BitmapFactory` → dulu tampil salah kaprah "media tidak tersedia". Kini tampil
chip "✨ Stiker animasi" + tombol simpan webp ke Download.

## Fitur APK v0.8.0 — Kelola Member Grup: Tambah & Kick 👥

- **Panel Member Grup**: menu ⋮ di header chat grup → "👥 Member Grup" —
  daftar semua anggota dengan foto profil, nama, nomor, dan badge admin
  (👑 superadmin, ⚙️ admin).
- **Tambah member**: input nomor di atas panel (format `62xxx`/`08xxx`,
  bisa banyak sekaligus dipisah koma/spasi). Hasil per-nomor ditampilkan —
  nomor yang menolak lewat setting privasi dilaporkan jelas (perlu undangan manual).
- **Kick member**: tombol "Kick" di baris member (atau long-press) →
  dialog konfirmasi. Admin/superadmin tidak bisa dikick dari UI.
  Bot HARUS admin grup — kalau bukan, WA menolak dan error ditampilkan.
- Endpoint baru: `GET /chats/:id/members`,
  `POST /chats/:id/members/add { jids }`, `POST /chats/:id/members/remove { jids }`.
- Kode status Baileys per-participant (200/403/404/408/409/dll) diterjemahkan
  jadi pesan yang bisa dibaca manusia.

## Fitur APK v0.7.0 — Manajemen Chat: Keluar Grup, Hapus Pesan & Chat 🗑️🚪

- **Keluar grup**: menu ⋮ di header chat grup → "🚪 Keluar Grup" (dengan
  dialog konfirmasi). Bot benar-benar meninggalkan grup di WA + chat hilang
  dari daftar.
- **Hapus pesan**: long-press bubble → dua opsi:
  - `🗑️ Saya` — hapus di sisi bot/APK saja (pesan dari tampilan hilang)
  - `🗑️ Semua` — unsend untuk semua orang: di grup bebas asal **bot admin**
    (WhatsApp yang enforce); di private hanya pesan milik bot sendiri
- **Hapus chat/nomor**: menu ⋮ → "🗑️ Hapus Chat" — seluruh pesan & data chat
  dihapus dari bot/gateway (pesan di HP orang lain tidak ikut terhapus).
- Endpoint baru: `POST /chats/:id/leave`,
  `POST /chats/:id/messages/:mid/delete { scope }`, `DELETE /chats/:id`.
- Event WS baru terkirim: `message.deleted` & `chat.updated { deleted }` —
  semua perangkat yang online langsung sinkron.

## Fitur APK v0.6.3 — Tombol Download di Semua Bubble Media ⬇️

- **Tombol download manual** ("⬇ Simpan") tampil di bawah SEMUA attachment
  media: gambar, video, sticker, audio, dokumen, stiker animasi.
- Status tombol: `⬇ Unduh` (media belum termuat) → `⬇ Simpan` (siap) →
  spinner "Menyimpan..." → `✓ Tersimpan` (disabled, anti dobel).
- Tujuan simpan per tipe: gambar/sticker → **Galeri** (`Pictures/MikuWA`),
  video/audio/dokumen/stiker animasi → folder **Download**.
- Media gagal termuat punya tombol **"🔄 Coba Lagi"** (gateway disk cache
  v0.6.2 biasanya sudah mengisi medianya setelahnya).
- Tap gambar/stiker tetap jalan sebagai shortcut simpan.

## Fitur APK v0.9.1 — Promote/Demote Admin Grup 👑

- Panel member grup: tiap member (non-superadmin) punya tombol
  **"Promote"/"Demote"** + dialog konfirmasi.
- Implementasi: `groupParticipantsUpdate(chatId, jids, "promote"|"demote")`
  — WA yang enforce: **bot harus admin grup**; superadmin/pembuat grup
  tidak bisa didemote.
- List member di-update lokal tanpa refetch setelah sukses.
- **Endpoint**: `POST /api/chats/:id/members/admin { jids: [...], action: "promote"|"demote" }`
  → `{ ok, changed: [...], failed: [{ jid, error }] }`

## Fitur APK v0.9.4 — Antrean Lagu, Notifikasi Spotify-style & Bisu Chat 🎶🔔

- **Antrean lagu**: tap lagu di hasil pencarian = mulai antrean dari situ.
  Saat lagu habis otomatis lanjut ke lagu berikutnya (auto-next, bisa di-
  matikan lewat toggle "auto-next ON/OFF" di tab Music). Tombol **⏮ ⏭** di
  mini player & Music tab — ⏮ gaya Spotify: kalau sudah play > 3 detik,
  restart lagu sekarang, kalau tidak pindah ke lagu sebelumnya.
- **Notifikasi gaya Spotify** (MediaStyle + MediaSession): judul lagu, artis,
  thumbnail album, durasi, progress bar, tombol prev/play-pause/next/stop.
  Tombol headset & media card layar kunci ikut bekerja (play/pause/next/
  previous/seek). Thumbnail lagu dimuat otomatis sebagai album art.
- **Bisukan notifikasi chat**: toggle "Notifikasi Chat Masuk" di Settings —
  pesan tetap masuk, cuma tidak bunyi/pop-up (tersimpan lokal di HP).
- Dependency baru: `androidx.media:media:1.7.0` (MediaStyle notification).

## Fix APK v0.9.3 — Musik Berhenti Saat Pindah Tab 🔧🎵

**Masalah:** musik di tab Music berhenti sendiri begitu user pindah tab
(Chats/Contacts/Settings), buka app lain, atau layar mati.

**Akar masalah:** `MediaPlayer` diputar di proses app tanpa foreground service
dan tanpa wake lock — Android bebas mematikan proses/CPU kapan saja.

**Solusi (v0.9.3):**
- **Foreground Service** (`MusicService`, type `mediaPlayback`): notifikasi tray
  diam (IMPORTANCE_LOW, tanpa bunyi) selama lagu diputar → Android TIDAK
  membunuh proses app. Notifikasi punya tombol Play/Pause & Stop.
- **Partial wake lock** (`MikuWA:MusicPlayback`, maks 4 jam): CPU tetap jalan
  walau layar mati — streaming tidak terputus.
- **Progress bar + seek**: slider di mini player global (semua tab) dan di bar
  Music tab, plus waktu `m:ss / m:ss`. Posisi di-update ticker 500ms.
- Permissions baru: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`,
  `WAKE_LOCK`.

## Fitur APK v0.9.0 — Tab Musik YouTube (Streaming) & Undangan Grup 🎵✉️

- **Icon baru**: dari gambar custom user (`wa-client/android/icon-src.jpg`),
  di-resize otomatis ke semua mipmap via `icon-gen.mjs` (sharp).
- **Tab Musik** di bottom nav:
  - Search YouTube via endpoint bot (`yt-search` di gateway, bukan di HP)
  - **Streaming audio (mp3) & video (mp4) langsung dari gateway** —
    MediaPlayer streaming HTTP, file TIDAK di-download/disimpan ke HP
    (tidak makan storage, hanya cache stream di RAM/OS)
  - Mini player sticky di bawah tab: judul, tombol stop
- **Undangan grup via link** (untuk nomor yang menolak ditambah — error 403):
  - Panel member grup punya form "Kirim undangan: 62xxx"
  - Gateway kirim payload `groupInviteMessage` resmi Baileys → muncul
    sebagai KARTU undangan yang bisa di-tap "Join" di HP penerima
    (fallback: link teks biasa bila payload ditolak)
  - Saat tambah member gagal 403, APK otomatis mengisi nomor ke form undangan
- **Endpoint baru**: `GET /api/media/youtube/search`,
  `GET /api/media/youtube/stream?videoId=&format=mp3|mp4` (proxy stream),
  `POST /api/chats/:id/members/invite`
- **Infrastruktur**: config gateway support `DATA_DIR` (test terisolasi dari
  data produksi), test e2e baru `tests/e2e-manual.js`, tool recovery DB
  `tests/rebuild-db.js`

## Fitur APK v0.3+
