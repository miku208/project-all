# MikuHost — Panel WA Sender (hasil rebrand DarkVerse)

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
cp build/app/outputs/flutter-apk/app-release.apk /root/apkbug/MikuHost.apk
pm2 start mikuhost-dv   # dan pm2 app lain yang dibutuhkan
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

## App lain di VPS (status saat ini)
Setelah build sukses, hanya `mikuhost-dv` yang di-start ulang. `mikuchat`, `mikuremote`, `mikuhost-api` (lama), `zahra`, `miku` masih **stopped** — start manual sesuai kebutuhan: `pm2 start <nama>`.
