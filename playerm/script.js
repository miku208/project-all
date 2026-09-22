(() => {
  'use strict';

  // ---------- state ----------
  const state = {
    tab: 'library',
    library: [],      // tracks seen this session (search results + default)
    queue: [],        // whatever list is currently displayed / playable
    currentIndex: -1,
    favorites: loadFavorites(),
    isPlaying: false,
    bgActive: 'A',
  };

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    searchInput: $('searchInput'),
    tabs: document.querySelectorAll('.tab'),
    listTitle: $('listTitle'),
    listCount: $('listCount'),
    statusLine: $('statusLine'),
    trackList: $('trackList'),
    emptyState: $('emptyState'),
    audio: $('audio'),
    npCover: $('npCover'),
    npTitle: $('npTitle'),
    npArtist: $('npArtist'),
    playBtn: $('playBtn'),
    playIcon: $('playIcon'),
    pauseIcon: $('pauseIcon'),
    prevBtn: $('prevBtn'),
    nextBtn: $('nextBtn'),
    favBtn: $('favBtn'),
    curTime: $('curTime'),
    durTime: $('durTime'),
    seekTrack: $('seekTrack'),
    seekFill: $('seekFill'),
    seekKnob: $('seekKnob'),
    bgA: $('bgA'),
    bgB: $('bgB'),
  };

  // ---------- favorites (client-side, no login) ----------
  function loadFavorites() {
    try {
      return JSON.parse(localStorage.getItem('kaset_favorites') || '[]');
    } catch (e) {
      return [];
    }
  }
  function saveFavorites() {
    localStorage.setItem('kaset_favorites', JSON.stringify(state.favorites));
  }
  function isFavorite(track) {
    return state.favorites.some((f) => f.url === track.url);
  }
  function toggleFavorite(track) {
    const idx = state.favorites.findIndex((f) => f.url === track.url);
    if (idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.unshift(track);
    saveFavorites();
    renderActiveTab();
    syncFavButton();
  }

  // ---------- helpers ----------
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function setStatus(msg) {
    els.statusLine.textContent = msg || '';
  }

  // ---------- rendering ----------
  function renderActiveTab() {
    const list = state.tab === 'library' ? state.library : state.favorites;
    els.listTitle.textContent = state.tab === 'library' ? 'Pustaka' : 'Favorit';
    els.listCount.textContent = `${list.length} lagu`;
    els.trackList.innerHTML = '';

    if (!list.length) {
      els.emptyState.classList.add('show');
      els.emptyState.textContent = state.tab === 'library'
        ? 'Ketik judul lagu atau nama artis di kolom pencarian untuk mulai.'
        : 'Belum ada lagu favorit. Tekan ikon hati pada sebuah lagu untuk menyimpannya di sini.';
      return;
    }
    els.emptyState.classList.remove('show');

    const frag = document.createDocumentFragment();
    list.forEach((track, i) => {
      frag.appendChild(buildRow(track, i, list));
    });
    els.trackList.appendChild(frag);
  }

  function buildRow(track, index, list) {
    const li = document.createElement('li');
    li.className = 'track-row';
    if (state.currentTrack && state.currentTrack.url === track.url) {
      li.classList.add('playing');
    }

    const cover = document.createElement('div');
    cover.className = 'tr-cover';
    if (track.cover) cover.style.backgroundImage = `url("${track.cover}")`;

    const main = document.createElement('div');
    main.className = 'tr-main';
    main.innerHTML = `
      <span class="tr-title"></span>
      <span class="tr-artist"></span>
    `;
    main.querySelector('.tr-title').textContent = track.title || 'Tanpa judul';
    main.querySelector('.tr-artist').textContent = track.artist || 'Tidak diketahui';
    main.addEventListener('click', () => playFromList(list, index));

    const dur = document.createElement('span');
    dur.className = 'tr-dur';
    dur.textContent = track.duration || '';

    const favBtn = document.createElement('button');
    favBtn.className = 'tr-fav' + (isFavorite(track) ? ' active' : '');
    favBtn.type = 'button';
    favBtn.setAttribute('aria-label', 'Tandai favorit');
    favBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 20s-7-4.35-9.5-8.5C.9 8.1 2.6 4.5 6 4.5c2 0 3.4 1.1 4 2.3.6-1.2 2-2.3 4-2.3 3.4 0 5.1 3.6 3.5 7-2.5 4.15-9.5 8.5-9.5 8.5z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(track);
    });

    li.append(cover, main, dur, favBtn);
    return li;
  }

  // ---------- search ----------
  const runSearch = debounce(async (q) => {
    if (!q.trim()) {
      setStatus('');
      renderActiveTab();
      return;
    }
    setStatus('Mencari...');
    try {
      const res = await fetch('/api/music/search?q=' + encodeURIComponent(q));
      const data = await res.json();
      state.library = data.tracks || [];
      state.tab = 'library';
      setActiveTabButton('library');
      setStatus(state.library.length ? '' : 'Tidak ada hasil untuk pencarian ini.');
      renderActiveTab();
    } catch (e) {
      setStatus('Gagal mencari. Periksa koneksi lalu coba lagi.');
    }
  }, 350);

  els.searchInput.addEventListener('input', (e) => runSearch(e.target.value));

  // ---------- tabs ----------
  els.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTabButton(btn.dataset.tab);
      state.tab = btn.dataset.tab;
      renderActiveTab();
    });
  });
  function setActiveTabButton(tab) {
    els.tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  }

  // ---------- playback ----------
  async function playFromList(list, index) {
    state.queue = list;
    state.currentIndex = index;
    await playTrack(list[index]);
  }

  async function playTrack(track) {
    state.currentTrack = track;
    updateNowPlayingUI(track);
    updateBackground(track.cover);
    renderActiveTab();
    syncFavButton();

    setStatus('Memuat audio...');
    els.audio.pause();
    els.audio.removeAttribute('src');

    try {
      // Default-playlist tracks already point straight at a playable file;
      // only search results need the extra stream-resolve step.
      if (track.direct) {
        els.audio.src = track.url;
      } else {
        const res = await fetch('/api/music/stream?url=' + encodeURIComponent(track.url));
        const data = await res.json();
        if (!data.url) {
          setStatus('Lagu ini tidak dapat diputar. Coba lagu lain.');
          return;
        }
        els.audio.src = data.url;
      }
      await els.audio.play();
      setStatus('');
    } catch (e) {
      setStatus('Gagal memuat audio. Coba lagu lain.');
    }
  }

  function updateNowPlayingUI(track) {
    if (track.cover) els.npCover.src = track.cover;
    else els.npCover.removeAttribute('src');
    els.npTitle.textContent = track.title || 'Tanpa judul';
    els.npArtist.textContent = track.artist || 'Tidak diketahui';
  }

  function syncFavButton() {
    const active = state.currentTrack && isFavorite(state.currentTrack);
    els.favBtn.classList.toggle('active', !!active);
  }

  function updateBackground(coverUrl) {
    if (!coverUrl) return;
    const showing = state.bgActive === 'A' ? els.bgA : els.bgB;
    const hidden = state.bgActive === 'A' ? els.bgB : els.bgA;
    hidden.style.backgroundImage = `url("${coverUrl}")`;
    hidden.classList.add('on');
    showing.classList.remove('on');
    state.bgActive = state.bgActive === 'A' ? 'B' : 'A';
  }

  els.playBtn.addEventListener('click', () => {
    if (!els.audio.src) return;
    if (els.audio.paused) els.audio.play();
    else els.audio.pause();
  });

  els.prevBtn.addEventListener('click', () => step(-1));
  els.nextBtn.addEventListener('click', () => step(1));
  function step(delta) {
    if (!state.queue.length || state.currentIndex < 0) return;
    const next = (state.currentIndex + delta + state.queue.length) % state.queue.length;
    playFromList(state.queue, next);
  }

  els.favBtn.addEventListener('click', () => {
    if (state.currentTrack) toggleFavorite(state.currentTrack);
  });

  // ---------- audio element events ----------
  els.audio.addEventListener('play', () => {
    state.isPlaying = true;
    els.playIcon.style.display = 'none';
    els.pauseIcon.style.display = '';
  });
  els.audio.addEventListener('pause', () => {
    state.isPlaying = false;
    els.playIcon.style.display = '';
    els.pauseIcon.style.display = 'none';
  });
  els.audio.addEventListener('ended', () => step(1));
  els.audio.addEventListener('timeupdate', updateSeekUI);
  els.audio.addEventListener('loadedmetadata', updateSeekUI);

  function updateSeekUI() {
    const cur = els.audio.currentTime || 0;
    const dur = els.audio.duration || 0;
    const pct = dur ? (cur / dur) * 100 : 0;
    els.curTime.textContent = fmtTime(cur);
    els.durTime.textContent = fmtTime(dur);
    els.seekFill.style.width = pct + '%';
    els.seekKnob.style.left = pct + '%';
  }

  function seekTo(clientX) {
    const rect = els.seekTrack.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    if (els.audio.duration) els.audio.currentTime = pct * els.audio.duration;
  }
  let dragging = false;
  els.seekTrack.addEventListener('pointerdown', (e) => {
    dragging = true;
    seekTo(e.clientX);
  });
  window.addEventListener('pointermove', (e) => {
    if (dragging) seekTo(e.clientX);
  });
  window.addEventListener('pointerup', () => { dragging = false; });

  // ---------- default playlist on load ----------
  async function loadDefault() {
    try {
      const res = await fetch('/api/music');
      const data = await res.json();
      state.library = (data.playlist || []).map((t) => ({
        title: t.title, artist: t.artist, url: t.url, cover: t.cover, duration: t.duration || '', direct: true
      }));
      if (data.defaultVolume !== undefined) els.audio.volume = data.defaultVolume;
      renderActiveTab();
    } catch (e) {
      renderActiveTab();
    }
  }

  loadDefault();
})();
