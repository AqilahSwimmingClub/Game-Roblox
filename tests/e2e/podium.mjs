/**
 * Uji Acara Podium Juara 3D — guru + 3 siswa di browser (HP potret, HP lanskap, tablet) + 3 siswa bot (protokol
 * Socket.IO siswa sungguhan) yang mengumpulkan poin dengan menjawab soal (dinilai server).
 *
 * Membuktikan:
 *  - peringkat podium = peringkat resmi server (top3 pada hasil akhir yang diterima bot), sama di semua perangkat;
 *  - urutan acara: pembukaan → juara 3 → juara 2 → crescendo → juara 1 → puncak, tersinkron jam server;
 *  - avatar juara = karakter asli pilihan pemenang;
 *  - musik podium aktif (tema berbeda dari dunia), sorak/tepuk tidak dobel;
 *  - sambung ulang & muat ulang halaman TIDAK memutar ulang acara;
 *  - Lewati/Tutup hanya memengaruhi perangkat itu, tidak mengubah juara;
 *  - overlay muat di layar potret/lanskap/tablet (tanpa geser horizontal), tangkapan layar tiap tahap.
 * Variabel: BASE_URL, WEB_URL, TEACHER_EMAIL, TEACHER_PASSWORD, SHOTS.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB_URL ?? BASE;
const EMAIL = process.env.TEACHER_EMAIL ?? 'guru@sekolah.id';
const PASS = process.env.TEACHER_PASSWORD ?? 'rahasia123';
const SHOTS = process.env.SHOTS ?? '';
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const v = await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name} (${Date.now() - t0} ms)${typeof v === 'string' ? ` — ${v}` : ''}`);
    return v;
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message).split('\n')[0] });
    console.log(`  ✘ ${name}: ${String(e.message).split('\n')[0]}`);
    return undefined;
  }
};

let cookie = '';
async function http(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${path}: ${j?.error ?? r.status}`);
  return j;
}
const ack = (s, ev, data) => new Promise((res) => s.timeout(15000).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'timeout' } : r)));

// ── Siswa bot: menjawab soal sungguhan (dinilai server) agar peringkat berasal dari permainan yang sah ──
class Bot {
  constructor(code, absen, nama, karakter) {
    Object.assign(this, { code, absen, nama, karakter, done: new Set(), answers: 0, correct: 0, ended: null, podium: [] });
  }
  async connect() {
    this.s = io(`${BASE}/play`, { transports: ['websocket'], forceNew: true });
    await new Promise((res, rej) => (this.s.once('connect', res), this.s.once('connect_error', rej)));
    this.s.on('game:ended', (m) => (this.ended = m));
    this.s.on('podium:show', (m) => this.podium.push(m));
    this.s.on('teleport', (p) => p && typeof p.x === 'number' && (this.pos = { x: p.x, y: p.y, z: p.z }));
    const j = await ack(this.s, 'join', { code: this.code });
    if (!j?.ok) throw new Error(`join ${j?.error}`);
    const c = await ack(this.s, 'identity:claim', { absen: this.absen, nama: this.nama });
    if (!c?.ok) throw new Error(`claim ${c?.error}`);
    await ack(this.s, 'avatar:set', { karakter: this.karakter, kulit: 1 });
    await ack(this.s, 'world:enter', { scene: 'lobi' });
    this.s.emit('ready:set', true);
  }
  async play(ms) {
    const r = await ack(this.s, 'world:enter', { scene: 'kota' });
    if (!r?.ok) throw new Error(`kota ${r?.error}`);
    this.pos = { ...r.spawn };
    const pts = r.points ?? [];
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const open = pts.filter((p) => !p.hidden && !this.done.has(p.id) && p.y < 2).sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z));
      const t = open[0];
      if (!t) break;
      // berjalan 5 m/dtk (validasi server), 10 Hz
      while (Math.hypot(t.x - this.pos.x, t.z - this.pos.z) > 1.4 && Date.now() < until) {
        const dx = t.x - this.pos.x;
        const dz = t.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const st = Math.min(d, 0.5);
        this.pos.x += (dx / d) * st;
        this.pos.z += (dz / d) * st;
        this.s.emit('player:state', { scene: 'kota', x: +this.pos.x.toFixed(2), y: 0.2, z: +this.pos.z.toFixed(2), ry: 0, anim: 1, riding: false });
        await sleep(100);
      }
      this.done.add(t.id);
      const i = await ack(this.s, 'point:interact', { pointId: t.id });
      if (!i?.ok) continue;
      const q = i.question;
      const answer = q.type === 'pg' ? { type: 'pg', index: (this.absen + this.answers) % q.options.length } : q.type === 'bs' ? { type: 'bs', value: (this.absen + this.answers) % 2 === 0 } : q.type === 'isian' ? { type: 'isian', text: String(1 + ((this.absen * 3 + this.answers) % 20)) } : { type: 'jodoh', pairs: q.options.map((_, k) => k) };
      const a = await ack(this.s, 'answer:submit', { token: q.token, answer });
      this.answers++;
      if (a?.ok && a.result?.correct) this.correct++;
      this.s.emit('question:close');
    }
  }
}

async function student(code, absen, nama, karakter, device) {
  const browser = await chromium.launch({ args: GL });
  const ctx = await browser.newContext({ ...device });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/?kode=${code}&debug=1`);
  const main = page.getByRole('button', { name: 'MAIN', exact: true });
  await main.waitFor({ timeout: 40000 });
  await main.click({ force: true });
  await page.getByText('Kamu yang mana?').waitFor({ timeout: 20000 });
  await page.getByPlaceholder('mis. 7').fill(String(absen));
  await page.getByPlaceholder('mis. Raka').fill(nama);
  await page.getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Pilih Karaktermu').waitFor({ timeout: 20000 });
  await page.locator(`.char-card[data-karakter="${karakter}"]`).click();
  await page.getByRole('button', { name: 'SIAP!' }).click();
  await page.getByText('Ruang Tunggu').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'SIAP', exact: true }).click();
  return { browser, page, errors, nama, karakter, absen, label: device.label };
}

const browsers = [];
const bots = [];
let code;
let sessionId;
try {
  console.log(`EDUVERSE uji podium → frontend ${WEB} · backend ${BASE}`);
  await http('/auth/login', { email: EMAIL, password: PASS });
  const sess = await http('/sessions', { title: 'Uji Podium Juara', className: '5P', settings: { durationMinutes: 15, requireApproval: false, showLeaderboard: true, density: 1 } });
  code = sess.code;
  sessionId = sess.id;
  console.log(`    kode kelas ${code}`);

  const pixel = devices['Pixel 7'];
  const studs = await step('3 siswa browser (HP potret, HP lanskap, tablet) masuk & memilih karakter berbeda', () =>
    Promise.all([
      student(code, 1, 'Ayu', 3, { ...pixel, label: 'hp-potret' }),
      student(code, 2, 'Bima', 9, { ...devices['Pixel 7 landscape'], label: 'hp-lanskap' }),
      student(code, 3, 'Citra', 15, { ...devices['iPad (gen 7)'], label: 'tablet' }),
    ]),
  );
  if (!studs) throw new Error('siswa gagal masuk');
  browsers.push(...studs.map((s) => s.browser));
  const [A, B, C] = studs;

  for (const [absen, nama, kar] of [[21, 'Dewi', 6], [22, 'Eka', 11], [23, 'Fajar', 17]]) bots.push(new Bot(code, absen, nama, kar));
  await step('3 siswa bot tersambung (protokol siswa) & memilih karakter', () => Promise.all(bots.map((b) => b.connect())));

  await step('Guru memulai → siswa & bot bermain; bot menjawab soal (dinilai server)', async () => {
    await http(`/sessions/${sessionId}/start`, {});
    await Promise.all(studs.map((s) => s.page.waitForFunction(() => window.__edu?.scene === 'kota', null, { timeout: 60000 })));
    await sleep(3500);
    await Promise.all(bots.map((b) => b.play(40000)));
    return bots.map((b) => `${b.nama}: ${b.correct}/${b.answers} benar`).join(', ');
  });

  await step('Guru mengakhiri permainan → server mengunci peringkat', async () => {
    await http(`/sessions/${sessionId}/end`, {});
    for (let i = 0; i < 50 && !bots[0].ended; i++) await sleep(200);
    if (!bots[0].ended?.top3?.length) throw new Error('hasil akhir tidak diterima');
    return bots[0].ended.top3.map((t) => `${t.rank}. ${t.nama} (${t.poin})`).join(' · ');
  });
  const official = bots[0].ended?.top3 ?? [];

  // Guru menekan tombol di Dashboard (UI sungguhan)
  const tb = await chromium.launch();
  browsers.push(tb);
  const teacher = await (await tb.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await step('Guru menekan "Tampilkan Podium 3D" di Dashboard', async () => {
    await teacher.goto(`${WEB}/guru/#/masuk`);
    await teacher.getByPlaceholder('nama@sekolah.sch.id').fill(EMAIL);
    await teacher.getByPlaceholder('Minimal 8 karakter').fill(PASS);
    await teacher.getByRole('button', { name: 'Masuk', exact: true }).click();
    await teacher.getByRole('heading', { name: 'Beranda' }).waitFor({ timeout: 15000 });
    await teacher.goto(`${WEB}/guru/#/sesi/${sessionId}`);
    await teacher.getByRole('button', { name: /Tampilkan Podium 3D/ }).click({ timeout: 20000 });
  });

  // Rekam tiap perangkat secara PARALEL (fase, kartu, judul, kecocokan overlay, tangkapan layar). Linimasa berjalan
  // menurut jam server, jadi uji tidak boleh "menunggu" fase satu per satu (tangkapan layar SwiftShader lambat).
  const overlayFits = () => {
    const vw = innerWidth;
    const vh = innerHeight;
    const bad = [];
    for (const sel of ['.podium-judul', '.podium-kartu', '.podium-trio', '.podium-lewati']) {
      const el = document.querySelector(sel);
      if (!el || getComputedStyle(el).display === 'none' || getComputedStyle(el).opacity === '0' || !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) bad.push(`${sel} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} di ${vw}×${vh}`);
    }
    if (document.documentElement.scrollWidth > vw + 1) bad.push('geser horizontal');
    return bad;
  };
  const SHOT_AT = { pembukaan: [1.8, '1-pembukaan'], juara3: [2.4, '2-juara3'], juara2: [2.4, '3-juara2'], juara1: [2.6, '4-juara1'], puncak: [2.5, '5-puncak'] };
  const timeline = new Map(studs.map((s) => [s.label, []]));
  let recording = true;
  const recordPage = async (s) => {
    const tl = timeline.get(s.label);
    const shotDone = new Set();
    while (recording) {
      const st = await s.page.evaluate(() => {
        const p = window.__edu?.podiumShow;
        return p && { phase: p.phase, elapsed: p.elapsed, ended: p.ended, card: document.querySelector('.podium-kartu')?.innerText ?? '', title: document.querySelector('.podium-judul')?.innerText ?? '', trio: document.querySelectorAll('.podium-trio.tampil .podium-mini').length };
      }).catch(() => null);
      if (st && !st.ended) {
        let cur = tl.at(-1);
        if (cur?.phase !== st.phase) tl.push((cur = { phase: st.phase, elapsed: st.elapsed, at: Date.now(), cards: new Set(), titles: new Set(), trio: 0, bad: [] }));
        if (st.card) cur.cards.add(st.card.replace(/\s+/g, ' '));
        if (st.title) cur.titles.add(st.title.replace(/\s+/g, ' '));
        cur.trio = Math.max(cur.trio, st.trio);
        const sa = SHOT_AT[st.phase];
        if (sa && !shotDone.has(st.phase) && st.elapsed - cur.elapsed >= sa[0]) {
          shotDone.add(st.phase);
          cur.bad.push(...(await s.page.evaluate(overlayFits)));
          if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/podium-${sa[1]}-${s.label}.png` });
        }
      }
      await sleep(150);
    }
  };
  const recorder = Promise.all(studs.map(recordPage));
  const waitPhase = (pg, ph, ms = 30000) => pg.waitForFunction((p) => window.__edu?.podiumShow?.phase === p, ph, { timeout: ms });

  await step('Semua perangkat masuk panggung podium dengan acara (id) yang sama', async () => {
    await Promise.all(studs.map((s) => s.page.waitForFunction(() => window.__edu?.scene === 'podium' && window.__edu.podiumShow, null, { timeout: 30000 })));
    const ids = await Promise.all(studs.map((s) => s.page.evaluate(() => window.__edu.podiumShow.id)));
    if (new Set(ids).size !== 1) throw new Error(`id berbeda ${ids}`);
    if (bots[0].podium[0]?.id !== ids[0]) throw new Error('id bot berbeda');
  });

  await step('Juara & urutan di podium = peringkat resmi server, identik di semua perangkat', async () => {
    const lists = await Promise.all(studs.map((s) => s.page.evaluate(() => window.__edu.podiumShow.juara)));
    const want = JSON.stringify(official.map((t) => ({ rank: t.rank, nama: t.nama, poin: t.poin, karakter: t.avatar.karakter })));
    for (const l of lists) if (JSON.stringify(l) !== want) throw new Error(`podium ${JSON.stringify(l)} ≠ resmi ${want}`);
    return lists[0].map((j) => `Juara ${j.rank} ${j.nama} ${j.poin} poin`).join(' · ');
  });

  await step('Avatar di podium = karakter asli pilihan pemenang', async () => {
    const chosen = Object.fromEntries([...studs.map((s) => [s.nama, s.karakter]), ...bots.map((b) => [b.nama, b.karakter])]);
    const pod = await A.page.evaluate(() => window.__edu.podium);
    for (const p of pod) if (chosen[p.nama] !== p.karakter) throw new Error(`${p.nama}: karakter ${p.karakter}, dipilih ${chosen[p.nama]}`);
    return pod.map((p) => `${p.nama}=karakter ${p.karakter}`).join(', ');
  });

  await step('Musik dunia berganti halus ke musik podium (tema & fase sendiri)', async () => {
    await A.page.waitForFunction(() => ['pembukaan', 'juara3'].includes(window.__edu?.podiumShow?.phase), null, { timeout: 20000 });
    const m = await A.page.evaluate(() => window.__edu.music);
    if (m.want !== 'podium') throw new Error(`musik ${JSON.stringify(m)}`);
    return `tema ${m.theme ?? m.want}, fase ${m.variant}, audio berjalan: ${m.running}`;
  });

  await step('Sambung ulang di tengah acara TIDAK memutar ulang (HP lanskap)', async () => {
    await B.page.waitForFunction(() => ['juara2', 'crescendo', 'juara1'].includes(window.__edu?.podiumShow?.phase), null, { timeout: 60000 });
    const before = await B.page.evaluate(() => window.__edu.podiumShow);
    await B.page.evaluate(() => window.__eduDebug.dropConnection());
    await B.page.waitForFunction(() => window.__edu.net.connected && window.__edu.net.reconnects > 0, null, { timeout: 30000 });
    await B.page.waitForTimeout(1500);
    const after = await B.page.evaluate(() => window.__edu.podiumShow);
    if (after.id !== before.id || after.elapsed < before.elapsed || ['menunggu', 'pembukaan'].includes(after.phase) || after.ended) throw new Error(`${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    return `${before.phase} ${before.elapsed}s → ${after.phase} ${after.elapsed}s (id sama, berlanjut)`;
  });

  await step('Tombol Tutup di puncak hanya menutup perangkat itu; juara tidak berubah; kontrol kembali', async () => {
    await A.page.waitForFunction(() => window.__edu?.podiumShow?.phase === 'puncak' && window.__edu.podiumShow.elapsed > 0, null, { timeout: 60000 });
    // biarkan perekam mengambil tangkapan layar puncak dulu
    await A.page.waitForFunction(() => window.__edu.podiumShow.elapsed >= 0, null).then(() => sleep(6000));
    await A.page.locator('[data-testid="podium-lewati"]').click();
    await A.page.waitForFunction(() => window.__edu.podiumShow?.ended && !window.__edu.input.locks.length, null, { timeout: 5000 });
    const others = await Promise.all([B, C].map((s) => s.page.evaluate(() => window.__edu.podiumShow)));
    if (others.some((o) => o.ended)) throw new Error('perangkat lain ikut tertutup');
    const pod = await A.page.evaluate(() => window.__edu.podium);
    if (JSON.stringify(pod.map((p) => p.nama)) !== JSON.stringify(official.map((t) => t.nama))) throw new Error('juara berubah');
  });

  await step('Linimasa tersinkron jam server di semua perangkat', async () => {
    const samples = await Promise.all([B, C].map((s) => s.page.evaluate(() => ({ e: window.__edu.podiumShow?.elapsed, now: Date.now() }))));
    const ref = samples[0].now;
    const norm = samples.map((x) => x.e - (x.now - ref) / 1000);
    const spread = Math.round(Math.abs(norm[0] - norm[1]) * 1000);
    if (spread > 400) throw new Error(`selisih ${spread} ms`);
    return `selisih linimasa HP lanskap vs tablet ${spread} ms (resolusi 100 ms)`;
  });

  await C.page.waitForFunction(() => ['puncak', 'selesai'].includes(window.__edu?.podiumShow?.phase), null, { timeout: 60000 }).catch(() => undefined);
  await sleep(4000);
  recording = false;
  await recorder;

  await step('Urutan acara benar (pembukaan → juara 3 → juara 2 → crescendo → juara 1 → puncak)', async () => {
    const want = ['pembukaan', ...(official.some((t) => t.rank === 3) ? ['juara3'] : []), ...(official.some((t) => t.rank === 2) ? ['juara2'] : []), 'crescendo', 'juara1', 'puncak'];
    const out = [];
    for (const s of [A, B]) {
      const seq = timeline.get(s.label).map((x) => x.phase).filter((p) => p !== 'menunggu');
      if (JSON.stringify(seq) !== JSON.stringify(want)) throw new Error(`${s.label}: ${seq}`);
      out.push(s.label);
    }
    return `${want.join(' → ')} (${out.join(', ')})`;
  });

  for (const [ph, rank] of [['juara3', 3], ['juara2', 2], ['juara1', 1]]) {
    if (!official.some((t) => t.rank === rank)) continue;
    await step(`Juara ${rank}: avatar naik ke podium ${rank}, kartu nama & poin jelas`, async () => {
      const e = official.find((t) => t.rank === rank);
      for (const s of [A, B]) {
        const seg = timeline.get(s.label).find((x) => x.phase === ph);
        if (!seg) throw new Error(`${s.label}: fase ${ph} tidak terekam`);
        const card = [...seg.cards].join(' | ');
        if (!card.includes(e.nama) || !card.includes(`${e.poin} poin`) || !card.includes(`JUARA ${rank}`)) throw new Error(`${s.label} kartu: ${card}`);
      }
      return `kartu "${[...timeline.get('hp-potret').find((x) => x.phase === ph).cards][0]}"`;
    });
  }

  await step('Judul pembukaan & puncak tampil; ketiga juara di kartu puncak', async () => {
    const segs = timeline.get('hp-potret');
    const t1 = [...(segs.find((x) => x.phase === 'pembukaan')?.titles ?? [])].join();
    const t2 = segs.find((x) => x.phase === 'puncak');
    if (!/PODIUM JUARA EDUVERSE/.test(t1)) throw new Error(`pembukaan: ${t1}`);
    if (!/SELAMAT PARA JUARA/.test([...(t2?.titles ?? [])].join())) throw new Error('puncak tanpa judul');
    if (t2.trio !== Math.min(3, official.length)) throw new Error(`kartu juara ${t2.trio}`);
  });

  await step('Overlay muat di layar potret, lanskap & tablet (tanpa terpotong / geser horizontal)', async () => {
    const bad = studs.flatMap((s) => timeline.get(s.label).flatMap((x) => x.bad.map((b) => `${s.label}/${x.phase}: ${b}`)));
    if (bad.length) throw new Error(bad.slice(0, 3).join('; '));
    const n = studs.reduce((a, s) => a + timeline.get(s.label).filter((x) => SHOT_AT[x.phase]).length, 0);
    return `${n} tahap diperiksa`;
  });

  await step('Sorak & tepuk tangan tidak dobel (tiap tahap sekali)', async () => {
    const st = await A.page.evaluate(() => window.__edu.podiumShow);
    const dup = st.sounds.filter((x, i) => st.sounds.indexOf(x) !== i);
    if (dup.length) throw new Error(`dobel ${dup}`);
    return st.sounds.length ? st.sounds.join(', ') : 'audio headless belum berjalan (tidak ada suara dijadwalkan)';
  });

  await step('Muat ulang halaman setelah puncak TIDAK mengulang acara (tablet)', async () => {
    await C.page.reload();
    const main = C.page.getByRole('button', { name: 'MAIN', exact: true });
    await main.waitFor({ timeout: 40000 });
    await main.click({ force: true });
    await C.page.waitForFunction(() => window.__edu?.podiumShow, null, { timeout: 40000 });
    const st = await C.page.evaluate(() => window.__edu.podiumShow);
    if (!['puncak', 'selesai'].includes(st.phase)) throw new Error(`fase ${st.phase} ${st.elapsed}s`);
    const want = JSON.stringify(official.map((t) => t.nama));
    if (JSON.stringify(st.juara.map((j) => j.nama)) !== want) throw new Error('juara berubah');
    return `lanjut di ${st.phase} (${st.elapsed}s), juara sama`;
  });

  await step('Acara podium baru ("Tampilkan Podium Lagi") → Lewati langsung ke puncak di satu perangkat saja', async () => {
    await teacher.getByRole('button', { name: /Tampilkan Podium Lagi/ }).click({ timeout: 15000 });
    await Promise.all([A, B].map((s) => s.page.waitForFunction((old) => window.__edu.podiumShow && window.__edu.podiumShow.id !== old && !window.__edu.podiumShow.ended, bots[0].podium[0].id, { timeout: 30000 })));
    await waitPhase(B.page, 'pembukaan', 20000);
    await B.page.locator('[data-testid="podium-lewati"]').click();
    await waitPhase(B.page, 'puncak', 5000);
    const a = await A.page.evaluate(() => window.__edu.podiumShow);
    if (a.phase === 'puncak') throw new Error('perangkat lain ikut melompat');
    const b = await B.page.evaluate(() => window.__edu.podiumShow);
    if (JSON.stringify(b.juara) !== JSON.stringify(a.juara)) throw new Error('juara berbeda');
    if (SHOTS) await B.page.screenshot({ path: `${SHOTS}/podium-6-lewati-hp-lanskap.png` });
    return `B: ${b.phase} (dilewati), A: ${a.phase}`;
  });

  recording = false;
  await recorder;
  await step('Tanpa galat JS di perangkat siswa', async () => {
    const errs = studs.flatMap((s) => s.errors.map((e) => `${s.label}: ${e}`));
    if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
    const fps = await Promise.all(studs.map((s) => s.page.evaluate(() => ({ fps: Math.round(window.__edu.fps), low: window.__edu.podiumShow?.lowFx }))));
    return `FPS SwiftShader (bukan angka HP): ${fps.map((f, i) => `${studs[i].label} ${f.fps}${f.low ? ' efek-hemat' : ''}`).join(', ')}`;
  });
} catch (e) {
  console.log(`  ✘ galat: ${e.message}`);
  results.push({ name: 'alur', ok: false, error: e.message });
} finally {
  for (const b of bots) b.s?.disconnect();
  await Promise.all(browsers.map((b) => b.close().catch(() => undefined)));
}
const ok = results.filter((r) => r.ok).length;
console.log(`\nPodium Juara 3D: ${ok}/${results.length} lulus`);
process.exit(ok === results.length ? 0 : 1);
