/**
 * Uji regresi UI responsif + kontrol sentuh EDUVERSE (Playwright, sentuhan NYATA lewat CDP Input.dispatchTouchEvent).
 * Untuk setiap resolusi (HP kecil–desktop):
 *  1. Masuk lewat kode kelas → lobi → Dunia Hutan.
 *  2. HUD: elemen yang terlihat tidak saling tumpang tindih & tidak keluar layar; tidak ada scroll horizontal.
 *  3. Area joystick (kiri bawah) benar-benar meneruskan sentuhan ke kanvas 3D (bukan ditangkap lapisan HUD).
 *  4. Menggeser joystick menggerakkan karakter ≥ 3 m (perangkat sentuh); WASD menggerakkan karakter (desktop).
 *  5. Menu: tombol kualitas grafis (2×2 di portrait) & semua tombol berada di dalam layar; setelah ditutup tetap bisa bergerak.
 *  6. HP: putar portrait → landscape → portrait, kontrol tetap jalan.
 *   BASE_URL, WEB_URL, TEACHER_EMAIL, TEACHER_PASSWORD, SHOTS, ONLY (nama resolusi, opsional)
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB_URL ?? BASE;
const EMAIL = process.env.TEACHER_EMAIL ?? 'guru@sekolah.id';
const PASS = process.env.TEACHER_PASSWORD ?? 'rahasia123';
const SHOTS = process.env.SHOTS ?? '';
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: 'hp-kecil-portrait', w: 360, h: 800, touch: true },
  { name: 'hp-portrait', w: 393, h: 873, touch: true, rotate: true },
  { name: 'hp-besar-portrait', w: 412, h: 915, touch: true },
  { name: 'hp-landscape', w: 873, h: 393, touch: true },
  { name: 'hp-besar-landscape', w: 915, h: 412, touch: true },
  { name: 'tablet-portrait', w: 768, h: 1024, touch: true },
  { name: 'tablet-landscape', w: 1024, h: 768, touch: true },
  { name: 'desktop-1366', w: 1366, h: 768, touch: false },
  { name: 'desktop-1920', w: 1920, h: 1080, touch: false },
].filter((v) => !process.env.ONLY || process.env.ONLY.split(',').includes(v.name));

const results = [];
const check = async (name, fn) => {
  try {
    const note = await fn();
    results.push({ ok: true });
    console.log(`    ✔ ${name}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    results.push({ ok: false });
    console.log(`    ✘ ${name}: ${String(e.message).split('\n')[0]}`);
  }
};

/** Kotak elemen HUD/kontrol yang terlihat (untuk uji tumpang tindih). */
const hudBoxes = () =>
  [...document.querySelectorAll('.hud-top .profil, .hud-top .timer, .hud-top .hud-ikon, .hud-top .minimap, .hud-chips > *:not(.hud-wallet), .hud-wallet .mv-wallet, .hud-br .btn, .hud-br .action-btn, .oksigen')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { n: (el.getAttribute('aria-label') || el.className || el.tagName).toString().slice(0, 40), x: r.left, y: r.top, w: r.width, h: r.height };
    });

function overlaps(boxes, vw, vh) {
  const out = [];
  for (const b of boxes) if (b.x < -1 || b.y < -1 || b.x + b.w > vw + 1 || b.y + b.h > vh + 1) out.push(`${b.n} keluar layar (${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)}×${Math.round(b.h)})`);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 2 && iy > 2) out.push(`${a.n} ⟂ ${b.n}`);
    }
  return out;
}

let token = '';
const api = async (path, method = 'GET', body) => (await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })).json();

const browser = await chromium.launch({ args: GL });
try {
  token = (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) }).then((r) => r.json())).token;
  const sess = await api('/sessions', 'POST', { title: 'Uji responsif', className: 'RSP', settings: { worlds: ['kota', 'hutan', 'laut', 'angkasa'], requireApproval: false, durationMinutes: 30 } });
  if (!sess.id) throw new Error(`sesi: ${JSON.stringify(sess)}`);
  await api(`/sessions/${sess.id}/start`, 'POST');
  await new Promise((r) => setTimeout(r, 1200));
  console.log(`EDUVERSE uji responsif & kontrol sentuh → ${WEB} (kode ${sess.code})`);

  let absen = 20;
  for (const vp of VIEWPORTS) {
    console.log(`  ▸ ${vp.name} ${vp.w}×${vp.h}${vp.touch ? ' (sentuh)' : ' (mouse+keyboard)'}`);
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const cdp = vp.touch ? await ctx.newCDPSession(page) : null;
    const edu = () => page.evaluate(() => window.__edu);
    const touchDrag = async (x, y, dx, dy, ms = 1400) => {
      const tp = (px, py) => [{ x: px, y: py, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(x, y) });
      for (let t = 0; t <= ms; t += 50) {
        const k = Math.min(1, t / 200);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x + dx * k, y + dy * k) });
        await page.waitForTimeout(50);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    /** Gerakkan karakter memakai kontrol sungguhan (joystick sentuh / tombol W) dan kembalikan jarak tempuh. */
    // arah bergantian (maju, mundur, kiri, kanan) agar tidak terus menabrak penghalang yang sama
    let turn = 0;
    const DIRS = [
      [0, -60, 'KeyW'],
      [0, 60, 'KeyS'],
      [-60, 0, 'KeyA'],
      [60, 0, 'KeyD'],
    ];
    const moveWithControls = async () => {
      const p0 = (await edu()).pos;
      const { width: w, height: h } = page.viewportSize();
      const [dx, dy, key] = DIRS[turn++ % DIRS.length];
      if (vp.touch) await touchDrag(Math.round(w * 0.16), Math.round(h * 0.78), dx, dy);
      else {
        await page.keyboard.down(key);
        await page.waitForTimeout(2600); // desktop di CI dirender perangkat lunak (fps rendah) → tahan lebih lama
        await page.keyboard.up(key);
      }
      await page.waitForTimeout(250);
      const p1 = (await edu()).pos;
      if (process.env.E2E_VERBOSE) console.log(`      ${key}: (${p0.x.toFixed(1)},${p0.z.toFixed(1)}) → (${p1.x.toFixed(1)},${p1.z.toFixed(1)}) · ${JSON.stringify((await edu()).input)}`);
      return Math.hypot(p1.x - p0.x, p1.z - p0.z);
    };

    try {
      await page.goto(`${WEB}/?kode=${sess.code}&debug=1`);
      await page.getByRole('button', { name: 'MAIN', exact: true }).click({ force: true, timeout: 30000 });
      await page.getByPlaceholder('mis. 7').fill(String(absen));
      await page.getByPlaceholder('mis. Raka').fill(`R${absen}`);
      absen++;
      await page.getByRole('button', { name: 'Simpan' }).click();
      await page.getByText('Pilih Karaktermu').waitFor({ timeout: 20000 });
      await page.locator('.char-card').nth(absen % 20).click();
      await page.getByRole('button', { name: 'SIAP!' }).click();
      await page.waitForFunction(() => window.__edu?.scene === 'lobi', null, { timeout: 30000 });
      await page.getByRole('button', { name: 'PILIH DUNIA' }).click();
      await page.locator('button.opt', { hasText: 'Dunia Hutan' }).click();
      await page.waitForFunction(() => window.__edu?.scene === 'hutan', null, { timeout: 30000 });
      await page.waitForTimeout(4500); // biarkan notifikasi sambutan hilang
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/r-${vp.name}-hutan.png` });

      await check('HUD tidak tumpang tindih & tidak keluar layar', async () => {
        const boxes = await page.evaluate(hudBoxes);
        const bad = overlaps(boxes, vp.w, vp.h);
        if (bad.length) throw new Error(bad.slice(0, 4).join(' · '));
        const sx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (sx > 0) throw new Error(`scroll horizontal ${sx}px`);
        return `${boxes.length} elemen`;
      });
      if (vp.touch)
        await check('Area joystick kiri bawah meneruskan sentuhan ke kanvas 3D', async () => {
          const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [Math.round(vp.w * 0.16), Math.round(vp.h * 0.78)]);
          if (hit !== 'CANVAS') throw new Error(`titik joystick mengenai ${hit}`);
        });
      await check(vp.touch ? 'Joystick sentuh menggerakkan karakter di Dunia Hutan' : 'Keyboard WASD menggerakkan karakter', async () => {
        const d = await moveWithControls();
        if (d < 3) throw new Error(`hanya ${d.toFixed(2)} m · input ${JSON.stringify((await edu()).input)}`);
        return `${d.toFixed(1)} m`;
      });
      await check('Menu: kualitas grafis & tombol di dalam layar, lalu kontrol kembali', async () => {
        await page.getByRole('button', { name: 'Menu' }).click();
        await page.locator('.grid-kualitas').waitFor();
        const r = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('.dialog-hud button')) {
            const b = el.getBoundingClientRect();
            if (b.left < 0 || b.right > innerWidth + 1) out.push(`${el.textContent} x ${Math.round(b.left)}–${Math.round(b.right)}`);
          }
          const q = [...document.querySelectorAll('.grid-kualitas .opt')].map((e) => e.getBoundingClientRect());
          const cols = new Set(q.map((b) => Math.round(b.left))).size;
          return { out, cols };
        });
        if (r.out.length) throw new Error(r.out.join(' · '));
        if (vp.w < vp.h && vp.w < 600 && r.cols !== 2) throw new Error(`kualitas ${r.cols} kolom (harus 2×2 di HP portrait)`);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/r-${vp.name}-menu.png` });
        await page.getByRole('button', { name: 'Lanjut Bermain' }).click();
        const d = await moveWithControls();
        if (d < 3) throw new Error(`setelah menu hanya bergerak ${d.toFixed(2)} m`);
        return `${r.cols} kolom kualitas · bergerak ${d.toFixed(1)} m setelah menu ditutup`;
      });
      if (vp.rotate)
        await check('Rotasi portrait → landscape → portrait: HUD rapi & joystick tetap jalan', async () => {
          await page.setViewportSize({ width: vp.h, height: vp.w });
          await page.waitForTimeout(800);
          let bad = overlaps(await page.evaluate(hudBoxes), vp.h, vp.w);
          if (bad.length) throw new Error(`landscape: ${bad.slice(0, 3).join(' · ')}`);
          if (SHOTS) await page.screenshot({ path: `${SHOTS}/r-${vp.name}-diputar.png` });
          let d = await moveWithControls();
          if (d < 3) throw new Error(`landscape bergerak ${d.toFixed(2)} m`);
          await page.setViewportSize({ width: vp.w, height: vp.h });
          await page.waitForTimeout(800);
          bad = overlaps(await page.evaluate(hudBoxes), vp.w, vp.h);
          if (bad.length) throw new Error(`portrait lagi: ${bad.slice(0, 3).join(' · ')}`);
          d = await moveWithControls();
          if (d < 3) throw new Error(`portrait lagi bergerak ${d.toFixed(2)} m`);
        });
      await check('Tanpa galat JavaScript', async () => {
        if (errors.length) throw new Error(errors.slice(0, 2).join(' | '));
      });
    } catch (e) {
      results.push({ ok: false });
      console.log(`    ✘ alur ${vp.name}: ${String(e.message).split('\n')[0]}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/r-${vp.name}-gagal.png` }).catch(() => undefined);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${bad ? 'GAGAL' : 'LULUS'} ${results.length - bad}/${results.length} pemeriksaan responsif & kontrol sentuh`);
  process.exitCode = bad || !results.length ? 1 : 0;
}
