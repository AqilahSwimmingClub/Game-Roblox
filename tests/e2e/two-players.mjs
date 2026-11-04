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
  await step('Siswa memilih karakter berbeda (Astronot & Superhero Putri) → ruang tunggu → SIAP', () => Promise.all([studentPick(a, 0), studentPick(b, 4)]));
  await step('Dashboard menampilkan karakter pilihan tiap siswa', async () => {
    await teacher.getByRole('cell', { name: 'Astronot', exact: true }).waitFor({ timeout: 15000 });
    await teacher.getByRole('cell', { name: 'Superhero Putri' }).waitFor({ timeout: 15000 });
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

  // ───────── Kota Hidup multipemain: kendaraan, jetpack, lubang dimensi, validasi server, sambung ulang ─────────
  const goTo = async (pg, x, z, until = null, ms = 90000) => {
    await pg.evaluate(({ x, z }) => window.__eduDebug.goTo(x, z), { x, z });
    await pg.waitForFunction((u) => !window.__eduDebug.walking() || (u && window.__edu.prompt === u), until, { timeout: ms }).catch(() => undefined);
    await pg.evaluate(() => window.__eduDebug.stop());
  };
  const edu = (pg) => pg.evaluate(() => window.__edu);
  await step('Server menolak kendaraan/portal/jetpack dari jauh (validasi tepercaya)', async () => {
    const r = await a.page.evaluate(async () => {
      const d = window.__eduDebug.raw;
      return [await d.enterVehicle('PESAWAT25'), await d.useRift('R_PASAR'), await d.setJetpack(true, 'JP_TAMAN')];
    });
    if (r.some((x) => x.ok)) throw new Error(JSON.stringify(r));
    console.log(`    ditolak: ${r.map((x) => x.error).join(' | ')}`);
  });
  await step('Siswa A naik mobil → siswa B melihat A mengendarai mobil', async () => {
    await goTo(a.page, 47, 50, 'kendaraan');
    if ((await edu(a.page)).prompt !== 'kendaraan') throw new Error(`prompt ${(await edu(a.page)).prompt}`);
    const pid = (await edu(a.page)).mobility.promptId;
    await a.page.evaluate(() => window.__eduDebug.action());
    const okEnter = await a.page.waitForFunction(() => ['mobil', 'motor', 'sepeda'].includes(window.__edu.mobility?.mode), null, { timeout: 8000 }).then(() => true, () => false);
    if (!okEnter) throw new Error(`tidak bisa naik ${pid}: ${JSON.stringify(await a.page.evaluate((id) => window.__eduDebug.raw.enterVehicle(id), pid))} pos=${JSON.stringify((await edu(a.page)).pos)}`);
    const kind = (await edu(a.page)).mobility.mode;
    await b.page.waitForFunction((k) => window.__edu.remoteModes.some((r) => r.nama === 'Raka' && r.mode === k && r.vehicleVisible), kind, { timeout: 10000 });
    await b.page.waitForFunction(() => window.__edu.vehicles.some((v) => v.driver), null, { timeout: 5000 });
    await a.page.evaluate(() => window.__eduDebug.control({ gas: true }));
    await a.page.waitForTimeout(2500);
    await a.page.evaluate(() => window.__eduDebug.control({ gas: false, brake: true }));
    await a.page.waitForTimeout(2000);
    await a.page.evaluate(() => window.__eduDebug.control({ brake: false }));
    const seen = (await edu(b.page)).remoteModes.find((r) => r.nama === 'Raka');
    await shot(b.page, 's3b-b-melihat-a-berkendara');
    await a.page.evaluate(() => window.__eduDebug.action()); // turun
    const okExit = await a.page.waitForFunction(() => window.__edu.mobility?.mode === 'jalan', null, { timeout: 8000 }).then(() => true, () => false);
    if (!okExit) throw new Error(`gagal turun: ${JSON.stringify((await edu(a.page)).mobility)} prompt=${(await edu(a.page)).prompt} teks=${(await a.page.locator('.notify-wrap').innerText()).slice(0, 200)}`);
    await b.page.waitForFunction(() => window.__edu.remoteModes.some((r) => r.nama === 'Raka' && r.mode === 'jalan' && !r.vehicleVisible), null, { timeout: 10000 });
    await b.page.waitForFunction(() => !window.__edu.vehicles.some((v) => v.driver), null, { timeout: 5000 });
    console.log(`    B melihat Raka mengendarai ${kind} di (${seen.x}, ${seen.z}); setelah turun kendaraan diparkir di posisi baru untuk semua pemain`);
  });
  await step('Siswa A memakai jetpack → siswa B melihat jetpack & A terbang', async () => {
    await goTo(a.page, -30, 31, 'jetpack');
    if ((await edu(a.page)).prompt !== 'jetpack') throw new Error(`prompt ${(await edu(a.page)).prompt}`);
    await a.page.evaluate(() => window.__eduDebug.action());
    await a.page.waitForFunction(() => window.__edu.mobility?.mode === 'jetpack', null, { timeout: 8000 });
    await a.page.keyboard.down('Space');
    await a.page.waitForFunction(() => window.__edu.pos.y > 12, null, { timeout: 10000 });
    await a.page.keyboard.up('Space');
    await b.page.waitForFunction(() => window.__edu.remoteModes.some((r) => r.nama === 'Raka' && r.mode === 'jetpack' && r.jetpackVisible && r.y > 8), null, { timeout: 10000 });
    await shot(b.page, 's3c-b-melihat-a-jetpack');
    await a.page.keyboard.down('KeyC');
    await a.page.waitForFunction(() => window.__edu.pos.y < 0.5, null, { timeout: 15000 });
    await a.page.keyboard.up('KeyC');
    await a.page.keyboard.press('KeyF');
    await a.page.waitForFunction(() => window.__edu.mobility?.mode === 'jalan', null, { timeout: 8000 });
  });
  const scoreBeforeRift = (await edu(a.page)).score;
  await step('Siswa A masuk lubang dimensi Alun-alun → Bandara; avatar & skor tetap; server menerima posisi baru', async () => {
    await goTo(a.page, 24, 22); // memutari Menara Jam
    await goTo(a.page, 26, -26);
    await a.page.waitForFunction(() => window.__edu.pos.x > 600, null, { timeout: 10000 });
    await a.page.waitForTimeout(3000);
    const e = await edu(a.page);
    if (e.pos.x < 600) throw new Error(`posisi dikoreksi server: ${JSON.stringify(e.pos)}`);
    if (e.score !== scoreBeforeRift || e.myChar !== 0) throw new Error(`skor/karakter berubah ${e.score} ${e.myChar}`);
    await shot(a.page, 's3d-bandara');
    console.log(`    tiba di (${e.pos.x.toFixed(0)}, ${e.pos.z.toFixed(0)}) · skor ${e.score} · karakter ${e.myChar}`);
  });
  await step('Siswa A membeli di kios Bandara (server): saldo berkurang, tas bertambah, aturan ditegakkan server', async () => {
    const far = await a.page.evaluate(() => window.__eduDebug.raw.buy('V01', 'apel', 1));
    if (far.ok) throw new Error('membeli dari pedagang jauh diterima');
    await goTo(a.page, 760, 95, 'pedagang');
    if ((await edu(a.page)).prompt !== 'pedagang') throw new Error(`prompt ${(await edu(a.page)).prompt}`);
    const fake = await a.page.evaluate(() => window.__eduDebug.raw.buy('V09', 'atlas-indonesia', 1));
    if (fake.ok || !/tidak dijual/.test(fake.error)) throw new Error('barang yang tidak dijual diterima');
    const s0 = (await edu(a.page)).mobility.saldo;
    const r = await a.page.evaluate(() => window.__eduDebug.raw.buy('V09', 'roti', 1));
    if (!r.ok || r.saldo !== s0 - 6000 || r.tas.roti !== 1) throw new Error(`beli: ${JSON.stringify(r)} saldo awal ${s0}`);
    const over = await a.page.evaluate(() => window.__eduDebug.raw.buy('V09', 'roti', 5));
    if (r.saldo < 30000 && (over.ok || !over.kurang)) throw new Error(`uang kurang tidak ditolak: ${JSON.stringify(over)}`);
    const air = await a.page.evaluate(() => window.__eduDebug.raw.buy('V09', 'air-mineral', 2));
    const used = await a.page.evaluate(() => window.__eduDebug.raw.useItem('air-mineral'));
    if (!air.ok || !used.ok || used.tas['air-mineral'] !== 1) throw new Error(`air/pakai: ${JSON.stringify(air)} ${JSON.stringify(used)}`);
    await teacher.getByText(/Rp\d[\d.]* · 2 barang/).first().waitFor({ timeout: 10000 });
    console.log(`    ditolak: "${far.error}" · "${fake.error}" · "${over.error}"`);
    console.log(`    saldo ${s0} → ${used.saldo}, tas ${JSON.stringify(used.tas)}; Dashboard Guru menampilkan uang & isi tas`);
  });
  const tasSebelum = (await edu(a.page)).mobility.tas;

  await step('Sambung ulang saat mengendarai: kendaraan dilepas dengan aman, sesi & skor utuh', async () => {
    await goTo(a.page, 685, 171, 'kendaraan');
    if ((await edu(a.page)).prompt !== 'kendaraan') throw new Error(`prompt ${(await edu(a.page)).prompt}`);
    await a.page.evaluate(() => window.__eduDebug.action());
    await a.page.waitForFunction(() => window.__edu.mobility?.mode !== 'jalan', null, { timeout: 8000 });
    const id = (await edu(a.page)).mobility.vehicle.id;
    await a.page.context().setOffline(true);
    await a.page.waitForTimeout(30000);
    await a.page.context().setOffline(false);
    await a.page.waitForFunction(() => window.__edu.mobility?.mode === 'jalan' && window.__edu.scene === 'kota', null, { timeout: 40000 });
    await a.page.waitForFunction((vid) => window.__edu.vehicles.some((v) => v.id === vid && !v.driver), id, { timeout: 10000 });
    const e = await edu(a.page);
    if (e.score !== scoreBeforeRift) throw new Error('skor berubah');
    if (JSON.stringify(e.mobility.tas) !== JSON.stringify(tasSebelum)) throw new Error(`tas berubah setelah sambung ulang: ${JSON.stringify(e.mobility.tas)} vs ${JSON.stringify(tasSebelum)}`);
    console.log(`    setelah sambung ulang: mode ${e.mobility.mode}, ${id} diparkir (tanpa pengemudi), posisi (${e.pos.x.toFixed(0)}, ${e.pos.z.toFixed(0)}), skor ${e.score}, tas ${JSON.stringify(e.mobility.tas)} utuh`);
  });

  await step('Siswa A memberi barang ke siswa B (UI tas + server): hanya bila dekat, tas keduanya berubah, B diberi tahu', async () => {
    const idB = (await edu(b.page)).myId;
    const tasA0 = (await edu(a.page)).mobility.tas;
    // B masih jauh (di Kota), A di Bandara → ditolak server
    const far = await a.page.evaluate((id) => window.__eduDebug.raw.give(id, 'roti', 1), idB);
    if (far.ok || !/Dekati Sinta/.test(far.error)) throw new Error(`memberi dari jauh: ${JSON.stringify(far)}`);
    const self = await a.page.evaluate((id) => window.__eduDebug.raw.give(id, 'roti', 1), (await edu(a.page)).myId);
    if (self.ok) throw new Error('memberi ke diri sendiri diterima');
    // B menyusul lewat lubang dimensi Alun-alun → Bandara, lalu berjalan ke dekat A
    await goTo(b.page, 24, 22);
    await goTo(b.page, 26, -26);
    await b.page.waitForFunction(() => window.__edu.pos.x > 600, null, { timeout: 15000 });
    const pa = (await edu(a.page)).pos;
    await goTo(b.page, pa.x + 2, pa.z - 2);
    await a.page.waitForFunction(() => window.__eduDebug.friends(5.5).some((f) => f.nama === 'Sinta'), null, { timeout: 15000 });
    // A membuka tas (tombol B) → BERI Air Mineral → pilih Sinta
    await a.page.keyboard.press('KeyB');
    await a.page.getByRole('button', { name: 'Beri Air Mineral', exact: true }).click();
    await a.page.getByRole('button', { name: '🎁 Sinta', exact: true }).click();
    await a.page.getByText(/sudah diberikan ke Sinta/).waitFor({ timeout: 8000 });
    await shot(a.page, 's3e-beri-barang');
    await a.page.getByRole('button', { name: 'Tutup', exact: true }).click();
    await b.page.waitForFunction(() => window.__edu.giftsReceived >= 1 && window.__edu.mobility.tas['air-mineral'] === 1, null, { timeout: 8000 });
    // Notifikasi tampil bergiliran (3,2 dtk per banner, hingga 4 antre + 1 tampil ≈ 16 dtk) — di CI yang lambat
    // pesan hadiah bisa menunggu di belakang pesan lain, jadi beri waktu sepanjang antrean itu.
    // Banner pemberitahuan hanya 3,2 dtk; yang dicek adalah tanda yang bertahan: lencana 🎁 di tombol Tas
    // dan daftar "Hadiah terbaru" di dalam tas.
    await b.page.locator('.mv-wallet.ada-hadiah', { hasText: '🎁1' }).waitFor({ timeout: 10000 });
    await b.page.keyboard.press('KeyB');
    await b.page.locator('.gift-row', { hasText: 'Air Mineral ×1 dari Raka' }).waitFor({ timeout: 5000 });
    await shot(b.page, 's3f-terima-barang');
    await b.page.getByRole('button', { name: 'Tutup', exact: true }).click();
    await b.page.waitForFunction(() => window.__edu.mobility.giftsUnseen === 0, null, { timeout: 5000 });
    const tasA1 = (await edu(a.page)).mobility.tas;
    if ((tasA1['air-mineral'] ?? 0) !== (tasA0['air-mineral'] ?? 0) - 1) throw new Error(`tas A ${JSON.stringify(tasA0)} → ${JSON.stringify(tasA1)}`);
    const none = await a.page.evaluate((id) => window.__eduDebug.raw.give(id, 'air-mineral', 1), idB);
    if (none.ok) throw new Error('memberi barang yang sudah habis diterima');
    console.log(`    ditolak: "${far.error}" · "${self.error}" · "${none.error}"`);
    console.log(`    tas A ${JSON.stringify(tasA0)} → ${JSON.stringify(tasA1)} · tas B ${JSON.stringify((await edu(b.page)).mobility.tas)}`);
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
