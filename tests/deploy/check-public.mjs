/**
 * Uji alamat publik EDUVERSE (dijalankan GitHub Actions — punya akses internet terbuka).
 *   WEB_URL=https://eduverse-web-preview.vercel.app node tests/deploy/check-public.mjs
 * Frontend wajib hidup (gagal = exit 1). Backend: dicek dari eduverse-config.js; bila belum aktif → peringatan.
 */
import fs from 'node:fs';

const WEB = (process.env.WEB_URL ?? 'https://eduverse-web-preview.vercel.app').replace(/\/$/, '');
const out = { web: WEB, at: new Date().toISOString(), checks: [] };
const summary = [];
const add = (name, ok, detail, level = ok ? 'ok' : 'gagal') => {
  out.checks.push({ name, ok, detail, level });
  const icon = level === 'ok' ? '✅' : level === 'peringatan' ? '⚠️' : '❌';
  summary.push(`| ${icon} | ${name} | ${String(detail).replace(/\|/g, '/')} |`);
  console.log(`${icon} ${name} — ${detail}`);
};

async function get(url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(opts.timeout ?? 20000) });
    const body = await r.text();
    return { status: r.status, body, ms: Date.now() - t0, headers: r.headers };
  } catch (e) {
    return { status: 0, body: String(e?.cause?.code ?? e?.message ?? e), ms: Date.now() - t0 };
  }
}

let webOk = true;
for (const [path, must] of [
  ['/', 'EDUVERSE'],
  ['/demo.html', 'Demo'],
  ['/guru/', '<div'],
]) {
  const r = await get(WEB + path);
  const ok = r.status === 200 && r.body.includes(must);
  if (!ok) webOk = false;
  add(`Frontend ${path}`, ok, r.status === 401 || r.status === 403 ? `HTTP ${r.status} — dilindungi (Vercel Deployment Protection)` : `HTTP ${r.status} · ${r.ms} ms`);
}

// Alamat backend yang dipakai frontend
const cfg = await get(WEB + '/eduverse-config.js');
const m = cfg.body.match(/https?:\/\/[^"'\s]+/);
const server = m ? m[0].replace(/\/$/, '') : '';
add('eduverse-config.js', cfg.status === 200 && !!server, cfg.status === 200 ? `backend = ${server || '(kosong: satu domain)'}` : `HTTP ${cfg.status}`);
if (cfg.status !== 200) webOk = false;

let backendOk = false;
if (server) {
  // Render Free bisa tertidur: coba sampai ±90 dtk agar sempat bangun
  let h = { status: 0, body: '' };
  for (let i = 0; i < 6; i++) {
    h = await get(server + '/api/health', { timeout: 25000 });
    if (h.status === 200) break;
    await new Promise((r) => setTimeout(r, 10000));
  }
  backendOk = h.status === 200 && h.body.includes('"ok":true');
  add('Backend /api/health', backendOk, backendOk ? `HTTP 200 · ${h.ms} ms` : `belum aktif (HTTP ${h.status} ${String(h.body).slice(0, 80)}) — pemilik akun perlu membuat layanan backend (docs/DEPLOYMENT.md)`, backendOk ? 'ok' : 'peringatan');
  if (backendOk) {
    // Socket.IO handshake (polling) dari origin frontend → CORS & WebSocket server aktif
    const s = await get(`${server}/socket.io/?EIO=4&transport=polling`);
    const sio = s.status === 200 && s.body.includes('sid');
    add('Backend Socket.IO handshake', sio, `HTTP ${s.status}`, sio ? 'ok' : 'gagal');
    if (!sio) backendOk = false;
  }
}

fs.writeFileSync('deploy-check.json', JSON.stringify(out, null, 2));
const md = ['## Uji Deployment Publik', '', `Frontend: ${WEB}`, '', '| | Pemeriksaan | Hasil |', '|---|---|---|', ...summary, ''];
if (!backendOk) md.push('> ⚠️ **Backend publik belum aktif** — mode kelas (kode kelas, Dashboard Guru, multipemain) belum bisa dipakai lewat internet. Mode Demo tetap jalan. Lihat `docs/DEPLOYMENT.md`.');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `web_ok=${webOk}\nbackend_ok=${backendOk}\n`);
if (!backendOk) console.log('::warning::Backend publik belum aktif — mode kelas belum bisa dipakai lewat internet (lihat docs/DEPLOYMENT.md)');
process.exitCode = webOk ? 0 : 1;
