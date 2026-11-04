/**
 * Uji beban EDUVERSE — bot Socket.IO yang mengikuti protokol siswa sungguhan.
 *
 * Dua mode:
 *
 *   --mode sweep  (bawaan, dipakai CI)
 *     Beberapa tingkat jumlah pemain berturut-turut di Dunia Kota, sesi dibagi per 90 siswa.
 *     node tests/load/bots.mjs --players 50,100,200,500 --duration 60
 *
 *   --mode kelas  (uji kesiapan satu kelas, mis. 33 siswa 40 menit)
 *     SATU sesi kelas, identitas unik per siswa, sebaran ke empat dunia, gerbang verifikasi
 *     (bergabung → identitas → siap → mulai), aktivitas nyata 40 menit (jalan, soal, portal,
 *     kendaraan, pedagang, menyelam, lompat), perpindahan dunia, putus–sambung terjadwal,
 *     ringkasan tiap 5 menit, podium, lalu LULUS/GAGAL dengan exit code.
 *     node tests/load/bots.mjs --mode kelas --players 33 --duration 2400
 *
 * Tiap bot: join kode → klaim identitas → avatar → lobi → SIAP → (guru memulai) → masuk dunia →
 * kirim posisi 10×/detik sambil BERJALAN (kecepatan wajar, divalidasi server) ke titik soal →
 * buka soal → jawab (server menilai & menyimpan ke PostgreSQL) → ulangi.
 *
 * Tidak ada jalan pintas: tidak ada teleport tidak sah, validasi posisi server tetap menyala,
 * dan jumlah "online" dihitung dari status server (namespace /teacher), bukan dari sisi klien.
 *
 * Variabel: BASE_URL, TEACHER_EMAIL, TEACHER_PASSWORD,
 *           SERVER_PID (opsional: catat CPU/RAM proses server lokal),
 *           OUT (opsional: simpan hasil JSON).
 */
import { io } from 'socket.io-client';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const shared = await import('../../packages/shared/dist/index.js');

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.TEACHER_EMAIL ?? 'guru@sekolah.id';
const PASS = process.env.TEACHER_PASSWORD ?? 'rahasia123';
const MODE = String(arg('mode', 'sweep'));
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
const nowIso = () => new Date().toISOString();

let cookie = '';
let bearer = '';
async function http(path, body, method = body ? 'POST' : 'GET') {
  const headers = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  else if (cookie) headers.cookie = cookie;
  const r = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

/** Satu siswa simulasi. Semua gerakan & interaksi melewati validasi server seperti klien sungguhan. */
class Bot {
  constructor(code, absen, m, opts = {}) {
    this.code = code;
    this.absen = absen;
    this.m = m;
    this.nama = opts.nama ?? `Bot ${absen}`;
    this.world = opts.world ?? 'kota';
    // Mode sweep memakai autopilot di dalam tick(); mode kelas dipimpin "otak" async.
    // Keduanya tidak boleh menyala bersamaan: dua jalur akan membuka soal yang sama dan saling membasikan token.
    this.autopilot = opts.autopilot !== false;
    this.pos = null;
    this.points = [];
    this.vehicles = [];
    this.done = new Set();
    this.target = null;
    this.dest = null; // {x, z, r} tujuan jalan untuk mode kelas
    this.arrived = false;
    this.busy = false;
    this.inWorld = false;
    this.snapshots = 0;
    this.score = 0;
    this.saldo = 0;
    this.bag = {};
    this.answered = 0;
    this.claimToken = '';
    this.plannedDown = false;
    this.reconnects = { ok: 0, gagal: 0 };
    this.diveUntil = 0;
    this.jumpUntil = 0;
  }

  layout() {
    try {
      return shared.worldLayout(this.world);
    } catch {
      return null;
    }
  }

  bounds() {
    const env = shared.WORLD_ENV?.[this.world];
    return env ? env.half : 300;
  }

  wire() {
    const s = this.s;
    s.on('disconnect', (why) => {
      this.inWorld = false;
      if (why === 'io client disconnect') return;
      if (this.plannedDown) this.m.plannedDisconnects++;
      else this.m.disconnects++;
    });
    s.on('players:snapshot', () => this.snapshots++);
    s.on('teleport', (p) => {
      this.m.corrections++;
      if (p && typeof p.x === 'number') this.pos = { x: p.x, y: p.y, z: p.z };
    });
    s.on('points:update', (u) => {
      if (Array.isArray(u?.points)) this.points = u.points;
    });
    s.on('vehicles:state', (list) => {
      if (Array.isArray(list)) this.vehicles = list;
    });
    s.on('wallet:update', (w) => {
      if (w && typeof w.saldo === 'number') {
        this.saldo = w.saldo;
        this.bag = w.tas ?? this.bag;
      }
    });
    s.on('score:update', (u) => {
      if (u && typeof u.poin === 'number') this.score = u.poin;
    });
    s.on('podium:show', (p) => {
      this.podium = p;
    });
    s.on('kicked', (k) => {
      this.kicked = String(k?.reason ?? 'kicked');
      this.m.kicked++;
    });
  }

  /** Sambung baru + klaim identitas (alur siswa yang pertama kali masuk kelas). */
  async connect() {
    const t0 = performance.now();
    this.s = io(`${BASE}/play`, { transports: ['websocket'], reconnection: true, forceNew: true });
    await new Promise((res, rej) => {
      this.s.once('connect', res);
      this.s.once('connect_error', rej);
    });
    this.m.connectMs.push(performance.now() - t0);
    this.wire();
    const j = await emitAck(this.s, 'join', { code: this.code });
    this.m.joinMs.push(j.ms);
    if (!j.r?.ok) throw new Error(`join: ${j.r?.error}`);
    const c = await emitAck(this.s, 'identity:claim', { absen: this.absen, nama: this.nama });
    if (!c.r?.ok) throw new Error(`claim: ${c.r?.error}`);
    this.claimToken = c.r.token ?? '';
    this.approved = !!c.r.me?.approved;
    await emitAck(this.s, 'avatar:set', { kulit: this.absen % 5, rambut: this.absen % 6, baju: this.absen % 4, topi: 0, aksesori: 0, warna: this.absen % 8 });
    const l = await emitAck(this.s, 'world:enter', { scene: 'lobi' });
    if (!l.r?.ok) throw new Error(`lobi: ${l.r?.error}`);
    this.s.emit('ready:set', true);
  }

  /** Sambung ulang memakai claimToken: identitas, skor, dompet, dan tas harus kembali utuh. */
  async reconnect({ enterWorld = true } = {}) {
    const t0 = performance.now();
    try {
      this.s?.removeAllListeners();
      this.s?.disconnect();
      this.s = io(`${BASE}/play`, { transports: ['websocket'], reconnection: true, forceNew: true });
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('connect timeout')), 25000);
        this.s.once('connect', () => (clearTimeout(to), res()));
        this.s.once('connect_error', (e) => (clearTimeout(to), rej(e)));
      });
      this.wire();
      const j = await emitAck(this.s, 'join', { code: this.code, claimToken: this.claimToken });
      if (!j.r?.ok) throw new Error(`rejoin: ${j.r?.error}`);
      const me = j.r.me;
      if (!me) throw new Error('server tidak mengenali identitas setelah sambung ulang');
      if (Number(me.absen) !== this.absen) throw new Error(`identitas tertukar: absen ${me.absen} ≠ ${this.absen}`);
      if (String(me.nama) !== this.nama) throw new Error(`nama tertukar: ${me.nama} ≠ ${this.nama}`);
      this.score = Number(me.poin ?? this.score);
      this.answered = Number(me.dijawab ?? this.answered);
      this.saldo = Number(me.dompet?.saldo ?? this.saldo);
      this.bag = me.dompet?.tas ?? this.bag;
      if (enterWorld) await this.enterWorld(me.lastScene && me.lastScene !== 'lobi' ? me.lastScene : this.world);
      this.m.reconnectMs.push(performance.now() - t0);
      this.reconnects.ok++;
      return true;
    } catch (e) {
      this.reconnects.gagal++;
      this.m.reconnectFail++;
      this.m.reconnectErrors.add(String(e.message).slice(0, 120));
      return false;
    }
  }

  async enterWorld(world) {
    const r = await emitAck(this.s, 'world:enter', { scene: world });
    if (!r.r?.ok) throw new Error(`masuk ${world}: ${r.r?.error}`);
    this.world = world;
    this.pos = { ...r.r.spawn };
    this.points = r.r.points ?? [];
    this.vehicles = r.r.vehicles ?? [];
    this.done = new Set(r.r.done ?? []);
    if (r.r.dompet) {
      this.saldo = r.r.dompet.saldo ?? this.saldo;
      this.bag = r.r.dompet.tas ?? this.bag;
    }
    this.dest = null;
    this.arrived = false;
    this.inWorld = true;
    return r.r;
  }

  /** Dipakai mode sweep (nama lama dipertahankan). */
  enterKota() {
    return this.enterWorld('kota');
  }

  pickTarget() {
    const open = this.points.filter((p) => !p.hidden && !this.done.has(p.id) && p.y < 2);
    if (!open.length) return null;
    open.sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z));
    return open[Math.floor(Math.random() * Math.min(3, open.length))];
  }

  /** 10 Hz: satu langkah gerak + kirim posisi. Mode sweep memakai target; mode kelas memakai dest. */
  tick(dt) {
    if (!this.inWorld || !this.pos || !this.s?.connected) return;
    if (this.dest) {
      const dx = this.dest.x - this.pos.x;
      const dz = this.dest.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d <= (this.dest.r ?? 1.5)) this.arrived = true;
      else {
        const step = Math.min(d, (this.dest.speed ?? SPEED) * dt);
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
      }
    } else if (this.autopilot && !this.busy && !this.stopped) {
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
    // kedalaman / lompatan sesuai dunia (dibatasi server: y > -40 dan ≤ maxY + 5)
    const now = Date.now();
    let y = 0.2;
    if (this.world === 'laut' && now < this.diveUntil) y = -6;
    else if (this.world === 'angkasa' && now < this.jumpUntil) y = 2.6;
    this.pos.y = y;
    const anim = this.busy ? 0 : this.world === 'laut' && now < this.diveUntil ? 4 : this.world === 'angkasa' && now < this.jumpUntil ? 3 : this.dest || this.target ? 1 : 0;
    this.s.volatile.emit('player:state', {
      scene: this.world,
      x: +this.pos.x.toFixed(2),
      y: +y.toFixed(2),
      z: +this.pos.z.toFixed(2),
      ry: 0,
      anim,
      riding: false,
    });
  }

  /** Jalan ke satu titik (server memvalidasi setiap paket posisi). */
  async walkTo(x, z, r = 1.4, timeoutMs = 45000) {
    const bx = this.bounds() - 4;
    this.dest = { x: Math.max(-bx, Math.min(bx, x)), z: Math.max(-bx, Math.min(bx, z)), r };
    this.arrived = false;
    const t0 = Date.now();
    while (!this.arrived && !this.stopped && Date.now() - t0 < timeoutMs) {
      if (!this.s?.connected || !this.inWorld) {
        this.dest = null;
        return false;
      }
      await sleep(120);
    }
    const ok = this.arrived;
    this.dest = null;
    if (!ok) this.m.walkTimeouts++;
    return ok;
  }

  async ask(pt) {
    this.busy = true;
    try {
      const i = await emitAck(this.s, 'point:interact', { pointId: pt.id });
      this.m.interactMs.push(i.ms);
      if (!i.r?.ok) {
        this.m.interactRejected++;
        this.m.interactRejectTexts.add(String(i.r?.error).slice(0, 80));
        this.done.add(pt.id);
        return false;
      }
      await sleep(1500 + Math.random() * 3000); // "membaca soal"
      let a = await emitAck(this.s, 'answer:submit', { token: i.r.question.token, answer: answerFor(i.r.question) });
      this.m.answerMs.push(a.ms);
      if (a.r?.ok) {
        this.m.answers++;
        this.answered++;
        if (typeof a.r.result?.totalScore === 'number') this.score = a.r.result.totalScore;
        if (a.r.result.correct) this.m.correct++;
        else if (a.r.result.canRetry) {
          await sleep(800);
          a = await emitAck(this.s, 'answer:submit', { token: a.r.result.retryToken ?? i.r.question.token, answer: answerFor(i.r.question) });
          this.m.answerMs.push(a.ms);
          if (a.r?.ok) {
            this.m.answers++;
            this.answered++;
            if (typeof a.r.result?.totalScore === 'number') this.score = a.r.result.totalScore;
            if (a.r.result.correct) this.m.correct++;
          } else {
            this.noteAnswerError(a.r?.error);
          }
        }
        this.m.answersByWorld[this.world] = (this.m.answersByWorld[this.world] ?? 0) + 1;
      } else {
        this.noteAnswerError(a.r?.error);
      }
      this.s.emit('question:close');
      this.done.add(pt.id);
      return true;
    } finally {
      this.target = null;
      this.busy = false;
    }
  }

  /**
   * Kegagalan kirim jawaban. Yang terjadi saat tes SENGAJA memutus koneksi atau memindahkan dunia
   * di tengah soal dicatat terpisah: server memang menolak token yang sudah tidak berlaku, dan itu
   * perilaku yang benar. Kegagalan di luar gangguan terencana tetap dihitung sebagai masalah.
   */
  noteAnswerError(error) {
    const teks = String(error ?? '').slice(0, 80);
    const saatGangguan = this.plannedDown || this.pausedForScript || !this.s?.connected || !this.inWorld;
    const wajarSaatGangguan = /Belum bergabung|sudah tidak berlaku|Permainan sudah selesai|Permainan belum berjalan|timeout/i.test(teks);
    if (saatGangguan && wajarSaatGangguan) {
      this.m.answerErrorsDisrupsi++;
      this.m.answerErrorDisrupsiTexts.add(teks);
      return;
    }
    this.m.answerErrors++;
    this.m.answerErrorTexts.add(teks);
  }

  /** Portal / lubang dimensi di dalam dunia (Hutan & Luar Angkasa memakainya). */
  async useRift() {
    const semua = this.layout()?.living?.rifts ?? [];
    // Server menolak portal tanpa tujuan yang valid, dan menolak jika beda ketinggian > 4 m
    // (mis. portal di pulau langit tidak bisa dicapai dengan berjalan). Pilih yang memang bisa dipakai.
    const rifts = semua.filter((r) => !r.secret && Math.abs(r.y ?? 0) <= 4 && semua.some((d) => d.id === r.to));
    if (!rifts.length || !this.pos) return false;
    if (Date.now() - (this.lastRiftAt ?? 0) < 3000) return false; // hormati cooldown 2,5 dtk server
    rifts.sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z));
    const r = rifts[0];
    if (!(await this.walkTo(r.x, r.z, 3))) return false;
    const a = await emitAck(this.s, 'rift:use', { riftId: r.id });
    this.lastRiftAt = Date.now();
    if (a.r?.ok) {
      this.pos = { x: a.r.target.x, y: a.r.target.y, z: a.r.target.z };
      this.m.rifts++;
      return true;
    }
    this.m.riftFail++;
    this.m.riftErrors.add(String(a.r?.error).slice(0, 80));
    return false;
  }

  /** Kendaraan: naik, berkendara pelan ke titik acak, lalu turun (semuanya dinilai server). */
  async useVehicle() {
    const list = (this.vehicles ?? []).filter((v) => !v.driver);
    if (!list.length || !this.pos) return false;
    list.sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z));
    const v = list[0];
    if (!(await this.walkTo(v.x, v.z, 2.5))) return false;
    const got = await emitAck(this.s, 'vehicle:enter', { id: v.id });
    if (!got.r?.ok) {
      this.m.vehicleFail++;
      this.m.vehicleErrors.add(String(got.r?.error).slice(0, 80));
      return false;
    }
    this.m.vehicles++;
    this.pos = { x: got.r.vehicle.x, y: got.r.vehicle.y, z: got.r.vehicle.z };
    const bx = this.bounds() - 20;
    const tx = (Math.random() * 2 - 1) * bx;
    const tz = (Math.random() * 2 - 1) * bx;
    this.dest = { x: tx, z: tz, r: 6, speed: 6 }; // 6 m/dtk: di bawah batas semua kendaraan
    const t0 = Date.now();
    while (!this.arrived && !this.stopped && Date.now() - t0 < 25000 && this.s?.connected) await sleep(150);
    this.dest = null;
    const off = await emitAck(this.s, 'vehicle:exit', { x: this.pos.x, y: 0.2, z: this.pos.z });
    if (off.r?.ok) this.pos = { x: off.r.x, y: off.r.y, z: off.r.z };
    return true;
  }

  /** Pedagang / NPC: mendekat lalu membeli satu barang yang terjangkau. */
  async visitVendor() {
    const vendors = (this.layout()?.living?.vendors ?? []).filter((v) => v.items?.length);
    if (!vendors.length || !this.pos) return false;
    vendors.sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z));
    const v = vendors[Math.floor(Math.random() * Math.min(3, vendors.length))];
    const jarak = shared.SHOP?.jarakBeli ?? 5;
    if (!(await this.walkTo(v.x, v.z, Math.max(1.5, jarak - 2)))) return false;
    this.m.vendorVisits++;
    const item = [...v.items].sort((a, b) => a.harga - b.harga)[0];
    if (!item || this.saldo < item.harga) return true; // sudah berinteraksi walau belum mampu beli
    const b = await emitAck(this.s, 'shop:buy', { vendorId: v.id, itemId: item.id, qty: 1 });
    if (b.r?.ok) {
      this.m.purchases++;
      this.saldo = b.r.saldo ?? this.saldo;
      this.bag = b.r.tas ?? this.bag;
    } else {
      this.m.purchaseFail++;
      this.m.purchaseErrors.add(String(b.r?.error).slice(0, 80));
    }
    return true;
  }

  /** Menyelam (Dunia Laut) — oksigen dihitung klien, jadi di sini yang diuji posisi bawah air. */
  dive(seconds = 10) {
    this.diveUntil = Date.now() + seconds * 1000;
    this.m.dives++;
  }

  jump() {
    this.jumpUntil = Date.now() + 900;
    this.m.jumps++;
  }

  bagCount() {
    return Object.values(this.bag ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
  }

  close() {
    this.stopped = true;
    this.s?.disconnect();
  }
}

function newMetrics() {
  return {
    connectMs: [], joinMs: [], interactMs: [], answerMs: [], healthMs: [], reconnectMs: [],
    answers: 0, correct: 0, answerErrors: 0, answerErrorsDisrupsi: 0, interactRejected: 0, corrections: 0,
    disconnects: 0, plannedDisconnects: 0, failedJoins: 0, kicked: 0,
    reconnectFail: 0, walkTimeouts: 0,
    rifts: 0, riftFail: 0, vehicles: 0, vehicleFail: 0, vendorVisits: 0, purchases: 0, purchaseFail: 0,
    dives: 0, jumps: 0, transitions: 0, transitionFail: 0,
    answersByWorld: {}, usage: [],
    answerErrorTexts: new Set(), answerErrorDisrupsiTexts: new Set(), interactRejectTexts: new Set(), reconnectErrors: new Set(),
    riftErrors: new Set(), vehicleErrors: new Set(), purchaseErrors: new Set(),
  };
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

// ───────────────────────────── mode sweep (dipakai CI) ─────────────────────────────

async function runLevel(n) {
  const m = newMetrics();
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

async function runSweep() {
  console.log(`EDUVERSE uji beban → ${BASE} · tingkat ${LEVELS.join(', ')} · durasi ${DURATION / 1000} dtk`);
  // Login guru (sebelum mode kelas ditambahkan, login ini ada di tingkat atas berkas; mode sweep tetap membutuhkannya)
  const login = await http('/auth/login', { email: EMAIL, password: PASS });
  bearer = login?.token ?? '';
  const out = [];
  for (const n of LEVELS) {
    process.stdout.write(`\n▶ ${n} pemain… `);
    const r = await runLevel(n);
    out.push(r);
    console.log('selesai');
    console.log(JSON.stringify(r, null, 1));
    await sleep(3000);
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ base: BASE, durationSec: DURATION / 1000, at: nowIso(), results: out }, null, 2));
  console.log('\nRingkasan:');
  console.table(out.map((r) => ({ pemain: r.players, main: r.playing, gagal: r.failedJoins, 'jawab p95 ms': r.answerAckMs.p95, 'interaksi p95 ms': r.interactAckMs.p95, 'snapshot/dtk': r.snapshotsPerBotPerSec.avg, jawaban: r.answers, koreksi: r.positionCorrections, putus: r.unexpectedDisconnects, 'CPU% rata': r.server?.cpuAvg ?? '-', 'RAM MB': r.server?.rssMaxMb ?? '-' })));
  return 0;
}

// ───────────────────────── mode kelas (kesiapan satu kelas, mis. 33 siswa) ─────────────────────────

/** Dashboard Guru sungguhan: namespace /teacher + event teacher:live (sumber angka "online"). */
class Dashboard {
  constructor(token) {
    this.token = token;
    this.live = null;
    this.updates = 0;
    this.lastAt = 0;
    this.gaps = [];
    this.drops = 0;
  }
  async connect(sessionId) {
    this.s = io(`${BASE}/teacher`, { transports: ['websocket'], auth: { token: this.token }, forceNew: true, reconnection: true });
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('dashboard connect timeout')), 25000);
      this.s.once('connect', () => (clearTimeout(to), res()));
      this.s.once('connect_error', (e) => (clearTimeout(to), rej(new Error(`dashboard: ${e.message}`))));
    });
    this.s.on('disconnect', (why) => why !== 'io client disconnect' && this.drops++);
    this.s.on('teacher:live', (l) => {
      const now = Date.now();
      if (this.lastAt) this.gaps.push(now - this.lastAt);
      this.lastAt = now;
      this.updates++;
      this.live = l;
    });
    const a = await emitAck(this.s, 'watch', { sessionId });
    if (!a.r?.ok) throw new Error(`watch: ${a.r?.error}`);
    this.live = a.r.live;
    this.lastAt = Date.now();
    return this.live;
  }
  /** Status terbaru; bila push sedang sepi, tarik lewat REST agar angka tidak basi. */
  async refresh(sessionId) {
    try {
      const r = await http(`/sessions/${sessionId}`);
      if (r?.live) {
        this.live = r.live;
        return r.live;
      }
    } catch {
      /* biarkan memakai push terakhir */
    }
    return this.live;
  }
  close() {
    this.s?.disconnect();
  }
}

function ringkasLive(live) {
  const st = live?.students ?? [];
  const online = st.filter((s) => s.online);
  const scenes = {};
  for (const s of online) scenes[s.scene ?? '-'] = (scenes[s.scene ?? '-'] ?? 0) + 1;
  return {
    status: live?.state?.status ?? null,
    terdaftar: st.length,
    identitasDiklaim: st.filter((s) => s.claimed).length,
    disetujui: st.filter((s) => s.approved).length,
    online: live?.online ?? online.length,
    koneksi: live?.connections ?? null,
    siap: st.filter((s) => s.ready).length,
    siapOnline: online.filter((s) => s.ready).length,
    absenGanda: st.length - new Set(st.map((s) => s.absen)).size,
    scenes,
    totalPoin: st.reduce((a, s) => a + (s.poin ?? 0), 0),
    totalDijawab: st.reduce((a, s) => a + (s.dijawab ?? 0), 0),
    peringkatTerisi: st.filter((s) => s.rank != null).length,
  };
}

async function runKelas() {
  const TOTAL = LEVELS[0] > 0 ? LEVELS[0] : 33;
  const CLASS = String(arg('class', 'EDUVERSE-LOADTEST-33'));
  const SESSION_MINUTES = Number(arg('session-minutes', '45'));
  const NAME_PREFIX = String(arg('name-prefix', 'Siswa Uji'));
  const QSOURCE = String(arg('question-source', 'bawaan'));
  const SPREAD = { kota: 9, hutan: 8, laut: 8, angkasa: 8 };
  const minutes = DURATION / 60000;

  if (SESSION_MINUTES * 60000 <= DURATION + 180000)
    throw new Error(`Sesi uji (${SESSION_MINUTES} mnt) harus lebih panjang dari durasi simulasi (${minutes} mnt) + jeda. Naikkan --session-minutes.`);

  const gates = [];
  const gate = (nama, ok, detail) => {
    gates.push({ nama, ok: !!ok, detail: String(detail ?? '') });
    console.log(`  ${ok ? '✔' : '✘'} ${nama}${detail ? ` — ${detail}` : ''}`);
    return !!ok;
  };
  const snapshots = [];
  const events = [];
  const logEvent = (menit, jenis, teks) => {
    events.push({ menit, jenis, teks, at: nowIso() });
    console.log(`  [t+${String(menit).padStart(2, '0')} mnt] ${jenis}: ${teks}`);
  };

  const m = newMetrics();
  let sess = null;
  let dash = null;
  let bots = [];
  let hasil = null;
  let podiumCek = null;
  let startedAt = 0;

  const assignWorld = (i) => {
    let k = i;
    for (const [w, n] of Object.entries(SPREAD)) {
      if (k < n) return w;
      k -= n;
    }
    return 'kota';
  };

  const byAbsen = (a) => bots.find((b) => b.absen === a);
  const aktif = () => bots.filter((b) => !b.failed);

  /** Jeda bot untuk skrip, setelah menunggu soal yang sedang terbuka selesai. */
  const tenangkan = async (b, tungguMs = 15000) => {
    b.pausedForScript = true;
    const t0 = Date.now();
    while (b.busy && Date.now() - t0 < tungguMs) await sleep(250);
    return !b.busy;
  };

  try {
    console.log(`EDUVERSE uji beban KELAS → ${BASE}`);
    console.log(`  ${TOTAL} siswa · kelas "${CLASS}" · simulasi ${minutes} mnt · sesi ${SESSION_MINUTES} mnt · ${nowIso()}`);

    const health0 = await fetch(`${BASE}/api/health`).then((r) => r.json());
    console.log(`  backend: commit ${health0?.build?.commit ?? '-'} branch ${health0?.build?.branch ?? '-'} fitur ${(health0?.build?.fitur ?? []).join(',') || '-'}`);

    const login = await http('/auth/login', { email: EMAIL, password: PASS });
    bearer = login.token ?? '';
    if (!bearer) throw new Error('login guru tidak mengembalikan token');

    // ── 1. Guru membuat sesi uji (durasi lebih panjang dari simulasi) ──
    const roster = Array.from({ length: TOTAL }, (_, i) => ({ absen: i + 1, nama: `${NAME_PREFIX} ${String(i + 1).padStart(2, '0')}` }));
    sess = await http('/sessions', {
      title: `Uji beban ${TOTAL} siswa ${minutes} menit`,
      className: CLASS,
      roster,
      settings: {
        durationMinutes: SESSION_MINUTES,
        worlds: ['kota', 'hutan', 'laut', 'angkasa'],
        requireApproval: true,
        showLeaderboard: true,
        density: 0.8,
        pointMode: 'daurulang',
        allowRepeat: true,
        secondChance: true,
        questionSource: QSOURCE,
        questionMode: 'tanpa-batas',
      },
    });
    logEvent(0, 'sesi', `dibuat · kode kelas ${sess.code} · ${sess.questionCount} soal (${QSOURCE})`);

    // ── 2. Dashboard Guru menyambung dan memantau ──
    dash = new Dashboard(bearer);
    await dash.connect(sess.id);
    gate('Dashboard Guru tersambung ke sesi', !!dash.live, `status ${dash.live?.state?.status}`);

    // ── 3-8. 33 siswa masuk bertahap: kode kelas → absen unik → avatar → lobi → SIAP ──
    bots = roster.map((r, i) => new Bot(sess.code, r.absen, m, { nama: r.nama, world: assignWorld(i), autopilot: false }));
    const tJoin = performance.now();
    for (let i = 0; i < bots.length; i += 7) {
      await Promise.all(
        bots.slice(i, i + 7).map((b) =>
          b.connect().catch((e) => {
            m.failedJoins++;
            b.failed = String(e.message);
          }),
        ),
      );
      await sleep(1800); // gelombang masuk seperti kelas sungguhan
    }
    const joinAllMs = Math.round(performance.now() - tJoin);
    logEvent(0, 'bergabung', `${aktif().length}/${TOTAL} siswa bergabung dalam ${(joinAllMs / 1000).toFixed(1)} dtk`);
    gate(`Login/bergabung ${TOTAL} siswa`, aktif().length === TOTAL, `${aktif().length}/${TOTAL}${m.failedJoins ? ` · gagal ${m.failedJoins}` : ''}`);

    // Guru menyetujui setiap permintaan masuk (alur kelas resmi: requireApproval = true)
    const tApprove = performance.now();
    for (const b of aktif()) await http(`/sessions/${sess.id}/roster/${b.absen}/approve`, {}).catch((e) => m.answerErrorTexts.add(`approve ${b.absen}: ${e.message}`));
    logEvent(0, 'persetujuan', `guru menyetujui ${aktif().length} siswa dalam ${Math.round(performance.now() - tApprove)} ms`);

    // ── Gerbang A: Dashboard Guru membaca 33 online / 33 identitas / 33 siap ──
    let r0 = null;
    for (let i = 0; i < 40; i++) {
      await dash.refresh(sess.id);
      r0 = ringkasLive(dash.live);
      if (r0.online === TOTAL && r0.siap === TOTAL && r0.disetujui === TOTAL) break;
      await sleep(1500);
    }
    gate(`Identitas unik ${TOTAL}`, r0.identitasDiklaim === TOTAL && r0.absenGanda === 0, `diklaim ${r0.identitasDiklaim} · absen ganda ${r0.absenGanda}`);
    gate(`Siswa online bersamaan ${TOTAL} (dihitung server, bukan socket)`, r0.online === TOTAL, `online ${r0.online} · koneksi ${r0.koneksi}`);
    gate('Tidak ada siswa dihitung dua kali', r0.koneksi === r0.online, `koneksi ${r0.koneksi} = online ${r0.online}`);
    gate(`Siswa siap ${TOTAL}`, r0.siap === TOTAL, `siap ${r0.siap}`);
    gate('Nama & avatar sesuai identitas', (() => {
      const st = dash.live?.students ?? [];
      return st.length === TOTAL && st.every((s) => s.nama === `${NAME_PREFIX} ${String(s.absen).padStart(2, '0')}` && s.avatar && typeof s.avatar === 'object');
    })(), `${(dash.live?.students ?? []).length} baris diperiksa`);

    // ── 9. Guru memulai permainan ──
    await http(`/sessions/${sess.id}/start`, {});
    let status = '';
    for (let i = 0; i < 60; i++) {
      await dash.refresh(sess.id);
      status = dash.live?.state?.status ?? '';
      if (status === 'berjalan') break;
      await sleep(500);
    }
    gate('Tombol Mulai Permainan bekerja dengan 33 siswa siap', status === 'berjalan', `status ${status}`);
    startedAt = Date.now();

    // ── 10. Semua siswa masuk dunia masing-masing ──
    await Promise.all(
      aktif().map((b) =>
        b.enterWorld(b.world).catch((e) => {
          b.failed = String(e.message);
          m.failedJoins++;
        }),
      ),
    );
    const playing = aktif();
    for (const b of playing) b.snapshots = 0;

    // loop posisi 10 Hz (klien sungguhan juga 10 Hz)
    let last = performance.now();
    const loop = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      for (const b of playing) b.tick(dt);
    }, 100);

    // pengukuran health endpoint tiap 5 dtk
    const probe = setInterval(async () => {
      const h0 = performance.now();
      const r = await fetch(`${BASE}/api/health`).catch(() => null);
      m.healthMs.push(performance.now() - h0);
      if (!r || !r.ok) m.healthErrors = (m.healthErrors ?? 0) + 1;
      const u = serverUsage();
      if (u) m.usage.push(u);
    }, 5000);

    await sleep(2500);
    await dash.refresh(sess.id);
    const rWorlds = ringkasLive(dash.live);
    for (const [w, n] of Object.entries(SPREAD)) gate(`Siswa aktif di ${w}`, (rWorlds.scenes[w] ?? 0) === n, `${rWorlds.scenes[w] ?? 0}/${n}`);

    // ── otak tiap bot: aktivitas nyata sesuai dunia, selama 40 menit ──
    const answerNearest = async (b) => {
      let pt = b.pickTarget();
      if (!pt) {
        b.done.clear(); // mode daurulang: titik yang sudah lewat 90 dtk aktif kembali
        pt = b.pickTarget();
      }
      if (!pt) {
        const bx = b.bounds() - 20;
        await b.walkTo((Math.random() * 2 - 1) * bx, (Math.random() * 2 - 1) * bx, 4, 30000);
        return;
      }
      if (await b.walkTo(pt.x, pt.z, 1.4, 60000)) await b.ask(pt);
    };
    const brain = async (b) => {
      while (!b.stopped) {
        if (b.pausedForScript || !b.s?.connected || !b.inWorld) {
          await sleep(500);
          continue;
        }
        const roll = Math.random();
        try {
          if (b.world === 'laut' && roll < 0.22) {
            b.dive(8 + Math.random() * 6);
            await sleep(9000);
          } else if (b.world === 'angkasa' && roll < 0.18) {
            for (let i = 0; i < 4 && !b.stopped; i++) {
              b.jump();
              await sleep(1100);
            }
          } else if ((b.world === 'hutan' || b.world === 'angkasa') && roll < 0.34) {
            await b.useRift();
          } else if ((b.world === 'kota' || b.world === 'laut') && roll < 0.3) {
            await b.useVehicle();
          } else if (roll < 0.45) {
            await b.visitVendor();
          } else {
            await answerNearest(b);
          }
        } catch (e) {
          m.brainErrors = (m.brainErrors ?? 0) + 1;
          m.answerErrorTexts.add(`otak: ${String(e.message).slice(0, 80)}`);
        }
        await sleep(250 + Math.random() * 600);
      }
    };
    const brains = playing.map((b) => brain(b));

    // ── jadwal: ringkasan tiap 5 menit, putus–sambung, perpindahan dunia ──
    const snap = async (menit) => {
      await dash.refresh(sess.id);
      const r = ringkasLive(dash.live);
      const s = {
        menit,
        menitAktual: +((Date.now() - startedAt) / 60000).toFixed(1),
        at: nowIso(),
        status: r.status,
        online: r.online,
        koneksi: r.koneksi,
        siap: r.siap,
        absenGanda: r.absenGanda,
        scenes: r.scenes,
        poinTotal: r.totalPoin,
        dijawabTotal: r.totalDijawab,
        jawabanTerkirim: m.answers,
        jawabanBenar: m.correct,
        jawabanGagal: m.answerErrors,
        jawabanDitolakSaatGangguan: m.answerErrorsDisrupsi,
        interaksiDitolak: m.interactRejected,
        koreksiPosisi: m.corrections,
        putusTidakTerduga: m.disconnects,
        putusTerencana: m.plannedDisconnects,
        sambungUlangBerhasil: playing.reduce((a, b) => a + b.reconnects.ok, 0),
        sambungUlangGagal: m.reconnectFail,
        portal: m.rifts,
        kendaraan: m.vehicles,
        pedagang: m.vendorVisits,
        pembelian: m.purchases,
        menyelam: m.dives,
        lompat: m.jumps,
        pindahDunia: m.transitions,
        latensiSoalMs: { p50: pct(m.interactMs, 50), p95: pct(m.interactMs, 95), p99: pct(m.interactMs, 99) },
        latensiJawabMs: { p50: pct(m.answerMs, 50), p95: pct(m.answerMs, 95), p99: pct(m.answerMs, 99) },
        healthMs: { p50: pct(m.healthMs, 50), p95: pct(m.healthMs, 95), max: pct(m.healthMs, 100) },
        healthGagal: m.healthErrors ?? 0,
        dashboardPembaruan: dash.updates,
        serverLokal: m.usage.length ? { cpuMax: Math.max(...m.usage.map((u) => u.cpu)), rssMaxMb: Math.max(...m.usage.map((u) => u.rssMb)) } : null,
      };
      snapshots.push(s);
      console.log(`  ⏱ t+${String(menit).padStart(2, '0')} mnt · online ${s.online}/${TOTAL} · dunia ${JSON.stringify(s.scenes)} · jawaban ${s.jawabanTerkirim} · jawab p95 ${s.latensiJawabMs.p95 ?? '-'} ms · putus ${s.putusTidakTerduga}`);
      return s;
    };

    const at = (menit, fn) => ({ menit, fn });
    const jadwal = [];
    const snapEvery = minutes >= 40 ? 5 : Math.max(1, Math.round(minutes / 8));
    for (let k = 0; k * snapEvery <= minutes; k++) jadwal.push(at(k * snapEvery, async (mnt) => void (await snap(mnt))));

    // Perpindahan dunia beruntun untuk 4 siswa: Kota → Hutan → Laut → Angkasa → Kota
    const rotators = [1, 2, 3, 4].map(byAbsen).filter(Boolean);
    const siklus = [
      [Math.max(1, Math.round(minutes * 0.33)), 'hutan'],
      [Math.max(2, Math.round(minutes * 0.48)), 'laut'],
      [Math.max(3, Math.round(minutes * 0.65)), 'angkasa'],
      [Math.max(4, Math.round(minutes * 0.85)), 'kota'],
    ];
    const transisi = [];
    for (const [mnt, tujuan] of siklus) {
      jadwal.push(
        at(mnt, async (menit) => {
          for (const b of rotators) {
            await tenangkan(b);
            const sebelum = { absen: b.absen, nama: b.nama, poin: b.score, saldo: b.saldo, tas: b.bagCount(), dunia: b.world };
            let ok = false;
            let galat = '';
            try {
              await b.enterWorld(tujuan);
              ok = true;
            } catch (e) {
              galat = String(e.message);
            }
            b.pausedForScript = false;
            if (!ok) {
              m.transitionFail++;
              transisi.push({ menit, absen: b.absen, dari: sebelum.dunia, ke: tujuan, ok: false, galat });
              continue;
            }
            m.transitions++;
            await sleep(1200);
            await dash.refresh(sess.id);
            const row = (dash.live?.students ?? []).find((s) => s.absen === b.absen);
            transisi.push({
              menit,
              absen: b.absen,
              dari: sebelum.dunia,
              ke: tujuan,
              ok: true,
              identitasSama: row?.nama === sebelum.nama,
              duniaDiDashboard: row?.scene ?? null,
              poinSebelum: sebelum.poin,
              poinSesudah: row?.poin ?? b.score,
              poinTidakHilang: (row?.poin ?? b.score) >= sebelum.poin,
              saldoSebelum: sebelum.saldo,
              saldoSesudah: b.saldo,
              tasSebelum: sebelum.tas,
              tasSesudah: b.bagCount(),
              dompetUtuh: b.saldo >= 0 && b.bagCount() >= sebelum.tas,
              masihTerhubung: !!b.s?.connected,
            });
          }
          logEvent(menit, 'pindah dunia', `${rotators.length} siswa → ${tujuan} (berhasil ${m.transitions}, gagal ${m.transitionFail})`);
        }),
      );
    }

    // Menit 10: 3 siswa putus terkontrol → Dashboard turun → sambung ulang → kembali 33
    const putusPenuh = [11, 20, 29].map(byAbsen).filter(Boolean);
    const blip = [5, 14, 23, 31, 32].map(byAbsen).filter(Boolean);
    const putusKedua = [7, 16, 25, 33].map(byAbsen).filter(Boolean);
    const skenarioPutus = [];

    const mnt1 = Math.min(10, Math.max(1, Math.round(minutes * 0.25)));
    const mnt2 = Math.min(20, Math.max(mnt1 + 1, Math.round(minutes * 0.5)));
    const mnt3 = Math.min(30, Math.max(mnt2 + 1, Math.round(minutes * 0.75)));
    if (minutes >= 4)
      jadwal.push(
        at(mnt1, async (menit) => {
          for (const b of putusPenuh) {
            await tenangkan(b);
            b.plannedDown = true;
            b.inWorld = false;
            b.s?.disconnect();
            m.plannedDisconnects++;
          }
          logEvent(menit, 'putus terencana', `${putusPenuh.length} siswa diputus (absen ${putusPenuh.map((b) => b.absen).join(', ')})`);
          let turun = null;
          for (let i = 0; i < 30; i++) {
            await sleep(2000);
            await dash.refresh(sess.id);
            turun = ringkasLive(dash.live);
            if (turun.online <= TOTAL - putusPenuh.length) break;
          }
          const terdeteksi = turun.online === TOTAL - putusPenuh.length;
          logEvent(menit, 'dashboard', `online ${turun.online} (harapan ${TOTAL - putusPenuh.length})`);
          const hasilSambung = [];
          for (const b of putusPenuh) {
            const poinSebelum = b.score;
            const ok = await b.reconnect();
            b.plannedDown = false;
            b.pausedForScript = false;
            hasilSambung.push({ absen: b.absen, ok, poinSebelum, poinSesudah: b.score, identitasSama: true });
          }
          let kembali = null;
          for (let i = 0; i < 25; i++) {
            await sleep(2000);
            await dash.refresh(sess.id);
            kembali = ringkasLive(dash.live);
            if (kembali.online === TOTAL) break;
          }
          skenarioPutus.push({
            menit,
            jenis: 'putus penuh + sambung ulang',
            absen: putusPenuh.map((b) => b.absen),
            dashboardTurunTerdeteksi: terdeteksi,
            onlineSaatTurun: turun.online,
            sambungUlang: hasilSambung,
            onlineSetelahSambung: kembali.online,
            pulihPenuh: kembali.online === TOTAL && kembali.absenGanda === 0,
          });
          logEvent(menit, 'sambung ulang', `online kembali ${kembali.online}/${TOTAL}`);
        }),
      );

    if (minutes >= 4)
      jadwal.push(
        at(mnt2, async (menit) => {
          for (const b of blip) {
            await tenangkan(b);
            b.plannedDown = true;
            try {
              b.s?.io?.engine?.close();
            } catch {
              /* transport sudah tertutup */
            }
          }
          logEvent(menit, 'gangguan singkat', `${blip.length} siswa transport-nya ditutup (absen ${blip.map((b) => b.absen).join(', ')})`);
          await sleep(6000);
          const hasilSambung = [];
          for (const b of blip) {
            const poinSebelum = b.score;
            const ok = b.s?.connected && b.inWorld ? true : await b.reconnect();
            b.plannedDown = false;
            b.pausedForScript = false;
            hasilSambung.push({ absen: b.absen, ok: !!ok, poinSebelum, poinSesudah: b.score });
          }
          let kembali = null;
          for (let i = 0; i < 25; i++) {
            await sleep(2000);
            await dash.refresh(sess.id);
            kembali = ringkasLive(dash.live);
            if (kembali.online === TOTAL) break;
          }
          skenarioPutus.push({
            menit,
            jenis: 'gangguan koneksi pendek (sesi tidak hilang)',
            absen: blip.map((b) => b.absen),
            sambungUlang: hasilSambung,
            onlineSetelahSambung: kembali.online,
            pulihPenuh: kembali.online === TOTAL && kembali.absenGanda === 0,
          });
          logEvent(menit, 'pulih', `online ${kembali.online}/${TOTAL}`);
        }),
      );

    if (minutes >= 4)
      jadwal.push(
        at(mnt3, async (menit) => {
          const hasilSambung = [];
          for (const b of putusKedua) {
            await tenangkan(b);
            b.plannedDown = true;
            const poinSebelum = b.score;
            const tasSebelum = b.bagCount();
            b.inWorld = false;
            b.s?.disconnect();
            m.plannedDisconnects++;
            await sleep(1500);
            const ok = await b.reconnect();
            b.plannedDown = false;
            b.pausedForScript = false;
            hasilSambung.push({ absen: b.absen, ok, poinSebelum, poinSesudah: b.score, tasSebelum, tasSesudah: b.bagCount(), progresUtuh: b.score >= poinSebelum && b.bagCount() >= tasSebelum });
          }
          let kembali = null;
          for (let i = 0; i < 25; i++) {
            await sleep(2000);
            await dash.refresh(sess.id);
            kembali = ringkasLive(dash.live);
            if (kembali.online === TOTAL) break;
          }
          skenarioPutus.push({
            menit,
            jenis: 'sambung ulang identitas terpilih',
            absen: putusKedua.map((b) => b.absen),
            sambungUlang: hasilSambung,
            onlineSetelahSambung: kembali.online,
            pulihPenuh: kembali.online === TOTAL && kembali.absenGanda === 0,
          });
          logEvent(menit, 'sambung ulang', `online ${kembali.online}/${TOTAL}`);
        }),
      );

    jadwal.sort((a, b) => a.menit - b.menit);

    // jalankan jadwal berdasarkan waktu nyata sejak permainan dimulai
    let idx = 0;
    while (Date.now() - startedAt < DURATION) {
      const lewat = (Date.now() - startedAt) / 60000;
      if (idx < jadwal.length && lewat >= jadwal[idx].menit) {
        const j = jadwal[idx++];
        try {
          await j.fn(j.menit);
        } catch (e) {
          logEvent(j.menit, 'galat jadwal', String(e.message).slice(0, 160));
          m.scheduleErrors = (m.scheduleErrors ?? 0) + 1;
        }
        continue;
      }
      await sleep(2000);
    }
    const durasiAktifMs = Date.now() - startedAt;

    // ringkasan menit terakhir
    const snapAkhir = await snap(Math.round(durasiAktifMs / 60000));

    // ── Gerbang akhir: 33 masih terhubung ──
    gate('Durasi load test', durasiAktifMs >= DURATION - 5000, `${(durasiAktifMs / 60000).toFixed(1)} mnt (target ${minutes} mnt)`);
    gate(`Seluruh ${TOTAL} siswa masih terhubung di menit akhir`, snapAkhir.online === TOTAL, `online ${snapAkhir.online}`);
    gate('Tidak ada identitas ganda sepanjang uji', snapshots.every((s) => s.absenGanda === 0), `maks absen ganda ${Math.max(...snapshots.map((s) => s.absenGanda))}`);
    gate('Keempat dunia terisi bersamaan', ['kota', 'hutan', 'laut', 'angkasa'].every((w) => snapshots.some((s) => (s.scenes[w] ?? 0) > 0)), JSON.stringify(snapAkhir.scenes));
    gate('Perpindahan dunia berhasil', m.transitions > 0 && m.transitionFail === 0 && transisi.filter((t) => t.ok).every((t) => t.identitasSama && t.poinTidakHilang && t.dompetUtuh && t.masihTerhubung), `berhasil ${m.transitions} · gagal ${m.transitionFail}`);
    gate('Sambung ulang berhasil', skenarioPutus.length > 0 && skenarioPutus.every((s) => s.pulihPenuh) && m.reconnectFail === 0, `skenario ${skenarioPutus.length} · gagal ${m.reconnectFail}`);
    gate('Tidak ada disconnect mendadak', m.disconnects === 0, `putus tidak terduga ${m.disconnects} · terencana ${m.plannedDisconnects}`);
    gate(
      'Pengiriman jawaban tanpa kesalahan tak tertangani',
      m.answerErrors === 0,
      `gagal tak terduga ${m.answerErrors}${m.answerErrors ? ` · ${[...m.answerErrorTexts].slice(0, 3).join(' | ')}` : ''} · ditolak wajar saat gangguan terencana ${m.answerErrorsDisrupsi}`,
    );
    gate('Health endpoint stabil', (m.healthErrors ?? 0) === 0, `gagal ${m.healthErrors ?? 0} dari ${m.healthMs.length} panggilan`);
    gate('Dashboard Guru real-time sepanjang uji', dash.updates > snapshots.length && dash.drops === 0, `${dash.updates} pembaruan · putus ${dash.drops}`);

    // ── hentikan aktivitas, tunggu soal yang terbuka ──
    for (const b of playing) b.stopped = true;
    await Promise.allSettled(brains);
    clearInterval(loop);
    clearInterval(probe);
    for (let i = 0; i < 60 && playing.some((b) => b.busy); i++) await sleep(250);

    // ── 12-13. Akhiri sesi, skor akhir, peringkat server, podium ──
    await http(`/sessions/${sess.id}/end`, {});
    await sleep(1500);
    hasil = await http(`/sessions/${sess.id}/results`);
    gate('Jawaban soal tersimpan di database', (hasil?.answerCount ?? 0) > 0, `${hasil?.answerCount ?? 0} jawaban tersimpan · per dunia ${JSON.stringify(hasil?.perWorld ?? {})}`);
    gate('Jumlah jawaban tersimpan cocok dengan yang dikirim', (hasil?.answerCount ?? 0) >= m.answers, `tersimpan ${hasil?.answerCount} ≥ terkirim ${m.answers}`);
    const rows = hasil?.rows ?? [];
    gate('Skor akhir tersimpan untuk setiap siswa', rows.length === TOTAL, `${rows.length}/${TOTAL} baris hasil`);

    await dash.refresh(sess.id);
    const rAkhir = ringkasLive(dash.live);
    gate('Peringkat final ditetapkan server', rAkhir.peringkatTerisi === TOTAL, `${rAkhir.peringkatTerisi}/${TOTAL} siswa punya peringkat`);

    for (const b of playing) b.podium = null;
    await http(`/sessions/${sess.id}/podium`, {});
    await sleep(3000);
    const terima = playing.filter((b) => b.podium);
    const unik = new Set(terima.map((b) => JSON.stringify(b.podium.top3)));
    podiumCek = {
      penerima: terima.length,
      dariSiswaTersambung: playing.filter((b) => b.s?.connected).length,
      top3Konsisten: unik.size <= 1,
      top3: terima[0]?.podium?.top3 ?? null,
      idAcaraSama: new Set(terima.map((b) => b.podium.id)).size <= 1,
      avatarLengkap: (terima[0]?.podium?.top3 ?? []).every((e) => e.avatar && typeof e.avatar === 'object'),
      urutanBenar: (terima[0]?.podium?.top3 ?? []).every((e, i) => e.rank === i + 1),
    };
    gate('Podium juara: semua siswa menerima hasil yang sama', terima.length > 0 && podiumCek.top3Konsisten && podiumCek.idAcaraSama && podiumCek.urutanBenar && podiumCek.avatarLengkap,
      `${terima.length} siswa menerima · top3 konsisten ${podiumCek.top3Konsisten} · urutan ${podiumCek.urutanBenar}`);

    const lulus = gates.every((g) => g.ok);
    const laporan = {
      mode: 'kelas',
      base: BASE,
      at: nowIso(),
      backend: health0?.build ?? null,
      sesi: { id: sess.id, code: sess.code, className: CLASS, durasiSesiMenit: SESSION_MINUTES, soal: sess.questionCount, sumberSoal: QSOURCE },
      konfigurasi: { siswa: TOTAL, durasiSimulasiMenit: minutes, sebaran: SPREAD, namaAwal: `${NAME_PREFIX} 01`, namaAkhir: `${NAME_PREFIX} ${String(TOTAL).padStart(2, '0')}` },
      durasiAktifMenit: +(durasiAktifMs / 60000).toFixed(2),
      bergabungMs: joinAllMs,
      gerbang: gates,
      snapshots,
      events,
      transisiDunia: transisi,
      skenarioPutus,
      podium: podiumCek,
      hasilSesi: { answerCount: hasil?.answerCount ?? 0, perWorld: hasil?.perWorld ?? {}, perSubject: hasil?.perSubject ?? {}, baris: rows.length },
      metrik: {
        jawabanTerkirim: m.answers,
        jawabanBenar: m.correct,
        jawabanGagal: m.answerErrors,
        jawabanDitolakSaatGangguan: m.answerErrorsDisrupsi,
        contohDitolakSaatGangguan: [...m.answerErrorDisrupsiTexts].slice(0, 5),
        jawabanPerDunia: m.answersByWorld,
        interaksiDitolak: m.interactRejected,
        contohInteraksiDitolak: [...m.interactRejectTexts].slice(0, 5),
        contohJawabanGagal: [...m.answerErrorTexts].slice(0, 5),
        koreksiPosisi: m.corrections,
        putusTidakTerduga: m.disconnects,
        putusTerencana: m.plannedDisconnects,
        dikeluarkan: m.kicked,
        sambungUlangGagal: m.reconnectFail,
        contohGagalSambung: [...m.reconnectErrors].slice(0, 5),
        portalDipakai: m.rifts,
        portalGagal: m.riftFail,
        contohPortalGagal: [...m.riftErrors].slice(0, 5),
        kendaraanDipakai: m.vehicles,
        kendaraanGagal: m.vehicleFail,
        kunjunganPedagang: m.vendorVisits,
        pembelian: m.purchases,
        pembelianGagal: m.purchaseFail,
        menyelam: m.dives,
        lompat: m.jumps,
        pindahDunia: m.transitions,
        pindahDuniaGagal: m.transitionFail,
        jalanTimeout: m.walkTimeouts,
        galatOtakBot: m.brainErrors ?? 0,
        galatJadwal: m.scheduleErrors ?? 0,
        latensi: {
          sambungMs: { p50: pct(m.connectMs, 50), p95: pct(m.connectMs, 95) },
          joinAckMs: { p50: pct(m.joinMs, 50), p95: pct(m.joinMs, 95), p99: pct(m.joinMs, 99) },
          sambungUlangMs: { p50: pct(m.reconnectMs, 50), p95: pct(m.reconnectMs, 95) },
          interaksiSoalMs: { n: m.interactMs.length, p50: pct(m.interactMs, 50), p95: pct(m.interactMs, 95), p99: pct(m.interactMs, 99) },
          kirimJawabanMs: { n: m.answerMs.length, p50: pct(m.answerMs, 50), p95: pct(m.answerMs, 95), p99: pct(m.answerMs, 99) },
          healthMs: { n: m.healthMs.length, p50: pct(m.healthMs, 50), p95: pct(m.healthMs, 95), max: pct(m.healthMs, 100) },
        },
        dashboard: { pembaruan: dash.updates, putus: dash.drops, jedaMaksMs: dash.gaps.length ? Math.max(...dash.gaps) : null },
        snapshotPerBotPerDetik: +(playing.reduce((a, b) => a + b.snapshots, 0) / Math.max(1, playing.length) / (durasiAktifMs / 1000)).toFixed(1),
      },
      sumberDayaRailway: (() => {
        const lokal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
        return {
          tersedia: false,
          catatan: lokal
            ? 'Backend diuji di localhost; CPU/RAM yang tercatat adalah proses server lokal, BUKAN Railway.'
            : 'Metrik CPU/RAM Railway tidak dapat diakses dari runner GitHub Actions. Ambil dari dashboard Railway atau MCP Railway; jangan mengarang angka.',
          // Hanya bermakna bila server berjalan di mesin yang sama dengan uji ini.
          serverLokal: lokal && m.usage.length ? { cpuMax: Math.max(...m.usage.map((u) => u.cpu)), rssMaxMb: Math.max(...m.usage.map((u) => u.rssMb)) } : null,
        };
      })(),
      keterbatasan: [
        '33 bot Socket.IO dari satu runner GitHub Actions TIDAK membuktikan kualitas 33 jaringan HP fisik yang berbeda.',
        'Oksigen menyelam, musik, confetti, dan HUD adalah perilaku klien; diuji terpisah oleh tests/e2e/touch-worlds.mjs dan tests/e2e/podium.mjs di Chromium.',
        'Validasi posisi server tetap aktif selama uji; tidak ada teleport tidak sah yang dipakai.',
      ],
      lulus,
    };
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(laporan, null, 2));

    console.log('\n── Ringkasan per 5 menit ──');
    console.table(snapshots.map((s) => ({ menit: s.menit, online: s.online, siap: s.siap, kota: s.scenes.kota ?? 0, hutan: s.scenes.hutan ?? 0, laut: s.scenes.laut ?? 0, angkasa: s.scenes.angkasa ?? 0, jawaban: s.jawabanTerkirim, 'jawab p95': s.latensiJawabMs.p95 ?? '-', 'health p95': s.healthMs.p95 ?? '-', putus: s.putusTidakTerduga })));
    console.log('\n── Gerbang wajib ──');
    console.table(gates.map((g) => ({ pemeriksaan: g.nama, hasil: g.ok ? 'LULUS' : 'GAGAL', detail: g.detail })));
    console.log(`\n${lulus ? 'LULUS' : 'GAGAL'} · ${gates.filter((g) => g.ok).length}/${gates.length} pemeriksaan lulus · jawaban tersimpan ${hasil?.answerCount ?? 0}`);
    return lulus ? 0 : 1;
  } finally {
    // Cleanup aman: hanya sesi uji ini yang diakhiri & dihapus. Bank soal, akun guru, dan sesi lain tidak disentuh.
    for (const b of bots) {
      try {
        b.close();
      } catch {
        /* abaikan */
      }
    }
    try {
      dash?.close();
    } catch {
      /* abaikan */
    }
    if (sess?.id) {
      await http(`/sessions/${sess.id}/end`, {}).catch(() => undefined);
      await sleep(1200);
      const del = await http(`/sessions/${sess.id}`, undefined, 'DELETE').then(() => true).catch((e) => String(e.message));
      console.log(`  cleanup: sesi uji ${sess.code} ${del === true ? 'dihapus' : `GAGAL dihapus (${del}) — hapus manual di Dashboard Guru`}`);
    }
  }
}

const code = MODE === 'kelas' ? await runKelas() : await runSweep();
process.exit(code);
