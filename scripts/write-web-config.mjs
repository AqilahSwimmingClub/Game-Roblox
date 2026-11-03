/**
 * Tulis alamat backend ke apps/game/dist/eduverse-config.js (dibaca game di "/" dan Dashboard di "/guru/").
 * Dipakai saat frontend di-host terpisah dari backend (Vercel ↔ Render).
 *   EDUVERSE_SERVER_URL=https://nama-layanan.onrender.com node scripts/write-web-config.mjs
 * Tanpa variabel: memakai DEFAULT_SERVER di bawah (alamat layanan dari render.yaml).
 */
import fs from 'node:fs';

const DEFAULT_SERVER = 'https://eduverse-aqilah-api.onrender.com';
const raw = (process.env.EDUVERSE_SERVER_URL ?? DEFAULT_SERVER).trim().replace(/\/+$/, '');
if (raw && !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(raw)) {
  console.error(`EDUVERSE_SERVER_URL tidak valid: "${raw}" (contoh: https://eduverse-aqilah-api.onrender.com)`);
  process.exit(1);
}
const out = new URL('../apps/game/dist/eduverse-config.js', import.meta.url);
fs.writeFileSync(out, `// Dibuat otomatis saat build. Alamat server EDUVERSE (API + Socket.IO).\nwindow.EDUVERSE_CONFIG = ${JSON.stringify({ server: raw })};\n`);
console.log(`[eduverse] server frontend → ${raw || '(origin yang sama)'}`);
