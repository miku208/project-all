import crypto from "node:crypto";
import { generateWAMessageFromContent } from "ourin";
import axios from "axios";
import config from "../../config.js";

const pluginConfig = {
  name: "play2",
  alias: ["playtwo"],
  category: "search",
  description: "Cari & putar musik YouTube (rich player)",
  usage: ".play2 <judul lagu> [--audio-send|--select-type]",
  example: ".play2 midnight drive",
  cooldown: 15,
  energi: 1,
  isEnabled: true,
};

async function handler(m, { sock }) {
  const raw = m.text?.trim();
  if (!raw) {
    return m.reply(
      `⚠️ Masukkan judul lagu/video YouTube!\n\n` +
      `Contoh:\n` +
      `*${m.prefix}play2 midnight drive*\n` +
      `*${m.prefix}play2 midnight drive --audio-send*\n` +
      `*${m.prefix}play2 midnight drive --select-type*`
    );
  }

  const audioSend = /(?:^|\s)--audio-send(?:\s|$)/i.test(raw);
  const selectType = /(?:^|\s)--select-type(?:\s|$)/i.test(raw);

  const query = raw
    .replace(/(?:^|\s)--audio-send(?=\s|$)/gi, "")
    .replace(/(?:^|\s)--select-type(?=\s|$)/gi, "")
    .trim();

  if (!query) return m.reply("⚠️ Query pencarian tidak boleh kosong.");

  m.react("🕐");

  try {
    const searchUrl = `https://api.ryuu-dev.my.id/discovery/search/youtube?q=${encodeURIComponent(query)}`;
    const { data: searchData } = await axios.get(searchUrl, {
      headers: { "X-RYUU-APIKEY": config.ryuuApiKey },
      timeout: 30000,
    });

    if (!searchData.success || !Array.isArray(searchData.result?.result) || searchData.result.result.length === 0) {
      m.react("❌");
      return m.reply("❌ Video tidak ditemukan atau API error.");
    }

    const firstVideo = searchData.result.result[0];
    const { title, channel, duration, imageUrl, link } = firstVideo;

    if (!link) throw new Error("Link YouTube tidak ditemukan dari hasil pencarian.");

    // ---------- MODE --select-type ----------
    if (selectType) {
      await sock.sendMessage(
        m.chat,
        {
          image: { url: imageUrl },
          caption: `🎵 ${title}\n\n👤 ${channel || "Unknown"}\n⏱️ ${duration || "Unknown"}\n\nPilih format yang ingin digunakan:`,
          footer: config.bot.name,
          buttons: [
            { buttonId: `${m.prefix}ytmp3 ${link}`, buttonText: { displayText: "🎧 Audio" }, type: 1 },
            { buttonId: `${m.prefix}ytmp4 ${link}`, buttonText: { displayText: "🎬 Video" }, type: 1 },
          ],
          headerType: 1,
        },
        { quoted: m }
      );
      m.react("✅");
      return;
    }

    // ---------- MODE --audio-send ----------
    if (audioSend) {
      const finalTitle = title || "YouTube Audio";
      const thumbnail = imageUrl;
      const finalDuration = duration || "Unknown";
      const finalChannel = channel || "Unknown";

      await sock.sendMessage(
        m.chat,
        {
          text: " ",
          contextInfo: {
            previewThumbnail: {
              title: finalTitle,
              description: `Duration: ${finalDuration} | Channel: ${finalChannel}`,
              thumbnail: { url: thumbnail },
              sourceUrl: link,
              largerThumbnail: true,
            },
          },
        },
        { quoted: m }
      );

      const downloadUrl = `https://api.ryuu-dev.my.id/downloader/youtube?url=${encodeURIComponent(link)}&format=mp3`;
      const { data: downloadData } = await axios.get(downloadUrl, {
        timeout: 1200000,
        headers: { "X-RYUU-APIKEY": config.ryuuApiKey },
      });

      if (!downloadData.success || !downloadData.result || !downloadData.result.status) {
        throw new Error("Gagal mendapatkan audio dari API.");
      }

      const mp3Url = downloadData.result.result.link;
      if (!mp3Url) throw new Error("Link audio tidak ditemukan.");

      const audioRes = await axios.get(mp3Url, { responseType: "arraybuffer", timeout: 60000 });

      await sock.sendMessage(
        m.chat,
        { audio: Buffer.from(audioRes.data), mimetype: "audio/mpeg" },
        { quoted: m }
      );

      m.react("✅");
      return;
    }

    // ---------- MODE DEFAULT: rich HTML player ----------
    const downloadUrl = `https://api.ryuu-dev.my.id/downloader/youtube?url=${encodeURIComponent(link)}&format=mp3`;
    const { data: downloadData } = await axios.get(downloadUrl, {
      timeout: 1200000,
      headers: { "X-RYUU-APIKEY": config.ryuuApiKey },
    });

    if (!downloadData.success || !downloadData.result || !downloadData.result.status) {
      throw new Error("Gagal mendapatkan audio dari API.");
    }

    const resData = downloadData.result.result;
    const mp3Url = resData.link;
    if (!mp3Url) throw new Error("Link audio tidak ditemukan.");

    let thumbnailb64 = "";
    try {
      const thumbRes = await axios.get(resData.thumbnail || imageUrl, {
        responseType: "arraybuffer",
        timeout: 1200000,
      });
      thumbnailb64 = "data:image/jpeg;base64," + Buffer.from(thumbRes.data).toString("base64");
    } catch (err) {
      console.error("⚠️ Gagal download thumbnail:", err);
    }

    const wsUrl = `wss://audio.ryuu-dev.my.id/wss/audio?url=${encodeURIComponent(mp3Url)}`;

    const playerConfig = {
      title: resData.title || title || "Unknown Song",
      artist: resData.channel || channel || "Unknown Artist",
      album: resData.album || "YouTube",
      thumbnailb64,
      backgroundb64: thumbnailb64,
      audioUrl: mp3Url,
      wsUrl,
    };

    const escapeHtmlJs = (value) =>
      String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const htmlPayload = `<style>*{-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;box-sizing:border-box}body{margin:0;background:#090a0f;font-family:Arial,Helvetica,sans-serif;color:#fff;touch-action:manipulation;cursor:pointer}input[type=range]{width:100%;height:4px;accent-color:#fff;cursor:pointer}.player-wrap{width:100%;max-width:440px;margin:auto;padding:12px}.player{position:relative;overflow:hidden;background:#111318;border:1px solid rgba(255,255,255,.12);border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,.55)}.bg{position:absolute;inset:-25px;background-position:center;background-size:cover;filter:blur(22px);opacity:.38;transform:scale(1.15);pointer-events:none}.bg-overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,6,10,.35),rgba(5,6,10,.72));pointer-events:none}.content{position:relative;padding:18px;z-index:2}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:15px}.top-title{font-size:13px;font-weight:700;letter-spacing:.8px;opacity:.85}.top-sub{font-size:10px;opacity:.5;margin-top:3px}.icon-btn{width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;display:flex;align-items:center;justify-content:center;padding:0}.icon-btn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.cover{width:100%;aspect-ratio:16/9;border-radius:15px;object-fit:cover;display:block;box-shadow:0 12px 35px rgba(0,0,0,.45)}.info{padding-top:15px}.song-title{font-size:19px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.artist{font-size:13px;opacity:.6;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.progress{margin-top:18px}.times{display:flex;justify-content:space-between;font-size:10px;opacity:.55;margin-top:7px}.controls{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:13px}.main-btn{width:52px;height:52px;border:0;border-radius:50%;background:#fff;color:#08090d;display:flex;align-items:center;justify-content:center;padding:0}.main-btn svg{width:23px;height:23px;fill:currentColor;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.side-btn{width:38px;height:38px;border:0;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center;padding:0;opacity:.8}.side-btn svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.bottom{display:flex;align-items:center;justify-content:space-between;margin-top:15px;gap:12px}.bottom-left,.bottom-right{display:flex;align-items:center;gap:9px}.volume{width:85px}.visualizer{height:24px;display:flex;align-items:center;justify-content:center;gap:3px;margin-top:10px}.bar{width:3px;height:8px;border-radius:3px;background:rgba(255,255,255,.7)}.playing .bar:nth-child(1){animation:b1 .7s infinite ease-in-out}.playing .bar:nth-child(2){animation:b2 .6s infinite ease-in-out}.playing .bar:nth-child(3){animation:b3 .8s infinite ease-in-out}.playing .bar:nth-child(4){animation:b4 .55s infinite ease-in-out}.playing .bar:nth-child(5){animation:b5 .75s infinite ease-in-out}.playing .bar:nth-child(6){animation:b6 .65s infinite ease-in-out}.playing .bar:nth-child(7){animation:b7 .7s infinite ease-in-out}@keyframes b1{0%,100%{height:6px}50%{height:19px}}@keyframes b2{0%,100%{height:11px}50%{height:22px}}@keyframes b3{0%,100%{height:5px}50%{height:16px}}@keyframes b4{0%,100%{height:9px}50%{height:23px}}@keyframes b5{0%,100%{height:7px}50%{height:18px}}@keyframes b6{0%,100%{height:12px}50%{height:20px}}@keyframes b7{0%,100%{height:5px}50%{height:15px}}.debug-wrap{margin-top:12px;background:#111318;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:12px;font-family:monospace}.debug-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.debug-title{font-size:11px;font-weight:700;letter-spacing:.8px;opacity:.85}.debug-state{font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;background:rgba(255,255,255,.08);color:#ffd166;letter-spacing:.5px}.debug-server{font-size:9px;opacity:.5;word-break:break-all;margin-bottom:8px;line-height:1.4}.debug-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}.debug-cell{background:rgba(255,255,255,.05);border-radius:8px;padding:6px 8px}.debug-cell span{display:block;font-size:8px;opacity:.5;letter-spacing:.5px}.debug-cell b{display:block;font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.debug-bar{height:4px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;margin-bottom:8px}.debug-bar-fill{height:100%;width:0;background:linear-gradient(90deg,#4cc9f0,#7bff9f);transition:width .3s}.debug-log{height:110px;overflow-y:auto;background:rgba(0,0,0,.35);border-radius:8px;padding:6px 8px;font-size:9px;line-height:1.6;color:rgba(255,255,255,.75);word-break:break-all;-webkit-overflow-scrolling:touch}.log-line{white-space:pre-wrap}
</style>

<body>
<div class="player-wrap">
<div class="player">
<div class="bg" id="background"></div>
<div class="bg-overlay"></div>
<div class="content">
<div class="top">
<div>
<div class="top-title" id="playlistTitle">NOW PLAYING</div>
<div class="top-sub" id="playlistSub">${escapeHtmlJs(playerConfig.title)}</div>
</div><button class="icon-btn" type="button" onclick="toggleMute()" id="muteButton">
<svg id="volumeIcon" viewBox="0 0 24 24">
<path d="M11 5 6 9H2v6h4l5 4V5z"></path>
<path d="M19 9a5 5 0 0 1 0 6"></path>
<path d="M16 6.5a9 9 0 0 1 0 11"></path>
</svg>
</button>
</div><img id="cover" class="cover" src="" alt="">
<div class="info">
<div class="song-title" id="songTitle">Unknown Song</div>
<div class="artist" id="artist">Unknown Artist</div>
</div>
<div class="visualizer" id="visualizer">
<div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>
</div>
<div class="progress"> <input id="progress" type="range" min="0" max="100" value="0" step="0.1" oninput="seekMusic(this.value)">
<div class="times"> <span id="currentTime">0:00</span><span id="duration">0:00</span></div>
</div>
<div class="controls"> <button class="side-btn" type="button" onclick="previousMusic()">
<svg viewBox="0 0 24 24"><path d="M19 20 9 12l10-8v16z"></path><path d="M5 19V5"></path></svg>
</button> <button class="main-btn" type="button" onclick="toggleMusic()" id="playButton"> <svg id="playIcon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg> <svg id="pauseIcon" viewBox="0 0 24 24" style="display:none"><path d="M7 5v14"></path><path d="M17 5v14"></path></svg> </button> <button class="side-btn" type="button" onclick="nextMusic()">
<svg viewBox="0 0 24 24"><path d="m5 4 10 8-10 8V4z"></path><path d="M19 5v14"></path></svg>
</button> </div>
<div class="bottom">
<div class="bottom-left">
<button class="icon-btn" type="button" onclick="toggleRepeat()" id="repeatButton">
<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"></path><path d="M3 11V9a3 3 0 0 1 3-3h15"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v2a3 3 0 0 1-3 3H3"></path></svg>
</button>
</div>
<div class="bottom-right"> <button class="icon-btn" type="button" onclick="toggleMute()">
<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="m19 9-5 6"></path><path d="m14 9 5 6"></path></svg>
</button> <input class="volume" id="volume" type="range" min="0" max="1" step="0.01" value="1" oninput="changeVolume(this.value)"> </div>
</div>
</div>
</div>
</div>
<div class="debug-wrap">
<div class="debug-head">
<div class="debug-title">WEBSOCKET AUDIO</div>
<div class="debug-state" id="wsState">CONNECTING</div>
</div>
<div class="debug-server" id="wsServer">-</div>
<div class="debug-grid">
<div class="debug-cell"><span>Loop</span><b id="dbgLoop">OFF</b></div>
<div class="debug-cell"><span>Downloaded</span><b id="dbgDownloaded">0.00 MB</b></div>
<div class="debug-cell"><span>Total</span><b id="dbgTotal">-</b></div>
<div class="debug-cell"><span>Progress</span><b id="dbgProgress">0%</b></div>
<div class="debug-cell"><span>Chunks</span><b id="dbgChunks">0</b></div>
<div class="debug-cell"><span>MIME</span><b id="dbgMime">-</b></div>
</div>
<div class="debug-bar"><div class="debug-bar-fill" id="dbgBarFill"></div></div>
<div class="debug-log" id="debugLog"></div>
</div> <audio id="music" preload="auto"></audio>
<script>
window.MUSIC_CONFIG = {
title: "${escapeHtmlJs(playerConfig.title)}",
artist: "${escapeHtmlJs(playerConfig.artist)}",
album: "${escapeHtmlJs(playerConfig.album)}",
thumbnail: "${escapeHtmlJs(playerConfig.thumbnailb64)}",
audioUrl: "${escapeHtmlJs(playerConfig.audioUrl)}",
wsUrl: "${escapeHtmlJs(playerConfig.wsUrl)}",
autoplay: false,
volume: 0.8,
repeat: false
};
var music = document.getElementById("music");
var cover = document.getElementById("cover");
var background = document.getElementById("background");
var songTitle = document.getElementById("songTitle");
var artist = document.getElementById("artist");
var progress = document.getElementById("progress");
var currentTime = document.getElementById("currentTime");
var duration = document.getElementById("duration");
var volume = document.getElementById("volume");
var playIcon = document.getElementById("playIcon");
var pauseIcon = document.getElementById("pauseIcon");
var player = document.querySelector(".player");
var playlistTitle = document.getElementById("playlistTitle");
var playlistSub = document.getElementById("playlistSub");
var repeatButton = document.getElementById("repeatButton");
var isRepeat = false;

function formatTime(seconds) {
if (!isFinite(seconds)) return "0:00";
var min = Math.floor(seconds / 60);
var sec = Math.floor(seconds % 60);
if (sec < 10) sec = "0" + sec;
return min + ":" + sec;
}

function updateUI() {
if (music.paused) {
playIcon.style.display = "block";
pauseIcon.style.display = "none";
player.classList.remove("playing");
} else {
playIcon.style.display = "none";
pauseIcon.style.display = "block";
player.classList.add("playing");
}
}

function toggleMusic() {
if (music.paused) {
var result = music.play();
if (result && result.catch) {
result.catch(function() {});
}
} else {
music.pause();
}
updateUI();
}

function previousMusic() {
if (!isFinite(music.duration)) return;
music.currentTime = Math.max(0, music.currentTime - 10);
}

function nextMusic() {
if (!isFinite(music.duration)) return;
music.currentTime = Math.min(music.duration, music.currentTime + 10);
}

function seekMusic(value) {
if (!isFinite(music.duration)) return;
music.currentTime = (Number(value) / 100) * music.duration;
}

function changeVolume(value) {
music.volume = Number(value);
if (music.volume > 0) {
music.muted = false;
}
}

function toggleMute() {
music.muted = !music.muted;
}

function toggleRepeat() {
isRepeat = !isRepeat;
music.loop = isRepeat;
repeatButton.style.opacity = isRepeat ? "1" : ".55";
repeatButton.title = isRepeat ? "Loop ON" : "Loop OFF";
updateLoopStatus();
}
music.addEventListener("loadedmetadata", function() {
duration.textContent = formatTime(music.duration);
});
music.addEventListener("timeupdate", function() {
if (!isFinite(music.duration)) return;
var value = (music.currentTime / music.duration) * 100;
progress.value = value;
currentTime.textContent = formatTime(music.currentTime);
duration.textContent = formatTime(music.duration);
});
music.addEventListener("play", function() {
updateUI();
});
music.addEventListener("pause", function() {
updateUI();
});
music.addEventListener("ended", function() {
if (!isRepeat) {
progress.value = 0;
currentTime.textContent = "0:00";
}
updateUI();
});

var wsAudio = null;
var wsChunks = [];
var wsDownloaded = 0;
var wsTotal = null;
var wsMime = "audio/mpeg";
var wsObjectUrl = null;
var wsDone = false;
var wsLastLog = 0;

function fmtSize(bytes) {
if (!isFinite(bytes)) return "0 B";
if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
return bytes + " B";
}

function setWsState(state) {
var el = document.getElementById("wsState");
if (el) el.textContent = state;
}

function updateLoopStatus() {
var el = document.getElementById("dbgLoop");
if (el) {
el.textContent = isRepeat ? "ON" : "OFF";
}
}

function writeLog(line) {
var box = document.getElementById("debugLog");
if (!box) return;
var div = document.createElement("div");
div.className = "log-line";
div.textContent = line;
box.appendChild(div);
while (box.childNodes.length > 80) {
box.removeChild(box.firstChild);
}
box.scrollTop = box.scrollHeight;
}

function updateWsProgress() {
var el = document.getElementById("dbgDownloaded");
if (el) el.textContent = fmtSize(wsDownloaded);
if (wsTotal !== null && wsTotal > 0) {
var pct = Math.min(100, (wsDownloaded / wsTotal) * 100);
el = document.getElementById("dbgTotal");
if (el) el.textContent = fmtSize(wsTotal);
el = document.getElementById("dbgProgress");
if (el) el.textContent = pct.toFixed(1) + "%";
el = document.getElementById("dbgBarFill");
if (el) el.style.width = pct.toFixed(1) + "%";
}
el = document.getElementById("dbgChunks");
if (el) el.textContent = String(wsChunks.length);
}

function finishWsDownload(config) {
if (wsDone) return;
wsDone = true;
setWsState("COMPLETE");
writeLog("Download complete");
var blob = new Blob(wsChunks, { type: wsMime || "audio/mpeg" });
writeLog("Blob created (" + fmtSize(blob.size) + ")");
if (wsObjectUrl) {
URL.revokeObjectURL(wsObjectUrl);
}
wsObjectUrl = URL.createObjectURL(blob);
writeLog("Audio source attached");
music.src = wsObjectUrl;
music.load();
writeLog("Player ready");
if (wsAudio) {
try { wsAudio.close(); } catch (e) {}
}
wsChunks = [];
if (config.autoplay) {
setTimeout(function() {
music.play().then(function() { updateUI(); }).catch(function() {});
}, 300);
}
}

function startAudioStream(config) {
var audioUrl = config.audioUrl || "";
var wsUrl = config.wsUrl || "";
if (!wsUrl && audioUrl) {
wsUrl = "wss://audio.ryuu-dev.my.id/wss/audio?url=" + encodeURIComponent(audioUrl);
}
var serverEl = document.getElementById("wsServer");
if (serverEl) {
var host = "-";
try { host = new URL(wsUrl).host; } catch (e) {}
serverEl.textContent = host || "-";
}
if (!wsUrl) {
setWsState("ERROR");
writeLog("No audio URL tersedia");
return;
}
if (typeof WebSocket === "undefined") {
setWsState("ERROR");
writeLog("WebSocket API tidak tersedia");
return;
}
writeLog("WebSocket API tersedia");
writeLog("Connecting...");
setWsState("CONNECTING");
wsAudio = new WebSocket(wsUrl);
wsAudio.binaryType = "arraybuffer";
wsAudio.onopen = function() {
writeLog("WebSocket OPEN");
setWsState("CONNECTED");
};
wsAudio.onmessage = function(event) {
if (typeof event.data === "string") {
var message = null;
try { message = JSON.parse(event.data); } catch (e) {}
if (!message) return;
if (message.type === "start") {
wsMime = message.mime || "audio/mpeg";
if (message.contentLength !== undefined && message.contentLength !== null) {
wsTotal = Number(message.contentLength);
} else if (message.length !== undefined && message.length !== null) {
wsTotal = Number(message.length);
}
var mimeEl = document.getElementById("dbgMime");
if (mimeEl) mimeEl.textContent = wsMime;
writeLog("START");
writeLog("MIME: " + wsMime);
if (wsTotal !== null && wsTotal > 0) {
writeLog("Size: " + fmtSize(wsTotal));
}
setWsState("DOWNLOADING");
updateWsProgress();
return;
}
if (message.type === "end") {
writeLog("END");
finishWsDownload(config);
return;
}
if (message.type === "error") {
writeLog("Server error: " + (message.message || "unknown"));
setWsState("ERROR");
return;
}
return;
}
wsChunks.push(event.data);
var bytes = event.data.byteLength || 0;
wsDownloaded += bytes;
var now = Date.now();
if (now - wsLastLog > 400) {
wsLastLog = now;
writeLog("Binary chunk: " + fmtSize(bytes));
}
updateWsProgress();
};
wsAudio.onerror = function() {
writeLog("WebSocket error");
setWsState("ERROR");
};
wsAudio.onclose = function(event) {
if (wsDone) {
setWsState("COMPLETE");
return;
}
writeLog("WebSocket closed unexpectedly");
writeLog("Code: " + event.code + " Reason: " + (event.reason || "-"));
setWsState("CLOSED");
};
window.addEventListener("beforeunload", function() {
if (wsAudio) {
try { wsAudio.close(); } catch (e) {}
}
if (wsObjectUrl) {
URL.revokeObjectURL(wsObjectUrl);
}
});
}
(function() {
var config = window.MUSIC_CONFIG || {};
songTitle.textContent = config.title || "Unknown Song";
artist.textContent = config.artist || "Unknown Artist";
playlistTitle.textContent = config.playlistTitle || "NOW PLAYING";
playlistSub.textContent = config.playlistSub || "${escapeHtmlJs(playerConfig.title)}"; if(config.thumbnail){ cover.src = config.thumbnail; } if(config.background){ background.style.backgroundImage = "url('" + config.background + "')"; } else if (config.thumbnail) { background.style.backgroundImage = "url('" + config.thumbnail + "')"; }
var vol = typeof config.volume === "number" ? config.volume : 1; music.volume = vol; volume.value = vol; music.loop = isRepeat; updateLoopStatus(); startAudioStream(config);
})();
</script>`;

    const html = {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            unifiedResponse: {
              data: Buffer.from(JSON.stringify({
                __typename: "GenAIUnifiedResponse",
                response_id: crypto.randomUUID(),
                sections: [{
                  __typename: "GenAIUnifiedResponseSection",
                  view_model: {
                    __typename: "GenAISingleLayoutViewModel",
                    primitive: {
                      __typename: "FOAHtmlPrimitiveDemoDONOTUSE",
                      trusted_sources: [],
                      payload: htmlPayload,
                    },
                  },
                }],
              })).toString("base64"),
            },
            contextInfo: { isForwarded: true, forwardOrigin: 4 },
          },
        },
      },
    };

    const msg = generateWAMessageFromContent(m.chat, html, { userJid: sock.user.jid });
    await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });

    m.react("✅");
  } catch (err) {
    console.error("PLAY2 Error:", err);
    m.react("❌");
    m.reply(`❌ Gagal mengambil data.\n\n${err.message}`);
  }
}

export { pluginConfig as config, handler };