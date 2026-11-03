/**
 * Uji Mode Demo Kota (/demo.html): harus tetap berjalan TANPA server, kode kelas, atau skor resmi.
 *   WEB_URL=http://localhost:4173 node tests/e2e/demo.mjs
 */
import { createRequire } from 'node:module';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let ok = false;
try {
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const page = await ctx.newPage();
  const errors = [];
  const sockets = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME/.test(m.text()) && errors.push(m.text()));
  page.on('request', (r) => /socket\.io|\/api\//.test(r.url()) && sockets.push(r.url()));
  await page.goto(`${WEB}/demo.html`);
  await page.locator('canvas').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(4000);
  // berjalan maju 2 dtk dengan keyboard (kontrol sama dengan game)
  await page.mouse.click(600, 200);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/demo.png` });
  const text = await page.locator('body').innerText();
  if (errors.length) throw new Error(`galat JS: ${errors.slice(0, 3).join(' | ')}`);
  if (sockets.length) throw new Error(`demo menghubungi server: ${sockets[0]}`);
  if (!/demo/i.test(text)) throw new Error('teks mode demo tidak tampil');
  ok = true;
  console.log('  ✔ Mode Demo Kota terbuka, bisa digerakkan, tanpa galat dan tanpa menghubungi server/skor resmi');
} catch (e) {
  console.log(`  ✘ Mode Demo: ${e.message}`);
} finally {
  await browser.close();
  process.exitCode = ok ? 0 : 1;
}
