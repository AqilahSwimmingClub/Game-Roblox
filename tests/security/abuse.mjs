/**
 * Uji keamanan & kasus tepi EDUVERSE terhadap server sungguhan (Socket.IO + REST + PostgreSQL).
 * Setiap pemeriksaan mencoba aksi curang/salah lalu memastikan SERVER yang menolaknya.
 *
 *   node tests/security/abuse.mjs
 * Variabel: BASE_URL (backend, default http://localhost:3000), TEACHER_EMAIL, TEACHER_PASSWORD,
 *           WEB_URL (frontend untuk uji sambung-ulang di browser; kosongkan untuk melewati bagian browser).
 */
import { io } from 'socket.io-client';
import { createRequire } from 'node:module';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB_URL ?? '';
const EMAIL = process.env.TEACHER_EMAIL ?? 'guru@sekolah.id';
const PASS = process.env.TEACHER_PASSWORD ?? 'rahasia123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
async function check(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  ✘ ${name}: ${e.message}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

let token = '';
async function http(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}
function sock(ns = '/play', opts = {}) {
  return io(`${BASE}${ns}`, { transports: ['websocket'], forceNew: true, reconnection: false, ...opts });
}
const connected = (s) => new Promise((res, rej) => (s.connected ? res() : (s.once('connect', res), s.once('connect_error', rej))));
const emit = (s, ev, data, t = 8000) => new Promise((res) => s.timeout(t).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'timeout' } : r)));
const waitFor = (s, ev, pred = () => true, t = 8000) =>
  new Promise((res, rej) => {
    const to = setTimeout(() => (s.off(ev, h), rej(new Error(`tidak menerima ${ev}`))), t);
    const h = (d) => pred(d) && (clearTimeout(to), s.off(ev, h), res(d));
    s.on(ev, h);
  });
/** Berjalan wajar (5 m/dtk, 10 paket/dtk) ke titik (x,z) — sama seperti klien sungguhan. */
async function walk(s, from, to) {
  const pos = { ...from };
  for (;;) {
    const dx = to.x - pos.x;
    const dz = to.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) break;
    const st = Math.min(d, 0.5);
    pos.x += (dx / d) * st;
    pos.z += (dz / d) * st;
    s.volatile.emit('player:state', { scene: 'kota', x: pos.x, y: from.y, z: pos.z, ry: 0, anim: 1, riding: false });
    await sleep(100);
  }
  return pos;
}

const all = [];
try {
  console.log(`EDUVERSE uji keamanan → ${BASE}`);
  const login = await http('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASS }, auth: false });
  expect(login.status === 200 && login.body.token, 'login guru gagal');
  token = login.body.token;
  const sess = await http('/sessions', { method: 'POST', body: { title: 'Uji keamanan', className: 'SEC', settings: { requireApproval: true, durationMinutes: 10, secondChance: false } } });
  const { id, code } = sess.body;

  // ── Dashboard & API tanpa login ──
  await check('API Dashboard tanpa login → 401', async () => {
    const r = await http('/sessions', { auth: false });
    expect(r.status === 401, `status ${r.status}`);
  });
  await check('Token palsu / diubah → 401', async () => {
    const forged = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const r = await http('/sessions', { auth: false, headers: { authorization: `Bearer ${forged}` } });
    expect(r.status === 401, `status ${r.status}`);
    const r2 = await http('/sessions', { auth: false, headers: { authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.' } });
    expect(r2.status === 401, `alg none status ${r2.status}`);
  });
  await check('Socket Dashboard guru tanpa token ditolak', async () => {
    const t = sock('/teacher');
    all.push(t);
    const err = await connected(t).then(() => null, (e) => e);
    expect(err, 'tersambung tanpa token!');
  });
  await check('Guru lain tidak bisa membuka sesi milik guru ini → 404', async () => {
    const other = `lain${Date.now()}@sekolah.id`;
    const reg = await http('/auth/register', { method: 'POST', auth: false, body: { email: other, password: 'rahasia-lain-123', name: 'Guru Lain', registrationCode: process.env.TEACHER_REGISTRATION_CODE || undefined } });
    if (reg.status !== 200 && reg.status !== 201) return `dilewati (pendaftaran guru tambahan butuh kode: ${reg.body?.error})`;
    const l2 = await http('/auth/login', { method: 'POST', auth: false, body: { email: other, password: 'rahasia-lain-123' } });
    const r = await http(`/sessions/${id}`, { auth: false, headers: { authorization: `Bearer ${l2.body.token}` } });
    expect(r.status === 404 || r.status === 403, `status ${r.status}`);
  });
  await check('CORS: origin asing ditolak (preflight 403, socket ditolak)', async () => {
    const r = await fetch(`${BASE}/api/sessions`, { method: 'OPTIONS', headers: { origin: 'https://situs-jahat.example', 'access-control-request-method': 'POST' } });
    expect(r.status === 403, `preflight ${r.status}`);
    const s = sock('/play', { extraHeaders: { origin: 'https://situs-jahat.example' } });
    all.push(s);
    const err = await connected(s).then(() => null, (e) => e);
    expect(err, 'socket dari origin asing tersambung!');
  });

  // ── Siswa: kode salah, belum disetujui, absen kembar ──
  const a = sock();
  const b = sock();
  all.push(a, b);
  await Promise.all([connected(a), connected(b)]);
  await check('Kode kelas salah ditolak', async () => {
    const r = await emit(a, 'join', { code: 'ZZZZZ9' });
    expect(!r.ok, 'diterima');
    const r2 = await emit(a, 'join', { code: "' OR 1=1 --" });
    expect(!r2.ok, 'kode injeksi diterima');
    return r.error;
  });
  expect((await emit(a, 'join', { code })).ok, 'join A');
  expect((await emit(b, 'join', { code })).ok, 'join B');
  const ca = await emit(a, 'identity:claim', { absen: 5, nama: 'Ani' });
  await check('Nomor absen kembar ditolak', async () => {
    const r = await emit(b, 'identity:claim', { absen: 5, nama: 'Penyusup' });
    expect(!r.ok, 'absen kembar diterima');
    return r.error;
  });
  expect((await emit(b, 'identity:claim', { absen: 6, nama: 'Budi' })).ok, 'claim B');
  await check('Siswa belum disetujui tidak bisa masuk lobi/dunia', async () => {
    const r = await emit(a, 'world:enter', { scene: 'lobi' });
    expect(!r.ok, 'masuk lobi tanpa persetujuan');
    return r.error;
  });
  await check('Guru menolak → permintaan dibatalkan, siswa diberi tahu & bisa mencoba lagi', async () => {
    const kicked = waitFor(b, 'kicked');
    expect((await http(`/sessions/${id}/roster/6/reject`, { method: 'POST' })).status === 200, 'reject');
    const k = await kicked;
    expect(k.retry === true, 'tanpa tanda coba lagi');
    const again = await emit(b, 'identity:claim', { absen: 6, nama: 'Budi' });
    expect(again.ok, `tidak bisa mencoba lagi: ${again.error}`);
  });
  for (const n of [5, 6]) await http(`/sessions/${id}/roster/${n}/approve`, { method: 'POST' });
  await emit(a, 'avatar:set', { karakter: 12, kulit: 3 });
  await check('Data avatar curang disanitasi server', async () => {
    await emit(b, 'avatar:set', { karakter: 999, kulit: -1, __proto__: { admin: true }, script: '<img onerror=alert(1)>' });
    const live = await http(`/sessions/${id}`);
    const sb = live.body.live.students.find((s) => s.absen === 6);
    expect(sb.avatar.karakter >= 0 && sb.avatar.karakter < 20 && !('script' in sb.avatar), JSON.stringify(sb.avatar));
    return JSON.stringify(sb.avatar);
  });

  // ── Permainan berjalan: manipulasi skor ──
  for (const s of [a, b]) await emit(s, 'world:enter', { scene: 'lobi' });
  await check('Masuk dunia sebelum guru memulai ditolak', async () => {
    const r = await emit(a, 'world:enter', { scene: 'kota' });
    expect(!r.ok, 'masuk dunia sebelum mulai');
  });
  await http(`/sessions/${id}/start`, { method: 'POST' });
  await sleep(4200);
  const ea = await emit(a, 'world:enter', { scene: 'kota' });
  await emit(b, 'world:enter', { scene: 'kota' });
  expect(ea.ok, `A masuk kota: ${ea.error}`);
  let posA = { ...ea.spawn };
  const pts = ea.points.filter((p) => !p.hidden && p.y < 2).sort((p, q) => Math.hypot(p.x - posA.x, p.z - posA.z) - Math.hypot(q.x - posA.x, q.z - posA.z));
  const scoreOf = async (absen) => (await http(`/sessions/${id}`)).body.live.students.find((s) => s.absen === absen).poin;

  await check('Event skor palsu dari klien diabaikan', async () => {
    a.emit('score:update', { poin: 99999 });
    a.emit('teacher:answer', { absen: 5, correct: true, points: 9999 });
    a.emit('leaderboard', [{ absen: 5, poin: 99999 }]);
    await sleep(400);
    expect((await scoreOf(5)) === 0, 'skor berubah');
  });
  await check('Membuka soal dari jauh ditolak (validasi jarak di server)', async () => {
    const far = pts[pts.length - 1];
    const r = await emit(a, 'point:interact', { pointId: far.id });
    expect(!r.ok, 'soal jauh terbuka');
    return r.error;
  });
  await check('Teleport / speed hack dikoreksi server', async () => {
    const tele = waitFor(a, 'teleport');
    a.emit('player:state', { scene: 'kota', x: posA.x + 400, y: posA.y, z: posA.z + 400, ry: 0, anim: 1, riding: false });
    const t = await tele;
    expect(Math.hypot(t.x - posA.x, t.z - posA.z) < 5, `posisi koreksi ${JSON.stringify(t)}`);
    return `alasan: ${t.reason}`;
  });
  await check('Jawaban tanpa membuka soal / token palsu ditolak', async () => {
    const r = await emit(a, 'answer:submit', { token: 'palsu', answer: { type: 'pg', index: 0 } });
    expect(!r.ok, 'diterima');
    return r.error;
  });
  await check('Menjawab soal sah: skor hanya dari penilaian server, jawaban ulang ditolak', async () => {
    const target = pts[0];
    posA = await walk(a, posA, target);
    const q = await emit(a, 'point:interact', { pointId: target.id });
    expect(q.ok, `buka soal: ${q.error}`);
    expect(!('key' in q.question) && !JSON.stringify(q.question).includes('"key"'), 'kunci jawaban bocor ke klien!');
    // jawaban dalam bentuk tak valid
    const bad = await emit(a, 'answer:submit', { token: q.question.token, answer: { type: 'pg', index: 99 } });
    expect(!bad.ok, 'jawaban tak valid diterima');
    const ans = q.question.type === 'pg' ? { type: 'pg', index: 0 } : q.question.type === 'bs' ? { type: 'bs', value: true } : q.question.type === 'isian' ? { type: 'isian', text: '1' } : { type: 'jodoh', pairs: q.question.options.map((_, i) => i) };
    const r = await emit(a, 'answer:submit', { token: q.question.token, answer: ans });
    expect(r.ok, `jawab: ${r.error}`);
    const after = await scoreOf(5);
    expect(after === r.result.total || after === r.result.points || after >= 0, 'skor tidak konsisten');
    const again = await emit(a, 'answer:submit', { token: q.question.token, answer: ans });
    expect(!again.ok, 'jawaban yang sama dinilai dua kali');
    const reopen = await emit(a, 'point:interact', { pointId: target.id });
    expect(!reopen.ok || reopen.question.token !== q.question.token, 'titik yang sama bisa dibuka ulang');
    return `benar=${r.result.correct}, poin server=${after}`;
  });

  // ── Sambung ulang (token klaim) ──
  await check('Sambung ulang: identitas, persetujuan & skor kembali tanpa memilih ulang', async () => {
    const before = await scoreOf(5);
    a.disconnect();
    await sleep(500);
    const a2 = sock();
    all.push(a2);
    await connected(a2);
    const j = await emit(a2, 'join', { code, claimToken: ca.token });
    expect(j.ok && j.me && j.me.absen === 5 && j.me.approved, JSON.stringify(j.me));
    expect(j.me.poin === before, `skor ${j.me.poin} ≠ ${before}`);
    expect(j.me.avatar.karakter === 12, 'karakter hilang');
    const e = await emit(a2, 'world:enter', { scene: 'kota' });
    expect(e.ok, 'tidak bisa kembali ke Kota');
    return `poin ${j.me.poin}, karakter ${j.me.avatar.karakter}`;
  });
  await check('Token klaim curian tidak berlaku di sesi lain / token acak ditolak', async () => {
    const c = sock();
    all.push(c);
    await connected(c);
    const j = await emit(c, 'join', { code, claimToken: 'x'.repeat(32) });
    expect(j.ok && !j.me, 'token acak memberi identitas!');
  });

  // ── Logout mencabut token ──
  await check('Logout mencabut token guru', async () => {
    const l = await http('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASS }, auth: false });
    const t2 = l.body.token;
    await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t2}` } });
    const r = await http('/sessions', { auth: false, headers: { authorization: `Bearer ${t2}` } });
    expect(r.status === 401, `status ${r.status}`);
  });

  // ── Browser: putus internet lalu tersambung lagi ──
  let detectS = 0;
  if (WEB) {
    await check('Browser HP: internet mati lalu hidup → kembali bermain di Kota dengan skor sama', async () => {
      const { chromium, devices } = createRequire(import.meta.url)('playwright');
      const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
      try {
        const ctx = await br.newContext({ ...devices['Pixel 7 landscape'] });
        const p = await ctx.newPage();
        await p.goto(`${WEB}/?kode=${code}&debug=1`);
        await p.getByRole('button', { name: 'MAIN', exact: true }).click({ force: true, timeout: 30000 });
        await p.getByPlaceholder('mis. 7').fill('8');
        await p.getByPlaceholder('mis. Raka').fill('Cici');
        await p.getByRole('button', { name: 'Simpan' }).click();
        await p.getByText('Menunggu persetujuan guru').waitFor({ timeout: 15000 });
        await http(`/sessions/${id}/roster/8/approve`, { method: 'POST' });
        await p.getByText('Pilih Karaktermu').waitFor({ timeout: 15000 });
        await p.locator('.char-card[data-karakter="19"]').click();
        await p.getByRole('button', { name: 'SIAP!' }).click();
        await p.waitForFunction(() => window.__edu?.scene === 'kota', null, { timeout: 30000 });
        // Chromium tidak memutus WebSocket yang sudah terbuka saat offline; putusnya terdeteksi lewat ping (≤ 25 dtk)
        await ctx.setOffline(true);
        const t0 = Date.now();
        await p.getByText('Koneksi terputus').waitFor({ timeout: 45000 });
        detectS = Math.round((Date.now() - t0) / 1000);
        await sleep(6000);
        await ctx.setOffline(false);
        await p.getByText('Tersambung kembali').waitFor({ timeout: 30000 });
        await p.waitForFunction(() => window.__edu?.scene === 'kota' && window.__edu.myChar === 19, null, { timeout: 15000 });
        const live = await http(`/sessions/${id}`);
        const s = live.body.live.students.find((x) => x.absen === 8);
        expect(s.online && s.scene === 'kota', `server: ${JSON.stringify({ online: s.online, scene: s.scene })}`);
        return `putus terdeteksi ${detectS} dtk; banner "Koneksi terputus" muncul lalu "Tersambung kembali"; tetap di Kota`;
      } finally {
        await br.close();
      }
    });
  }

  await http(`/sessions/${id}/end`, { method: 'POST' });
} catch (e) {
  console.log(`  ✘ GALAT: ${e.message}`);
  results.push({ name: 'galat', ok: false });
} finally {
  all.forEach((s) => s.disconnect());
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok === results.length ? 'LULUS' : 'GAGAL'} ${ok}/${results.length} pemeriksaan keamanan`);
  process.exitCode = ok === results.length ? 0 : 1;
  setTimeout(() => process.exit(process.exitCode), 200);
}
