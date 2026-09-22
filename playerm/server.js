// ============================================
// KASET — Standalone Music Player Server
// Berdiri sendiri, terpisah dari server c.ai utama.
// ============================================

const express = require('express');
const path = require('path');
const { setupMusicRoutes } = require('./music-api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ============================================
// MUSIC API — search, stream, default playlist
// (logic aslinya, tidak diubah)
// ============================================
setupMusicRoutes(app);

// ============================================
// STATIC FILES — index.html, style.css, script.js
// ============================================
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// SERVER START
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('============================================');
  console.log('Kaset — Music Player Server Ready');
  console.log(`http://localhost:${PORT}`);
  console.log('============================================');
});

module.exports = app;
