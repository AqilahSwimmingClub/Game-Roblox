/**
 * Uji ujung-ke-ujung EMPAT DUNIA EDUVERSE: 1 guru + 3 siswa.
 *  - Siswa A (browser HP sungguhan, Playwright): Lobi → portal Dunia Hutan → menjawab soal guru (dinilai server)
 *    → Gerbang Antardunia → Dunia Laut (menyelam: oksigen berkurang, perahu di air) → Menu → Lobi → Luar Angkasa
 *    (gravitasi rendah: lompatan lebih tinggi) → menjawab soal. Skor, identitas, dan tas tetap sama di semua dunia.
 *  - Siswa B & C (klien Socket.IO): masuk Dunia Laut dan Dunia Luar Angkasa, saling terlihat dengan siswa A,
 *    server menolak gerakan curang di dunia baru.
 *  - Guru: Dashboard menampilkan peta sebaran per dunia; hasil sesi mencatat jawaban per dunia.
 *   BASE_URL, WEB_URL, TEACHER_EMAIL, TEACHER_PASSWORD, SHOTS
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const shared = await import('../../packages/shared/dist/index.js');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB_URL ?? BASE;
const EMAIL = process.env.TEACHER_EMAIL ?? 'guru@sekolah.id';
const PASS = process.env.TEACHER_PASSWORD ?? 'rahasia123';
const SHOTS = process.env.SHOTS ?? '';
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const v = await fn();
    results.push({ ok: true });
    console.log(`  ✔ ${name} (${Date.now() - t0} ms)${typeof v === 'string' ? ` — ${v}` : ''}`);
    return v;
  } catch (e) {
    results.push({ ok: false });
    console.log(`  ✘ ${name}: ${String(e.message).split('\n')[0]}`);
    throw e;
  }
};
const shot = async (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png` });
let token = '';
const api = async (path, method = 'GET', body) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const emit = (s, ev, data, t = 8000) => new Promise((res) => s.timeout(t).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'timeout' } : r)));

/** Siswa socket: bergabung, klaim identitas, masuk dunia. */
async function socketStudent(code, absen, nama, world) {
  const s = io(`${BASE}/play`, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise((r) => s.once('connect', r));
  const j = await emit(s, 'join', { code });
  if (!j.ok) throw new Error(`join ${j.error}`);
  const c = await emit(s, 'identity:claim', { absen, nama });
  if (!c.ok) throw new Error(`claim ${c.error}`);
  const e = await emit(s, 'world:enter', { scene: world });
  if (!e.ok) throw new Error(`enter ${world}: ${e.error}`);
  const st = { s, pos: { ...e.spawn }, world, enter: e };
  // kirim posisi berkala (seperti klien sungguhan) agar terlihat oleh pemain lain
  st.timer = setInterval(() => s.volatile.emit('player:state', { scene: world, x: st.pos.x, y: st.pos.y, z: st.pos.z, ry: 0, anim: 0, riding: false }), 200);
  return st;
}

let browsers = [];
const sockets = [];
try {
  console.log(`EDUVERSE uji 4 dunia → frontend ${WEB} · backend ${BASE}`);
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) }).then((r) => r.json());
  token = login.token;
  if (!token) throw new Error('login guru gagal (jalankan tests/setup-teacher.mjs)');

  const sess = await step('Guru membuat sesi dengan 4 dunia aktif (sumber: Hanya Soal Guru) lalu memulai', async () => {
    const r = await api('/sessions', 'POST', { title: 'Jelajah 4 Dunia', className: '5C', settings: { worlds: ['kota', 'hutan', 'laut', 'angkasa'], requireApproval: false, durationMinutes: 30, questionSource: 'guru', secondChance: false } });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    await api(`/sessions/${r.body.id}/start`, 'POST');
    for (let i = 0; i < 40 && (await api(`/sessions/${r.body.id}`)).body.live.state.status !== 'berjalan'; i++) await sleep(250);
    return r.body;
  });

  // ── Siswa A: browser HP ──
  const browser = await chromium.launch({ args: GL });
  browsers.push(browser);
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const edu = () => page.evaluate(() => window.__edu);
  const goTo = async (x, z, until = null, ms = 90000) => {
    await page.evaluate(({ x, z }) => window.__eduDebug.goTo(x, z), { x, z });
    await page.waitForFunction((u) => !window.__eduDebug.walking() || (u && window.__edu.prompt === u), until, { timeout: ms }).catch(() => undefined);
    await page.evaluate(() => window.__eduDebug.stop());
  };
  const answerNearest = async (label) => {
    const pts = await page.evaluate(() => window.__eduDebug.openPoints());
    const me = (await edu()).pos;
    const cand = pts.filter((p) => Math.abs(p.y - me.y) < 1.5).sort((p, q) => Math.hypot(p.x - me.x, p.z - me.z) - Math.hypot(q.x - me.x, q.z - me.z));
    for (const p of cand.slice(0, 5)) {
      await goTo(p.x, p.z, 'soal');
      if ((await edu()).prompt === 'soal') {
        await page.evaluate(() => window.__eduDebug.action());
        await page.getByRole('button', { name: 'JAWAB' }).waitFor({ timeout: 10000 });
        await shot(page, `w-${label}-soal`);
        if (await page.locator('.opsi button').count()) await page.locator('.opsi button:not([disabled])').first().click();
        else if (await page.locator('.jodoh select').count()) for (const s of await page.locator('.jodoh select').all()) await s.selectOption({ index: 1 });
        else await page.locator('input.field').fill('1');
        await page.getByRole('button', { name: 'JAWAB' }).click();
        await page.getByRole('button', { name: 'LANJUT JELAJAH' }).waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'LANJUT JELAJAH' }).click();
        return p.id;
      }
    }
    throw new Error(`tidak bisa mencapai titik soal di ${label}`);
  };

  await step('Siswa A masuk lewat kode kelas, memilih karakter → Lobi', async () => {
    await page.goto(`${WEB}/?kode=${sess.code}&debug=1`);
    await page.getByRole('button', { name: 'MAIN', exact: true }).click({ force: true, timeout: 30000 });
    await page.getByText('Kamu yang mana?').waitFor({ timeout: 20000 });
    await page.getByPlaceholder('mis. 7').fill('3');
    await page.getByPlaceholder('mis. Raka').fill('Ayu');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await page.getByText('Pilih Karaktermu').waitFor({ timeout: 20000 });
    await page.locator('.char-card[data-karakter="6"]').click();
    await page.getByRole('button', { name: 'SIAP!' }).click();
    await page.waitForFunction(() => window.__edu?.scene === 'lobi', null, { timeout: 30000 });
  });

  await step('Lobi: keempat portal dunia aktif → PILIH DUNIA → Dunia Hutan', async () => {
    await page.getByRole('button', { name: 'PILIH DUNIA' }).click();
    for (const n of ['Dunia Kota', 'Dunia Hutan', 'Dunia Laut', 'Dunia Luar Angkasa']) {
      const card = page.locator('button.opt', { hasText: n });
      if (!(await card.textContent()).includes('Ketuk untuk masuk')) throw new Error(`${n} tidak aktif`);
    }
    await shot(page, 'w0-pilih-dunia');
    await page.locator('button.opt', { hasText: 'Dunia Hutan' }).click();
    await page.waitForFunction(() => window.__edu?.scene === 'hutan', null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot(page, 'w1-hutan');
    const e = await edu();
    if (e.env.sky !== shared.WORLD_ENV.hutan.sky) throw new Error(`langit hutan ${e.env.sky}`);
    return `spawn (${e.pos.x.toFixed(0)}, ${e.pos.z.toFixed(0)}) · ${e.points} titik soal aktif`;
  });

  const scoreStart = (await edu()).score;
  await step('Dunia Hutan: siswa menjawab soal guru (dinilai server)', async () => {
    const id = await answerNearest('hutan');
    const r = await api(`/sessions/${sess.id}/results`);
    if (!(r.body.perWorld?.hutan >= 1)) throw new Error(JSON.stringify(r.body.perWorld));
    return `titik ${id} · jawaban tercatat di dunia hutan`;
  });

  // ── Siswa B & C ──
  const B = await socketStudent(sess.code, 8, 'Bima', 'laut');
  const C = await socketStudent(sess.code, 9, 'Citra', 'angkasa');
  sockets.push(B, C);

  await step('Gerbang Antardunia Hutan → Dunia Laut (skor & identitas tetap)', async () => {
    const gate = shared.worldLayout('hutan').living.rifts.find((r) => r.id === 'RH_DUNIA');
    await page.evaluate(({ x, z }) => window.__eduDebug.goTo(x, z), gate);
    await page.locator('[data-gate="laut"]').waitFor({ timeout: 60000 });
    await page.evaluate(() => window.__eduDebug.stop());
    await shot(page, 'w2-gerbang');
    if (await page.locator('[data-gate="hutan"]').isEnabled()) throw new Error('dunia saat ini tidak boleh dipilih');
    const before = (await edu()).score;
    await page.locator('[data-gate="laut"]').click();
    await page.waitForFunction(() => window.__edu?.scene === 'laut', null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    await shot(page, 'w3-laut');
    const after = (await edu()).score;
    if (after !== before) throw new Error(`skor berubah ${before} → ${after}`);
    return `skor tetap ${after}`;
  });

  await step('Dunia Laut: siswa A melihat Bima (siswa B) di dunia yang sama', async () => {
    B.pos = { x: 3, y: 1.2, z: -10 };
    await page.waitForFunction(() => window.__edu.remoteChars.some((r) => r.nama === 'Bima'), null, { timeout: 20000 });
  });

  await step('Dunia Laut: naik perahu dari dermaga dan berlayar (hanya di air)', async () => {
    await goTo(0, -48);
    await goTo(0, -56, 'kendaraan', 40000);
    const pr = (await edu()).prompt;
    if (pr !== 'kendaraan') {
      const e = await edu();
      await shot(page, 'w4-gagal');
      throw new Error(`prompt ${pr} · pos ${JSON.stringify(e.pos)} · kendaraan ${JSON.stringify(e.vehicles.slice(0, 6))}`);
    }
    await page.evaluate(() => window.__eduDebug.action());
    await page.waitForFunction(() => window.__edu.mobility?.mode === 'perahu', null, { timeout: 10000 }).catch(async () => {
      const e = await edu();
      throw new Error(`tidak naik perahu: ${JSON.stringify({ pos: e.pos, m: e.mobility?.mode, p: e.mobility?.prompt, id: e.mobility?.promptId, note: await page.locator('.notif, .toast, .notify').allTextContents().catch(() => []) })}`);
    });
    const p0 = (await edu()).pos;
    await page.evaluate(() => window.__eduDebug.control({ gas: true }));
    await page.waitForTimeout(1500);
    console.log('    saat gas:', JSON.stringify((await edu()).mobility.vehicle));
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__eduDebug.control({ gas: false, brake: true }));
    await page.waitForTimeout(800);
    await shot(page, 'w4-perahu');
    const p1 = (await edu()).pos;
    const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (d < 6) throw new Error(`perahu hanya bergerak ${d.toFixed(1)} m · ${JSON.stringify((await edu()).mobility)}`);
    if (Math.abs(p1.y) > 0.3) throw new Error(`perahu tidak di permukaan air (y=${p1.y})`);
    await page.evaluate(() => window.__eduDebug.control({ brake: false }));
    await page.evaluate(() => window.__eduDebug.exitVehicle()); // turun di laut → tercebur & berenang
    await page.waitForFunction(() => window.__edu.mobility?.mode === 'jalan', null, { timeout: 10000 });
    return `berlayar ${d.toFixed(0)} m di permukaan`;
  });

  await step('Dunia Laut: menyelam → oksigen berkurang & meteran tampil, lalu naik lagi', async () => {
    await page.waitForFunction(() => window.__edu.env.swimming, null, { timeout: 10000 });
    await page.evaluate(() => window.__eduDebug.hold({ dive: true }));
    await page.waitForFunction(() => window.__edu.env.submerged >= 0.98, null, { timeout: 15000 });
    await page.waitForTimeout(3000);
    const e = (await edu()).env;
    await shot(page, 'w5-menyelam');
    await page.evaluate(() => window.__eduDebug.hold({ dive: false }));
    if (!(e.oxygen < shared.OXYGEN_SECONDS - 2) || e.oxygenBar === null) throw new Error(JSON.stringify(e));
    await page.waitForFunction(() => window.__edu.env.submerged < 0.98, null, { timeout: 15000 });
    return `oksigen ${e.oxygen.toFixed(1)}/${shared.OXYGEN_SECONDS} dtk saat di bawah air`;
  });

  await step('Menu → Keluar ke Lobi → Luar Angkasa (tas & skor terbawa)', async () => {
    const before = await edu();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Keluar ke Lobi' }).click();
    await page.getByRole('button', { name: 'Yakin keluar? Tekan lagi' }).click();
    await page.waitForFunction(() => window.__edu?.scene === 'lobi', null, { timeout: 20000 });
    await page.getByRole('button', { name: 'PILIH DUNIA' }).click();
    await page.locator('button.opt', { hasText: 'Dunia Luar Angkasa' }).click();
    await page.waitForFunction(() => window.__edu?.scene === 'angkasa', null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot(page, 'w6-angkasa');
    const e = await edu();
    if (e.score !== before.score) throw new Error('skor berubah');
    if (!e.env.lowGravity) throw new Error('gravitasi rendah tidak aktif');
    if (e.env.sky !== shared.WORLD_ENV.angkasa.sky) throw new Error('langit angkasa salah');
  });

  await step('Luar Angkasa: lompatan gravitasi rendah jauh lebih tinggi daripada di Bumi', async () => {
    let maxY = -Infinity;
    const y0 = (await edu()).pos.y;
    await page.evaluate(() => window.__eduDebug.hold({ jump: true }));
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__eduDebug.hold({ jump: false }));
    for (let i = 0; i < 30; i++) {
      maxY = Math.max(maxY, (await edu()).pos.y);
      await page.waitForTimeout(80);
    }
    const h = maxY - y0;
    const earth = (shared.BODY_JUMP ?? 9.2) ** 2 / (2 * 26);
    if (h < earth * 2) throw new Error(`tinggi lompatan ${h.toFixed(2)} m`);
    return `${h.toFixed(1)} m (di Bumi ±${earth.toFixed(1)} m)`;
  });

  await step('Luar Angkasa: siswa A melihat Citra (siswa C) & menjawab soal guru', async () => {
    C.pos = { x: 4, y: 0.2, z: -176 };
    await page.waitForFunction(() => window.__edu.remoteChars.some((r) => r.nama === 'Citra'), null, { timeout: 20000 });
    await answerNearest('angkasa');
    const r = await api(`/sessions/${sess.id}/results`);
    if (!(r.body.perWorld?.angkasa >= 1)) throw new Error(JSON.stringify(r.body.perWorld));
    return `jawaban per dunia: ${JSON.stringify(r.body.perWorld)}`;
  });

  await step('Server memvalidasi gerak di dunia baru (lompat jauh ditolak, keluar batas ditolak)', async () => {
    const tele = new Promise((res) => C.s.once('teleport', res));
    clearInterval(C.timer);
    C.s.emit('player:state', { scene: 'angkasa', x: 250, y: 0.2, z: 200, ry: 0, anim: 0, riding: false });
    const t = await Promise.race([tele, sleep(4000).then(() => null)]);
    if (!t) throw new Error('tidak ada koreksi server');
    return `dikoreksi ke (${t.x.toFixed(0)}, ${t.z.toFixed(0)}) alasan ${t.reason}`;
  });

  await step('Server menolak perahu/portal dari dunia lain (id kendaraan Laut di Angkasa)', async () => {
    const r1 = await emit(C.s, 'vehicle:enter', { id: 'L_PERAHU1' });
    const r2 = await emit(C.s, 'rift:use', { riftId: 'RH_GUA' });
    if (r1.ok || r2.ok) throw new Error(JSON.stringify([r1, r2]));
    return `${r1.error} · ${r2.error}`;
  });

  await step('Dashboard guru: tab peta sebaran per dunia menampilkan siswa di Laut & Luar Angkasa', async () => {
    const tb = await chromium.launch();
    browsers.push(tb);
    const tp = await (await tb.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
    await tp.goto(`${WEB}/guru/#/masuk`);
    await tp.getByPlaceholder('nama@sekolah.sch.id').fill(EMAIL);
    await tp.getByPlaceholder('Minimal 8 karakter').fill(PASS);
    await tp.getByRole('button', { name: 'Masuk', exact: true }).click();
    await tp.getByRole('heading', { name: 'Beranda' }).waitFor({ timeout: 15000 });
    await tp.goto(`${WEB}/guru/#/sesi/${sess.id}`);
    await tp.locator('[data-heat-world="laut"]').waitFor({ timeout: 15000 });
    await tp.waitForFunction(() => /\((1|2)\)/.test(document.querySelector('[data-heat-world="laut"]')?.textContent ?? ''), null, { timeout: 15000 });
    await tp.locator('[data-heat-world="angkasa"]').click();
    await tp.getByText('Sebaran Siswa — Dunia Luar Angkasa').waitFor({ timeout: 5000 });
    await shot(tp, 'w7-dashboard-angkasa');
    return (await tp.locator('[data-heat-world]').allTextContents()).join(' · ');
  });

  await step('Tanpa galat JavaScript di perangkat siswa', async () => {
    if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
    const e = await edu();
    return `fps ${e.fps}`;
  });
} catch {
  /* langkah gagal sudah dicatat */
} finally {
  for (const s of sockets) {
    clearInterval(s.timer);
    s.s.disconnect();
  }
  for (const b of browsers) await b.close().catch(() => undefined);
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${bad ? 'GAGAL' : 'LULUS'} ${results.length - bad}/${results.length} langkah uji 4 dunia`);
  process.exitCode = bad || !results.length ? 1 : 0;
}
