/**
 * Recovery gateway.db korup: baca snapshot DB lama (semua tabel readable,
 * hanya autoindex messages rusak), buat DB baru dengan schema identik,
 * salin seluruh data per tabel. Index baru dibangun otomatis saat CREATE.
 *
 * Pakai: node tests/rebuild-db.js <db-sumber> <db-hasil>
 */
import { DatabaseSync } from "node:sqlite";
import fs from "fs";

const srcPath = process.argv[2];
const dstPath = process.argv[3];
if (!srcPath || !dstPath) {
  console.error("Pemakaian: node tests/rebuild-db.js <sumber> <hasil>");
  process.exit(1);
}
if (fs.existsSync(dstPath)) {
  console.error(`File hasil sudah ada, hapus dulu: ${dstPath}`);
  process.exit(1);
}

const src = new DatabaseSync(srcPath);
const dst = new DatabaseSync(dstPath);

// 1. Salin schema (tabel + index; skip internal sqlite_*)
const objects = src
  .prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`)
  .all();
for (const o of objects) {
  dst.exec(o.sql);
  console.log(`schema: ${o.type} ${o.name}`);
}

// 2. Salin data per tabel
const tables = src
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
  .all()
  .map((r) => r.name);

for (const t of tables) {
  const cols = src.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const rows = src.prepare(`SELECT ${colList} FROM "${t}"`).all();
  if (rows.length === 0) {
    console.log(`data: ${t} (0 baris)`);
    continue;
  }
  const placeholders = cols.map(() => "?").join(", ");
  const ins = dst.prepare(`INSERT INTO "${t}" (${colList}) VALUES (${placeholders})`);
  dst.exec("BEGIN");
  try {
    for (const row of rows) ins.run(...cols.map((c) => row[c]));
    dst.exec("COMMIT");
    console.log(`data: ${t} → ${rows.length} baris`);
  } catch (e) {
    dst.exec("ROLLBACK");
    throw new Error(`Gagal salin ${t}: ${e.message}`);
  }
}

// 3. Salin sqlite_sequence agar AUTOINCREMENT tidak mulai dari 1 lagi
try {
  const seqs = src.prepare("SELECT * FROM sqlite_sequence").all();
  for (const s of seqs) {
    dst.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`).run(s.seq, s.name);
  }
  console.log(`sqlite_sequence: ${seqs.length} entri disinkronkan`);
} catch {}

// 4. Verifikasi integritas DB baru
const check = dst.prepare("PRAGMA integrity_check").get();
console.log("integrity_check:", JSON.stringify(check));

src.close();
dst.close();
console.log(`SELESAI → ${dstPath}`);
