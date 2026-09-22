// Generate launcher icon MikuWA dari icon custom user: wa-client/android/icon-src.jpg
// Hasil unduhan https://u.pone.rs/fxqkftoy.jpg — di-resize ke semua density mipmap.
// Pakai sharp dari node_modules bot (jalankan dari root project bot).
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(path.join(process.cwd(), "package.json"));
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SIZES = {
  mdpi: 48,
  hdpi: 72,
  ldpi: 48,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const src = path.join(__dirname, "icon-src.jpg");
const sharp = require("sharp");

const resDir = path.join(__dirname, "app", "src", "main", "res");

for (const [density, size] of Object.entries(SIZES)) {
  const dir = path.join(resDir, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });
  const buf = await sharp(src)
    .resize(size, size, { fit: "cover" })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(dir, "ic_launcher.png"), buf);
  fs.writeFileSync(path.join(dir, "ic_launcher_round.png"), buf);
  console.log(`OK mipmap-${density}: ${size}x${size}`);
}
console.log("Icon launcher MikuWA selesai digenerate dari icon-src.jpg.");
