/**
 * Uji ujung-ke-ujung EDUVERSE: 1 guru (tablet) + 2 siswa (HP) di 3 PROSES BROWSER TERPISAH.
 *
 * Alur kelas resmi yang diuji (semua lewat UI sungguhan, bukan panggilan API langsung):
 *  1. Guru masuk Dashboard → membuat sesi lewat formulir (persetujuan siswa aktif) → mendapat kode kelas.
 *  2. Dua siswa membuka tautan ?kode=…, mengisi nomor absen & nama → menunggu persetujuan.
 *  3. Guru menyetujui di Dashboard → siswa memilih karakter (dua karakter berbeda dari 20) → ruang tunggu → SIAP.
 *  4. Guru menekan Mulai → keduanya masuk Dunia Kota yang sama dan saling melihat DENGAN karakter pilihan masing-masing.
 *  5. Siswa A berjalan (autopilot mode uji ?debug=1 memakai input gerak biasa, posisi divalidasi server) ke titik soal,
 *     membuka soal, menjawab → server menilai → umpan jawaban & poin muncul di Dashboard.
 *  6. Guru mengakhiri permainan → hasil akhir → Podium 3D menampilkan karakter pilihan para juara.
 *
 * Topologi: WEB_URL = frontend statis (game "/", Dashboard "/guru/", seperti Vercel),
 *           backend API/Socket.IO di alamat dari eduverse-config.js (seperti Render). Tanpa WEB_URL = BASE_URL.
 * Prasyarat: server berjalan, guru & bank soal siap (node tests/setup-teacher.mjs).
 * Variabel: BASE_URL, WEB_URL, TEACHER_EMAIL, TEACHER_PASSWORD, SHOTS (folder tangkapan layar, opsional).
 * Butuh paket "playwright" + Chromium (npx playwright install chromium).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

// require() agar juga menemukan Playwright yang terpasang global (NODE_PATH)
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB_URL ?? BASE;
const EMAIL = process.env.TEACHER_EMAIL ?? 'guru@sekolah.id';
const PASS = process.env.TEACHER_PASSWORD ?? 'rahasia123';
const SHOTS = process.env.SHOTS ?? '';
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const v = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✔ ${name} (${Date.now() - t0} ms)`);
    return v;
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message).split('\n')[0] });
    if (process.env.E2E_VERBOSE) console.log(String(e.message).split('\n').slice(0, 12).join('\n'));
    console.log(`  ✘ ${name}: ${String(e.message).split('\n')[0]}`);
    throw e;
  }
};
const shot = async (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png` });

/** Tahap 1: buka tautan undangan, isi absen & nama → layar menunggu persetujuan guru. */
async function studentJoin(code, absen, nama) {
  const browser = await chromium.launch({ args: GL });
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${WEB}/?kode=${code}&debug=1`);
  const main = page.getByRole('button', { name: 'MAIN', exact: true });
  await main.waitFor({ timeout: 30000 });
  await main.click({ force: true });
  await page.getByText('Kamu yang mana?').waitFor({ timeout: 20000 });
  await page.getByPlaceholder('mis. 7').fill(String(absen));
  await page.getByPlaceholder('mis. Raka').fill(nama);
  await page.getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Menunggu persetujuan guru').waitFor({ timeout: 15000 });
  return { browser, page, errors, nama };
}

/** Tahap 2 (setelah disetujui): pilih karakter → ruang tunggu Dunia Kota → SIAP. */
async function studentPick(s, karakter) {
  const { page } = s;
  await page.getByText('Pilih Karaktermu').waitFor({ timeout: 20000 });
  await page.locator(`.char-card[data-karakter="${karakter}"]`).click();
  await shot(page, `s0-karakter-${s.nama}`);
  await page.getByRole('button', { name: 'SIAP!' }).click();
  await page.getByText('Ruang Tunggu').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'SIAP', exact: true }).click();
  s.karakter = karakter;
}

async function answerCurrentQuestion(page) {
  await page.getByRole('button', { name: 'JAWAB' }).waitFor({ timeout: 10000 });
  if (await page.locator('.opsi button').count()) await page.locator('.opsi button:not([disabled])').first().click();
  else if (await page.locator('.jodoh select').count()) {
    for (const s of await page.locator('.jodoh select').all()) await s.selectOption({ index: 1 });
  } else await page.locator('input.field').fill('1');
  await page.getByRole('button', { name: 'JAWAB' }).click();
}

let browsers = [];
try {
  console.log(`EDUVERSE e2e → frontend ${WEB} · backend ${BASE}`);
  // ── Guru ──
  const tb = await chromium.launch();
  browsers.push(tb);
  const tctx = await tb.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, hasTouch: true });
  const teacher = await tctx.newPage();
  const code = await step('Guru masuk & membuat sesi dari formulir Dashboard', async () => {
    await teacher.goto(`${WEB}/guru/#/masuk`);
    await teacher.getByPlaceholder('nama@sekolah.sch.id').fill(EMAIL);
    await teacher.getByPlaceholder('Minimal 8 karakter').fill(PASS);
    await teacher.getByRole('button', { name: 'Masuk', exact: true }).click();
    await teacher.getByRole('heading', { name: 'Beranda' }).waitFor({ timeout: 15000 });
    await shot(teacher, 'g1-beranda');
    await teacher.getByRole('link', { name: 'Buat Sesi' }).click();
    await teacher.getByPlaceholder('mis. 5B').fill('5B');
    await shot(teacher, 'g2-buat-sesi');
    await teacher.getByRole('button', { name: 'Buat Sesi & Kode Kelas' }).click();
    await teacher.locator('.kode').first().waitFor({ timeout: 15000 });
    await teacher.getByText('Terhubung langsung').waitFor({ timeout: 15000 });
    const c = (await teacher.locator('.kode').first().innerText()).trim();
    if (!/^[A-Z0-9]{6}$/.test(c)) throw new Error(`kode kelas tidak valid: ${c}`);
    return c;
  });
  console.log(`    kode kelas ${code}`);

  // ── Dua siswa di dua proses browser berbeda ──
  const [a, b] = await step('Dua siswa (2 browser terpisah) masuk dengan kode, absen & nama → menunggu persetujuan', () => Promise.all([studentJoin(code, 7, 'Raka'), studentJoin(code, 12, 'Sinta')]));
  browsers.push(a.browser, b.browser);
  await step('Dashboard menampilkan 2 permintaan masuk → guru menyetujui', async () => {
    await teacher.getByText('2 menunggu persetujuan').waitFor({ timeout: 15000 });
    await shot(teacher, 'g3-permintaan-masuk');
    await teacher.getByRole('button', { name: /Setujui Semua/ }).click();
    await teacher.getByText('2 siswa online').waitFor({ timeout: 15000 });
  });
  await step('Siswa memilih karakter berbeda (Astronot & Srikandi Cahaya) → ruang tunggu → SIAP', () => Promise.all([studentPick(a, 0), studentPick(b, 4)]));
  await step('Dashboard menampilkan karakter pilihan tiap siswa', async () => {
    await teacher.getByRole('cell', { name: 'Astronot Bintang' }).waitFor({ timeout: 15000 });
    await teacher.getByRole('cell', { name: 'Srikandi Cahaya' }).waitFor({ timeout: 15000 });
    await shot(teacher, 'g3b-karakter');
  });

  await step('Guru menekan Mulai → kedua siswa masuk Dunia Kota', async () => {
    await teacher.getByRole('button', { name: '▶ Mulai Permainan' }).click();
    await Promise.all([a, b].map((s) => s.page.waitForFunction(() => window.__edu?.scene === 'kota', null, { timeout: 40000 })));
  });

  await step('Setiap siswa melihat siswa lain dengan karakter pilihannya (sinkron multipemain)', async () => {
    await Promise.all([a, b].map((s) => s.page.waitForFunction(() => window.__edu?.remotes >= 1, null, { timeout: 20000 })));
    // karakter pemain lain yang tampil = karakter yang dipilih pemain itu
    const seenByA = await a.page.evaluate(() => window.__edu.remoteChars);
    const seenByB = await b.page.evaluate(() => window.__edu.remoteChars);
    if (!seenByA.some((r) => r.nama === 'Sinta' && r.karakter === 4)) throw new Error(`A melihat ${JSON.stringify(seenByA)}`);
    if (!seenByB.some((r) => r.nama === 'Raka' && r.karakter === 0)) throw new Error(`B melihat ${JSON.stringify(seenByB)}`);
    await a.page.waitForTimeout(1500);
    await shot(a.page, 's1-kota-raka');
    await shot(b.page, 's2-kota-sinta');
  });

  const before = await a.page.evaluate(() => window.__edu.score);
  await step('Siswa A berjalan ke titik soal terdekat, menjawab, dan dinilai server', async () => {
    const pts = await a.page.evaluate(() => window.__eduDebug.openPoints());
    if (!pts.length) throw new Error('tidak ada titik soal aktif');
    const me = await a.page.evaluate(() => window.__edu.pos);
    // pilih titik terdekat yang ketinggiannya dekat tanah (bukan di atap/lantai atas)
    const cand = pts.filter((p) => p.y < me.y + 1.5).sort((p, q) => Math.hypot(p.x - me.x, p.z - me.z) - Math.hypot(q.x - me.x, q.z - me.z));
    let opened = false;
    for (const p of cand.slice(0, 4)) {
      await a.page.evaluate(({ x, z }) => window.__eduDebug.goTo(x, z), p);
      await a.page.waitForFunction(() => !window.__eduDebug.walking() || window.__edu.prompt === 'soal', null, { timeout: 60000 }).catch(() => undefined);
      await a.page.evaluate(() => window.__eduDebug.stop());
      if (await a.page.evaluate(() => window.__edu.prompt === 'soal')) {
        await a.page.evaluate(() => window.__eduDebug.action());
        opened = true;
        break;
      }
    }
    if (!opened) throw new Error('gagal mencapai titik soal');
    await shot(a.page, 's3-soal');
    await answerCurrentQuestion(a.page);
    // hasil: benar → LANJUT JELAJAH; belum tepat + kesempatan kedua → coba jawab lagi sekali
    await a.page.waitForTimeout(1500);
    if (!(await a.page.getByRole('button', { name: 'LANJUT JELAJAH' }).count()) && (await a.page.getByRole('button', { name: 'JAWAB' }).count())) await answerCurrentQuestion(a.page);
    await a.page.getByRole('button', { name: 'LANJUT JELAJAH' }).waitFor({ timeout: 10000 });
    await shot(a.page, 's4-hasil');
    await a.page.getByRole('button', { name: 'LANJUT JELAJAH' }).click();
  });
  const after = await a.page.evaluate(() => window.__edu.score);
  console.log(`    skor siswa A: ${before} → ${after}`);

  await step('Umpan jawaban siswa A muncul di Dashboard', async () => {
    await teacher.locator('.feed div b', { hasText: 'Raka (7)' }).first().waitFor({ timeout: 10000 });
    await shot(teacher, 'g4-umpan-jawaban');
  });

  await step('Guru mengakhiri permainan → hasil akhir tampil', async () => {
    teacher.once('dialog', (d) => d.accept());
    await teacher.getByRole('button', { name: '■ Akhiri Permainan' }).click();
    await teacher.getByRole('heading', { name: 'Hasil Akhir' }).waitFor({ timeout: 15000 });
    await Promise.all([a, b].map((s) => s.page.waitForFunction(() => window.__edu?.status === 'selesai', null, { timeout: 15000 })));
    await shot(teacher, 'g5-hasil');
  });

  await step('Guru menampilkan Podium 3D → kedua siswa pindah ke panggung podium', async () => {
    await teacher.getByRole('button', { name: /Tampilkan Podium/ }).click();
    await Promise.all([a, b].map((s) => s.page.waitForFunction(() => window.__edu?.scene === 'podium' && window.__edu.podium.length > 0, null, { timeout: 20000 })));
    await a.page.waitForTimeout(5000);
    await shot(a.page, 's5-podium');
  });

  await step('Avatar di podium = karakter pilihan masing-masing juara', async () => {
    const pod = await b.page.evaluate(() => window.__edu.podium);
    const want = { Raka: 0, Sinta: 4 };
    for (const p of pod) if (want[p.nama] !== undefined && want[p.nama] !== p.karakter) throw new Error(`podium ${JSON.stringify(pod)}`);
    if (!pod.length) throw new Error('podium kosong');
    console.log(`    podium: ${pod.map((p) => `#${p.rank} ${p.nama}=karakter ${p.karakter}`).join(', ')}`);
  });

  const errs = [...a.errors, ...b.errors];
  if (errs.length) console.log('  ! galat JS di klien siswa:', errs.slice(0, 5));
  console.log(`\nLULUS ${results.filter((r) => r.ok).length}/${results.length} langkah`);
} catch {
  console.log(`\nGAGAL — ${results.filter((r) => r.ok).length}/${results.length} langkah lulus`);
  process.exitCode = 1;
} finally {
  await Promise.all(browsers.map((b) => b.close().catch(() => undefined)));
}
