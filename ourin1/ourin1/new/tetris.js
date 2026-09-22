import crypto from "node:crypto";
import { generateWAMessageFromContent } from "ourin";
import config from "../../config.js";

const pluginConfig = {
  name: "tetris",
  alias: ["tetrisgame", "gametetris"],
  category: "game",
  description: "Mini game Tetris interaktif",
  usage: ".tetris",
  example: ".tetris",
  cooldown: 30,
  energi: 1,
  isEnabled: true,
};

// Kosongkan dulu — isi manual dengan base64 audio pendek (disarankan hanya beberapa KB, bukan lagu penuh)
const menuSongBase64 = "";

const htmlPayload = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{margin:0;background:#0e0e10;color:#fff;font-family:-apple-system,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;padding:16px;box-sizing:border-box;}
  canvas{background:#000;border-radius:8px;image-rendering:pixelated;max-width:100%;}
  .hud{display:flex;gap:16px;margin:10px 0;font-size:13px;color:#aaa;}
  .hud b{color:#fff;}
  .controls{display:flex;gap:10px;margin-top:12px;}
  .controls button{background:#1a1a1d;color:#fff;border:1px solid #333;border-radius:8px;padding:10px 14px;font-size:16px;}
  #bgmBtn{margin-top:8px;background:#1a1a1d;color:#fff;border:1px solid #333;border-radius:8px;padding:8px 12px;font-size:12px;}
</style></head>
<body>
  <div class="hud">
    <div>SCORE <b id="score">000000</b></div>
    <div>LINES <b id="lines">000</b></div>
    <div>LVL <b id="level">01</b></div>
  </div>
  <canvas id="board" width="200" height="400"></canvas>
  <div class="controls">
    <button id="btnLeft">⬅️</button>
    <button id="btnRotate">🔄</button>
    <button id="btnDown">⬇️</button>
    <button id="btnRight">➡️</button>
  </div>
  <button id="bgmBtn">🎵 MUSIK BGM: OFF</button>
  ${menuSongBase64 ? `<audio id="bgm" loop src="${menuSongBase64}"></audio>` : ""}

<script>
  const canvas = document.getElementById('board');
  const context = canvas.getContext('2d');
  context.scale(20, 20);

  const bgmAudio = document.getElementById('bgm');
  const bgmBtn = document.getElementById('bgmBtn');
  if (bgmBtn) {
    bgmBtn.addEventListener('click', () => {
      if (!bgmAudio) { bgmBtn.textContent = '🎵 Musik belum tersedia'; return; }
      if (bgmAudio.paused) { bgmAudio.play(); bgmBtn.textContent = '🎵 MUSIK BGM: ON'; }
      else { bgmAudio.pause(); bgmBtn.textContent = '🎵 MUSIK BGM: OFF'; }
    });
  }

  function createMatrix(w, h) {
    const matrix = [];
    while (h--) matrix.push(new Array(w).fill(0));
    return matrix;
  }

  function createPiece(type) {
    const pieces = {
      T: [[0,0,0],[1,1,1],[0,1,0]],
      O: [[2,2],[2,2]],
      L: [[0,0,3],[3,3,3],[0,0,0]],
      J: [[4,0,0],[4,4,4],[0,0,0]],
      I: [[0,0,0,0],[5,5,5,5],[0,0,0,0],[0,0,0,0]],
      S: [[0,6,6],[6,6,0],[0,0,0]],
      Z: [[7,7,0],[0,7,7],[0,0,0]],
    };
    return pieces[type];
  }

  const colors = [null,'#8b5cf6','#facc15','#f97316','#3b82f6','#06b6d4','#22c55e','#ef4444'];

  function drawMatrix(matrix, offset) {
    matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value !== 0) {
          context.fillStyle = colors[value];
          context.fillRect(x + offset.x, y + offset.y, 1, 1);
        }
      });
    });
  }

  function draw() {
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawMatrix(arena, {x: 0, y: 0});
    drawMatrix(player.matrix, player.pos);
  }

  function merge(arena, player) {
    player.matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value !== 0) arena[y + player.pos.y][x + player.pos.x] = value;
      });
    });
  }

  function collide(arena, player) {
    const [m, o] = [player.matrix, player.pos];
    for (let y = 0; y < m.length; ++y) {
      for (let x = 0; x < m[y].length; ++x) {
        if (m[y][x] !== 0 && (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) {
          return true;
        }
      }
    }
    return false;
  }

  function rotate(matrix, dir = 1) {
    for (let y = 0; y < matrix.length; ++y) {
      for (let x = 0; x < y; ++x) {
        [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
      }
    }
    if (dir > 0) matrix.forEach(row => row.reverse());
    else matrix.reverse();
  }

  function arenaSweep() {
    let rowCount = 1;
    outer: for (let y = arena.length - 1; y >= 0; --y) {
      for (let x = 0; x < arena[y].length; ++x) {
        if (arena[y][x] === 0) continue outer;
      }
      const row = arena.splice(y, 1)[0].fill(0);
      arena.unshift(row);
      ++y;
      player.score += rowCount * 10;
      player.lines++;
      player.level = Math.floor(player.lines / 10) + 1;
      rowCount *= 2;
    }
  }

  function playerReset() {
    const pieces = 'TJLOSZI';
    player.matrix = createPiece(pieces[pieces.length * Math.random() | 0]);
    player.pos.y = 0;
    player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    if (collide(arena, player)) {
      arena.forEach(row => row.fill(0));
      player.score = 0;
      player.lines = 0;
      player.level = 1;
    }
  }

  function playerDrop() {
    player.pos.y++;
    if (collide(arena, player)) {
      player.pos.y--;
      merge(arena, player);
      playerReset();
      arenaSweep();
      updateStats();
    }
    dropCounter = 0;
  }

  function playerMove(dir) {
    player.pos.x += dir;
    if (collide(arena, player)) player.pos.x -= dir;
  }

  function playerRotate() {
    const pos = player.pos.x;
    let offset = 1;
    rotate(player.matrix);
    while (collide(arena, player)) {
      player.pos.x += offset;
      offset = -(offset + (offset > 0 ? 1 : -1));
      if (offset > player.matrix[0].length) {
        rotate(player.matrix, -1);
        player.pos.x = pos;
        return;
      }
    }
  }

  function updateStats() {
    document.getElementById('score').textContent = String(Math.floor(player.score)).padStart(6, '0');
    document.getElementById('lines').textContent = String(player.lines).padStart(3, '0');
    document.getElementById('level').textContent = String(player.level).padStart(2, '0');
  }

  let dropCounter = 0;
  let dropInterval = 800;
  let lastTime = 0;

  function update(time = 0) {
    const deltaTime = time - lastTime;
    lastTime = time;
    dropCounter += deltaTime;
    dropInterval = Math.max(80, 800 - (player.level - 1) * 75);
    if (dropCounter > dropInterval) playerDrop();
    draw();
    requestAnimationFrame(update);
  }

  const arena = createMatrix(10, 20);
  const player = { pos: {x: 0, y: 0}, matrix: null, score: 0, lines: 0, level: 1 };

  document.getElementById('btnLeft').addEventListener('click', () => playerMove(-1));
  document.getElementById('btnRight').addEventListener('click', () => playerMove(1));
  document.getElementById('btnDown').addEventListener('click', () => playerDrop());
  document.getElementById('btnRotate').addEventListener('click', () => playerRotate());

  document.addEventListener('keydown', e => {
    if (e.code === 'ArrowLeft') playerMove(-1);
    else if (e.code === 'ArrowRight') playerMove(1);
    else if (e.code === 'ArrowDown') playerDrop();
    else if (e.code === 'ArrowUp' || e.code === 'Space') playerRotate();
  });

  playerReset();
  updateStats();
  requestAnimationFrame(update);
</script>
</body></html>`;

async function handler(m, { sock }) {
  m.react("🎮");

  try {
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

    m.react("✅");
  } catch (err) {
    console.error("[Tetris]", err);
    m.react("😭");
    m.reply("Gagal membuka game Tetris, coba lagi nanti yak.");
  }
}

export { pluginConfig as config, handler };