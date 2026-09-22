import os from "os";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/* ==========================================================================
   CPU
   Sebelumnya pakai os.loadavg()[0] / cpus().length * 100 — di Linux
   load average gampang lebih besar dari jumlah core kalau ada proses
   yang antre, jadi kepotong Math.min(100, ...) dan keliatan "nempel"
   terus di 100%. Ini ukur delta idle/total antar 2 snapshot os.cpus(),
   cara standar buat CPU% yang akurat tanpa dependency tambahan.
   ========================================================================== */
function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  }
  return { idle: idle / cpus.length, total: total / cpus.length };
}

function getCpuUsagePercent(sampleMs = 200) {
  return new Promise((resolve) => {
    const start = cpuSnapshot();
    setTimeout(() => {
      const end = cpuSnapshot();
      const idleDiff = end.idle - start.idle;
      const totalDiff = end.total - start.total;
      const pct = totalDiff > 0 ? 100 - (100 * idleDiff) / totalDiff : 0;
      resolve(Math.max(0, Math.min(100, Math.round(pct))));
    }, sampleMs);
  });
}

/* ==========================================================================
   RAM
   systemPct = RAM terpakai seluruh sistem (semua proses).
   processPct = RAM yang dipakai proses bot ini sendiri terhadap total RAM
   server, sesuai yang diminta: process.memoryUsage() + os.totalmem().
   ========================================================================== */
function getRamUsage() {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    processPct: Math.round((mem.rss / totalMem) * 100),
    processRssMb: Math.round(mem.rss / 1024 / 1024),
    systemPct: Math.round(((totalMem - freeMem) / totalMem) * 100),
    totalMb: Math.round(totalMem / 1024 / 1024),
  };
}

/* ==========================================================================
   Disk (root filesystem)
   Coba 3 cara berurutan, apa pun yang tersedia di environment-nya.
   ========================================================================== */
async function getDiskUsage() {
  try {
    if (typeof fs.promises.statfs === "function") {
      const stat = await fs.promises.statfs("/");
      const total = stat.blocks * stat.bsize;
      const free = stat.bfree * stat.bsize;
      if (total > 0) {
        return {
          pct: Math.round(((total - free) / total) * 100),
          totalGb: +(total / 1024 ** 3).toFixed(1),
        };
      }
    }
  } catch { }

  try {
    const { stdout } = await execAsync("df -k /");
    const line = stdout.trim().split("\n")[1];
    const parts = line.split(/\s+/);
    const totalKb = Number(parts[1]);
    const usedKb = Number(parts[2]);
    if (totalKb > 0) {
      return {
        pct: Math.round((usedKb / totalKb) * 100),
        totalGb: +(totalKb / 1024 / 1024).toFixed(1),
      };
    }
  } catch { }

  try {
    const si = await import("systeminformation");
    const [fsSize] = await si.fsSize();
    if (fsSize?.size) {
      return { pct: Math.round(fsSize.use), totalGb: +(fsSize.size / 1024 ** 3).toFixed(1) };
    }
  } catch { }

  return { pct: 0, totalGb: 0 };
}

/* ==========================================================================
   History buat chart — disimpan di memori proses (bukan file), cukup
   buat grafik beberapa jam terakhir. Reset kalau proses restart, itu
   gak masalah untuk kebutuhan monitoring realtime.
   ========================================================================== */
const MAX_POINTS = 60; // 60 titik * sampling 2 menit = 2 jam terakhir
const history = {
  cpu: [],
  ram: [],
  botActiveByHour: new Map(),
  newUsersByDay: new Map(),
};

function pushSample(cpuPct, ramPct) {
  const t = Date.now();
  history.cpu.push({ t, v: cpuPct });
  history.ram.push({ t, v: ramPct });
  if (history.cpu.length > MAX_POINTS) history.cpu.shift();
  if (history.ram.length > MAX_POINTS) history.ram.shift();
}

let sampler = null;
function startSystemSampler(intervalMs = 120000) {
  if (sampler) return;
  const tick = async () => {
    try {
      const cpu = await getCpuUsagePercent();
      const ram = getRamUsage();
      pushSample(cpu, ram.systemPct);
    } catch { }
  };
  tick();
  sampler = setInterval(tick, intervalMs);
}

function recordBotActive() {
  const hourKey = new Date().toISOString().slice(0, 13); // yyyy-mm-ddThh
  history.botActiveByHour.set(hourKey, (history.botActiveByHour.get(hourKey) || 0) + 1);
  const cutoff = Date.now() - 48 * 3600 * 1000;
  for (const key of history.botActiveByHour.keys()) {
    const t = new Date(key + ":00:00Z").getTime();
    if (t < cutoff) history.botActiveByHour.delete(key);
  }
}

function recordNewUser() {
  const dayKey = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  history.newUsersByDay.set(dayKey, (history.newUsersByDay.get(dayKey) || 0) + 1);
}

function getHistory() {
  return {
    cpu: history.cpu,
    ram: history.ram,
    botActiveByHour: Array.from(history.botActiveByHour.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([hour, count]) => ({ hour, count })),
    newUsersByDay: Array.from(history.newUsersByDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ day, count })),
  };
}

export {
  getCpuUsagePercent,
  getRamUsage,
  getDiskUsage,
  startSystemSampler,
  recordBotActive,
  recordNewUser,
  getHistory,
};