import { performance } from "perf_hooks";
import os from "os";
import crypto from "node:crypto";
import { generateWAMessageFromContent } from "mikuhostt-baileys";
import config from "../../config.js";
import te from "../../src/lib/miku-error.js";

const pluginConfig = {
  name: "ping",
  alias: ["speed", "p", "latency", "sys", "status"],
  category: "main",
  description: "Cek performa dan status sistem bot secara real-time",
  usage: ".ping",
  example: ".ping",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const fmtSize = (b) => {
  if (!b || b === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + " " + u[i];
};

const fmtUp = (s) => {
  s = Number(s);
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60),
    sc = Math.floor(s % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sc}s`;
  return `${m}m ${sc}s`;
};

// ---------- GET STATS (DENGAN ROUNDING) ----------
function getStats() {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPct = ((usedMem / totalMem) * 100).toFixed(1);
  
  // CPU load percentage (real-time berdasarkan load average)
  const cpuLoad = Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100));
  
  // Ping latency - ambil angka depan (integer)
  const rawPing = performance.now() - (global._pingStart || performance.now());
  const ping = Math.round(rawPing); // bulatkan ke integer terdekat

  return {
    ping: ping,
    cpuModel: cpus[0]?.model || "Unknown CPU",
    cpuSpeed: cpus[0]?.speed || 0,
    cpuCores: cpus.length,
    cpuLoad: cpuLoad,
    load: [
      loadAvg[0].toFixed(2),
      loadAvg[1].toFixed(2),
      loadAvg[2].toFixed(2)
    ],
    totalMem,
    freeMem,
    usedMem,
    memPct,
    memNode: process.memoryUsage(),
    osType: os.type(),
    osRel: os.release(),
    osPlatform: os.platform(),
    osArch: os.arch(),
    osHost: os.hostname(),
    nodeVer: process.version,
    v8: process.versions.v8,
    upOS: fmtUp(os.uptime()),
    upBot: fmtUp(process.uptime()),
    upBotSec: Math.round(process.uptime()),
    upServerSec: Math.round(os.uptime()),
  };
}

// ---------- BUILD HTML PING (REALTIME UPDATING) ----------
function buildPingHtml(data) {
  const safeData = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>📊 System Monitor</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#e2e8f0;display:flex;justify-content:center;padding:8px}
.c{max-width:400px;width:100%;background:#12121a;border-radius:16px;padding:16px;border:1px solid rgba(56,189,248,0.15)}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.header h1{font-size:18px;font-weight:700;color:#38bdf8}
.status{font-size:12px;color:#4ade80;background:rgba(74,222,128,0.15);padding:4px 12px;border-radius:12px}
.glow{text-shadow:0 0 20px rgba(56,189,248,0.3)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.box{background:#1a1a24;border-radius:10px;padding:12px;border:1px solid rgba(255,255,255,0.05)}
.box .label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px}
.box .value{font-size:20px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
.box .sub{font-size:11px;color:#64748b;margin-top:2px}
.full{grid-column:1/-1}
.cyan{color:#38bdf8}
.green{color:#4ade80}
.yellow{color:#facc15}
.pink{color:#f472b6}
.purple{color:#c084fc}
.orange{color:#fb923c}
.red{color:#f87171}
.bar-wrap{background:#1e1e2e;border-radius:6px;height:6px;margin-top:6px;overflow:hidden}
.bar{height:100%;border-radius:6px;transition:width 0.8s ease}
.small{font-size:12px}
.mt-4{margin-top:4px}
.footer{text-align:center;font-size:10px;color:#475569;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05)}
</style>
</head>
<body>
<div class="c">
  <div class="header">
    <h1 class="glow">📊 SYSTEM MONITOR</h1>
    <span class="status" id="statusBadge">● ONLINE</span>
  </div>

  <!-- PING & UPTIME -->
  <div class="grid">
    <div class="box">
      <div class="label">🏓 Latency</div>
      <div class="value cyan" id="ping">${data.ping} ms</div>
      <div class="sub" id="pingStatus">${data.ping < 100 ? '⚡ Excellent' : data.ping < 300 ? '👍 Good' : '🐢 Slow'}</div>
    </div>
    <div class="box">
      <div class="label">⏱ Uptime Bot</div>
      <div class="value green" id="uptimeBot">${data.upBot}</div>
      <div class="sub" id="uptimeBotSub">since ${new Date(Date.now() - process.uptime() * 1000).toLocaleTimeString()}</div>
    </div>
  </div>

  <!-- CPU -->
  <div class="box full" style="margin-top:8px">
    <div class="label">💻 CPU</div>
    <div class="small" style="color:#94a3b8;margin-top:2px" id="cpuModel">${data.cpuModel}</div>
    <div class="grid" style="margin-top:6px">
      <div><span class="label" style="font-size:9px">Cores</span><div class="value yellow" style="font-size:16px" id="cpuCores">${data.cpuCores}</div></div>
      <div><span class="label" style="font-size:9px">Speed</span><div class="value yellow" style="font-size:16px" id="cpuSpeed">${data.cpuSpeed} MHz</div></div>
    </div>
    <div class="bar-wrap"><div class="bar" id="cpuBar" style="width:${data.cpuLoad}%;background:linear-gradient(90deg,#facc15,#fb923c)"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:2px">
      <span>Load: <span id="cpuLoad">${data.cpuLoad}</span>%</span>
      <span id="loadAvg">1m: ${data.load[0]} | 5m: ${data.load[1]} | 15m: ${data.load[2]}</span>
    </div>
  </div>

  <!-- MEMORY -->
  <div class="box full" style="margin-top:8px">
    <div class="label">🧠 Memory</div>
    <div style="display:flex;justify-content:space-between;margin-top:4px">
      <span class="small" style="color:#94a3b8">Used</span>
      <span class="small" style="color:#94a3b8">Free</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600">
      <span class="purple" id="memUsed">${fmtSize(data.usedMem)}</span>
      <span class="green" id="memFree">${fmtSize(data.freeMem)}</span>
    </div>
    <div class="bar-wrap"><div class="bar" id="memBar" style="width:${data.memPct}%;background:linear-gradient(90deg,#c084fc,#a855f7)"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:2px">
      <span>Used: <span id="memPct">${data.memPct}</span>%</span>
      <span>Total: ${fmtSize(data.totalMem)}</span>
    </div>
  </div>

  <!-- NODE.JS MEMORY -->
  <div class="box full" style="margin-top:8px">
    <div class="label">📦 Node.js Memory</div>
    <div class="grid" style="margin-top:4px">
      <div><span class="label" style="font-size:9px">RSS</span><div class="small pink" id="rss">${fmtSize(data.memNode.rss)}</div></div>
      <div><span class="label" style="font-size:9px">Heap Used</span><div class="small orange" id="heapUsed">${fmtSize(data.memNode.heapUsed)}</div></div>
      <div><span class="label" style="font-size:9px">Heap Total</span><div class="small cyan" id="heapTotal">${fmtSize(data.memNode.heapTotal)}</div></div>
      <div><span class="label" style="font-size:9px">External</span><div class="small pink" id="external">${fmtSize(data.memNode.external)}</div></div>
    </div>
  </div>

  <!-- SYSTEM INFO -->
  <div class="box full" style="margin-top:8px">
    <div class="label">🖥 System</div>
    <div class="grid" style="margin-top:4px">
      <div><span class="label" style="font-size:9px">OS</span><div class="small" style="color:#94a3b8" id="osType">${data.osType}</div></div>
      <div><span class="label" style="font-size:9px">Platform</span><div class="small" style="color:#94a3b8" id="osPlatform">${data.osPlatform}</div></div>
      <div><span class="label" style="font-size:9px">Node</span><div class="small" style="color:#94a3b8" id="nodeVer">${data.nodeVer}</div></div>
      <div><span class="label" style="font-size:9px">V8</span><div class="small" style="color:#94a3b8" id="v8Ver">${data.v8}</div></div>
    </div>
  </div>

  <!-- UPTIME SERVER -->
  <div class="box full" style="margin-top:8px;background:rgba(236,72,153,0.05);border-color:rgba(236,72,153,0.15)">
    <div class="label">⏱ Uptime Server</div>
    <div class="value pink" style="font-size:18px" id="uptimeServer">${data.upOS}</div>
  </div>

  <div class="footer">🔄 Auto-update setiap 2 detik • ${data.nodeVer}</div>
</div>

<script>
const initData = ${safeData};

// Format bytes
function fmt(b){ if(!b||b===0)return'0 B';const u=['B','KB','MB','GB','TB'];const i=Math.floor(Math.log(b)/Math.log(1024));return (b/Math.pow(1024,i)).toFixed(1)+' '+u[i];}

// Format uptime
function fmtUp(s){ s=Number(s); const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60),sc=Math.floor(s%60); if(d>0)return d+'d '+h+'h '+m+'m'; if(h>0)return h+'h '+m+'m '+sc+'s'; return m+'m '+sc+'s'; }

// Update function
async function updateStats() {
  try {
    const res = await fetch('/ping-stats');
    const d = await res.json();
    
    // Update ping (integer)
    document.getElementById('ping').textContent = Math.round(d.ping) + ' ms';
    const ps = document.getElementById('pingStatus');
    const pingVal = Math.round(d.ping);
    ps.textContent = pingVal < 100 ? '⚡ Excellent' : pingVal < 300 ? '👍 Good' : '🐢 Slow';
    
    // Update CPU
    document.getElementById('cpuLoad').textContent = d.cpuLoad;
    document.getElementById('cpuBar').style.width = d.cpuLoad + '%';
    document.getElementById('loadAvg').textContent = '1m: ' + d.load[0] + ' | 5m: ' + d.load[1] + ' | 15m: ' + d.load[2];
    
    // Update Memory
    document.getElementById('memUsed').textContent = fmt(d.usedMem);
    document.getElementById('memFree').textContent = fmt(d.freeMem);
    document.getElementById('memPct').textContent = d.memPct;
    document.getElementById('memBar').style.width = d.memPct + '%';
    
    // Update Node memory
    document.getElementById('rss').textContent = fmt(d.memNode.rss);
    document.getElementById('heapUsed').textContent = fmt(d.memNode.heapUsed);
    document.getElementById('heapTotal').textContent = fmt(d.memNode.heapTotal);
    document.getElementById('external').textContent = fmt(d.memNode.external);
    
    // Update uptime
    document.getElementById('uptimeBot').textContent = fmtUp(d.upBotSec);
    document.getElementById('uptimeBotSub').textContent = 'since ' + new Date(Date.now() - d.upBotSec * 1000).toLocaleTimeString();
    document.getElementById('uptimeServer').textContent = fmtUp(d.upServerSec);
    
    // Update status badge
    const badge = document.getElementById('statusBadge');
    if (d.cpuLoad > 90 || d.memPct > 90) {
      badge.textContent = '⚠️ HIGH LOAD';
      badge.style.color = '#f87171';
      badge.style.background = 'rgba(248,113,113,0.15)';
    } else {
      badge.textContent = '● ONLINE';
      badge.style.color = '#4ade80';
      badge.style.background = 'rgba(74,222,128,0.15)';
    }
    
  } catch(e) {
    // Silent fail
  }
}

// Update setiap 2 detik
setInterval(updateStats, 2000);
</script>
</body></html>`;
}

// ---------- SEND PING CARD ----------
async function sendPingCard(m, sock, stats) {
  const htmlPayload = buildPingHtml(stats);

  const richContent = {
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

  try {
    const richMsg = generateWAMessageFromContent(m.chat, richContent, { userJid: sock.user.jid });
    await sock.relayMessage(m.chat, richMsg.message, { messageId: richMsg.key.id });
  } catch (err) {
    console.warn("[Ping] Rich card gagal:", err.message);
    throw err;
  }
}

// ---------- HANDLER ----------
async function handler(m, { sock }) {
  try {
    await m.react("🕕");

    // Set ping start
    global._pingStart = performance.now();

    const stats = getStats();

    // Kirim rich card
    await sendPingCard(m, sock, stats);

    await m.react("✅");
  } catch (error) {
    console.error("[Ping] Error:", error);
    await m.react("❌");
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

// ---------- EXPORT ----------
export { pluginConfig as config, handler };