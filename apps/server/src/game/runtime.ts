/**
 * SessionRuntime — keadaan permainan satu sesi kelas yang otoritatif di server.
 *
 * - Identitas siswa terikat sesi (nomor absen unik + token klaim yang di-hash).
 * - Posisi dikirim klien (prediksi) tetapi divalidasi server (batas kecepatan, batas dunia).
 * - Soal, kunci, penilaian, skor, peringkat dan podium sepenuhnya di server.
 * - Interest management: tiap pemain hanya menerima pemain terdekat di instance-nya.
 */
import crypto from 'node:crypto';
import type { Namespace, Socket } from 'socket.io';
import {
  EV,
  LIMITS,
  DEFAULT_SETTINGS,
  QUESTION_TYPE_LABEL,
  buildKota,
  buildLobby,
  zoneAt,
  KOTA_ZONES,
  checkAnswer,
  parseAnswer,
  computeScore,
  rankEntries,
  sanitizeAvatar,
  DEFAULT_AVATAR,
  isWorldId,
  WORLDS,
  type AvatarConfig,
  type SessionSettings,
  type SessionStatus,
  type SessionPublicState,
  type SceneId,
  type WorldId,
  type QuestionRecord,
  type PublicQuestion,
  type ActivePoint,
  type LeaderboardRow,
  type RemotePlayer,
  type AnswerPayload,
  type AnswerResultMsg,
  type FinalResultMsg,
  type PodiumEntry,
  type SpawnMarker,
} from '@eduverse/shared';
import { query } from '../db/pool.js';
import { loadQuestionPage } from '../questionsRepo.js';

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

interface SessionRow {
  id: string;
  teacher_id: string;
  code: string;
  title: string;
  class_name: string;
  status: SessionStatus;
  settings: Partial<SessionSettings>;
  question_ids: string[] | null;
  started_at: Date | null;
  ends_at: Date | null;
  paused_remaining_ms: number | null;
  ended_at: Date | null;
  podium_at: Date | null;
}

interface RosterRow {
  id: string;
  absen: number;
  nickname: string;
  claim_hash: string | null;
  approved: boolean;
  avatar: AvatarConfig | null;
  score: number;
  correct: number;
  answered: number;
  last_correct_at: Date | null;
  preset: boolean;
  kicked: boolean;
}

export interface Student {
  rosterId: string;
  absen: number;
  nama: string;
  claimHash: string | null;
  approved: boolean;
  preset: boolean;
  kicked: boolean;
  avatar: AvatarConfig;
  score: number;
  correct: number;
  answered: number;
  lastCorrectAt: number | null;
  streak: number;
  seen: Set<string>; // id soal yang sudah muncul
  done: Map<string, number>; // titik soal yang sudah diselesaikan → waktu
  cursor: number;
  socketId: string | null;
  lastScene: SceneId;
  lastPos: { x: number; y: number; z: number } | null;
  ready: boolean;
}

interface Pending {
  token: string;
  question: QuestionRecord;
  pointId: string;
  world: WorldId;
  zone: string;
  attempt: number;
  shownAt: number;
  optionPerm: number[] | null; // PG: indeks tampilan → indeks asli
  rightOrder: number[] | null; // Jodoh: indeks tampilan kanan → indeks asli
  hidden: boolean;
  surprise: boolean;
}

interface Player {
  socket: Socket;
  student: Student | null;
  scene: SceneId;
  instance: number;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: number;
  emote: number;
  emoteUntil: number;
  riding: boolean;
  lastStateAt: number;
  violations: number;
  known: Set<string>; // pemain lain yang metadatanya sudah dikirim
  pending: Pending | null;
  interactTimes: number[];
}

interface WorldPoints {
  active: Map<string, SpawnMarker & { surprise: boolean }>;
  cooldown: Map<string, number>; // titik rebutan yang sedang menunggu respawn
  pool: QuestionRecord[];
  poolExhausted: boolean;
  poolLoading: Promise<void> | null;
}

const rnd = (n: number) => crypto.randomInt(n);
function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const AVAILABLE_WORLDS = new Set(WORLDS.filter((w) => w.tersedia).map((w) => w.id));
const POOL_PAGE = 200;

export class SessionRuntime {
  readonly id: string;
  readonly teacherId: string;
  code: string;
  title: string;
  className: string;
  status: SessionStatus;
  settings: SessionSettings;
  questionIds: string[] | null;
  endsAt: number | null;
  pausedRemainingMs: number | null;
  podiumShown: boolean;
  students = new Map<number, Student>();
  players = new Map<string, Player>(); // socket.id → Player
  worlds = new Map<WorldId, WorldPoints>();
  private lbDirty = true;
  private lastLb: LeaderboardRow[] = [];
  private countdownTimer: NodeJS.Timeout | null = null;
  private nextSurpriseAt = 0;
  lastActivity = Date.now();

  constructor(
    row: SessionRow,
    roster: RosterRow[],
    private play: Namespace,
    private teacher: Namespace,
  ) {
    this.id = row.id;
    this.teacherId = row.teacher_id;
    this.code = row.code;
    this.title = row.title;
    this.className = row.class_name;
    this.status = row.status;
    this.settings = { ...DEFAULT_SETTINGS, ...row.settings };
    this.questionIds = row.question_ids && row.question_ids.length ? row.question_ids : null;
    this.endsAt = row.ends_at ? row.ends_at.getTime() : null;
    this.pausedRemainingMs = row.paused_remaining_ms;
    this.podiumShown = !!row.podium_at;
    for (const r of roster) this.students.set(r.absen, this.studentFromRow(r));
  }

  private studentFromRow(r: RosterRow): Student {
    return {
      rosterId: r.id,
      absen: r.absen,
      nama: r.nickname,
      claimHash: r.claim_hash,
      approved: r.approved,
      preset: r.preset,
      kicked: r.kicked,
      avatar: r.avatar ? sanitizeAvatar(r.avatar) : { ...DEFAULT_AVATAR },
      score: r.score,
      correct: r.correct,
      answered: r.answered,
      lastCorrectAt: r.last_correct_at ? r.last_correct_at.getTime() : null,
      streak: 0,
      seen: new Set(),
      done: new Map(),
      cursor: rnd(1_000_000),
      socketId: null,
      lastScene: 'lobi',
      lastPos: null,
      ready: false,
    };
  }

  // ───────────────────────────── keadaan publik ─────────────────────────────

  get room() {
    return `s:${this.id}`;
  }
  worldRoom(w: WorldId) {
    return `w:${this.id}:${w}`;
  }
  get teacherRoom() {
    return `t:${this.id}`;
  }

  publicState(): SessionPublicState {
    return {
      sessionId: this.id,
      code: this.code,
      title: this.title,
      className: this.className,
      status: this.status,
      worlds: this.settings.worlds.filter((w) => AVAILABLE_WORLDS.has(w)),
      endsAt: this.endsAt,
      remainingMs: this.status === 'jeda' ? this.pausedRemainingMs : this.endsAt ? Math.max(0, this.endsAt - Date.now()) : null,
      serverNow: Date.now(),
      showLeaderboard: this.settings.showLeaderboard,
      progressTarget: this.settings.questionMode === 'jumlah' ? this.settings.questionCount : null,
    };
  }

  rosterList() {
    return [...this.students.values()]
      .filter((s) => !s.kicked)
      .sort((a, b) => a.absen - b.absen)
      .map((s) => ({ absen: s.absen, nama: s.nama, taken: !!s.claimHash }));
  }

  broadcastState() {
    const st = this.publicState();
    this.play.to(this.room).emit(EV.session, st);
    this.teacher.to(this.teacherRoom).emit(EV.session, st);
  }

  notifyAll(text: string, kind: 'info' | 'sukses' | 'peringatan' = 'info') {
    this.play.to(this.room).emit(EV.notify, { text, kind });
  }

  // ───────────────────────────── identitas siswa ─────────────────────────────

  /** Siswa bergabung (atau tersambung ulang dengan token klaim). */
  attach(socket: Socket, claimToken: string | undefined): Student | null {
    this.lastActivity = Date.now();
    const p: Player = {
      socket,
      student: null,
      scene: 'lobi',
      instance: 0,
      x: 0,
      y: 0.2,
      z: 12,
      ry: 0,
      anim: 0,
      emote: -1,
      emoteUntil: 0,
      riding: false,
      lastStateAt: Date.now(),
      violations: 0,
      known: new Set(),
      pending: null,
      interactTimes: [],
    };
    this.players.set(socket.id, p);
    void socket.join(this.room);
    if (claimToken) {
      const h = hashToken(claimToken);
      const s = [...this.students.values()].find((x) => x.claimHash === h && !x.kicked);
      if (s) {
        this.bind(p, s);
        return s;
      }
    }
    return null;
  }

  private bind(p: Player, s: Student) {
    // Satu identitas hanya boleh aktif di satu perangkat: putuskan sambungan lama
    if (s.socketId && s.socketId !== p.socket.id) {
      const old = this.players.get(s.socketId);
      if (old) {
        old.socket.emit(EV.kicked, { reason: 'Identitas ini dipakai di perangkat lain.' });
        old.student = null;
        old.socket.disconnect(true);
      }
    }
    p.student = s;
    s.socketId = p.socket.id;
    this.lbDirty = true;
  }

  async claim(socket: Socket, absen: number, nama: string | undefined): Promise<{ ok: true; token: string; student: Student } | { ok: false; error: string }> {
    const p = this.players.get(socket.id);
    if (!p) return { ok: false, error: 'Sambungan tidak dikenal.' };
    if (p.student) return { ok: false, error: 'Kamu sudah memilih identitas.' };
    if (!Number.isInteger(absen) || absen < 1 || absen > 99) return { ok: false, error: 'Nomor absen harus 1–99.' };
    if (this.status === 'selesai') return { ok: false, error: 'Sesi sudah selesai.' };
    let s = this.students.get(absen);
    if (s?.kicked) return { ok: false, error: 'Nomor absen ini dinonaktifkan guru.' };
    if (s?.claimHash) return { ok: false, error: `Nomor absen ${absen} sudah dipakai. Minta guru mereset jika itu kamu.` };
    const presetMode = [...this.students.values()].some((x) => x.preset);
    if (!s) {
      if (presetMode) return { ok: false, error: 'Nomor absen tidak ada di daftar kelas.' };
      const clean = (nama ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
      if (clean.length < 2) return { ok: false, error: 'Nama panggilan minimal 2 huruf.' };
      const dupName = [...this.students.values()].some((x) => x.nama.toLowerCase() === clean.toLowerCase());
      if (dupName) return { ok: false, error: 'Nama panggilan sudah dipakai teman. Tambahkan inisial.' };
      const r = await query<RosterRow>(
        `INSERT INTO session_roster (session_id, absen, nickname, approved) VALUES ($1,$2,$3,$4)
         ON CONFLICT (session_id, absen) DO NOTHING RETURNING *`,
        [this.id, absen, clean, !this.settings.requireApproval],
      );
      if (!r.rows[0]) return { ok: false, error: `Nomor absen ${absen} baru saja dipakai.` };
      s = this.studentFromRow(r.rows[0]);
      this.students.set(absen, s);
    }
    const token = crypto.randomBytes(24).toString('base64url');
    const h = hashToken(token);
    // Klaim atomik di DB: hanya berhasil bila belum diklaim (mencegah duplikat lintas perangkat)
    const u = await query('UPDATE session_roster SET claim_hash = $1, claimed_at = now(), approved = approved OR $4 WHERE id = $2 AND claim_hash IS NULL AND session_id = $3', [
      h,
      s.rosterId,
      this.id,
      !this.settings.requireApproval,
    ]);
    if (!u.rowCount) return { ok: false, error: `Nomor absen ${absen} sudah dipakai.` };
    s.claimHash = h;
    if (!this.settings.requireApproval) s.approved = true;
    this.bind(p, s);
    this.play.to(this.room).emit(EV.roster, this.rosterList());
    this.pushTeacher();
    return { ok: true, token, student: s };
  }

  async setAvatar(socket: Socket, raw: unknown) {
    const p = this.players.get(socket.id);
    if (!p?.student) return;
    p.student.avatar = sanitizeAvatar(raw);
    p.known.clear();
    for (const o of this.players.values()) o.known.delete(p.socket.id);
    await query('UPDATE session_roster SET avatar = $1 WHERE id = $2', [JSON.stringify(p.student.avatar), p.student.rosterId]);
  }

  setReady(socket: Socket, ready: boolean) {
    const p = this.players.get(socket.id);
    if (p?.student) p.student.ready = !!ready;
    this.pushTeacher();
  }

  async approve(absen: number, approved: boolean) {
    const s = this.students.get(absen);
    if (!s) return false;
    s.approved = approved;
    await query('UPDATE session_roster SET approved = $1 WHERE id = $2', [approved, s.rosterId]);
    if (s.socketId) this.play.to(s.socketId).emit(EV.identityApproved, { approved });
    this.pushTeacher();
    return true;
  }

  /** Guru mereset klaim (siswa ganti perangkat / salah pilih). Skor tetap tersimpan. */
  async resetClaim(absen: number) {
    const s = this.students.get(absen);
    if (!s) return false;
    s.claimHash = null;
    if (s.socketId) {
      const p = this.players.get(s.socketId);
      p?.socket.emit(EV.kicked, { reason: 'Guru mereset identitasmu. Silakan pilih lagi.' });
      if (p) p.student = null;
    }
    s.socketId = null;
    await query('UPDATE session_roster SET claim_hash = NULL WHERE id = $1', [s.rosterId]);
    this.play.to(this.room).emit(EV.roster, this.rosterList());
    this.pushTeacher();
    return true;
  }

  async kick(absen: number) {
    const s = this.students.get(absen);
    if (!s) return false;
    s.kicked = true;
    if (s.socketId) {
      const p = this.players.get(s.socketId);
      p?.socket.emit(EV.kicked, { reason: 'Kamu dikeluarkan dari sesi oleh guru.' });
      p?.socket.disconnect(true);
    }
    await query('UPDATE session_roster SET kicked = true, claim_hash = NULL WHERE id = $1', [s.rosterId]);
    this.lbDirty = true;
    this.pushTeacher();
    return true;
  }

  detach(socket: Socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    if (p.student && p.student.socketId === socket.id) {
      p.student.socketId = null;
      p.student.lastScene = p.scene;
      p.student.lastPos = { x: p.x, y: p.y, z: p.z };
    }
    this.players.delete(socket.id);
    for (const o of this.players.values()) o.known.delete(socket.id);
    this.lbDirty = true;
  }

  // ───────────────────────────── adegan & gerak ─────────────────────────────

  enterScene(socket: Socket, scene: SceneId): { ok: true; spawn: { x: number; y: number; z: number }; points?: ActivePoint[]; done?: string[] } | { ok: false; error: string } {
    const p = this.players.get(socket.id);
    if (!p?.student) return { ok: false, error: 'Pilih identitas dahulu.' };
    if (!p.student.approved) return { ok: false, error: 'Menunggu persetujuan guru.' };
    if (scene !== 'lobi' && scene !== 'podium') {
      if (!isWorldId(scene) || !AVAILABLE_WORLDS.has(scene)) return { ok: false, error: 'Dunia ini belum dibuka.' };
      if (!this.settings.worlds.includes(scene)) return { ok: false, error: 'Guru tidak mengaktifkan dunia ini.' };
      if (this.status !== 'berjalan' && this.status !== 'jeda') return { ok: false, error: 'Tunggu guru memulai permainan.' };
    }
    if (p.scene !== 'lobi' && p.scene !== 'podium') void socket.leave(this.worldRoom(p.scene));
    if (p.pending) p.pending = null;
    const prev = p.student.lastScene === scene ? p.student.lastPos : null;
    p.scene = scene;
    p.known.clear();
    for (const o of this.players.values()) o.known.delete(socket.id);
    // instance: isi instance yang ada sampai LIMITS.instanceSize
    const counts = new Map<number, number>();
    for (const o of this.players.values()) if (o !== p && o.scene === scene) counts.set(o.instance, (counts.get(o.instance) ?? 0) + 1);
    let inst = 0;
    while ((counts.get(inst) ?? 0) >= LIMITS.instanceSize) inst++;
    p.instance = inst;
    let spawn: { x: number; y: number; z: number };
    if (scene === 'lobi') spawn = { ...buildLobby().spawnPoint, x: (rnd(80) - 40) / 10 };
    else if (scene === 'podium') spawn = { x: (rnd(200) - 100) / 10, y: 0.2, z: 14 };
    else spawn = prev ?? { ...buildKota().spawnPoint, x: (rnd(120) - 60) / 10 };
    p.x = spawn.x;
    p.y = spawn.y;
    p.z = spawn.z;
    p.lastStateAt = Date.now();
    p.student.lastScene = scene;
    this.pushTeacher();
    if (isWorldId(scene)) {
      void socket.join(this.worldRoom(scene));
      const w = this.ensureWorld(scene);
      return { ok: true, spawn, points: this.pointList(w), done: this.doneList(p.student) };
    }
    return { ok: true, spawn };
  }

  /** Validasi posisi kiriman klien. Mengembalikan posisi koreksi bila tidak sah. */
  updateState(socket: Socket, raw: unknown) {
    const p = this.players.get(socket.id);
    if (!p?.student || !raw || typeof raw !== 'object') return;
    const m = raw as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    const x = num(m.x);
    const y = num(m.y);
    const z = num(m.z);
    if (Number.isNaN(x + y + z)) return;
    if (m.scene !== p.scene) return; // paket basi dari adegan sebelumnya
    const now = Date.now();
    const dt = Math.min(2, Math.max(0.05, (now - p.lastStateAt) / 1000));
    const riding = m.riding === true;
    const maxSpeed = riding ? LIMITS.maxBusSpeed : LIMITS.maxRunSpeed;
    const horiz = Math.hypot(x - p.x, z - p.z);
    const half = p.scene === 'lobi' ? 46 : p.scene === 'podium' ? 40 : 610;
    const tooFast = horiz > maxSpeed * dt * 1.35 + 1.5;
    const outside = Math.abs(x) > half || Math.abs(z) > half || y > 260;
    const fell = y < -40;
    if (tooFast || outside || fell) {
      p.violations++;
      const back = fell || outside ? this.safeSpawn(p.scene) : { x: p.x, y: p.y, z: p.z };
      p.x = back.x;
      p.y = back.y;
      p.z = back.z;
      p.lastStateAt = now;
      socket.emit(EV.teleport, { ...back, reason: fell || outside ? 'pulih' : 'koreksi' });
      return;
    }
    p.x = x;
    p.y = y;
    p.z = z;
    p.ry = num(m.ry) || 0;
    p.anim = Math.max(0, Math.min(6, Math.trunc(num(m.anim) || 0)));
    p.riding = riding;
    p.lastStateAt = now;
  }

  safeSpawn(scene: SceneId) {
    if (scene === 'lobi') return { ...buildLobby().spawnPoint };
    if (scene === 'podium') return { x: 0, y: 0.2, z: 14 };
    return { ...buildKota().spawnPoint };
  }

  emote(socket: Socket, id: unknown) {
    const p = this.players.get(socket.id);
    if (!p || typeof id !== 'number' || id < 0 || id > 5) return;
    p.emote = Math.trunc(id);
    p.emoteUntil = Date.now() + 3000;
  }

  useLift(socket: Socket, liftId: unknown) {
    const p = this.players.get(socket.id);
    if (!p?.student || p.scene !== 'kota') return { ok: false, error: 'Tidak ada lift di sini.' };
    const lift = buildKota().lifts.find((l) => l.id === liftId);
    if (!lift) return { ok: false, error: 'Lift tidak ditemukan.' };
    if (Math.hypot(p.x - lift.x, p.z - lift.z) > LIMITS.interactDistance + 2) return { ok: false, error: 'Mendekatlah ke lift.' };
    if (lift.locked && p.student.correct < 3) return { ok: false, error: 'Lift terkunci. Jawab 3 soal dengan benar untuk membukanya.' };
    p.x = lift.target.x;
    p.y = lift.target.y;
    p.z = lift.target.z;
    p.lastStateAt = Date.now();
    return { ok: true, target: lift.target };
  }

  // ───────────────────────────── titik soal ─────────────────────────────

  private ensureWorld(w: WorldId): WorldPoints {
    let wp = this.worlds.get(w);
    if (wp) return wp;
    wp = { active: new Map(), cooldown: new Map(), pool: [], poolExhausted: false, poolLoading: null };
    this.worlds.set(w, wp);
    const spawns = w === 'kota' ? buildKota().spawns : [];
    // Kepadatan: aktifkan sebagian titik di tiap zona (dipilih acak, merata per zona)
    const byZone = new Map<string, SpawnMarker[]>();
    for (const s of spawns) byZone.set(s.zone, [...(byZone.get(s.zone) ?? []), s]);
    for (const list of byZone.values()) {
      const n = Math.max(4, Math.round(list.length * this.settings.density));
      for (const i of shuffled(list.length).slice(0, n)) {
        const s = list[i]!;
        wp.active.set(s.id, { ...s, surprise: false });
      }
    }
    return wp;
  }

  private pointList(w: WorldPoints): ActivePoint[] {
    return [...w.active.values()].map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, zone: s.zone, object: s.object, hidden: s.hidden, surprise: s.surprise, done: false }));
  }

  private doneList(s: Student): string[] {
    const now = Date.now();
    const out: string[] = [];
    for (const [id, t] of s.done) {
      if (this.settings.pointMode === 'daurulang' && now - t > 90_000) s.done.delete(id);
      else out.push(id);
    }
    return out;
  }

  private async nextQuestion(w: WorldId, wp: WorldPoints, s: Student): Promise<QuestionRecord | null> {
    for (let round = 0; round < 50; round++) {
      const pool = wp.pool;
      if (pool.length) {
        for (let k = 0; k < pool.length; k++) {
          const q = pool[(s.cursor + k) % pool.length]!;
          if (!s.seen.has(q.id)) {
            s.cursor = (s.cursor + k + 1) % pool.length;
            return q;
          }
        }
      }
      if (!wp.poolExhausted) {
        if (!wp.poolLoading) {
          wp.poolLoading = loadQuestionPage(this.teacherId, this.id, {
            subjects: this.settings.subjects,
            grade: this.settings.grade,
            world: w,
            ids: this.questionIds,
            limit: POOL_PAGE,
            offset: wp.pool.length,
          }).then((page) => {
            wp.pool.push(...page);
            if (page.length < POOL_PAGE) wp.poolExhausted = true;
            wp.poolLoading = null;
          });
        }
        await wp.poolLoading;
        continue;
      }
      if (this.settings.allowRepeat && pool.length) {
        for (const q of pool) s.seen.delete(q.id);
        continue;
      }
      return null;
    }
    return null;
  }

  async interact(socket: Socket, pointId: unknown): Promise<{ ok: true; question: PublicQuestion } | { ok: false; error: string }> {
    const p = this.players.get(socket.id);
    if (!p?.student) return { ok: false, error: 'Pilih identitas dahulu.' };
    if (this.status !== 'berjalan') return { ok: false, error: this.status === 'jeda' ? 'Permainan sedang dijeda guru.' : 'Permainan belum berjalan.' };
    if (!isWorldId(p.scene)) return { ok: false, error: 'Tidak ada soal di sini.' };
    const now = Date.now();
    p.interactTimes = p.interactTimes.filter((t) => now - t < 60_000);
    if (p.interactTimes.length >= LIMITS.questionRequestsPerMinute) return { ok: false, error: 'Pelan-pelan ya! Coba lagi sebentar lagi.' };
    if (p.pending) return { ok: true, question: this.toPublic(p.pending) };
    const wp = this.ensureWorld(p.scene);
    const pt = typeof pointId === 'string' ? wp.active.get(pointId) : undefined;
    if (!pt) return { ok: false, error: 'Titik soal ini sudah tidak aktif.' };
    if (Math.hypot(p.x - pt.x, p.z - pt.z) > LIMITS.interactDistance + 1.5 || Math.abs(p.y - pt.y) > 4) return { ok: false, error: 'Mendekatlah ke objek.' };
    this.doneList(p.student);
    if (p.student.done.has(pt.id)) return { ok: false, error: 'Kamu sudah menyelesaikan titik ini.' };
    if (this.settings.questionMode === 'jumlah' && p.student.answered >= this.settings.questionCount)
      return { ok: false, error: `Hebat! Kamu sudah menjawab ${this.settings.questionCount} soal.` };
    const q = await this.nextQuestion(p.scene, wp, p.student);
    if (!q) return { ok: false, error: 'Semua soal sudah kamu jawab. Hebat!' };
    p.interactTimes.push(now);
    p.student.seen.add(q.id);
    const pend: Pending = {
      token: crypto.randomBytes(12).toString('base64url'),
      question: q,
      pointId: pt.id,
      world: p.scene,
      zone: pt.zone,
      attempt: 1,
      shownAt: now,
      optionPerm: q.type === 'pg' ? shuffled(q.options.length) : null,
      rightOrder: q.type === 'jodoh' ? shuffled(q.right.length) : null,
      hidden: pt.hidden,
      surprise: pt.surprise,
    };
    p.pending = pend;
    return { ok: true, question: this.toPublic(pend) };
  }

  private toPublic(pd: Pending): PublicQuestion {
    const q = pd.question;
    const zone = KOTA_ZONES.find((z) => z.id === pd.zone);
    return {
      token: pd.token,
      type: q.type,
      typeLabel: QUESTION_TYPE_LABEL[q.type],
      subject: q.subject,
      topic: q.topic,
      prompt: q.prompt,
      options: pd.optionPerm ? pd.optionPerm.map((i) => q.options[i]!) : q.options,
      right: pd.rightOrder ? pd.rightOrder.map((i) => q.right[i]!) : [],
      points: this.basePointsFor(q),
      attempt: pd.attempt,
      location: zone?.nama ?? pd.zone,
      object: pd.pointId,
      surprise: pd.surprise,
    };
  }

  private basePointsFor(q: QuestionRecord) {
    return Math.round((q.points * this.settings.basePoints) / 100);
  }

  closeQuestion(socket: Socket) {
    const p = this.players.get(socket.id);
    if (p) p.pending = null; // soal yang ditutup tetap dihitung "terlihat" (tidak diulang)
  }

  async answer(socket: Socket, raw: unknown): Promise<{ ok: true; result: AnswerResultMsg } | { ok: false; error: string }> {
    const p = this.players.get(socket.id);
    if (!p?.student) return { ok: false, error: 'Pilih identitas dahulu.' };
    const pd = p.pending;
    const msg = (raw ?? {}) as { token?: unknown; answer?: unknown };
    if (!pd || msg.token !== pd.token) return { ok: false, error: 'Soal ini sudah tidak berlaku.' };
    if (this.status !== 'berjalan') return { ok: false, error: 'Permainan tidak sedang berjalan.' };
    const q = pd.question;
    const count = q.type === 'pg' || q.type === 'jodoh' ? q.options.length : 0;
    const ans = parseAnswer(msg.answer, q.type, count);
    if (!ans) return { ok: false, error: 'Bentuk jawaban tidak valid.' };
    const mapped: AnswerPayload = ans.type === 'pg' && pd.optionPerm ? { type: 'pg', index: pd.optionPerm[ans.index]! } : ans;
    const correct = checkAnswer(q.key, mapped, pd.rightOrder ?? undefined);
    const s = p.student;
    const now = Date.now();
    const elapsed = now - pd.shownAt;
    let points = 0;
    let breakdown;
    const finalAttempt = correct || pd.attempt >= 2 || !this.settings.secondChance;
    if (correct) {
      s.streak++;
      breakdown = computeScore({
        basePoints: this.basePointsFor(q),
        attempt: pd.attempt,
        elapsedSeconds: elapsed / 1000,
        hidden: pd.hidden,
        surprise: pd.surprise,
        streakAfter: s.streak,
      });
      points = breakdown.total;
      s.score += points;
      s.correct++;
      s.lastCorrectAt = now;
    } else if (finalAttempt) {
      s.streak = 0;
    }
    if (finalAttempt) {
      s.answered++;
      s.done.set(pd.pointId, now);
      p.pending = null;
    } else {
      pd.attempt = 2;
      pd.shownAt = now;
    }
    // Persistensi: setiap percobaan dicatat; skor siswa diperbarui atomik
    await query(
      `INSERT INTO answers (session_id, roster_id, question_id, point_id, world, zone, answer, correct, points, attempt, elapsed_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [this.id, s.rosterId, q.id, pd.pointId, pd.world, pd.zone, JSON.stringify(mapped), correct, points, pd.attempt === 2 && !finalAttempt ? 1 : pd.attempt, Math.min(elapsed, 2_000_000_000)],
    );
    if (finalAttempt) {
      await query(
        'UPDATE session_roster SET score = $2, correct = $3, answered = $4, last_correct_at = $5 WHERE id = $1',
        [s.rosterId, s.score, s.correct, s.answered, s.lastCorrectAt ? new Date(s.lastCorrectAt) : null],
      );
    }
    this.lbDirty = true;
    this.lastActivity = now;
    if (correct && this.settings.pointMode === 'rebutan') this.consumePoint(pd.world, pd.pointId);
    const result: AnswerResultMsg = {
      correct,
      canRetry: !finalAttempt,
      chosen: ans,
      correctAnswer: finalAttempt && !correct ? this.displayKey(pd) : undefined,
      breakdown,
      explanation: finalAttempt ? q.explanation : undefined,
      streak: s.streak,
      totalScore: s.score,
      answeredCorrect: s.correct,
    };
    this.teacher.to(this.teacherRoom).emit(EV.answerFeed, {
      at: now,
      absen: s.absen,
      nama: s.nama,
      subject: q.subject,
      topic: q.topic,
      prompt: q.prompt.slice(0, 120),
      correct,
      points,
      attempt: finalAttempt && !correct && pd.attempt === 2 ? 2 : correct ? pd.attempt : 1,
      zone: pd.zone,
      world: pd.world,
    });
    return { ok: true, result };
  }

  /** Kunci dalam urutan tampilan siswa (hanya dikirim setelah percobaan terakhir salah). */
  private displayKey(pd: Pending): AnswerPayload {
    const k = pd.question.key;
    switch (k.type) {
      case 'pg':
        return { type: 'pg', index: pd.optionPerm ? pd.optionPerm.indexOf(k.index) : k.index };
      case 'bs':
        return { type: 'bs', value: k.value };
      case 'isian':
        return { type: 'isian', text: k.accepted[0] ?? '' };
      case 'jodoh':
        return { type: 'jodoh', pairs: k.pairs.map((orig) => (pd.rightOrder ? pd.rightOrder.indexOf(orig) : orig)) };
    }
  }

  /** Mode rebutan: titik hilang untuk semua, lalu muncul titik baru di zona yang sama. */
  private consumePoint(w: WorldId, pointId: string) {
    const wp = this.worlds.get(w);
    const pt = wp?.active.get(pointId);
    if (!wp || !pt) return;
    wp.active.delete(pointId);
    wp.cooldown.set(pointId, Date.now() + 30_000);
    const candidates = (w === 'kota' ? buildKota().spawns : []).filter((s) => s.zone === pt.zone && !wp.active.has(s.id) && !wp.cooldown.has(s.id));
    if (candidates.length) {
      const n = candidates[rnd(candidates.length)]!;
      wp.active.set(n.id, { ...n, surprise: false });
    }
    this.play.to(this.worldRoom(w)).emit(EV.points, { world: w, points: this.pointList(wp) });
  }

  // ───────────────────────────── kendali guru ─────────────────────────────

  async start(): Promise<string | null> {
    if (this.status !== 'menunggu') return 'Sesi sudah dimulai.';
    // Pastikan ada soal untuk setiap dunia aktif
    for (const w of this.settings.worlds.filter((x) => AVAILABLE_WORLDS.has(x))) {
      const page = await loadQuestionPage(this.teacherId, this.id, { subjects: this.settings.subjects, grade: this.settings.grade, world: w, ids: this.questionIds, limit: 1, offset: 0 });
      if (!page.length) return `Belum ada soal yang cocok untuk Dunia ${w}. Tambahkan soal atau ubah filter mapel/kelas.`;
    }
    this.status = 'hitung';
    this.broadcastState();
    let n = 3;
    this.play.to(this.room).emit(EV.countdown, { n });
    this.countdownTimer = setInterval(() => {
      n--;
      if (n > 0) {
        this.play.to(this.room).emit(EV.countdown, { n });
        return;
      }
      if (this.countdownTimer) clearInterval(this.countdownTimer);
      this.countdownTimer = null;
      this.status = 'berjalan';
      this.endsAt = Date.now() + this.settings.durationMinutes * 60_000;
      this.nextSurpriseAt = Date.now() + 120_000;
      void query("UPDATE sessions SET status = 'berjalan', started_at = now(), ends_at = $2 WHERE id = $1", [this.id, new Date(this.endsAt)]);
      this.play.to(this.room).emit(EV.countdown, { n: 0 });
      this.broadcastState();
      this.notifyAll('Permainan dimulai! Masuk ke portal dan temukan soal.', 'sukses');
    }, 1000);
    return null;
  }

  async pause(): Promise<string | null> {
    if (this.status !== 'berjalan' || !this.endsAt) return 'Permainan tidak sedang berjalan.';
    this.pausedRemainingMs = Math.max(0, this.endsAt - Date.now());
    this.status = 'jeda';
    for (const p of this.players.values()) p.pending = null;
    await query("UPDATE sessions SET status = 'jeda', paused_remaining_ms = $2 WHERE id = $1", [this.id, this.pausedRemainingMs]);
    this.broadcastState();
    this.notifyAll('Guru menjeda permainan sebentar.', 'peringatan');
    return null;
  }

  async resume(): Promise<string | null> {
    if (this.status !== 'jeda') return 'Permainan tidak sedang dijeda.';
    this.endsAt = Date.now() + (this.pausedRemainingMs ?? 0);
    this.pausedRemainingMs = null;
    this.status = 'berjalan';
    await query("UPDATE sessions SET status = 'berjalan', ends_at = $2, paused_remaining_ms = NULL WHERE id = $1", [this.id, new Date(this.endsAt)]);
    this.broadcastState();
    this.notifyAll('Permainan dilanjutkan!', 'sukses');
    return null;
  }

  async extend(minutes: number): Promise<string | null> {
    const m = Math.max(1, Math.min(30, Math.trunc(minutes)));
    if (this.status === 'berjalan' && this.endsAt) {
      this.endsAt += m * 60_000;
      await query('UPDATE sessions SET ends_at = $2 WHERE id = $1', [this.id, new Date(this.endsAt)]);
    } else if (this.status === 'jeda') {
      this.pausedRemainingMs = (this.pausedRemainingMs ?? 0) + m * 60_000;
      await query('UPDATE sessions SET paused_remaining_ms = $2 WHERE id = $1', [this.id, this.pausedRemainingMs]);
    } else return 'Waktu hanya bisa ditambah saat permainan berjalan.';
    this.broadcastState();
    this.notifyAll(`Guru menambah waktu ${m} menit.`);
    return null;
  }

  ranking() {
    const list = [...this.students.values()]
      .filter((s) => s.claimHash || s.answered > 0)
      .filter((s) => !s.kicked)
      .map((s) => ({ studentId: String(s.absen), nama: s.nama, absen: s.absen, poin: s.score, benar: s.correct, lastCorrectAt: s.lastCorrectAt, s }));
    return rankEntries(list);
  }

  /** Akhiri permainan: kunci hasil, hitung peringkat gabungan, kirim hasil pribadi. */
  async end(): Promise<string | null> {
    if (this.status === 'selesai') return 'Sesi sudah selesai.';
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.status = 'selesai';
    this.endsAt = null;
    for (const p of this.players.values()) p.pending = null;
    await query("UPDATE sessions SET status = 'selesai', ended_at = now(), paused_remaining_ms = NULL WHERE id = $1", [this.id]);
    // Simpan skor akhir semua siswa (sumber kebenaran ada di DB)
    for (const s of this.students.values()) {
      await query('UPDATE session_roster SET score = $2, correct = $3, answered = $4, last_correct_at = $5 WHERE id = $1', [
        s.rosterId,
        s.score,
        s.correct,
        s.answered,
        s.lastCorrectAt ? new Date(s.lastCorrectAt) : null,
      ]);
    }
    const ranked = this.ranking();
    const top3 = this.top3(ranked);
    for (const p of this.players.values()) {
      if (!p.student) continue;
      const me = ranked.find((r) => r.absen === p.student!.absen);
      const msg: FinalResultMsg = {
        poin: p.student.score,
        benar: p.student.correct,
        dijawab: p.student.answered,
        rank: me?.rank ?? ranked.length,
        total: ranked.length,
        lencana: this.badges(p.student),
        saran: this.advice(p.student),
        top3,
      };
      p.socket.emit(EV.ended, msg);
    }
    this.broadcastState();
    this.lbDirty = true;
    this.pushTeacher();
    return null;
  }

  top3(ranked = this.ranking()): PodiumEntry[] {
    return ranked.slice(0, 3).map((r) => ({ rank: r.rank, nama: r.nama, absen: r.absen, poin: r.poin, avatar: r.s.avatar }));
  }

  async showPodium(): Promise<string | null> {
    if (this.status !== 'selesai') return 'Akhiri permainan terlebih dahulu.';
    this.podiumShown = true;
    await query('UPDATE sessions SET podium_at = now() WHERE id = $1', [this.id]);
    const payload = { top3: this.top3(), total: this.ranking().length };
    this.play.to(this.room).emit(EV.podium, payload);
    this.teacher.to(this.teacherRoom).emit(EV.podium, payload);
    return null;
  }

  private badges(s: Student): string[] {
    const out: string[] = [];
    if (s.correct >= 1) out.push('Penjelajah Pemula');
    if (s.correct >= 5) out.push('Pemburu Soal');
    if (s.answered > 0 && s.correct === s.answered && s.answered >= 3) out.push('Tanpa Salah');
    if (s.correct >= 10) out.push('Juara Kota');
    return out;
  }

  private advice(s: Student): string {
    if (!s.answered) return 'Ayo coba jelajahi kota dan temukan soal di sesi berikutnya!';
    const acc = s.correct / s.answered;
    if (acc >= 0.8) return 'Luar biasa! Pertahankan, dan coba soal yang lebih sulit.';
    if (acc >= 0.5) return 'Bagus! Baca kembali pembahasan soal yang salah agar makin paham.';
    return 'Tetap semangat! Pelajari lagi pembahasannya dan tanyakan pada guru.';
  }

  // ───────────────────────────── loop berkala ─────────────────────────────

  /** Dipanggil 10×/detik: snapshot pemain terdekat (interest management). */
  tickSnapshots() {
    const now = Date.now();
    const groups = new Map<string, Player[]>();
    for (const p of this.players.values()) {
      if (!p.student) continue;
      if (p.emote >= 0 && now > p.emoteUntil) p.emote = -1;
      const key = `${p.scene}#${p.instance}`;
      const g = groups.get(key);
      if (g) g.push(p);
      else groups.set(key, [p]);
    }
    const CELL = 50;
    for (const list of groups.values()) {
      if (list.length < 2) {
        for (const p of list) p.socket.volatile.emit(EV.players, { t: now, list: [], gone: [] });
        continue;
      }
      // grid spasial sederhana
      const grid = new Map<string, Player[]>();
      for (const p of list) {
        const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
        const c = grid.get(k);
        if (c) c.push(p);
        else grid.set(k, [p]);
      }
      const R = Math.ceil(LIMITS.visibleRadius / CELL);
      for (const p of list) {
        const cx = Math.floor(p.x / CELL);
        const cz = Math.floor(p.z / CELL);
        const near: { o: Player; d: number }[] = [];
        for (let dx = -R; dx <= R; dx++)
          for (let dz = -R; dz <= R; dz++) {
            const c = grid.get(`${cx + dx},${cz + dz}`);
            if (!c) continue;
            for (const o of c) {
              if (o === p) continue;
              const d = Math.hypot(o.x - p.x, o.z - p.z);
              if (d <= LIMITS.visibleRadius) near.push({ o, d });
            }
          }
        near.sort((a, b) => a.d - b.d);
        const vis = near.slice(0, LIMITS.maxVisiblePlayers);
        const ids = new Set(vis.map((v) => v.o.socket.id));
        const gone = [...p.known].filter((id) => !ids.has(id));
        for (const g of gone) p.known.delete(g);
        const out: (RemotePlayer | [string, number, number, number, number, number, number])[] = vis.map(({ o }) => {
          const r2 = (v: number) => Math.round(v * 100) / 100;
          if (p.known.has(o.socket.id)) return [o.socket.id, r2(o.x), r2(o.y), r2(o.z), r2(o.ry), o.anim, o.emote];
          p.known.add(o.socket.id);
          return { id: o.socket.id, nama: o.student!.nama, absen: o.student!.absen, avatar: o.student!.avatar, x: o.x, y: o.y, z: o.z, ry: o.ry, anim: o.anim, emote: o.emote };
        });
        p.socket.volatile.emit(EV.players, { t: now, list: out, gone });
      }
    }
  }

  /** Dipanggil 1×/detik: timer, kejutan, leaderboard, dashboard. */
  async tickSecond() {
    const now = Date.now();
    if (this.status === 'berjalan' && this.endsAt && now >= this.endsAt) {
      await this.end();
      return;
    }
    if (this.status === 'berjalan' && now >= this.nextSurpriseAt) {
      this.nextSurpriseAt = now + 120_000;
      for (const [w, wp] of this.worlds) {
        for (const pt of wp.active.values()) pt.surprise = false;
        const all = [...wp.active.values()];
        if (!all.length) continue;
        const pick = all[rnd(all.length)]!;
        pick.surprise = true;
        const zone = KOTA_ZONES.find((z) => z.id === pick.zone);
        this.play.to(this.worldRoom(w)).emit(EV.points, { world: w, points: this.pointList(wp) });
        this.play.to(this.worldRoom(w)).emit(EV.notify, { text: `⭐ Soal Kejutan (poin ×2) muncul di ${zone?.nama ?? pick.zone}!`, kind: 'sukses' });
      }
    }
    // respawn titik rebutan
    for (const wp of this.worlds.values()) for (const [id, t] of wp.cooldown) if (now > t) wp.cooldown.delete(id);
    if (this.lbDirty) {
      this.lbDirty = false;
      const online = new Set([...this.players.values()].map((p) => p.student?.absen).filter((x): x is number => x !== undefined));
      this.lastLb = this.ranking().map((r) => ({ studentId: r.studentId, nama: r.nama, absen: r.absen, poin: r.poin, benar: r.benar, rank: r.rank, online: online.has(r.absen) }));
      if (this.settings.showLeaderboard || this.status === 'selesai') this.play.to(this.room).emit(EV.leaderboard, this.lastLb.slice(0, 10));
      for (const p of this.players.values()) {
        if (!p.student) continue;
        const me = this.lastLb.find((r) => r.absen === p.student!.absen);
        p.socket.emit(EV.score, { poin: p.student.score, benar: p.student.correct, dijawab: p.student.answered, rank: me?.rank ?? null, total: this.lastLb.length, streak: p.student.streak });
      }
    }
    this.pushTeacher();
  }

  /** Data langsung untuk Dashboard Guru — dari keadaan server yang sebenarnya. */
  liveData() {
    const byAbsen = new Map<number, Player>();
    for (const p of this.players.values()) if (p.student) byAbsen.set(p.student.absen, p);
    const ranked = this.ranking();
    const rankOf = new Map(ranked.map((r) => [r.absen, r.rank]));
    const students = [...this.students.values()]
      .filter((s) => !s.kicked)
      .sort((a, b) => a.absen - b.absen)
      .map((s) => {
        const p = byAbsen.get(s.absen);
        const zone = p && p.scene === 'kota' ? zoneAt(p.x, p.z) : null;
        return {
          absen: s.absen,
          nama: s.nama,
          claimed: !!s.claimHash,
          approved: s.approved,
          online: !!p,
          ready: s.ready,
          scene: p?.scene ?? null,
          zone: zone?.id ?? null,
          zoneName: zone?.nama ?? null,
          x: p ? Math.round(p.x) : null,
          z: p ? Math.round(p.z) : null,
          poin: s.score,
          benar: s.correct,
          dijawab: s.answered,
          rank: rankOf.get(s.absen) ?? null,
          avatar: s.avatar,
        };
      });
    const scenes: Record<string, number> = {};
    const zones: Record<string, number> = {};
    for (const s of students) {
      if (!s.online) continue;
      scenes[s.scene ?? '-'] = (scenes[s.scene ?? '-'] ?? 0) + 1;
      if (s.zone) zones[s.zone] = (zones[s.zone] ?? 0) + 1;
    }
    return { state: this.publicState(), students, scenes, zones, online: byAbsen.size, connections: this.players.size, podiumShown: this.podiumShown };
  }

  private lastTeacherPush = 0;
  pushTeacher() {
    const now = Date.now();
    if (now - this.lastTeacherPush < 400) return;
    this.lastTeacherPush = now;
    this.teacher.to(this.teacherRoom).emit(EV.live, this.liveData());
  }

  async updateSettings(patch: Partial<SessionSettings>, title?: string, className?: string) {
    this.settings = { ...this.settings, ...patch };
    if (title) this.title = title;
    if (className) this.className = className;
    this.worlds.clear(); // pool & titik dibangun ulang dengan pengaturan baru
    this.broadcastState();
  }
}

// ───────────────────────────── registry runtime ─────────────────────────────

export class RuntimeRegistry {
  private map = new Map<string, SessionRuntime>();
  private loading = new Map<string, Promise<SessionRuntime | null>>();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private play: Namespace,
    private teacher: Namespace,
  ) {}

  startLoops() {
    this.timers.push(
      setInterval(() => {
        for (const r of this.map.values()) r.tickSnapshots();
      }, 1000 / LIMITS.snapshotHz),
    );
    this.timers.push(
      setInterval(() => {
        for (const r of this.map.values()) void r.tickSecond().catch((e) => console.error('[tick]', e));
        // bebaskan memori sesi yang sudah lama sepi
        for (const [id, r] of this.map) if (r.players.size === 0 && Date.now() - r.lastActivity > 30 * 60_000 && r.status !== 'berjalan') this.map.delete(id);
      }, 1000),
    );
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
  }

  get(id: string) {
    return this.map.get(id);
  }

  all() {
    return [...this.map.values()];
  }

  async load(sessionId: string): Promise<SessionRuntime | null> {
    const have = this.map.get(sessionId);
    if (have) return have;
    let p = this.loading.get(sessionId);
    if (!p) {
      p = (async () => {
        const s = await query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [sessionId]);
        if (!s.rows[0]) return null;
        const r = await query<RosterRow>('SELECT * FROM session_roster WHERE session_id = $1', [sessionId]);
        const rt = new SessionRuntime(s.rows[0], r.rows, this.play, this.teacher);
        this.map.set(sessionId, rt);
        return rt;
      })().finally(() => this.loading.delete(sessionId));
      this.loading.set(sessionId, p);
    }
    return p;
  }

  async byCode(code: string): Promise<SessionRuntime | null> {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    for (const r of this.map.values()) if (r.code === c) return r;
    const s = await query<{ id: string }>('SELECT id FROM sessions WHERE code = $1', [c]);
    return s.rows[0] ? this.load(s.rows[0].id) : null;
  }

  drop(id: string) {
    this.map.delete(id);
  }
}
