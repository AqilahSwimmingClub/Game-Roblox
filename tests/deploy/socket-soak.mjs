/**
 * Uji ketahanan koneksi backend publik (dijalankan GitHub Actions — internet terbuka).
 * Mengumpulkan BUKTI penyebab "Koneksi terputus", bukan menebak:
 *  1. /api/health (waktu respons, cold start).
 *  2. Handshake Socket.IO (polling) dari tiap origin frontend Vercel → status HTTP & header CORS.
 *  3. WebSocket dibiarkan tersambung selama DURATION detik dengan Origin frontend; mencatat setiap putus
 *     beserta alasannya (transport close / ping timeout / io server disconnect), latensi ping, dan sambung ulang.
 *   BACKEND_URL=https://… ORIGINS=https://a.vercel.app,https://b.vercel.app DURATION=180 node tests/deploy/socket-soak.mjs
 * Hanya melaporkan (exit 0) — hasilnya ditulis ke ringkasan job & socket-soak.json.
 */
import fs from 'node:fs';
import { io } from 'socket.io-client';

const BACKEND = (process.env.BACKEND_URL ?? 'https://eduverse-aqilah-api-production.up.railway.app').replace(/\/$/, '');
const ORIGINS = (process.env.ORIGINS ?? 'https://eduverse-web-preview.vercel.app').split(',').map((s) => s.trim()).filter(Boolean);
const DURATION = Number(process.env.DURATION ?? 180) * 1000;
const out = { backend: BACKEND, at: new Date().toISOString(), health: null, cors: [], soak: [] };
const lines = [];
const log = (s) => {
  console.log(s);
  lines.push(s);
};

const t0 = Date.now();
try {
  const r = await fetch(`${BACKEND}/api/health`, { signal: AbortSignal.timeout(30000) });
  out.health = { status: r.status, ms: Date.now() - t0, body: (await r.text()).slice(0, 200) };
} catch (e) {
  out.health = { status: 0, ms: Date.now() - t0, error: String(e?.cause?.code ?? e?.message ?? e) };
}
log(`- /api/health → ${out.health.status} dalam ${out.health.ms} ms ${out.health.error ?? out.health.body ?? ''}`);

for (const origin of ORIGINS) {
  try {
    const r = await fetch(`${BACKEND}/socket.io/?EIO=4&transport=polling`, { headers: { origin }, signal: AbortSignal.timeout(20000) });
    const acao = r.headers.get('access-control-allow-origin');
    out.cors.push({ origin, status: r.status, acao });
    log(`- handshake dari ${origin} → HTTP ${r.status}, Access-Control-Allow-Origin: ${acao ?? '(tidak ada → browser MENOLAK)'}`);
  } catch (e) {
    out.cors.push({ origin, status: 0, error: String(e?.message ?? e) });
    log(`- handshake dari ${origin} → gagal: ${e?.message ?? e}`);
  }
}

async function soak(origin) {
  const ev = { origin, connects: 0, disconnects: [], errors: [], pings: [], firstConnectMs: null, transport: null };
  const started = Date.now();
  const s = io(`${BACKEND}/play`, { transports: ['websocket', 'polling'], extraHeaders: { origin }, reconnectionDelay: 800, reconnectionDelayMax: 5000, timeout: 20000 });
  s.on('connect', () => {
    ev.connects++;
    ev.firstConnectMs ??= Date.now() - started;
    ev.transport = s.io.engine.transport.name;
    s.io.engine.on('upgrade', (t) => (ev.transport = t.name));
  });
  s.on('disconnect', (reason) => ev.disconnects.push({ t: Math.round((Date.now() - started) / 1000), reason }));
  s.on('connect_error', (e) => ev.errors.length < 5 && ev.errors.push(e.message));
  s.io.on('ping', () => ev.pings.push(Date.now() - started));
  // ping aplikasi: ukur RTT nyata lewat ack (join dengan kode palsu → server menjawab galat, tetap mengukur jalur penuh)
  const rtts = [];
  const timer = setInterval(() => {
    if (!s.connected) return;
    const a = Date.now();
    s.timeout(8000).emit('join', { code: 'ZZZZZZ' }, () => rtts.push(Date.now() - a));
  }, 5000);
  await new Promise((r) => setTimeout(r, DURATION));
  clearInterval(timer);
  s.disconnect();
  ev.rtt = rtts.length ? { n: rtts.length, median: rtts.sort((a, b) => a - b)[Math.floor(rtts.length / 2)], max: Math.max(...rtts) } : null;
  const gaps = ev.pings.slice(1).map((p, i) => p - ev.pings[i]);
  ev.pingGapMaxMs = gaps.length ? Math.max(...gaps) : null;
  ev.pings = ev.pings.length;
  return ev;
}

log(`\nMenahan koneksi WebSocket ${DURATION / 1000} detik…`);
out.soak = await Promise.all(ORIGINS.map(soak));
for (const e of out.soak)
  log(
    `- ${e.origin}: tersambung ${e.connects}× (pertama ${e.firstConnectMs ?? '—'} ms, transport ${e.transport ?? '—'}), putus ${e.disconnects.length}× ${e.disconnects.map((d) => `[${d.t}s ${d.reason}]`).join(' ')}` +
      `, ping server ${e.pings}× (jeda maks ${e.pingGapMaxMs ?? '—'} ms), RTT ${e.rtt ? `median ${e.rtt.median} ms / maks ${e.rtt.max} ms` : '—'}${e.errors.length ? `, galat: ${e.errors.join(' | ')}` : ''}`,
  );

fs.writeFileSync('socket-soak.json', JSON.stringify(out, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['## Ketahanan koneksi backend', '', `Backend: ${BACKEND}`, '', ...lines, ''].join('\n') + '\n');
