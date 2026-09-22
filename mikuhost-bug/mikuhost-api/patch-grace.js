// Patch bug @mikudeveloper/grace: variabel `gradient` tidak didefinisi
const fs = require('fs');
const p = 'node_modules/@mikudeveloper/grace/lib/index.js';
try {
  let c = fs.readFileSync(p, 'utf8');
  if (!c.includes('const gradient =')) {
    fs.writeFileSync(p, "const gradient = (txt) => String(txt);\n" + c);
    console.log('[patch-grace] patched');
  }
} catch (e) { console.error('[patch-grace] skip:', e.message); }
