import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateWAMessageFromContent } from "ourin";
import config from "../../config.js";
import { getOwnerName } from "../../config.js";
import { getDatabase } from "../../src/lib/ourin-database.js";
import { parsePhoneNumber } from "awesome-phonenumber";

const pluginConfig = {
  name: "owner",
  alias: ["creator", "dev", "developer"],
  category: "main",
  description: "Menampilkan owner card Rich HTML (foto + profil owner)",
  usage: ".owner",
  example: ".owner",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 0,
  isEnabled: true,
};

// ═══════════════════════════════════════════════════════════
// MEDIA — media owner di-embed base64 supaya pasti tampil tanpa
// fetch remote. Path diatur di config.ownerCard.imageUrl
// (path lokal atau URL http(s)). Bisa foto (jpg/png/webp/gif)
// atau video (mp4/webm/mkv/mov/m4v/3gp) — video streaming via
// WebSocket sama seperti plugin play2.
// ═══════════════════════════════════════════════════════════

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Endpoint WebSocket streaming diatur di config.ownerCard.wsUrl
// (fallback: server yang sama dengan plugin play2)

const IMAGE_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function extFromPath(p) {
  const clean = String(p).replace(/[?#].*$/, "");
  const m = /\.([a-z0-9]+)$/i.exec(clean);
  return m ? m[1].toLowerCase() : "";
}

const VIDEO_EXT = ["mp4", "webm", "mkv", "mov", "avi", "m4v", "3gp"];

// Deteksi video dari ekstensi; shortlink seperti https://kappa.lol/EniR40
// tidak punya ekstensi, jadi backend harus bisa memaksa tipe lewat config
// (mediaType: "video") — pola yang sama dipakai plugin play2.
function isVideoSource(src) {
  const ext = extFromPath(String(src).split("?")[0]);
  return ext !== "" && VIDEO_EXT.includes(ext);
}

// Escape string untuk dipakai di dalam string JS (inline <script>)
function escapeHtmlJs(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

// Bangun URL WebSocket final dari base di config + URL video:
// - base diakhiri "url=" → URL video langsung ditempel (sudah di-encode)
// - base belum ada param url → ditambahkan "?url=" / "&url=" otomatis
function buildWsUrl(wsBase, videoUrl) {
  const base = String(wsBase || "").trim() || "wss://audio.ryuu-dev.my.id/wss/audio?url=";
  const encoded = encodeURIComponent(videoUrl);
  if (/[?&]url=$/.test(base)) return base + encoded;
  return base + (base.includes("?") ? "&" : "?") + "url=" + encoded;
}

// Path lokal → data URI base64; URL http(s) → dipakai langsung;
// kosong/gagal baca → "" (section media tidak dirender)
// Return { src, isVideo }
// Path lokal → data URI base64; URL http(s) → dipakai langsung;
// kosong/gagal baca → "" (section media tidak dirender)
// mediaType "video" memaksa mode video (untuk shortlink tanpa ekstensi)
// Return { src, isVideo }
function resolveOwnerMedia(imageUrl, mediaType = "") {
  const val = String(imageUrl ?? "").trim();
  if (!val) return { src: "", isVideo: false };

  const wantVideo = String(mediaType || "").toLowerCase() === "video" || isVideoSource(val);

  if (/^https?:\/\//i.test(val)) return { src: val, isVideo: wantVideo };

  try {
    const p = path.isAbsolute(val) ? val : path.join(__dirname, "../..", val);
    const buf = fs.readFileSync(p);
    const ext = extFromPath(p);
    const mime = VIDEO_EXT.includes(ext)
      ? `video/${ext === "mkv" ? "webm" : ext === "mov" ? "quicktime" : ext}`
      : IMAGE_MIME[ext] || "image/jpeg";
    return { src: `data:${mime};base64,${buf.toString("base64")}`, isVideo: VIDEO_EXT.includes(ext) };
  } catch {
    // Path lokal tidak ada → kalau backend memaksa video, tetap pakai URL
    return wantVideo ? { src: val, isVideo: true } : { src: "", isVideo: false };
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS — escape & format nomor
// ═══════════════════════════════════════════════════════════

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Nomor owner dari config/db (bukan dari incoming message), diformat WhatsApp.
function resolveOwnerData() {
  const db = getDatabase();
  const configOwners = Array.isArray(config.owner?.number)
    ? config.owner.number
    : config.owner?.number
      ? [config.owner.number]
      : [];
  const dbOwners = Array.isArray(db?.data?.owner) ? db.data.owner : [];

  const numbers = [...new Set([...configOwners, ...dbOwners])]
    .map((n) => String(n ?? "").replace(/[^0-9]/g, ""))
    .filter(Boolean);

  const primary = numbers[0] || "";
  const primaryName = numbers.length
    ? getOwnerName(primary)
    : config.owner?.name || "Owner";

  return { numbers, primary, primaryName };
}

// Format nomor: "+62 851-xxxx-xxxx" via awesome-phonenumber (hanya jika valid),
// fallback bersih "+<digits>" untuk nomor tidak valid/kosong.
function formatOwnerNumber(cleanNumber) {
  if (!cleanNumber) return "-";
  try {
    const parsed = parsePhoneNumber(cleanNumber, { regionCode: "ID" });
    if (parsed?.valid && parsed?.number?.international) return parsed.number.international;
  } catch { }
  const digits = String(cleanNumber).replace(/[^0-9]/g, "");
  return digits ? `+${digits}` : "-";
}

// Buat JID WhatsApp yang benar berdasarkan Baileys
function toWhatsappJid(cleanNumber) {
  return cleanNumber ? `${cleanNumber}@s.whatsapp.net` : "";
}

// ═══════════════════════════════════════════════════════════
// HTML TEMPLATE — dark, clean, premium, typography-first
// ═══════════════════════════════════════════════════════════

// Script streaming video via WebSocket — pola sama dengan plugin play2
// (server diatur di config.ownerCard.wsUrl)
const OWNER_VIDEO_WS_SCRIPT = `<script>
(function () {
  var cfg = {
    videoUrl: "__VIDEO_URL__",
    wsUrl: "__WS_URL__"
  };
  var video = document.getElementById("ownerVideo");
  var stateEl = document.getElementById("wsState");
  if (!video || !cfg.videoUrl) return;

  function setState(txt, cls) {
    if (!stateEl) return;
    stateEl.textContent = txt;
    stateEl.className = "ws-state" + (cls ? " " + cls : "");
  }

  function fmtSize(bytes) {
    if (!isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
    return bytes + " B";
  }

  function setStateProgress(prefix, cls) {
    if (!stateEl) return;
    var pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
    stateEl.textContent = prefix + " " + pct + "% \u00b7 " + fmtSize(downloaded);
    stateEl.className = "ws-state" + (cls ? " " + cls : "");
  }

  var ws = null;
  var chunks = [];
  var downloaded = 0;
  var total = null;
  var mime = "video/mp4";
  var objectUrl = null;
  var done = false;
  var watchdog = null;
  var directTried = false;

  // Watchdog: kalau WS macet (tidak ada byte masuk) terlalu lama,
  // fallback langsung ke URL video supaya tetap bisa diputar.
  function resetWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(function () {
      if (!done) useDirect();
    }, 10000);
  }

  // Fallback: putar langsung dari URL (HTTP progressive, server support range)
  function useDirect() {
    if (done) return;
    done = true;
    if (watchdog) clearTimeout(watchdog);
    if (ws) { try { ws.close(); } catch (e) {} }
    directTried = true;
    setState("DIRECT PLAY", "ok");
    video.src = cfg.videoUrl;
    video.load();
  }

  function finish() {
    if (done) return;
    done = true;
    if (watchdog) clearTimeout(watchdog);
    setState("COMPLETE", "ok");
    try {
      var blob = new Blob(chunks, { type: mime || "video/mp4" });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      video.src = objectUrl;
      video.load();
    } catch (e) {
      setState("ERROR", "err");
    }
    if (ws) { try { ws.close(); } catch (e) {} }
    chunks = [];
  }

  function startStream() {
    if (typeof WebSocket === "undefined") { useDirect(); return; }
    setState("CONNECTING");
    resetWatchdog();
    try { ws = new WebSocket(cfg.wsUrl); } catch (e) { useDirect(); return; }
    ws.binaryType = "arraybuffer";
    ws.onopen = function () { setState("CONNECTED", "ok"); };
    ws.onmessage = function (event) {
      if (typeof event.data === "string") {
        var msg = null;
        try { msg = JSON.parse(event.data); } catch (e) {}
        if (!msg) return;
        if (msg.type === "start") {
          if (msg.mime) mime = msg.mime;
          if (msg.contentLength !== undefined && msg.contentLength !== null) total = Number(msg.contentLength);
          else if (msg.length !== undefined && msg.length !== null) total = Number(msg.length);
          setState("START", "ok");
          resetWatchdog();
          return;
        }
        if (msg.type === "end") { finish(); return; }
        if (msg.type === "error") { useDirect(); return; }
        return;
      }
      chunks.push(event.data);
      downloaded += event.data.byteLength || 0;
      resetWatchdog();
      setStateProgress("LOADING", "ok");
    };
    ws.onerror = function () { if (!done) useDirect(); };
    ws.onclose = function () {
      if (!done && !directTried) useDirect();
    };
  }

  video.addEventListener("loadedmetadata", function () {
    setState("READY", "ok");
  });
  video.addEventListener("error", function () {
    if (!done && !directTried) useDirect();
    else if (directTried) setState("ERROR", "err");
  });
  video.addEventListener("ended", function () {
    setState("DONE", "ok");
  });

  startStream();
})();
<\/script>`;

function buildOwnerHtml({ name, numberDisplay, jid, role, quote, about, imageSrc, isVideo, wsBase, verified }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

  body {
    background: #0b0d12;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    color: #e7e9ee;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 100vh;
    padding: 14px 0;
    -webkit-font-smoothing: antialiased;
  }

  .card {
    width: 100%;
    max-width: 400px;
    margin: 0 12px;
    background: #10131a;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 16px 40px -20px rgba(0, 0, 0, 0.8);
  }

  /* ── OWNER IDENTITY ─────────────────────────── */
  .owner-head {
    padding: 20px 20px 16px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .owner-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2.4px;
    text-transform: uppercase;
    color: #6b7280;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .badge-verified {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    background: #1d9bf0;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .badge-verified svg {
    width: 9px;
    height: 9px;
    fill: #fff;
  }

  .owner-name {
    margin-top: 8px;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: #f4f5f7;
    line-height: 1.15;
    word-break: break-word;
  }

  .owner-verified-label {
    margin-top: 5px;
    font-size: 12px;
    font-weight: 600;
    color: #1d9bf0;
    letter-spacing: 0.2px;
  }

  .owner-number {
    font-size: 12px;
    font-weight: 600;
    color: #8b92a3;
    white-space: nowrap;
    padding-top: 3px;
    font-variant-numeric: tabular-nums;
  }

  /* ── FOTO / VIDEO OWNER ─────────────────────────── */
  .media-section {
    background: #000;
    line-height: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .media-section img,
  .media-section video {
    display: block;
    width: 100%;
    height: auto;
  }

  .media-video-wrap { position: relative; }

  .ws-state {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    padding: 4px 9px;
    border-radius: 20px;
    background: rgba(0, 0, 0, 0.55);
    color: #ffd166;
  }

  .ws-state.ok { color: #7bff9f; }
  .ws-state.err { color: #ff6b6b; }

  /* ── TYPOGRAPHY CARD ─────────────────────────── */
  .quote-card {
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .quote {
    font-size: 17px;
    font-weight: 600;
    line-height: 1.45;
    color: #e7e9ee;
    letter-spacing: -0.2px;
  }

  .role {
    margin-top: 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 1.6px;
    text-transform: uppercase;
    color: #6b7280;
  }

  /* ── ABOUT ─────────────────────────── */
  .about-section {
    padding: 18px 20px 20px;
  }

  .about-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2.4px;
    text-transform: uppercase;
    color: #6b7280;
  }

  .about-text {
    margin-top: 8px;
    font-size: 13.5px;
    line-height: 1.6;
    color: #9aa2b1;
  }

  .footer {
    padding: 0 20px 18px;
    font-size: 10.5px;
    color: #3f4552;
    letter-spacing: 0.4px;
  }
</style>
</head>
<body>
  <div class="card">

    <!-- 1. OWNER CARD -->
    <div class="owner-head">
      <div class="owner-main">
        <div class="owner-title">
          OWNER${verified ? `
          <span class="badge-verified" title="Verified Owner"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>` : ""}
        </div>
        <div class="owner-name">${escapeHtml(name)}</div>
        ${verified ? `<div class="owner-verified-label">Verified Owner</div>` : ""}
      </div>
      <div class="owner-number">${escapeHtml(numberDisplay)}</div>
    </div>

    <!-- 2. FOTO / VIDEO OWNER -->
    ${imageSrc && !isVideo ? `
    <div class="media-section">
      <img src="${escapeHtml(imageSrc)}" alt="Owner">
    </div>` : ""}
    ${imageSrc && isVideo ? `
    <div class="media-section media-video-wrap">
      <div class="ws-state" id="wsState">CONNECTING</div>
      <video id="ownerVideo" playsinline webkit-playsinline preload="auto" controls></video>
    </div>` : ""}

    <!-- 3. TYPOGRAPHY CARD -->
    <div class="quote-card">
      <div class="quote">&ldquo;${escapeHtml(quote)}&rdquo;</div>
      ${role ? `<div class="role">${escapeHtml(role)}</div>` : ""}
    </div>

    <!-- 4. ABOUT OWNER -->
    <div class="about-section">
      <div class="about-title">ABOUT OWNER</div>
      <div class="about-text">${escapeHtml(about)}</div>
    </div>

    <div class="footer">wa.me/${escapeHtml(jid ? jid.split("@")[0] : "")}</div>

  </div>
${imageSrc && isVideo ? OWNER_VIDEO_WS_SCRIPT
      .replace("__VIDEO_URL__", () => escapeHtmlJs(imageSrc))
      .replace("__WS_URL__", () => escapeHtmlJs(buildWsUrl(wsBase, imageSrc))) : ""}
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════
// SEND — pola Rich HTML existing project (FOAHtmlPrimitive)
// ═══════════════════════════════════════════════════════════

async function sendOwnerRichCard(m, sock, data) {
  const htmlPayload = buildOwnerHtml(data);

  const content = {
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

  const msg = generateWAMessageFromContent(m.chat, content, { userJid: sock.user.jid });
  await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
}

function buildOwnerFallbackText({ name, primary, numberDisplay, role }) {
  const lines = [`Owner: ${name}`];
  if (primary) lines.push(`Nomor: ${numberDisplay} (wa.me/${primary})`);
  if (role) lines.push(`Role: ${role}`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════

async function handler(m, { sock }) {
  let data;
  try {
    const cardConfig = config.ownerCard || {};
    const { numbers, primary, primaryName } = resolveOwnerData();

    data = {
      name: primaryName || "Owner",
      primary,
      jid: toWhatsappJid(primary),
      numberDisplay: primary ? formatOwnerNumber(primary) : "-",
      role: cardConfig.role || "Developer • Creator • Builder",
      quote: cardConfig.quote || "",
      about: cardConfig.about || "",
      ...(() => {
        const media = resolveOwnerMedia(
          cardConfig.imageUrl || "./assets/image/owner-card.jpg",
          cardConfig.mediaType || "",
        );
        return { imageSrc: media.src, isVideo: media.isVideo, wsBase: cardConfig.wsUrl || "" };
      })(),
      verified: cardConfig.verified !== false,
    };
  } catch (err) {
    console.error("[Owner] Gagal menyiapkan data owner:", err.message);
    // Database/config gagal → kirim fallback teks minimal, jangan crash
    await m.reply(`Owner: ${config.owner?.name || "Owner"}\nNomor: ${Array.isArray(config.owner?.number) ? config.owner.number[0] : config.owner?.number || "-"}`);
    return;
  }

  try {
    await sendOwnerRichCard(m, sock, data);
  } catch (err) {
    // Rich HTML gagal → fallback pesan biasa, proses bot tetap jalan
    console.error("[Owner] Rich HTML gagal dikirim:", err);
    try {
      await m.reply(buildOwnerFallbackText(data));
    } catch (replyErr) {
      console.error("[Owner] Fallback reply juga gagal:", replyErr.message);
    }
  }
}

export {
  pluginConfig as config,
  handler,
  escapeHtml,
  escapeHtmlJs,
  buildWsUrl,
  resolveOwnerMedia,
  isVideoSource,
  formatOwnerNumber,
  toWhatsappJid,
  buildOwnerHtml,
};
