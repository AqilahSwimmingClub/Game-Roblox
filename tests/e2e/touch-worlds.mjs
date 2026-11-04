/**
 * Uji regresi "karakter tidak bisa bergerak" — HP dengan SENTUHAN NYATA (CDP Input.dispatchTouchEvent), bukan autopilot:
 *  - 20 avatar: ganti avatar lalu joystick tetap menggerakkan karakter.
 *  - Kota, Hutan, Laut (darat + berenang), Luar Angkasa (jalan + lompat gravitasi rendah): joystick ≥ 20 m ke beberapa
 *    arah, kamera mengikuti avatar.
 *  - Buka/tutup Peta, Tas, Soal, Toko/pedagang, Menu, Gerbang Antardunia → joystick masih jalan; dialog tidak keluar layar.
 *  - Pindah dunia berkali-kali (lobi, Menu → Keluar ke Lobi, Gerbang Antardunia) tanpa joystick terkunci.
 *  - Koneksi Socket.IO diputus paksa lalu pulih: dialog hilang, dunia sama, kontrol kembali.
 *  - Perangkat kedua (HP landscape) melihat gerakan pemain pertama di dunia yang sama.
 * Navigasi jarak jauh (ke titik soal/pedagang/gerbang) memakai autopilot uji; semua uji GERAK memakai joystick sentuh.
 *   BASE_URL, WEB_URL, TEACHER_EMAIL, TEACHER_PASSWORD, SHOTS
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
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
    console.log(`  ✔ ${name} (${Date.now() - t0} ms)${v ? ` — ${v}` : ''}`);
  } catch (e) {
    results.push({ ok: false });
    console.log(`  ✘ ${name}: ${String(e.message).split('\n')[0]}`);
    if (SHOTS && shotOnFail) await shotOnFail(`gagal-${results.length}`).catch(() => undefined);
  }
};
let shotOnFail = null;
const musicSeen = new Set();

let token = '';
const api = async (path, method = 'GET', body) => (await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })).json();

/** Satu perangkat sentuh dengan helper joystick. */
async function device(browser, name, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const edu = () => page.evaluate(() => window.__edu);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  /** Geser joystick (kiri bawah) ke arah (dx, dy) selama ms; kembalikan jarak tempuh horizontal. */
  const joy = async (dx, dy, ms = 1500) => {
    const p0 = (await edu()).pos;
    const vp = page.viewportSize();
    const x = Math.round(vp.width * 0.16);
    const y = Math.round(vp.height * 0.78);
    await touch('touchStart', [{ x, y, id: 1 }]);
    for (let t = 0; t <= ms; t += 50) {
      const k = Math.min(1, t / 200);
      await touch('touchMove', [{ x: x + dx * k, y: y + dy * k, id: 1 }]);
      await page.waitForTimeout(50);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(200);
    const p1 = (await edu()).pos;
    return Math.hypot(p1.x - p0.x, p1.z - p0.z);
  };
  /** Jelajah 4 arah; total ≥ minTotal m, minimal 3 arah bergerak, kamera tetap dekat avatar. */
  const explore = async (minTotal = 20) => {
    const d = [];
    for (const [dx, dy] of [
      [0, -60],
      [60, 0],
      [0, 60],
      [-60, 0],
      [0, -60],
    ])
      d.push(await joy(dx, dy, 1700));
    const total = d.reduce((a, b) => a + b, 0);
    const moved = d.filter((x) => x > 2).length;
    const e = await edu();
    const camGap = Math.hypot(e.cam.x - e.pos.x, e.cam.z - e.pos.z);
    if (total < minTotal || moved < 3) throw new Error(`jarak ${d.map((x) => x.toFixed(1)).join('/')} m · input ${JSON.stringify(e.input)}`);
    if (camGap > 30) throw new Error(`kamera tertinggal ${camGap.toFixed(1)} m dari avatar`);
    return `${total.toFixed(0)} m (${d.map((x) => x.toFixed(0)).join('/')}) · kamera ${camGap.toFixed(1)} m di belakang avatar`;
  };
  const mustMove = async (what) => {
    for (const [dx, dy] of [
      [0, -60],
      [60, 0],
      [0, 60],
    ]) {
      const d = await joy(dx, dy, 1200);
      if (d >= 2) return `${what}: joystick ${d.toFixed(1)} m`;
    }
    throw new Error(`${what}: joystick tidak menggerakkan karakter · ${JSON.stringify((await edu()).input)}`);
  };
  /** Semua tombol dialog yang terlihat ada di dalam layar & tidak ada scroll horizontal. */
  const noOverflow = async (label) => {
    const bad = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.screen button, .screen .btn')) {
        const r = el.getBoundingClientRect();
        if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
        const card = el.closest('.card, .panel');
        const scroller = card && card.scrollHeight > card.clientHeight + 2; // tombol di area gulir boleh di bawah lipatan
        if (r.left < -1 || r.right > innerWidth + 1 || (!scroller && (r.top < -1 || r.bottom > innerHeight + 1))) out.push(`${(el.textContent || '').trim().slice(0, 20)} @${Math.round(r.left)},${Math.round(r.top)}`);
      }
      if (document.documentElement.scrollWidth > innerWidth) out.push(`scroll horizontal ${document.documentElement.scrollWidth - innerWidth}px`);
      return out;
    });
    if (bad.length) throw new Error(`${label}: keluar layar → ${bad.slice(0, 3).join(' · ')}`);
  };
  const goTo = async (x, z, until = null, ms = 90000) => {
    await page.evaluate(({ x, z }) => window.__eduDebug.goTo(x, z), { x, z });
    await page.waitForFunction((u) => !window.__eduDebug.walking() || (u && window.__edu.prompt === u), until, { timeout: ms }).catch(() => undefined);
    await page.evaluate(() => window.__eduDebug.stop());
  };
  const toWorld = async (world, label) => {
    const sc = (await edu()).scene;
    if (sc !== 'lobi') {
      await page.getByRole('button', { name: 'Menu' }).tap();
      await page.getByRole('button', { name: 'Keluar ke Lobi' }).tap();
      await page.getByRole('button', { name: 'Yakin keluar? Tekan lagi' }).tap();
      await page.waitForFunction(() => window.__edu?.scene === 'lobi', null, { timeout: 20000 });
    }
    await page.getByRole('button', { name: 'PILIH DUNIA' }).tap();
    await page.locator('button.opt', { hasText: label }).tap();
    await page.waitForFunction((w) => window.__edu?.scene === w, world, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const mu = (await edu()).music;
    if (mu.want !== world) throw new Error(`musik dunia ${world} tidak dipilih (${JSON.stringify(mu)})`);
    musicSeen.add(`${world}:${mu.theme}`);
  };
  return { name, ctx, page, errors, edu, joy, explore, mustMove, noOverflow, goTo, toWorld };
}

async function join(d, code, absen, nama, karakter) {
  const { page } = d;
  await page.goto(`${WEB}/?kode=${code}&debug=1`);
  await page.getByRole('button', { name: 'MAIN', exact: true }).click({ force: true, timeout: 30000 });
  await page.getByPlaceholder('mis. 7').fill(String(absen));
  await page.getByPlaceholder('mis. Raka').fill(nama);
  await page.getByRole('button', { name: 'Simpan' }).tap();
  await page.getByText('Pilih Karaktermu').waitFor({ timeout: 20000 });
  await page.locator(`.char-card[data-karakter="${karakter}"]`).tap();
  await page.getByRole('button', { name: 'SIAP!' }).tap();
  await page.waitForFunction(() => window.__edu?.scene === 'lobi', null, { timeout: 30000 });
}

const browser = await chromium.launch({ args: GL });
try {
  token = (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) }).then((r) => r.json())).token;
  const sess = await api('/sessions', 'POST', { title: 'Uji gerak sentuh', className: 'GRK', settings: { worlds: ['kota', 'hutan', 'laut', 'angkasa'], requireApproval: false, durationMinutes: 40, secondChance: false } });
  if (!sess.id) throw new Error(JSON.stringify(sess));
  await api(`/sessions/${sess.id}/start`, 'POST');
  await sleep(1200);
  console.log(`EDUVERSE uji gerak sentuh 4 dunia → ${WEB} (kode ${sess.code})`);
  const A = await device(browser, 'A', 393, 873); // HP portrait
  const B = await device(browser, 'B', 873, 393); // HP landscape
  shotOnFail = async (n) => {
    await A.page.screenshot({ path: `${SHOTS}/t-${n}.png` });
    console.log('    keadaan A:', JSON.stringify(await A.page.evaluate(() => ({ scene: window.__edu.scene, pos: window.__edu.pos, env: window.__edu.env, input: window.__edu.input, net: window.__edu.net, layar: [...document.querySelectorAll('.screen')].map((e) => e.id || e.className) }))));
  };
  await join(A, sess.code, 31, 'Ayu', 0);
  await join(B, sess.code, 32, 'Budi', 5);

  if (!process.env.FAST) await step('20 avatar: ganti avatar di lobi, joystick tetap menggerakkan setiap avatar', async () => {
    const ok = [];
    for (let k = 0; k < 20; k++) {
      await A.page.getByRole('button', { name: 'Menu' }).tap();
      await A.page.getByRole('button', { name: 'Ganti Karakter' }).tap();
      await A.page.locator(`.char-card[data-karakter="${k}"]`).tap();
      await A.page.getByRole('button', { name: 'SIAP!' }).tap();
      await A.page.waitForFunction((kk) => window.__edu?.myChar === kk && !document.querySelector('.char-card'), k, { timeout: 20000 });
      await A.page.waitForTimeout(300);
      const dirs = [
        [0, -60],
        [0, 60],
      ][k % 2];
      let d = await A.joy(dirs[0], dirs[1], 900);
      if (d < 1.5) d = await A.joy(60, 0, 900);
      if (d < 1.5) throw new Error(`avatar ${k} tidak bergerak (${d.toFixed(2)} m) · ${JSON.stringify((await A.edu()).input)}`);
      ok.push(k);
    }
    return `${ok.length}/20 avatar bergerak`;
  });

  await step('Dunia Kota: joystick ≥ 20 m ke beberapa arah, kamera mengikuti', async () => {
    await A.toWorld('kota', 'Dunia Kota');
    await B.toWorld('kota', 'Dunia Kota');
    if (SHOTS) await A.page.screenshot({ path: `${SHOTS}/t-kota-portrait.png` });
    return A.explore(20);
  });

  if (!process.env.FAST) await step('Perangkat lain (HP landscape) melihat gerakan pemain A di Kota', async () => {
    await B.page.waitForFunction(() => window.__edu.others.some((o) => o.nama === 'Ayu'), null, { timeout: 15000 });
    const before = (await B.edu()).others.find((o) => o.nama === 'Ayu');
    await A.joy(0, -60, 1500);
    await A.joy(60, 0, 1200);
    await B.page.waitForTimeout(800);
    const after = (await B.edu()).others.find((o) => o.nama === 'Ayu');
    const d = Math.hypot(after.x - before.x, after.z - before.z);
    if (d < 3) throw new Error(`B melihat A bergeser ${d.toFixed(1)} m saja`);
    if (SHOTS) await B.page.screenshot({ path: `${SHOTS}/t-kota-landscape-B.png` });
    return `B melihat A berpindah ${d.toFixed(1)} m`;
  });

  if (!process.env.FAST) await step('Buka/tutup Peta, Tas, Menu → joystick masih jalan, dialog tidak keluar layar', async () => {
    await A.page.getByRole('button', { name: 'Peta' }).tap();
    await A.page.getByRole('button', { name: 'Tutup Peta' }).waitFor();
    await A.noOverflow('Peta');
    await A.page.getByRole('button', { name: 'Tutup Peta' }).tap();
    await A.mustMove('setelah Peta');
    await A.page.locator('.hud-wallet .mv-wallet').tap();
    await A.page.getByRole('button', { name: 'Tutup' }).first().waitFor();
    await A.noOverflow('Tas');
    if (SHOTS) await A.page.screenshot({ path: `${SHOTS}/t-tas.png` });
    await A.page.getByRole('button', { name: 'Tutup' }).first().tap();
    await A.mustMove('setelah Tas');
    await A.page.getByRole('button', { name: 'Menu' }).tap();
    await A.noOverflow('Menu');
    await A.page.getByRole('button', { name: 'Lanjut Bermain' }).tap();
    return A.mustMove('setelah Menu');
  });

  if (!process.env.FAST) await step('Pedagang/Toko: buka dialog pedagang lalu tutup → joystick jalan', async () => {
    const vs = await A.page.evaluate(() => window.__eduDebug.vendors());
    const me = (await A.edu()).pos;
    const v = vs.filter((x) => x.y < 1).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
    await A.goTo(v.x, v.z + 1.8, 'pedagang');
    if ((await A.edu()).prompt !== 'pedagang') throw new Error(`tidak sampai pedagang ${v.id}`);
    await A.page.evaluate(() => window.__eduDebug.action());
    await A.page.getByRole('button', { name: 'Tutup' }).first().waitFor({ timeout: 10000 });
    await A.noOverflow('Pedagang');
    if (SHOTS) await A.page.screenshot({ path: `${SHOTS}/t-pedagang.png` });
    await A.page.getByRole('button', { name: 'Tutup' }).first().tap();
    return A.mustMove(`setelah pedagang ${v.id}`);
  });

  if (!process.env.FAST) await step('Soal: buka soal lalu tutup (X) → joystick jalan', async () => {
    const pts = await A.page.evaluate(() => window.__eduDebug.openPoints());
    const me = (await A.edu()).pos;
    const cand = pts.filter((p) => Math.abs(p.y - me.y) < 1.5).sort((p, q) => Math.hypot(p.x - me.x, p.z - me.z) - Math.hypot(q.x - me.x, q.z - me.z));
    let opened = false;
    for (const p of cand.slice(0, 4)) {
      await A.goTo(p.x, p.z, 'soal');
      if ((await A.edu()).prompt === 'soal') {
        await A.page.evaluate(() => window.__eduDebug.action());
        opened = true;
        break;
      }
    }
    if (!opened) throw new Error('tidak bisa mencapai titik soal');
    await A.page.getByRole('button', { name: 'Tutup soal' }).waitFor({ timeout: 10000 });
    await A.noOverflow('Soal');
    if (SHOTS) await A.page.screenshot({ path: `${SHOTS}/t-soal.png` });
    await A.page.getByRole('button', { name: 'Tutup soal' }).tap();
    return A.mustMove('setelah soal ditutup');
  });

  await step('Dunia Hutan: joystick ≥ 20 m ke beberapa arah, kamera mengikuti', async () => {
    await A.toWorld('hutan', 'Dunia Hutan');
    if (SHOTS) await A.page.screenshot({ path: `${SHOTS}/t-hutan.png` });
    return A.explore(20);
  });

  await step('Gerbang Antardunia Hutan → Laut: dialog muat di layar, joystick langsung jalan di Laut', async () => {
    const gate = shared.worldLayout('hutan').living.rifts.find((r) => r.id === 'RH_DUNIA');
    await A.page.evaluate(({ x, z }) => window.__eduDebug.goTo(x, z), gate);
    await A.page.locator('[data-gate="laut"]').waitFor({ timeout: 60000 });
    await A.page.evaluate(() => window.__eduDebug.stop());
    await A.noOverflow('Gerbang Antardunia');
    if (SHOTS) await A.page.screenshot({ path: `${SHOTS}/t-gerbang.png` });
    await A.page.locator('[data-gate="laut"]').tap();
    await A.page.waitForFunction(() => window.__edu?.scene === 'laut', null, { timeout: 30000 });
    await A.page.waitForTimeout(1200);
    return A.explore(15);
  });

  await step('Dunia Laut: berenang dengan joystick', async () => {
    // jalur pasti ke air: kembali ke tengah pulau → sepanjang dermaga → melompat dari ujung dermaga
    await A.goTo(0, -14);
    await A.goTo(0, -46);
    await A.goTo(0, -78);
    await A.page.waitForFunction(() => window.__edu.env.swimming, null, { timeout: 30000 });
    const d = await A.joy(60, 0, 1800);
    const sw = (await A.edu()).env.swimming;
    if (SHOTS) await A.page.screenshot({ path: `${SHOTS}/t-laut-renang.png` });
    if (d < 2) throw new Error(`berenang ${d.toFixed(2)} m`);
    return `berenang ${d.toFixed(1)} m (masih di air: ${sw})`;
  });

  await step('Luar Angkasa: joystick ≥ 20 m + tombol Lompat (gravitasi rendah)', async () => {
    await A.toWorld('angkasa', 'Dunia Luar Angkasa');
    const r = await A.explore(20);
    const y0 = (await A.edu()).pos.y;
    await A.page.getByRole('button', { name: 'Lompat' }).tap();
    let maxY = y0;
    for (let i = 0; i < 20; i++) {
      maxY = Math.max(maxY, (await A.edu()).pos.y);
      await A.page.waitForTimeout(70);
    }
    if (maxY - y0 < 2.5) throw new Error(`lompatan ${(maxY - y0).toFixed(2)} m`);
    if (SHOTS) await A.page.screenshot({ path: `${SHOTS}/t-angkasa.png` });
    return `${r} · lompat ${(maxY - y0).toFixed(1)} m`;
  });

  await step('Pindah dunia beruntun (Kota → Laut → Hutan → Angkasa) tanpa joystick terkunci', async () => {
    const out = [];
    for (const [w, label] of [
      ['kota', 'Dunia Kota'],
      ['laut', 'Dunia Laut'],
      ['hutan', 'Dunia Hutan'],
      ['angkasa', 'Dunia Luar Angkasa'],
    ]) {
      await A.toWorld(w, label);
      out.push(await A.mustMove(w));
    }
    return out.join(' · ');
  });

  await step('Koneksi Socket.IO diputus lalu pulih: dialog hilang, dunia sama, kontrol kembali', async () => {
    const before = await A.edu();
    await A.page.evaluate(() => window.__eduDebug.dropConnection());
    await A.page.waitForFunction((n) => window.__edu.net.reconnects > n && window.__edu.net.connected && !window.__edu.net.banner, before.net.reconnects, { timeout: 30000 });
    const after = await A.edu();
    if (after.scene !== before.scene) throw new Error(`dunia berubah ${before.scene} → ${after.scene}`);
    if (after.input.locks.length || !after.input.enabled) throw new Error(`kontrol masih terkunci ${JSON.stringify(after.input)}`);
    if (await A.page.locator('#blocker').count()) throw new Error('dialog koneksi masih tampil');
    return `${await A.mustMove('setelah sambung ulang')} · alasan putus: ${after.net.lastDisconnect}`;
  });

  await step('Putus koneksi lebih lama (dialog tampil) lalu pulih → dialog hilang & kontrol kembali', async () => {
    await A.page.evaluate(() => {
      window.__eduDebug.dropConnection();
    });
    // tahan di kondisi offline ±3,5 dtk dengan memblokir sambung ulang sementara
    await A.ctx.setOffline(true);
    await A.page.waitForFunction(() => window.__edu.net.banner, null, { timeout: 15000 });
    if (SHOTS) await A.page.screenshot({ path: `${SHOTS}/t-koneksi-putus.png` });
    await A.noOverflow('Dialog koneksi');
    await A.ctx.setOffline(false);
    await A.page.waitForFunction(() => window.__edu.net.connected && !window.__edu.net.banner && !window.__edu.input.locks.length, null, { timeout: 40000 });
    return A.mustMove('setelah internet kembali');
  });

  await step('Musik latar berbeda di setiap dunia (tema berganti saat pindah dunia)', async () => {
    const themes = new Set([...musicSeen].map((x) => x.split(':')[1]));
    const want = ['kota', 'hutan', 'laut', 'angkasa'];
    const missing = want.filter((w) => ![...musicSeen].includes(`${w}:${w}`));
    if (missing.length) throw new Error(`tema tidak diputar untuk: ${missing.join(', ')} (${[...musicSeen].join(' ')})`);
    return `${themes.size} tema: ${[...themes].join(', ')}`;
  });

  await step('Tanpa galat JavaScript di kedua perangkat', async () => {
    const errs = [...A.errors, ...B.errors];
    if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  });
} catch (e) {
  results.push({ ok: false });
  console.log(`  ✘ persiapan: ${e.message}`);
} finally {
  await browser.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${bad ? 'GAGAL' : 'LULUS'} ${results.length - bad}/${results.length} langkah uji gerak sentuh`);
  process.exitCode = bad || !results.length ? 1 : 0;
}
