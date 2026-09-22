import fs from "fs/promises";

const store = new Map();
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 menit

export function registerAudioJob(jobId, filePath, meta = {}, ttlMs = DEFAULT_TTL_MS) {
  const timeout = setTimeout(() => cleanupJob(jobId), ttlMs);
  store.set(jobId, { filePath, meta, timeout });
}

export function claimAudioJob(jobId) {
  const entry = store.get(jobId);
  if (!entry) return null;
  clearTimeout(entry.timeout);
  store.delete(jobId);
  return entry;
}

export function peekAudioJob(jobId) {
  return store.get(jobId) || null;
}

async function cleanupJob(jobId) {
  const entry = store.get(jobId);
  if (!entry) return;
  store.delete(jobId);
  try {
    await fs.unlink(entry.filePath);
  } catch {}
}