/**
 * Uji Kota Hidup di Mode Demo (/demo.html) — tanpa server, sepenuhnya lewat kontrol game:
 * lalu lintas NPC, pedagang + misi, mobil, motor, sepeda, jetpack + mendarat di atap, pesawat (lepas landas,
 * terbang, mendarat), lubang dimensi, tidak terjebak di bangunan, FPS (GPU perangkat lunak).
 *   WEB_URL=http://localhost:4173 SHOTS=e2e-shots node tests/e2e/living-city.mjs
 */
import { createRequire } from 'node:module';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const WEB = process.env.WEB_URL ?? 'http://localhost:4173';
const SHOTS = process.env.SHOTS ?? '';
const results = [];
const pass = (name, detail = '') => (results.push({ name, ok: true, detail }), console.log(`  ✔ ${name}${detail ? ' — ' + detail : ''}`));
const fail = (name, detail) => (results.push({ name, ok: false, detail }), console.log(`  ✘ ${name} — ${detail}`));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
const page = await ctx.newPage();
const errors = [];
const netCalls = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME/.test(m.text()) && errors.push(m.text()));
page.on('request', (r) => /socket\.io|\/api\//.test(r.url()) && netCalls.push(r.url()));
const st = () => page.evaluate(() => window.__eduDemo.getState());
const api = (fn, ...args) => page.evaluate(([f, a]) => window.__eduDemo[f](...a), [fn, args]);
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (n) => SHOTS && (await page.screenshot({ path: `${SHOTS}/kota-${n}.png` }));
async function ensureWalking() {
  const s = await st();
  if (s.mobility.mode === 'jetpack') await page.keyboard.press('KeyF');
  else if (s.mobility.mode !== 'jalan') {
    await api('control', { gas: false, brake: true, up: false, down: false });
    await wait(1500);
    await api('control', { brake: false });
    await api('action');
  }
  await wait(500);
}
async function until(fn, ms, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await st();
    if (fn(s)) return s;
    await wait(step);
  }
  return st();
}

try {
  await page.goto(`${WEB}/demo.html`);
  await page.waitForFunction(() => !!window.__eduDemo, null, { timeout: 30000 });
  await wait(3000);
  const L = await api('layout');

  // 1. Berjalan
  {
    const a = (await st()).position;
    await api('setMove', 0, 1);
    await wait(1500);
    await api('setMove', 0, 0);
    const b = (await st()).position;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    d > 2 ? pass('Siswa berjalan di Kota', `${d.toFixed(1)} m`) : fail('Siswa berjalan di Kota', `hanya ${d.toFixed(2)} m`);
  }

  // 2. Lalu lintas NPC bergerak mengikuti jalan + berhenti di lampu merah (berdiri di trotoar dekat simpang)
  {
    await api('teleport', 222, 0.3, 30, 0);
    await wait(1500);
    const s1 = (await st()).traffic;
    await wait(3000);
    const s2 = (await st()).traffic;
    const moved = s1.sample.filter((c, i) => Math.hypot(c.x - s2.sample[i].x, c.z - s2.sample[i].z) > 1).length;
    let stopped = 0;
    for (let i = 0; i < 16 && !stopped; i++) {
      stopped = (await st()).traffic.stoppedAtLight;
      await wait(1000);
    }
    moved > 0 && s2.carsVisible > 0 && stopped > 0
      ? pass('Mobil NPC bergerak di jalur & berhenti di lampu merah', `${s2.cars} kendaraan, ${s2.carsVisible} dirender dekat pemain, ${stopped} berhenti di lampu, ${s2.peds} pejalan kaki (${s2.pedsVisible} dirender), state: ${JSON.stringify(s2.states)}`)
      : fail('Mobil NPC bergerak', `moved=${moved} visible=${s2.carsVisible} stoppedAtLight=${stopped}`);
  }

  // 3. Pedagang: bicara, lihat barang, terima misi, jawab
  {
    const v = L.vendors.find((x) => x.id === 'V03');
    await api('teleport', v.x, 0.3, v.z + 2, Math.PI);
    await wait(1200);
    const s = await st();
    if (s.prompt !== 'pedagang') fail('Pedagang dapat diajak bicara', `prompt=${s.prompt}`);
    else {
      await api('action');
      await wait(500);
      await page.getByRole('button', { name: 'BICARA', exact: true }).click();
      await page.getByRole('button', { name: 'LIHAT BARANG', exact: true }).click();
      const txt = await page.locator('body').innerText();
      await shot('pedagang');
      await page.getByRole('button', { name: 'TERIMA MISI', exact: true }).click();
      await wait(400);
      await page.locator('.opsi button').first().click();
      await wait(400);
      const fb = await page.locator('body').innerText();
      await shot('misi');
      await page.getByRole('button', { name: 'LANJUT JELAJAH', exact: true }).click();
      /Mas Joko/.test(txt) && /Rp/.test(txt) && /(BENAR|Belum tepat)/.test(fb) ? pass('Pedagang dapat diajak bicara + misi edukasi', 'BICARA, LIHAT BARANG (harga Rp), TERIMA MISI → soal pecahan uang dinilai') : fail('Pedagang', 'dialog/misi tidak lengkap');
    }
  }

  // 4–6. Mobil, motor, sepeda: naik → gas → rem → turun
  for (const kind of ['mobil', 'motor', 'sepeda']) {
    const v = L.vehicles.find((x) => x.kind === kind);
    await ensureWalking();
    await api('teleport', v.x, 0.3, v.z + 2.6, Math.PI);
    await wait(900);
    let s = await st();
    if (s.prompt !== 'kendaraan') {
      fail(`Naik ${kind}`, `prompt=${s.prompt} (${s.promptId})`);
      continue;
    }
    await api('action');
    s = await until((x) => x.mobility.mode === kind, 3000);
    if (s.mobility.mode !== kind) {
      fail(`Naik ${kind}`, `mode=${s.mobility.mode}`);
      continue;
    }
    const p0 = s.mobility.vehicle;
    await api('control', { gas: true });
    await wait(2200);
    s = await st();
    const sp = s.mobility.vehicle.speed;
    await shot(kind);
    await api('control', { gas: false, brake: true });
    await until((x) => Math.abs(x.mobility.vehicle?.speed ?? 0) < 0.5, 4000);
    await api('control', { brake: false });
    const p1 = (await st()).mobility.vehicle;
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const inside = await api('inside', p1.x, p1.y + 1, p1.z);
    await api('action'); // TURUN
    s = await until((x) => x.mobility.mode === 'jalan', 3000);
    const pos = s.position;
    const insideAfter = await api('inside', pos.x, pos.y + 1, pos.z);
    s.mobility.mode === 'jalan' && moved > 1 && !inside && !insideAfter
      ? pass(`Naik, mengendarai & turun ${kind}`, `kecepatan ${(sp * 3.6).toFixed(0)} km/j, bergerak ${moved.toFixed(1)} m, turun di (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}) tidak di dalam bangunan`)
      : fail(`Mengendarai ${kind}`, `mode=${s.mobility.mode} moved=${moved.toFixed(2)} inside=${inside}/${insideAfter}`);
  }

  // 7. Tidak menembus bangunan: tabrakkan mobil ke gedung
  {
    const v = L.vehicles.find((x) => x.kind === 'mobil');
    await ensureWalking();
    await api('teleport', v.x, 0.3, v.z + 2.6, Math.PI);
    await wait(700);
    await api('action');
    await until((x) => x.mobility.mode === 'mobil', 3000);
    await api('control', { gas: true });
    let maxInside = false;
    for (let i = 0; i < 16; i++) {
      await wait(500);
      const m = (await st()).mobility.vehicle;
      if (m && (await api('inside', m.x, m.y + 1, m.z))) maxInside = true;
    }
    await api('control', { gas: false, brake: true });
    await wait(1500);
    await api('control', { brake: false });
    await api('action');
    const s = await until((x) => x.mobility.mode === 'jalan', 3000);
    !maxInside && s.mobility.mode === 'jalan' ? pass('Kendaraan tidak menembus bangunan / pemain tidak terjebak', 'menyetir lurus 8 dtk: badan mobil tidak pernah berada di dalam kotak padat') : fail('Tabrakan', `inside=${maxInside} mode=${s.mobility.mode}`);
  }

  // 8. Jetpack: ambil, terbang naik, mendarat di atap gedung, turun ke jalan
  {
    await ensureWalking();
    const j = L.jetpacks.find((x) => x.id === 'JP_BISNIS');
    await api('teleport', j.x + 1, 0.3, j.z, 0);
    await wait(800);
    let s = await st();
    if (s.prompt !== 'jetpack') fail('Jetpack', `prompt=${s.prompt}`);
    else {
      await api('action');
      s = await until((x) => x.mobility.mode === 'jetpack', 3000);
      await api('setMove', 0, 0, true, false);
      s = await until((x) => x.position.y > 20, 6000);
      const climbed = s.position.y;
      await api('setMove', 0, 0, false, false);
      await shot('jetpack');
      // terbang ke atas Menara (gedung 42 m di -760,-60) lalu turun ke atapnya
      await api('teleport', -760, 50, -60, 0);
      await api('setMove', 0, 0, false, true);
      s = await until((x) => x.mobility.landedOnRoof, 8000);
      await api('setMove', 0, 0, false, false);
      const roofY = s.position.y;
      await shot('atap');
      // turun kembali ke jalan: terbang keluar dari tepi atap lalu turun
      await api('teleport', -730, roofY + 2, -60, 0);
      await api('setMove', 0, 0, false, true);
      s = await until((x) => x.position.y < 1 && x.mobility.mode === 'jetpack', 15000);
      await api('setMove', 0, 0, false, false);
      const ground = s.position.y;
      climbed > 20 && roofY > 40 && ground < 1
        ? pass('Jetpack terbang, mendarat di atap gedung, turun ke jalan', `naik ke ${climbed.toFixed(0)} m, mendarat di atap y=${roofY.toFixed(1)} m, kembali ke tanah y=${ground.toFixed(2)}, energi ${s.mobility.fuel}`)
        : fail('Jetpack', `climb=${climbed} roof=${roofY} ground=${ground}`);
      await page.keyboard.press('KeyF'); // matikan jetpack (keyboard F)
      await wait(600);
    }
  }

  // 9. Pesawat: naik, gas, lepas landas, terbang, mendarat, keluar
  {
    await ensureWalking();
    const v = L.vehicles.find((x) => x.kind === 'pesawat');
    await api('teleport', v.x, 0.3, v.z - 5, 0);
    await wait(900);
    let s = await st();
    if (s.prompt !== 'kendaraan') fail('Pesawat', `prompt=${s.prompt} ${s.promptId}`);
    else {
      await api('action');
      s = await until((x) => x.mobility.mode === 'pesawat', 3000);
      await api('control', { gas: true });
      s = await until((x) => (x.mobility.vehicle?.speed ?? 0) > 24, 15000);
      const runSpeed = s.mobility.vehicle.speed;
      await api('control', { gas: true, up: true });
      s = await until((x) => (x.mobility.vehicle?.y ?? 0) > 40, 15000);
      const alt = s.mobility.vehicle.y;
      await api('control', { up: false });
      await shot('pesawat');
      // belok kiri sebentar (A) agar tidak keluar zona, lalu turun & mendarat
      await api('setMove', -1, 0);
      await wait(2500);
      await api('setMove', 0, 0);
      await api('control', { gas: false, brake: true, down: true });
      s = await until((x) => x.mobility.vehicle?.grounded === true, 25000);
      await api('control', { down: false });
      s = await until((x) => (x.mobility.vehicle?.speed ?? 9) < 2, 30000);
      const landed = s.mobility.vehicle;
      await api('control', { brake: false });
      await wait(400);
      await api('action');
      s = await until((x) => x.mobility.mode === 'jalan', 3000);
      s.mobility.takeoffs >= 1 && alt > 40 && landed?.grounded && s.mobility.mode === 'jalan'
        ? pass('Pesawat lepas landas, terbang, mendarat, pilot keluar', `kecepatan landasan ${(runSpeed * 3.6).toFixed(0)} km/j, ketinggian maks ${s.mobility.maxAltitude.toFixed(0)} m, mendarat di (${landed.x}, ${landed.z})`)
        : fail('Pesawat', `takeoffs=${s.mobility.takeoffs} alt=${alt} landed=${JSON.stringify(landed)} mode=${s.mobility.mode}`);
    }
  }

  // 10. Lubang dimensi: Alun-alun → Bandara
  {
    await ensureWalking();
    const r = L.rifts.find((x) => x.id === 'R_ALUN');
    const dest = L.rifts.find((x) => x.id === 'R_BANDARA');
    await api('teleport', r.x, 0.3, r.z + 6, Math.PI);
    await wait(800);
    await api('teleport', r.x, 0.3, r.z, Math.PI);
    // titik keluar = 8 m di depan portal tujuan (RIFT_EXIT_DIST)
    const ex = { x: dest.x + Math.sin(dest.ry) * 8, z: dest.z + Math.cos(dest.ry) * 8 };
    const s = await until((x) => Math.hypot(x.position.x - ex.x, x.position.z - ex.z) < 3, 5000);
    await wait(600);
    await shot('portal');
    const d = Math.hypot(s.position.x - ex.x, s.position.z - ex.z);
    const s2 = await st();
    d < 3 && s2.mobility.rifts >= 1 ? pass('Lubang dimensi memindahkan pemain', `Alun-alun → ${dest.nama}, skor tetap ${s2.score}`) : fail('Lubang dimensi', `jarak ke titik keluar ${d.toFixed(1)} m`);
    // tidak teleport bolak-balik: tetap di bandara 3 dtk kemudian
    await wait(3000);
    const s3 = await st();
    Math.hypot(s3.position.x - ex.x, s3.position.z - ex.z) < 5 ? pass('Tidak ada teleport berulang tanpa sengaja') : fail('Teleport berulang', JSON.stringify(s3.position));
  }

  // 11. Peta besar menampilkan penanda Kota Hidup (portal, jetpack, parkir, pesawat, pedagang)
  {
    await page.click('#demo-map');
    await wait(400);
    const txt = await page.locator('body').innerText();
    const hasCanvas = (await page.locator('.screen canvas').count()) > 0;
    await shot('peta');
    await page.getByRole('button', { name: 'Tutup Peta', exact: true }).click();
    hasCanvas && ['Lubang dimensi', 'Jetpack', 'Parkir', 'Pesawat', 'Pedagang'].every((w) => txt.includes(w)) ? pass('Peta menampilkan portal, jetpack, parkir, pesawat, pedagang') : fail('Peta', 'kanvas/keterangan tidak lengkap');
  }

  const fps = (await st()).fps;
  pass('FPS terukur (GPU perangkat lunak SwiftShader — bukan angka HP)', `${fps.toFixed(1)} FPS`);
  if (errors.length) fail('Tanpa galat JS', errors.slice(0, 3).join(' | '));
  else pass('Tanpa galat JS');
  netCalls.length ? fail('Mode Demo tidak menghubungi server', netCalls[0]) : pass('Mode Demo tidak menghubungi server / tidak mengubah data resmi');
} catch (e) {
  fail('uji', e.stack ?? String(e));
} finally {
  await browser.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\nKota Hidup (Mode Demo): ${results.length - bad}/${results.length} lulus`);
  if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
  process.exitCode = bad ? 1 : 0;
}
