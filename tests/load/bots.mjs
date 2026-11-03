/**
 * Uji beban EDUVERSE — bot Socket.IO yang mengikuti protokol siswa sungguhan.
 *
 * Tiap bot: join kode → klaim identitas → avatar → lobi → (guru memulai) → masuk Dunia Kota →
 * kirim posisi 10×/detik sambil BERJALAN (kecepatan wajar, divalidasi server) ke titik soal →
 * buka soal → jawab (server menilai & menyimpan ke PostgreSQL) → ulangi.
 *
 * Satu sesi menampung maksimal 99 siswa (nomor absen 1–99), jadi N bot dibagi ke ⌈N/90⌉ sesi
 * — sama seperti beberapa kelas bermain bersamaan di satu server.
 *
 * Pemakaian:
 *   node tests/load/bots.mjs --players 50,100,200,500 --duration 60
 * Variabel: BASE_URL, TEACHER_EMAIL, TEACHER_PASSWORD, SERVER_PID (opsional: catat CPU/RAM proses server lokal),
 *           OUT (opsional: simpan hasil JSON).
 */
import { io } from 'socket.io-client';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.TEACHER_EMAIL ?? 'guru@sekolah.id';
const PASS = process.env.TEACHER_PASSWORD ?? 'rahasia123';
const LEVELS = String(arg('players', '50')).split(',').map(Number);
const DURATION = Number(arg('duration', '60')) * 1000;
const PER_SESSION = 90;
const SPEED = 5; // m/detik (jalan cepat; batas server 8,5)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
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

function emitAck(s, ev, data, timeout = 15000) {
  const t0 = performance.now();
  return new Promise((res) => {
    s.timeout(timeout).emit(ev, data, (err, r) => res({ r: err ? { ok: false, error: 'timeout' } : r, ms: performance.now() - t0 }));
  });
}

function answerFor(q) {
  if (q.type === 'pg') return { type: 'pg', index: Math.floor(Math.random() * q.options.length) };
  if (q.type === 'bs') return { type: 'bs', value: Math.random() < 0.5 };
  if (q.type === 'isian') return { type: 'isian', text: String(1 + Math.floor(Math.random() * 20)) };
  return { type: 'jodoh', pairs: q.options.map((_, i) => i) };
}

class Bot {
  constructor(code, absen, m) {
    this.code = code;
    this.absen = absen;
    this.m = m;
    this.pos = null;
    this.points = [];
    this.done = new Set();
    this.target = null;
    this.busy = false;
    this.inWorld = false;
    this.snapshots = 0;
  }
  async connect() {
    const t0 = performance.now();
    this.s = io(`${BASE}/play`, { transports: ['websocket'], reconnection: true, forceNew: true });
    await new Promise((res, rej) => {
      this.s.once('connect', res);
      this.s.once('connect_error', rej);
    });
    this.m.connectMs.push(performance.now() - t0);
    this.s.on('disconnect', (why) => why !== 'io client disconnect' && this.m.disconnects++);
    this.s.on('players:snapshot', () => this.snapshots++);
    this.s.on('teleport', (p) => {
      this.m.corrections++;
      if (p && typeof p.x === 'number') this.pos = { x: p.x, y: p.y, z: p.z };
    });
    this.s.on('points:update', (u) => {
      // pembaruan titik (mode rebutan/daur ulang); daftar penuh datang saat masuk dunia
      if (Array.isArray(u?.points)) this.points = u.points;
    });
    const j = await emitAck(this.s, 'join', { code: this.code });
    this.m.joinMs.push(j.ms);
    if (!j.r?.ok) throw new Error(`join: ${j.r?.error}`);
    const c = await emitAck(this.s, 'identity:claim', { absen: this.absen, nama: `Bot ${this.absen}` });
    if (!c.r?.ok) throw new Error(`claim: ${c.r?.error}`);
    await emitAck(this.s, 'avatar:set', { kulit: this.absen % 5, rambut: this.absen % 6, baju: this.absen % 4, topi: 0, aksesori: 0, warna: this.absen % 8 });
    const l = await emitAck(this.s, 'world:enter', { scene: 'lobi' });
    if (!l.r?.ok) throw new Error(`lobi: ${l.r?.error}`);
    this.s.emit('ready:set', true);
  }
  async enterKota() {
    const r = await emitAck(this.s, 'world:enter', { scene: 'kota' });
    if (!r.r?.ok) throw new Error(`kota: ${r.r?.error}`);
    this.pos = { ...r.r.spawn };
    this.points = r.r.points ?? [];
    for (const d of r.r.done ?? []) this.done.add(d);
    this.inWorld = true;
  }
  pickTarget() {
    const open = this.points.filter((p) => !p.hidden && !this.done.has(p.id) && p.y < 2);
    if (!open.length) return null;
    open.sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z));
    return open[Math.floor(Math.random() * Math.min(3, open.length))];
  }
  tick(dt) {
    if (!this.inWorld || !this.pos) return;
    if (!this.busy && !this.stopped) {
      if (!this.target) this.target = this.pickTarget();
      if (this.target) {
        const dx = this.target.x - this.pos.x;
        const dz = this.target.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.5) void this.ask(this.target);
        else {
          const step = Math.min(d, SPEED * dt);
          this.pos.x += (dx / d) * step;
          this.pos.z += (dz / d) * step;
        }
      }
    }
    this.s.volatile.emit('player:state', { scene: 'kota', x: +this.pos.x.toFixed(2), y: 0.2, z: +this.pos.z.toFixed(2), ry: 0, anim: this.busy ? 0 : 1, riding: false });
  }
  async ask(pt) {
    this.busy = true;
    try {
      const i = await emitAck(this.s, 'point:interact', { pointId: pt.id });
      this.m.interactMs.push(i.ms);
      if (!i.r?.ok) {
        this.m.interactRejected++;
        this.done.add(pt.id);
        return;
      }
      await sleep(1500 + Math.random() * 3000); // "membaca soal"
      let a = await emitAck(this.s, 'answer:submit', { token: i.r.question.token, answer: answerFor(i.r.question) });
      this.m.answerMs.push(a.ms);
      if (a.r?.ok) {
        this.m.answers++;
        if (a.r.result.correct) this.m.correct++;
        else if (a.r.result.canRetry) {
          await sleep(800);
          a = await emitAck(this.s, 'answer:submit', { token: a.r.result.retryToken ?? i.r.question.token, answer: answerFor(i.r.question) });
          this.m.answerMs.push(a.ms);
          if (a.r?.ok) this.m.answers++;
        }
      } else {
        this.m.answerErrors++;
        this.m.answerErrorTexts.add(String(a.r?.error));
      }
      this.s.emit('question:close');
      this.done.add(pt.id);
    } finally {
      this.target = null;
      this.busy = false;
    }
  }
  close() {
    this.s?.disconnect();
  }
}

/** CPU proses server saat ini (selisih /proc/<pid>/stat per detik, % dari 1 inti) + RSS. Linux lokal saja. */
let lastCpu = null;
function serverUsage() {
  const pid = process.env.SERVER_PID;
  if (!pid) return null;
  try {
    const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const ticks = Number(f[11]) + Number(f[12]); // utime + stime
    const rssMb = Math.round((Number(f[21]) * 4096) / 1048576);
    const now = performance.now();
    const prev = lastCpu;
    lastCpu = { ticks, now };
    if (!prev) return null;
    const hz = Number(execSync('getconf CLK_TCK').toString()) || 100;
    return { cpu: Math.round(((ticks - prev.ticks) / hz / ((now - prev.now) / 1000)) * 100), rssMb };
  } catch {
    return null;
  }
}

async function runLevel(n) {
  const m = { connectMs: [], joinMs: [], interactMs: [], answerMs: [], healthMs: [], answers: 0, correct: 0, answerErrors: 0, interactRejected: 0, corrections: 0, disconnects: 0, failedJoins: 0, usage: [], answerErrorTexts: new Set() };
  const sessions = [];
  for (let i = 0; i < Math.ceil(n / PER_SESSION); i++) {
    const s = await http('/sessions', { title: `Uji beban ${n} #${i + 1}`, className: `LT${n}-${i + 1}`, settings: { durationMinutes: 30, requireApproval: false, showLeaderboard: true, density: 0.8 } });
    sessions.push(s);
  }
  const bots = [];
  for (let i = 0; i < n; i++) bots.push(new Bot(sessions[Math.floor(i / PER_SESSION)].code, (i % PER_SESSION) + 1, m));
  // sambung bertahap (±50/detik) seperti siswa yang masuk kelas
  const tJoin = performance.now();
  for (let i = 0; i < bots.length; i += 25) {
    await Promise.all(bots.slice(i, i + 25).map((b) => b.connect().catch((e) => (m.failedJoins++, (b.failed = String(e.message))))));
    await sleep(500);
  }
  const joinedIn = Math.round(performance.now() - tJoin);
  const live = bots.filter((b) => !b.failed);
  for (const s of sessions) await http(`/sessions/${s.id}/start`, {});
  await sleep(4500); // hitung mundur 3-2-1
  await Promise.all(live.map((b) => b.enterKota().catch((e) => ((b.failed = String(e.message)), m.failedJoins++))));
  const playing = live.filter((b) => !b.failed);
  for (const b of playing) b.snapshots = 0;

  // simulasi: 10 Hz per bot, plus pengukuran waktu respons HTTP server tiap detik
  const t0 = performance.now();
  let last = t0;
  const loop = setInterval(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    for (const b of playing) b.tick(dt);
  }, 100);
  const probe = setInterval(async () => {
    const h0 = performance.now();
    await fetch(`${BASE}/api/health`).catch(() => undefined);
    m.healthMs.push(performance.now() - h0);
    const u = serverUsage();
    if (u) m.usage.push(u);
  }, 1000);
  await sleep(DURATION);
  for (const b of playing) b.stopped = true;
  clearInterval(loop);
  clearInterval(probe);
  const secs = (performance.now() - t0) / 1000;
  const snapRate = playing.map((b) => b.snapshots / secs);
  // tunggu soal yang sedang dibuka bot selesai dijawab sebelum sesi diakhiri
  for (let i = 0; i < 40 && playing.some((b) => b.busy); i++) await sleep(250);
  for (const s of sessions) await http(`/sessions/${s.id}/end`, {}).catch(() => undefined);
  bots.forEach((b) => b.close());
  await sleep(1500);
  for (const s of sessions) await http(`/sessions/${s.id}`, undefined, 'DELETE').catch(() => undefined);

  const errorsSample = [...new Set(bots.filter((b) => b.failed).map((b) => b.failed))].slice(0, 3);
  return {
    players: n,
    sessions: sessions.length,
    playing: playing.length,
    failedJoins: m.failedJoins,
    errorsSample,
    joinAllMs: joinedIn,
    connectMs: { p50: pct(m.connectMs, 50), p95: pct(m.connectMs, 95) },
    joinAckMs: { p50: pct(m.joinMs, 50), p95: pct(m.joinMs, 95), p99: pct(m.joinMs, 99) },
    interactAckMs: { n: m.interactMs.length, p50: pct(m.interactMs, 50), p95: pct(m.interactMs, 95), p99: pct(m.interactMs, 99) },
    answerAckMs: { n: m.answerMs.length, p50: pct(m.answerMs, 50), p95: pct(m.answerMs, 95), p99: pct(m.answerMs, 99) },
    httpHealthMs: { p50: pct(m.healthMs, 50), p95: pct(m.healthMs, 95), max: pct(m.healthMs, 100) },
    snapshotsPerBotPerSec: { avg: +(snapRate.reduce((a, b) => a + b, 0) / Math.max(1, snapRate.length)).toFixed(1), min: +Math.min(...snapRate).toFixed(1) },
    answers: m.answers,
    correct: m.correct,
    answerErrors: m.answerErrors,
    answerErrorTexts: [...m.answerErrorTexts],
    interactRejected: m.interactRejected,
    positionCorrections: m.corrections,
    unexpectedDisconnects: m.disconnects,
    server: m.usage.length ? { cpuAvg: Math.round(m.usage.reduce((a, u) => a + u.cpu, 0) / m.usage.length), cpuMax: Math.max(...m.usage.map((u) => u.cpu)), rssMaxMb: Math.max(...m.usage.map((u) => u.rssMb)) } : null,
  };
}

console.log(`EDUVERSE uji beban → ${BASE} · tingkat ${LEVELS.join(', ')} · durasi ${DURATION / 1000} dtk`);
await http('/auth/login', { email: EMAIL, password: PASS });
const out = [];
for (const n of LEVELS) {
  process.stdout.write(`\n▶ ${n} pemain… `);
  const r = await runLevel(n);
  out.push(r);
  console.log('selesai');
  console.log(JSON.stringify(r, null, 1));
  await sleep(3000);
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ base: BASE, durationSec: DURATION / 1000, at: new Date().toISOString(), results: out }, null, 2));
console.log('\nRingkasan:');
console.table(out.map((r) => ({ pemain: r.players, main: r.playing, gagal: r.failedJoins, 'jawab p95 ms': r.answerAckMs.p95, 'interaksi p95 ms': r.interactAckMs.p95, 'snapshot/dtk': r.snapshotsPerBotPerSec.avg, jawaban: r.answers, koreksi: r.positionCorrections, putus: r.unexpectedDisconnects, 'CPU% rata': r.server?.cpuAvg ?? '-', 'RAM MB': r.server?.rssMaxMb ?? '-' })));
process.exit(0);
