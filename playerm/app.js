// ============================================
// Ashi X Miku — app logic
// UI baru dari desain yang diupload, disambungkan ke backend
// musik yang sudah ada (music-api.js): search, stream, default playlist.
// Favorit & riwayat disimpan di localStorage — tanpa login.
// ============================================
(() => {
  'use strict';

  const FAV_KEY = 'ashixmiku_favorites';
  const RECENT_KEY = 'ashixmiku_recent';
  const RECENT_LIMIT = 30;

  const state = {
    tab: 'search',
    searchResults: [],
    favorites: loadJSON(FAV_KEY, []),
    recent: loadJSON(RECENT_KEY, []),
    queue: [],
    queueIndex: -1,
    currentTrack: null,
    shuffleOn: false,
    repeatMode: 'off', // off | all | one
    isSeeking: false,
    bgActive: null,
  };

  function loadJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveFavorites() { localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites)); }
  function saveRecent() { localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent)); }

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    menuBtn: $('menuBtn'),
    sideMenu: $('sideMenu'),
    scrim: $('scrim'),
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.panel'),

    searchInput: $('searchInput'),
    clearSearch: $('clearSearch'),
    searchStatus: $('searchStatus'),
    searchResults: $('searchResults'),
    recentResults: $('recentResults'),
    favoriteResults: $('favoriteResults'),
    queueList: $('queueList'),
    shuffleQueueBtn: $('shuffleQueueBtn'),

    bgLayerA: document.querySelector('.layer-a'),
    bgLayerB: document.querySelector('.layer-b'),

    miniPlayer: $('miniPlayer'),
    miniCover: $('miniCover'),
    miniTitle: $('miniTitle'),
    miniArtist: $('miniArtist'),
    miniProgressFill: $('miniProgressFill'),
    miniPrev: $('miniPrev'),
    miniPlayPause: $('miniPlayPause'),
    miniNext: $('miniNext'),

    player: $('player'),
    closePlayer: $('closePlayer'),
    favBtn: $('favBtn'),
    cover: $('cover'),
    trackTitle: $('trackTitle'),
    trackArtist: $('trackArtist'),
    seekBar: $('seekBar'),
    currentTime: $('currentTime'),
    duration: $('duration'),
    playerError: $('playerError'),
    shuffleBtn: $('shuffleBtn'),
    prevBtn: $('prevBtn'),
    playPauseBtn: $('playPauseBtn'),
    nextBtn: $('nextBtn'),
    repeatBtn: $('repeatBtn'),
    volumeBar: $('volumeBar'),
    audio: $('audio'),
  };

  const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
  const ICON_PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';

  // ==========================================================
  // Ambient background — crossfade + live accent color
  // ==========================================================
  function setBackground(coverUrl) {
    if (!coverUrl) return;
    const showing = state.bgActive === 'a' ? el.bgLayerA : el.bgLayerB;
    const hidden = state.bgActive === 'a' ? el.bgLayerB : el.bgLayerA;
    const target = state.bgActive === null ? el.bgLayerA : hidden;
    target.style.backgroundImage = `url("${coverUrl}")`;
    requestAnimationFrame(() => {
      target.classList.add('active');
      if (showing && showing !== target) showing.classList.remove('active');
    });
    state.bgActive = target === el.bgLayerA ? 'a' : 'b';
  }

  function extractAccent(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const size = 12;
          const c = document.createElement('canvas');
          c.width = size; c.height = size;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, size, size);
          const data = ctx.getImageData(0, 0, size, size).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 16) continue;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
          }
          if (!n) return resolve(null);
          resolve({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
        } catch (e) {
          resolve(null); // canvas tainted by CORS — silently keep default accent
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function applyAccentFromCover(url) {
    const rgb = await extractAccent(url);
    const root = document.documentElement.style;
    if (!rgb) {
      root.removeProperty('--accent');
      root.removeProperty('--accent-soft');
      root.removeProperty('--accent-ink');
      return;
    }
    const { r, g, b } = rgb;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    root.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
    root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.33)`);
    root.setProperty('--accent-ink', luminance > 0.55 ? '#1a1508' : '#f5f1e8');
  }

  // ==========================================================
  // Song card / queue item rendering
  // ==========================================================
  function buildSongCard(track, index, list) {
    const card = document.createElement('div');
    card.className = 'song-card';
    if (state.currentTrack && state.currentTrack.url === track.url) card.classList.add('playing');

    const thumb = document.createElement('div');
    thumb.className = 'thumb-wrap';
    const img = document.createElement('img');
    img.src = track.cover || '';
    img.alt = '';
    thumb.appendChild(img);
    if (track.duration) {
      const dur = document.createElement('span');
      dur.className = 'duration-pill';
      dur.textContent = track.duration;
      thumb.appendChild(dur);
    }
    const badge = document.createElement('div');
    badge.className = 'playing-badge';
    badge.innerHTML = '<span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span>';
    thumb.appendChild(badge);

    const info = document.createElement('div');
    info.className = 'song-info';
    const title = document.createElement('div');
    title.className = 'song-title';
    title.textContent = track.title || 'Tanpa judul';
    const sub = document.createElement('div');
    sub.className = 'song-sub';
    sub.textContent = track.artist || 'Tidak diketahui';
    info.append(title, sub);

    card.append(thumb, info);
    card.addEventListener('click', () => playFromList(list, index));
    return card;
  }

  function renderGrid(container, tracks, emptyTitle, emptyDesc) {
    container.innerHTML = '';
    if (!tracks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `<strong></strong><span></span>`;
      empty.querySelector('strong').textContent = emptyTitle;
      empty.querySelector('span').textContent = emptyDesc;
      container.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    tracks.forEach((t, i) => frag.appendChild(buildSongCard(t, i, tracks)));
    container.appendChild(frag);
  }

  function renderSearch() {
    renderGrid(
      el.searchResults,
      state.searchResults,
      'Belum ada pencarian',
      'Ketik judul lagu atau nama artis di kolom atas untuk mulai.'
    );
  }
  function renderRecent() {
    renderGrid(el.recentResults, state.recent, 'Belum ada riwayat', 'Lagu yang kamu putar akan muncul di sini.');
  }
  function renderFavorites() {
    renderGrid(el.favoriteResults, state.favorites, 'Belum ada favorit', 'Tekan ikon hati saat memutar lagu untuk menyimpannya di sini.');
  }
  function renderQueue() {
    el.queueList.innerHTML = '';
    if (!state.queue.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<strong></strong><span></span>';
      empty.querySelector('strong').textContent = 'Antrean kosong';
      empty.querySelector('span').textContent = 'Putar sebuah lagu untuk mengisi antrean.';
      el.queueList.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    state.queue.forEach((track, i) => {
      const row = document.createElement('div');
      row.className = 'queue-item';
      if (i === state.queueIndex) row.classList.add('playing');

      const idx = document.createElement('span');
      idx.className = 'queue-index';
      idx.textContent = String(i + 1);

      const img = document.createElement('img');
      img.src = track.cover || '';
      img.alt = '';

      const info = document.createElement('div');
      info.className = 'song-info';
      const title = document.createElement('div');
      title.className = 'song-title';
      title.textContent = track.title || 'Tanpa judul';
      const sub = document.createElement('div');
      sub.className = 'song-sub';
      sub.textContent = track.artist || 'Tidak diketahui';
      info.append(title, sub);

      const remove = document.createElement('button');
      remove.className = 'queue-remove';
      remove.setAttribute('aria-label', 'Hapus dari antrean');
      remove.textContent = '\u2715';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromQueue(i);
      });

      row.append(idx, img, info, remove);
      row.addEventListener('click', () => playFromList(state.queue, i));
      frag.appendChild(row);
    });
    el.queueList.appendChild(frag);
  }

  function removeFromQueue(index) {
    state.queue.splice(index, 1);
    if (index < state.queueIndex) state.queueIndex -= 1;
    else if (index === state.queueIndex) state.queueIndex = Math.min(state.queueIndex, state.queue.length - 1);
    renderQueue();
  }

  function refreshAllGrids() {
    renderSearch();
    renderRecent();
    renderFavorites();
    renderQueue();
  }

  // ==========================================================
  // Tabs & menu
  // ==========================================================
  function switchTab(name) {
    state.tab = name;
    el.tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    el.panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
    if (name === 'recent') renderRecent();
    if (name === 'favorites') renderFavorites();
    if (name === 'queue') renderQueue();
    closeMenu();
  }
  function openMenu() {
    el.sideMenu.classList.add('open');
    el.scrim.classList.add('show');
    el.menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    el.sideMenu.classList.remove('open');
    el.scrim.classList.remove('show');
    el.menuBtn.setAttribute('aria-expanded', 'false');
  }
  el.menuBtn.addEventListener('click', () => {
    el.sideMenu.classList.contains('open') ? closeMenu() : openMenu();
  });
  el.scrim.addEventListener('click', closeMenu);
  el.tabs.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // ==========================================================
  // Search
  // ==========================================================
  function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  const runSearch = debounce(async (q) => {
    if (!q.trim()) {
      state.searchResults = [];
      el.searchStatus.hidden = true;
      renderSearch();
      return;
    }
    el.searchStatus.hidden = false;
    el.searchStatus.classList.remove('error');
    el.searchStatus.innerHTML = '<span class="spinner"></span> Mencari...';
    try {
      const res = await fetch('/api/music/search?q=' + encodeURIComponent(q));
      const data = await res.json();
      state.searchResults = data.tracks || [];
      el.searchStatus.hidden = true;
      if (!state.searchResults.length) {
        el.searchStatus.hidden = false;
        el.searchStatus.textContent = 'Tidak ada hasil untuk pencarian ini.';
      }
      renderSearch();
    } catch (e) {
      el.searchStatus.hidden = false;
      el.searchStatus.classList.add('error');
      el.searchStatus.textContent = 'Gagal mencari. Periksa koneksi lalu coba lagi.';
    }
  }, 350);

  el.searchInput.addEventListener('input', (e) => {
    const v = e.target.value;
    el.clearSearch.hidden = !v;
    runSearch(v);
  });
  el.clearSearch.addEventListener('click', () => {
    el.searchInput.value = '';
    el.clearSearch.hidden = true;
    state.searchResults = [];
    el.searchStatus.hidden = true;
    renderSearch();
    el.searchInput.focus();
  });

  // ==========================================================
  // Playback
  // ==========================================================
  function playFromList(list, index) {
    state.queue = list === state.queue ? list : list.slice();
    state.queueIndex = index;
    playCurrent();
    openPlayer();
  }

  async function playCurrent() {
    const track = state.queue[state.queueIndex];
    if (!track) return;
    state.currentTrack = track;
    updateNowPlayingUI(track);
    setBackground(track.cover);
    applyAccentFromCover(track.cover);
    pushRecent(track);
    refreshAllGrids();
    syncFavButton();

    hidePlayerError();
    setPlayerLoading(true);
    el.audio.pause();
    el.audio.removeAttribute('src');

    try {
      let streamUrl;
      if (track.direct) {
        streamUrl = track.url;
      } else {
        const res = await fetch('/api/music/stream?url=' + encodeURIComponent(track.url));
        const data = await res.json();
        if (!data.url) { showPlayerError('Lagu ini tidak dapat diputar. Coba lagu lain.'); setPlayerLoading(false); return; }
        streamUrl = data.url;
      }
      el.audio.src = streamUrl;
      await el.audio.play();
    } catch (e) {
      showPlayerError('Gagal memuat audio. Coba lagu lain.');
    } finally {
      setPlayerLoading(false);
    }
  }

  function pushRecent(track) {
    state.recent = state.recent.filter((t) => t.url !== track.url);
    state.recent.unshift(track);
    if (state.recent.length > RECENT_LIMIT) state.recent.length = RECENT_LIMIT;
    saveRecent();
  }

  function updateNowPlayingUI(track) {
    if (track.cover) { el.cover.src = track.cover; el.miniCover.src = track.cover; }
    else { el.cover.removeAttribute('src'); el.miniCover.removeAttribute('src'); }
    el.trackTitle.textContent = track.title || 'Tanpa judul';
    el.trackArtist.textContent = track.artist || 'Tidak diketahui';
    el.miniTitle.textContent = track.title || 'Tanpa judul';
    el.miniArtist.textContent = track.artist || 'Tidak diketahui';
    el.miniPlayer.hidden = false;
  }

  function showPlayerError(msg) { el.playerError.textContent = msg; el.playerError.hidden = false; }
  function hidePlayerError() { el.playerError.hidden = true; }

  function setPlayerLoading(loading) {
    const playIcon = el.playPauseBtn.querySelector('.icon-play');
    const pauseIcon = el.playPauseBtn.querySelector('.icon-pause');
    const spinIcon = el.playPauseBtn.querySelector('.icon-spin');
    spinIcon.hidden = !loading;
    if (loading) { playIcon.hidden = true; pauseIcon.hidden = true; }
    else syncPlayIcons();
  }

  function syncPlayIcons() {
    const playing = !el.audio.paused && el.audio.currentTime >= 0 && el.audio.src;
    const playIcon = el.playPauseBtn.querySelector('.icon-play');
    const pauseIcon = el.playPauseBtn.querySelector('.icon-pause');
    const spinIcon = el.playPauseBtn.querySelector('.icon-spin');
    spinIcon.hidden = true;
    playIcon.hidden = !!playing;
    pauseIcon.hidden = !playing;
    el.miniPlayPause.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">${playing ? ICON_PAUSE : ICON_PLAY}</svg>`;
    el.cover.classList.toggle('playing', !!playing);
  }

  function syncFavButton() {
    const active = state.currentTrack && state.favorites.some((f) => f.url === state.currentTrack.url);
    el.favBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  function toggleFavorite() {
    if (!state.currentTrack) return;
    const idx = state.favorites.findIndex((f) => f.url === state.currentTrack.url);
    if (idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.unshift(state.currentTrack);
    saveFavorites();
    syncFavButton();
    if (state.tab === 'favorites') renderFavorites();
  }

  function openPlayer() { el.player.hidden = false; }
  function closePlayerView() { el.player.hidden = true; }
  el.closePlayer.addEventListener('click', closePlayerView);
  el.miniPlayer.addEventListener('click', openPlayer);
  el.favBtn.addEventListener('click', toggleFavorite);

  // ---------- transport ----------
  function togglePlayPause() {
    if (!el.audio.src) return;
    if (el.audio.paused) el.audio.play(); else el.audio.pause();
  }
  function getStepIndex(fromIndex, direction) {
    if (!state.queue.length) return -1;
    if (state.shuffleOn && state.queue.length > 1) {
      let r;
      do { r = Math.floor(Math.random() * state.queue.length); } while (r === fromIndex);
      return r;
    }
    let next = fromIndex + direction;
    if (next < 0) next = state.queue.length - 1;
    if (next >= state.queue.length) next = 0;
    return next;
  }
  function manualNext() {
    const next = getStepIndex(state.queueIndex, 1);
    if (next >= 0) { state.queueIndex = next; playCurrent(); }
  }
  function manualPrev() {
    if (el.audio.currentTime > 3) { el.audio.currentTime = 0; return; }
    const prev = getStepIndex(state.queueIndex, -1);
    if (prev >= 0) { state.queueIndex = prev; playCurrent(); }
  }
  function handleEnded() {
    if (state.repeatMode === 'one') { el.audio.currentTime = 0; el.audio.play(); return; }
    if (!state.queue.length) return;
    let next;
    if (state.shuffleOn && state.queue.length > 1) {
      do { next = Math.floor(Math.random() * state.queue.length); } while (next === state.queueIndex);
    } else {
      next = state.queueIndex + 1;
      if (next >= state.queue.length) {
        if (state.repeatMode !== 'all') { syncPlayIcons(); return; }
        next = 0;
      }
    }
    state.queueIndex = next;
    playCurrent();
  }

  el.playPauseBtn.addEventListener('click', togglePlayPause);
  el.miniPlayPause.addEventListener('click', (e) => { e.stopPropagation(); togglePlayPause(); });
  el.nextBtn.addEventListener('click', manualNext);
  el.prevBtn.addEventListener('click', manualPrev);
  el.miniNext.addEventListener('click', (e) => { e.stopPropagation(); manualNext(); });
  el.miniPrev.addEventListener('click', (e) => { e.stopPropagation(); manualPrev(); });

  el.shuffleBtn.addEventListener('click', () => {
    state.shuffleOn = !state.shuffleOn;
    el.shuffleBtn.setAttribute('aria-pressed', String(state.shuffleOn));
  });
  el.repeatBtn.addEventListener('click', () => {
    const order = ['off', 'all', 'one'];
    state.repeatMode = order[(order.indexOf(state.repeatMode) + 1) % order.length];
    el.repeatBtn.dataset.mode = state.repeatMode;
    el.repeatBtn.setAttribute('aria-pressed', String(state.repeatMode !== 'off'));
    el.repeatBtn.querySelector('.repeat-one-dot').hidden = state.repeatMode !== 'one';
  });

  el.shuffleQueueBtn.addEventListener('click', () => {
    if (state.queue.length < 2) return;
    const current = state.queue[state.queueIndex];
    for (let i = state.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
    }
    if (current) state.queueIndex = state.queue.findIndex((t) => t.url === current.url);
    renderQueue();
  });

  // ---------- audio element wiring ----------
  el.audio.addEventListener('play', syncPlayIcons);
  el.audio.addEventListener('pause', syncPlayIcons);
  el.audio.addEventListener('ended', handleEnded);
  el.audio.addEventListener('error', () => {
    if (el.audio.src) showPlayerError('Terjadi masalah saat memutar audio.');
  });

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateSeekVisual(pct) {
    el.seekBar.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--panel-strong) ${pct}%, var(--panel-strong) 100%)`;
    el.seekBar.value = String(Math.round(pct * 10));
    el.miniProgressFill.style.width = pct + '%';
  }

  el.audio.addEventListener('timeupdate', () => {
    if (state.isSeeking) return;
    const dur = el.audio.duration || 0;
    const pct = dur ? (el.audio.currentTime / dur) * 100 : 0;
    updateSeekVisual(pct);
    el.currentTime.textContent = fmtTime(el.audio.currentTime);
  });
  el.audio.addEventListener('loadedmetadata', () => {
    el.duration.textContent = fmtTime(el.audio.duration);
  });

  el.seekBar.addEventListener('pointerdown', () => { state.isSeeking = true; });
  el.seekBar.addEventListener('input', () => {
    const pct = Number(el.seekBar.value) / 10;
    updateSeekVisual(pct);
    if (el.audio.duration) el.currentTime.textContent = fmtTime((pct / 100) * el.audio.duration);
  });
  el.seekBar.addEventListener('change', () => {
    const pct = Number(el.seekBar.value) / 10;
    if (el.audio.duration) el.audio.currentTime = (pct / 100) * el.audio.duration;
    state.isSeeking = false;
  });

  el.volumeBar.addEventListener('input', () => {
    el.audio.volume = Number(el.volumeBar.value) / 100;
  });

  // ==========================================================
  // Initial load — seed "Baru Diputar" with the default playlist
  // ==========================================================
  async function loadDefault() {
    try {
      const res = await fetch('/api/music');
      const data = await res.json();
      if (data.defaultVolume !== undefined) {
        el.audio.volume = data.defaultVolume;
        el.volumeBar.value = String(Math.round(data.defaultVolume * 100));
      }
      if (!state.recent.length && Array.isArray(data.playlist) && data.playlist.length) {
        state.recent = data.playlist.map((t) => ({
          title: t.title, artist: t.artist, url: t.url, cover: t.cover, duration: t.duration || '', direct: true,
        }));
        saveRecent();
      }
    } catch (e) {
      // silently ignore — search still works without the default playlist
    } finally {
      refreshAllGrids();
    }
  }

  loadDefault();
  updateSeekVisual(0);
})();
