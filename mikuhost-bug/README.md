# MikuHost — Panel WA Sender (hasil rebrand DarkVerse)

> **21 Sep 2026:** APK sudah di-rebuild dengan fitur Sender Global (kartu status di dashboard, picker Pribadi/Global di layar kirim bug, halaman kelola owner/admin) + fix backend (sender count 0, opsional `&sender=global|private` di `/sendBug`, endpoint kelola `/addGlobalSender`, `/delGlobalSender`, `/uploadGlobalCreds`). Source: `/root/apkbug/_extract/darkverse/lib/global_sender.dart` + integrasi di `home_page.dart` & `dashboard_page.dart`.
>
> **Update 2:** Tambah sender global sekarang **alurnya sama seperti sender pribadi** — masukkan nomor → dapat pairing code → enter di WhatsApp (endpoint `GET /getGlobalPairing`, owner/admin). Tidak perlu paste creds.json lagi. Reconnect otomatis via `pairingGlobalSender()` saat koneksi putus.
>
> **Update 3:** `/sendBug` support 3 mode sender: `private` (sender pribadi), `global` (1 sender online acak), `allglobal` (SEMUA sender global online nembak paralel sekaligus via `sendBugViaSocket()` + `Promise.allSettled`). Picker APK jadi 3 kartu: 📱 Pribadi / 🌐 Global / 💥 Semua.

## Tentang folder ini (`/root/mikuhost-bug`)
Ini adalah **paket portabel** hasil penggabungan backend + APK:
- `MikuHost.apk` — APK siap install (arm64)
- `mikuhost-api/` — source backend lengkap (tanpa node_modules; jalankan `npm install` dulu jika dipindah, patch grace otomatis via postinstall)
- `mikuhost-bug.zip` — semua di atas dalam 1 file

**PENTING:** Backend **live** sekarang jalan **dari folder ini** (pm2 name: `mikuhost-dv`, cwd: `/root/mikuhost-bug/mikuhost-api`). Edit kode & data langsung di sini. Setelah edit, `pm2 restart mikuhost-dv`.

File `permenmd/` di dalam paket berisi **session WhatsApp yang sudah dipairing** (milik nomor owner sendiri) — jaga zip ini, jangan dibagikan sembarangan karena berisi kredensial session.

## Yang sudah dikerjakan
1. **APK**: build sukses dari source DarkVerse (Flutter) → `/root/apkbug/MikuHost.apk` (20.6MB, arm64-v8a, release)
2. **Backend**: `api dv.zip` → `/root/apkbug/_extract/mikuhost-api` (port 2276, pm2 name: `mikuhost-dv`)
3. **Domain**: semua API APK mengarah ke `https://ashimusic.biz.id/apidv` (nginx routing ke 127.0.0.1:2276)
4. **WebSocket chat**: `wss://ashimusic.biz.id/apidv/ws`

## Kredensial & Owner
| Item | Nilai |
|---|---|
| Login owner APK | `mikuhost` / `mikuhost2026` (role: owner) |
| No. WA owner | 6285189063747 |
| Telegram | https://t.me/mikuhost |
| TikTok | https://www.tiktok.com/@hosting.bot |
| Instagram | dihapus dari app (sesuai permintaan) |

## Kenapa dulu crash saat compile & solusinya
- `gradle.properties` lama minta `-Xmx8G -XX:MaxMetaspaceSize=4G` (butuh 12GB, VPS cuma 4GB) → sekarang `-Xmx1536m` + serial GC + no daemon/parallel
- APK di-build **arm64 only** (jauh lebih ringan dari universal)
- 3 video assets (19MB) dikompres jadi 0.3MB total (banner 9MB→97KB, splash 1.4MB→120KB)
- Dependency `chewie` dihapus (video_player native saja)
- **Sebelum compile**: `pm2 stop all` dulu — pastikan RAM ≥ 3GB tersedia

## Cara build ulang APK
```bash
pm2 stop all
export ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk
cd /root/apkbug/_extract/darkverse
/opt/flutter/bin/flutter build apk --release --target-platform android-arm64 --no-tree-shake-icons
cp build/app/outputs/flutter-apk/app-release.apk /root/mikuhost-bug/MikuHost.apk
pm2 start mikuhost-dv
```

## Backend (pm2: mikuhost-dv)
- Folder: `/root/apkbug/_extract/mikuhost-api`
- `botconfig.json` → isi `"token"`, `"ownerId"`, `"groups"`, `"mainGroups"` untuk mengaktifkan bot Telegram (kosong = bot mati, server tetap jalan)
- `database.json` → daftar user/role/expired
- `permenmd/` → taruh folder session WA (creds.json) di sini, auto-start saat boot
- Auto-restart tiap 20 menit tetap aktif (tanpa notif TG jika bot kosong)
- Guard RAM: `--max-memory-restart 500M`

## Nginx
- `/etc/nginx/sites-available/ashimusic.biz.id` → blok `location /apidv/` proxy ke 127.0.0.1:2276 (port 300 & 8787)

## Patch library (penting!)
`@mikudeveloper/grace` punya bug: `gradient is not defined` saat import.
- Sudah dipatch manual di `node_modules/@mikudeveloper/grace/lib/index.js` (baris 1: `const gradient = (txt) => String(txt);`)
- Patch otomatis tersedia via `patch-grace.js` + script `postinstall` di package.json — jalan lagi kalau `npm install` diulang

## Sender Global (fitur baru backend)
- Folder session sender global: `permenmd/global/` — taruh file `creds.json`-style (`<nomor>.json`) di situ, auto-connect saat boot & `/refresh`
- **Role PAKAI sender global**: semua kecuali member biasa (`vip`, `owner`, `reseller`, `admin`, `reseller1`)
- **Role KELOLA (tambah/hapus)**: hanya `owner` & `admin`
- `/sendBug` menerima opsi `&sender=global` atau `&sender=private` (default `private`). Validasi dilakukan SEBELUM cooldown — jika global ditolak/kosong, cooldown tidak terpakai dan respons berisi `senderDenied`/`senderEmpty`
- Endpoint kelola (owner/admin): `POST /addGlobalSender` `{key, creds}` atau `{key, file}` (file dari `permenmd/uploads/`), `POST /delGlobalSender` `{key, number}` (boleh nomor ter-sensor), `POST /uploadGlobalCreds?key=` (multipart, field `file`)
- `/mySender` & `/globalSenders` kini mengembalikan `canUseGlobal`/`canUse` + `canManageGlobal`/`canManage`
- Kelola via Telegram: `/addglobal`, `/global`, `/delglobal` — owner (`botconfig.ownerId`) atau admin (daftar `ownerList` di `telegram.json`)
- Widget Flutter siap tempel di `flutter-widget/`:
  - `global_senders_card.dart` → kartu status di dashboard
  - `sender_mode_picker.dart` → picker 2 opsi (Pribadi/Global) untuk layar kirim bug; global auto-disable jika kosong/member; helper `GlobalSenderApi`
  - `global_sender_manager_page.dart` → halaman kelola (tambah via paste creds.json / hapus) untuk owner/admin
  Contoh pakai picker + kirim:
  ```dart
  SenderMode selectedMode = SenderMode.private;
  SenderModePicker(
    sessionKey: key,
    onChanged: (m) => setState(() => selectedMode = m),
  )
  // saat kirim:
  GET $baseUrl/sendBug?key=$key&bug=$bug&target=$target&sender=${selectedMode == SenderMode.global ? 'global' : 'private'}
  ```
- Nomor sender selalu di-sensor oleh server (`628•••••xx`) — APK tidak perlu menyensor sendiri

## App lain di VPS (status saat ini)
Setelah build sukses, hanya `mikuhost-dv` yang di-start ulang. `mikuchat`, `mikuremote`, `mikuhost-api` (lama), `zahra`, `miku` masih **stopped** — start manual sesuai kebutuhan: `pm2 start <nama>`.
