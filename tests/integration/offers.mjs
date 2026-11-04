/**
 * Uji hadiah & tukar barang dengan persetujuan (TERIMA/TOLAK) terhadap server sungguhan (Socket.IO + REST + PostgreSQL).
 * 3 siswa: A (pemberi), B, C. Semua aturan diperiksa di SERVER.
 *   OFFER_TTL_MS=8000 (di server) · BASE_URL=http://localhost:3000 node tests/integration/offers.mjs
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.TEACHER_EMAIL ?? 'guru@sekolah.id';
const PASS = process.env.TEACHER_PASSWORD ?? 'rahasia123';
const TTL = Number(process.env.OFFER_TTL_MS ?? 8000);
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
const expect = (c, m) => {
  if (!c) throw new Error(m);
};
let token = '';
async function http(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const emit = (s, ev, data, t = 8000) => new Promise((res) => s.timeout(t).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'timeout' } : r)));
const connected = (s) => new Promise((res, rej) => (s.connected ? res() : (s.once('connect', res), s.once('connect_error', rej))));

class Siswa {
  constructor(nama, absen) {
    this.nama = nama;
    this.absen = absen;
    this.offers = new Map();
    this.wallet = null;
    this.pos = null;
  }
  async connect(code, claimToken) {
    this.s = io(`${BASE}/play`, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.s.on('offer:list', (list) => list.forEach((o) => this.offers.set(o.id, o)));
    this.s.on('wallet:update', (w) => (this.wallet = w));
    await connected(this.s);
    const j = await emit(this.s, 'join', { code, claimToken });
    expect(j.ok, `${this.nama} join: ${j.error}`);
    if (!j.me) {
      const c = await emit(this.s, 'identity:claim', { absen: this.absen, nama: this.nama });
      expect(c.ok, `${this.nama} claim: ${c.error}`);
      this.token = c.token;
    }
    const e = await emit(this.s, 'world:enter', { scene: 'kota' });
    expect(e.ok, `${this.nama} masuk kota: ${e.error}`);
    this.pos = e.spawn;
    this.wallet = e.dompet;
    for (const o of e.offers ?? []) this.offers.set(o.id, o);
    return e;
  }
  /** Berjalan wajar (5 m/dtk, 10 paket/dtk) — server memvalidasi kecepatan. */
  async walk(x, z) {
    for (;;) {
      const dx = x - this.pos.x;
      const dz = z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) break;
      const st = Math.min(d, 0.5);
      this.pos = { ...this.pos, x: this.pos.x + (dx / d) * st, z: this.pos.z + (dz / d) * st };
      this.s.volatile.emit('player:state', { scene: 'kota', x: this.pos.x, y: this.pos.y, z: this.pos.z, ry: 0, anim: 1, riding: false });
      await sleep(100);
    }
    await sleep(150);
  }
  bag() {
    return this.wallet?.tas ?? {};
  }
  async waitOffer(id, status, t = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < t) {
      if (this.offers.get(id)?.status === status) return this.offers.get(id);
      await sleep(100);
    }
    throw new Error(`${this.nama}: status ${status} tidak diterima (kini ${this.offers.get(id)?.status})`);
  }
}

const A = new Siswa('Raka', 7);
const B = new Siswa('Sinta', 12);
const C = new Siswa('Dodi', 3);
try {
  console.log(`EDUVERSE uji hadiah & tukar (persetujuan) → ${BASE} · TTL ${TTL} ms`);
  const login = await http('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASS } });
  expect(login.status === 200, 'login guru gagal');
  token = login.body.token;
  const sess = await http('/sessions', { method: 'POST', body: { title: 'Uji hadiah', className: 'HDH', settings: { requireApproval: false, durationMinutes: 15 } } });
  const { id, code } = sess.body;
  expect((await http(`/sessions/${id}/start`, { method: 'POST' })).status === 200, 'mulai sesi');
  for (let i = 0; i < 40 && (await http(`/sessions/${id}`)).body.live.state.status !== 'berjalan'; i++) await sleep(250);
  for (const s of [A, B, C]) await s.connect(code);
  // semua berjalan ke kios Mas Joko (V03, -24,-18) lalu belanja dengan uang virtual
  await Promise.all([A.walk(-24, -15.5), B.walk(-22.8, -15.5), C.walk(-25.2, -15.5)]);
  for (const [s, itemId, qty] of [[A, 'air-mineral', 3], [A, 'es-jeruk', 2], [B, 'susu-kotak', 2], [C, 'air-mineral', 1]]) {
    const r = await emit(s.s, 'shop:buy', { vendorId: 'V03', itemId, qty });
    expect(r.ok, `${s.nama} beli ${itemId}: ${r.error}`);
    s.wallet = r;
  }
  const saldoAwal = { A: A.wallet.saldo, B: B.wallet.saldo, C: C.wallet.saldo };

  let giftId = '';
  await check('A meminta memberi 2 Air Mineral ke B → barang ditahan (escrow), B menerima permintaan "menunggu"', async () => {
    const r = await emit(A.s, 'offer:create', { kind: 'hadiah', toId: B.s.id, give: { itemId: 'air-mineral', qty: 2 } });
    expect(r.ok, r.error);
    giftId = r.offer.id;
    expect(r.tas['air-mineral'] === 1, `tas A ${JSON.stringify(r.tas)}`);
    const o = await B.waitOffer(giftId, 'menunggu');
    expect(o.dari.nama === 'Raka' && o.give.qty === 2, JSON.stringify(o));
    return `tas A ${JSON.stringify(r.tas)} · B melihat "${o.dari.nama} ingin memberikan ${o.give.qty} ${o.give.itemId}"`;
  });
  await check('Permintaan ganda ke teman yang sama ditolak (anti-spam)', async () => {
    const r = await emit(A.s, 'offer:create', { kind: 'hadiah', toId: B.s.id, give: { itemId: 'air-mineral', qty: 1 } });
    expect(!r.ok && /masih menunggu/.test(r.error), JSON.stringify(r));
    return r.error;
  });
  await check('B menekan TERIMA dua kali bersamaan → diproses tepat sekali (idempoten)', async () => {
    const [r1, r2] = await Promise.all([emit(B.s, 'offer:respond', { id: giftId, accept: true }), emit(B.s, 'offer:respond', { id: giftId, accept: true })]);
    expect([r1, r2].filter((r) => r.ok).length === 1, `${JSON.stringify(r1)} ${JSON.stringify(r2)}`);
    const ok = r1.ok ? r1 : r2;
    expect(ok.tas['air-mineral'] === 2, `tas B ${JSON.stringify(ok.tas)}`);
    await A.waitOffer(giftId, 'diterima');
    expect((A.wallet.tas['air-mineral'] ?? 0) === 1, `tas A ${JSON.stringify(A.wallet.tas)}`);
    return `tas B ${JSON.stringify(ok.tas)}; jawaban kedua: "${(r1.ok ? r2 : r1).error}"`;
  });
  let declineId = '';
  await check('C menekan TOLAK → barang kembali ke A, keduanya mendapat status "ditolak"', async () => {
    const r = await emit(A.s, 'offer:create', { kind: 'hadiah', toId: C.s.id, give: { itemId: 'es-jeruk', qty: 1 } });
    expect(r.ok && (r.tas['es-jeruk'] ?? 0) === 1, JSON.stringify(r));
    declineId = r.offer.id;
    await C.waitOffer(declineId, 'menunggu');
    const d = await emit(C.s, 'offer:respond', { id: declineId, accept: false });
    expect(d.ok, d.error);
    await A.waitOffer(declineId, 'ditolak');
    await sleep(200);
    expect(A.wallet.tas['es-jeruk'] === 2, `tas A ${JSON.stringify(A.wallet.tas)}`);
    expect(!C.wallet.tas['es-jeruk'], 'C malah menerima barang');
    return `tas A kembali ${JSON.stringify(A.wallet.tas)}`;
  });
  await check('Mengirim lagi ke teman yang baru menolak → jeda (tidak bisa mengganggu)', async () => {
    const r = await emit(A.s, 'offer:create', { kind: 'hadiah', toId: C.s.id, give: { itemId: 'es-jeruk', qty: 1 } });
    expect(!r.ok && /Tunggu \d+ detik/.test(r.error), JSON.stringify(r));
    return r.error;
  });
  await check('Uang virtual, barang yang tidak dimiliki, diri sendiri, jumlah > 3 → ditolak server', async () => {
    const tries = [
      [{ kind: 'hadiah', toId: B.s.id, give: { itemId: 'uang', qty: 1 } }, /tidak dikenal/],
      [{ kind: 'hadiah', toId: B.s.id, give: { itemId: 'atlas-indonesia', qty: 1 } }, /tidak cukup/],
      [{ kind: 'hadiah', toId: A.s.id, give: { itemId: 'es-jeruk', qty: 1 } }, /Pilih teman/],
      [{ kind: 'hadiah', toId: B.s.id, give: { itemId: 'es-jeruk', qty: 4 } }, /1–3/],
    ];
    const errs = [];
    for (const [data, re] of tries) {
      const r = await emit(A.s, 'offer:create', data);
      expect(!r.ok && re.test(r.error), `${JSON.stringify(data)} → ${JSON.stringify(r)}`);
      errs.push(r.error);
    }
    return errs.join(' · ');
  });
  await check(`Tidak dijawab ${TTL / 1000} dtk → kedaluwarsa, barang kembali ke pemberi`, async () => {
    const r = await emit(B.s, 'offer:create', { kind: 'hadiah', toId: C.s.id, give: { itemId: 'susu-kotak', qty: 1 } });
    expect(r.ok && (r.tas['susu-kotak'] ?? 0) === 1, JSON.stringify(r));
    await B.waitOffer(r.offer.id, 'kedaluwarsa', TTL + 4000);
    await sleep(300);
    expect(B.wallet.tas['susu-kotak'] === 2, `tas B ${JSON.stringify(B.wallet.tas)}`);
    const late = await emit(C.s, 'offer:respond', { id: r.offer.id, accept: true });
    expect(!late.ok, 'TERIMA setelah kedaluwarsa diterima');
    return `tas B kembali ${JSON.stringify(B.wallet.tas)}; jawaban terlambat: "${late.error}"`;
  });
  await check('Penerima putus koneksi saat permintaan aktif → tersambung lagi, pop-up dipulihkan, TERIMA berhasil', async () => {
    const r = await emit(A.s, 'offer:create', { kind: 'hadiah', toId: B.s.id, give: { itemId: 'air-mineral', qty: 1 } });
    expect(r.ok, r.error);
    await B.waitOffer(r.offer.id, 'menunggu');
    const tok = B.token;
    B.s.disconnect();
    B.offers.clear();
    await sleep(500);
    const e = await B.connect(code, tok);
    expect((e.offers ?? []).some((o) => o.id === r.offer.id), `daftar menunggu setelah masuk lagi: ${JSON.stringify(e.offers)}`);
    await B.walk(-22.8, -15.5);
    const acc = await emit(B.s, 'offer:respond', { id: r.offer.id, accept: true });
    expect(acc.ok && acc.tas['air-mineral'] === 3, JSON.stringify(acc));
    return `tas B ${JSON.stringify(acc.tas)}`;
  });
  await check('Guru mematikan "memberi barang" → permintaan menunggu dibatalkan, barang kembali, permintaan baru ditolak; dinyalakan lagi → normal', async () => {
    const r = await emit(A.s, 'offer:create', { kind: 'hadiah', toId: B.s.id, give: { itemId: 'es-jeruk', qty: 1 } });
    expect(r.ok, r.error);
    const off = await http(`/sessions/${id}`, { method: 'PATCH', body: { settings: { allowGifts: false } } });
    expect(off.status === 200, `PATCH ${off.status} ${JSON.stringify(off.body)}`);
    const o = await A.waitOffer(r.offer.id, 'dibatalkan');
    await sleep(200);
    expect(A.wallet.tas['es-jeruk'] === 2, `tas A ${JSON.stringify(A.wallet.tas)}`);
    const blocked = await emit(A.s, 'offer:create', { kind: 'hadiah', toId: B.s.id, give: { itemId: 'es-jeruk', qty: 1 } });
    expect(!blocked.ok && /dinonaktifkan guru/.test(blocked.error), JSON.stringify(blocked));
    expect((await http(`/sessions/${id}`, { method: 'PATCH', body: { settings: { allowGifts: true } } })).status === 200, 'nyalakan lagi');
    const again = await emit(A.s, 'offer:create', { kind: 'hadiah', toId: B.s.id, give: { itemId: 'es-jeruk', qty: 1 } });
    expect(again.ok, again.error);
    await emit(A.s, 'offer:cancel', { id: again.offer.id });
    return `alasan: "${o.reason}" · baru ditolak: "${blocked.error}"`;
  });
  await check('Tukar dua arah: A (Es Jeruk) ⇄ B (Susu Kotak), B melihat tas & TERIMA → atomik', async () => {
    await sleep(300);
    const peek = await emit(A.s, 'offer:peek', { toId: B.s.id });
    expect(peek.ok && peek.tas['susu-kotak'] >= 1, JSON.stringify(peek));
    const before = { a: { ...A.wallet.tas }, b: { ...B.wallet.tas } };
    const r = await emit(A.s, 'offer:create', { kind: 'tukar', toId: B.s.id, give: { itemId: 'es-jeruk', qty: 1 }, want: { itemId: 'susu-kotak', qty: 1 } });
    expect(r.ok, r.error);
    await B.waitOffer(r.offer.id, 'menunggu');
    const acc = await emit(B.s, 'offer:respond', { id: r.offer.id, accept: true });
    expect(acc.ok, acc.error);
    await A.waitOffer(r.offer.id, 'diterima');
    await sleep(300);
    expect((A.wallet.tas['susu-kotak'] ?? 0) === (before.a['susu-kotak'] ?? 0) + 1 && (A.wallet.tas['es-jeruk'] ?? 0) === before.a['es-jeruk'] - 1, `A ${JSON.stringify(before.a)} → ${JSON.stringify(A.wallet.tas)}`);
    expect((acc.tas['es-jeruk'] ?? 0) === (before.b['es-jeruk'] ?? 0) + 1 && (acc.tas['susu-kotak'] ?? 0) === before.b['susu-kotak'] - 1, `B ${JSON.stringify(before.b)} → ${JSON.stringify(acc.tas)}`);
    return `A ${JSON.stringify(A.wallet.tas)} · B ${JSON.stringify(acc.tas)}`;
  });
  await check('Tukar: penerima tidak punya barang yang diminta → TERIMA ditolak, permintaan tetap bisa ditolak', async () => {
    const data = { kind: 'tukar', toId: C.s.id, give: { itemId: 'susu-kotak', qty: 1 }, want: { itemId: 'jus-alpukat', qty: 1 } };
    let r = await emit(A.s, 'offer:create', data);
    const wait = /Tunggu (\d+) detik/.exec(r.error ?? ''); // jeda anti-spam dari penolakan sebelumnya
    if (wait) {
      await sleep((Number(wait[1]) + 1) * 1000);
      r = await emit(A.s, 'offer:create', data);
    }
    expect(r.ok, r.error);
    await C.waitOffer(r.offer.id, 'menunggu');
    const acc = await emit(C.s, 'offer:respond', { id: r.offer.id, accept: true });
    expect(!acc.ok && /tidak punya/.test(acc.error), JSON.stringify(acc));
    expect((await emit(C.s, 'offer:respond', { id: r.offer.id, accept: false })).ok, 'tolak');
    await A.waitOffer(r.offer.id, 'ditolak');
    return acc.error;
  });
  await check('Guru mematikan "tukar barang" → tukar ditolak, hadiah tetap boleh', async () => {
    expect((await http(`/sessions/${id}`, { method: 'PATCH', body: { settings: { allowTrades: false } } })).status === 200, 'PATCH');
    const t = await emit(A.s, 'offer:create', { kind: 'tukar', toId: B.s.id, give: { itemId: 'susu-kotak', qty: 1 }, want: { itemId: 'es-jeruk', qty: 1 } });
    expect(!t.ok && /tukar barang sedang dinonaktifkan/.test(t.error), JSON.stringify(t));
    const peek = await emit(A.s, 'offer:peek', { toId: B.s.id });
    expect(!peek.ok, 'melihat tas teman saat tukar mati');
    await http(`/sessions/${id}`, { method: 'PATCH', body: { settings: { allowTrades: true } } });
    return t.error;
  });
  await check('Teman yang jauh (> 6 m) tidak bisa diberi', async () => {
    await C.walk(-24, 5);
    const r = await emit(A.s, 'offer:create', { kind: 'hadiah', toId: C.s.id, give: { itemId: 'susu-kotak', qty: 1 } });
    expect(!r.ok && /Dekati Dodi/.test(r.error), JSON.stringify(r));
    return r.error;
  });
  await check('Uang virtual tidak pernah berpindah antarsiswa', async () => {
    await sleep(300);
    expect(A.wallet.saldo === saldoAwal.A && B.wallet.saldo === saldoAwal.B, `A ${saldoAwal.A}→${A.wallet.saldo}, B ${saldoAwal.B}→${B.wallet.saldo}`);
    return `A Rp${A.wallet.saldo}, B Rp${B.wallet.saldo} (tetap)`;
  });
  await check('Riwayat Dashboard Guru: pemberi, penerima, barang, jumlah, waktu, status', async () => {
    const h = await http(`/sessions/${id}/offers`);
    expect(h.status === 200 && h.body.offers.length >= 8, `${h.status} ${h.body?.offers?.length}`);
    const st = new Set(h.body.offers.map((o) => o.status));
    for (const s of ['diterima', 'ditolak', 'kedaluwarsa', 'dibatalkan']) expect(st.has(s), `status ${s} tidak ada di riwayat`);
    const o = h.body.offers[0];
    expect(o.dari && o.ke && o.give_item && o.give_qty && o.created_at, JSON.stringify(o));
    return `${h.body.offers.length} baris · status: ${[...st].join(', ')}`;
  });
  await http(`/sessions/${id}/end`, { method: 'POST' });
} catch (e) {
  results.push({ ok: false });
  console.log(`  ✘ persiapan: ${e.message}`);
} finally {
  for (const s of [A, B, C]) s.s?.disconnect();
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${bad ? 'GAGAL' : 'LULUS'} ${results.length - bad}/${results.length} pemeriksaan hadiah & tukar`);
  process.exitCode = bad ? 1 : 0;
}
