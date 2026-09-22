# Ashi X Miku — Music Player

Tampilan baru dari desain yang kamu upload, disambungkan ke backend musik yang lama
(`music-api.js`, tidak diubah sama sekali). Server tetap standalone, terpisah dari
`c.ai`. Favorit & riwayat disimpan di `localStorage` browser — tanpa login.

## Isi folder

- `server.js` — server Express standalone (sama seperti sebelumnya)
- `music-api.js` — backend musik lama, dipakai apa adanya
- `index.html`, `style.css` — desain yang kamu upload, brand diganti jadi "Ashi X Miku"
- `app.js` — logic baru: search, mini player, full player, playlist/antrean,
  favorit, riwayat "Baru Diputar", shuffle, repeat, volume, dan latar dinamis
  yang warnanya diambil otomatis dari artwork lagu yang sedang diputar
- `assets/favicon.svg`, `manifest.json` — ikon & metadata PWA ringan
- `package.json` — dependency cuma `express`

## Cara jalanin

```bash
npm install
npm start
```

Buka `http://localhost:3000`.

## Fitur yang jalan di UI ini

- **Pencarian** — hasil dari `/api/music/search`
- **Baru Diputar** — riwayat lagu yang pernah diputar (localStorage), otomatis
  terisi dari default playlist saat pertama kali dibuka
- **Favorit** — tekan ikon hati di player untuk simpan/hapus
- **Antrean** — daftar putar berjalan, bisa dihapus per-lagu atau diacak
- **Player** — play/pause, next/prev, shuffle, repeat (off/all/satu lagu), seek, volume
- **Latar dinamis** — cover lagu di-blur jadi background, warna aksen tombol
  diambil otomatis dari cover itu (kalau server gambarnya tidak izinkan
  pembacaan warna lintas-domain, otomatis balik ke warna default, tidak error)

## Catatan

- Track dari `/api/music` (default playlist) diputar langsung tanpa lewat
  `/api/music/stream`. Track dari hasil pencarian tetap resolve dulu lewat
  `/api/music/stream` untuk dapat URL streaming aslinya — sama seperti sebelumnya.
- Tidak ada perubahan apa pun di `server.js` / `music-api.js` — sesuai permintaan,
  backend tetap yang lama.
