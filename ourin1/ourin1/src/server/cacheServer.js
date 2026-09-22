import express from "express";
import fs from "fs";
import { peekAudioJob } from "../../src/lib/audioCache.js";

const app = express();

app.get("/cache/audio/:jobId.mp3", (req, res) => {
  const job = peekAudioJob(req.params.jobId);
  if (!job) return res.status(404).send("Not found or expired");

  fs.stat(job.filePath, (err, stat) => {
    if (err) return res.status(404).send("File not found");
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Accept-Ranges", "bytes");
    fs.createReadStream(job.filePath).pipe(res);
  });
});

export function startCacheServer(port = 3939) {
  app.listen(port, () => {
    console.log(`[CacheServer] Jalan di port ${port}`);
  });
}