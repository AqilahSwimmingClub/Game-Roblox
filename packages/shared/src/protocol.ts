import type { AvatarConfig } from './avatar.js';
import type { WorldId, SceneId } from './worlds.js';
import type { PublicQuestion, AnswerPayload } from './questions.js';
import type { ScoreBreakdown } from './scoring.js';

export type SessionStatus = 'menunggu' | 'hitung' | 'berjalan' | 'jeda' | 'selesai';
export type PointMode = 'personal' | 'rebutan' | 'daurulang';

export interface SessionSettings {
  durationMinutes: number;
  basePoints: number;
  worlds: WorldId[];
  subjects: string[]; // kosong = semua
  grade: number | null;
  questionMode: 'tanpa-batas' | 'jumlah';
  questionCount: number; // dipakai bila questionMode = 'jumlah'
  allowRepeat: boolean; // guru mengizinkan pengulangan soal
  secondChance: boolean;
  pointMode: PointMode;
  density: number; // 0.3 | 0.5 | 0.8
  requireApproval: boolean; // identitas siswa harus disetujui guru
  showLeaderboard: boolean;
}

export const DEFAULT_SETTINGS: SessionSettings = {
  durationMinutes: 20,
  basePoints: 100,
  worlds: ['kota'],
  subjects: [],
  grade: null,
  questionMode: 'tanpa-batas',
  questionCount: 20,
  allowRepeat: false,
  secondChance: true,
  pointMode: 'personal',
  density: 0.5,
  requireApproval: true, // guru menyetujui setiap siswa yang masuk (alur kelas resmi)
  showLeaderboard: true,
};

/** Batas server (anti curang & stabilitas). */
export const LIMITS = {
  stateHz: 10, // klien mengirim posisi 10×/detik
  snapshotHz: 10, // server mengirim pemain terdekat 10×/detik
  maxRunSpeed: 8.5, // m/detik (lari 7,5 + toleransi)
  maxBusSpeed: 14,
  interactDistance: 4.5, // m
  questionRequestsPerMinute: 8,
  visibleRadius: 150, // m — interest management
  maxVisiblePlayers: 30,
  instanceSize: 60, // pemain per instance dunia (visibilitas), leaderboard tetap satu
  codeAttemptsPerMinute: 8,
} as const;

/** Status ringkas pemain lain yang dikirim server (interest management). */
export interface RemotePlayer {
  id: string;
  nama: string;
  absen: number;
  avatar: AvatarConfig;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: number; // 0 diam, 1 jalan, 2 lari, 3 lompat/jatuh, 4 renang, 5 duduk
  emote: number; // -1 tidak ada
  mode: number; // MODE_CODE (0 jalan, 2 sepeda, 3 motor, 4 mobil, 5 bus, 6 pesawat, 7 jetpack, 1 penumpang)
  tp: number; // bertambah setiap teleport (lift/lubang dimensi/koreksi) → klien tidak menginterpolasi lompatan
  vc: number; // warna kendaraan yang dikendarai
}

/** Snapshot ringkas: [id, x, y, z, ry, anim, emote, mode, tp, vc]. */
export type CompactPlayer = [string, number, number, number, number, number, number, number, number, number];

/** Status kendaraan yang bisa dikendarai (parkir / sedang dipakai) — dikirim saat berubah saja. */
export interface VehicleStateMsg {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  color: number;
  driver: string | null; // socket id pengemudi
}

export interface PlayerStateMsg {
  scene: SceneId;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: number;
  riding: boolean;
  /** Info saja (server memakai mode yang ia catat sendiri). */
  mode?: number;
  /** Untuk pesawat: kemiringan badan (radian), hanya visual. */
  pitch?: number;
  roll?: number;
}

export interface ActivePoint {
  id: string;
  x: number;
  y: number;
  z: number;
  zone: string;
  object: string;
  hidden: boolean;
  surprise: boolean;
  done: boolean; // sudah diselesaikan pemain ini
}

export interface LeaderboardRow {
  studentId: string;
  nama: string;
  absen: number;
  poin: number;
  benar: number;
  rank: number;
  online: boolean;
}

export interface SessionPublicState {
  sessionId: string;
  code: string;
  title: string;
  className: string;
  status: SessionStatus;
  worlds: WorldId[];
  endsAt: number | null; // epoch ms (waktu server)
  remainingMs: number | null; // saat jeda
  serverNow: number;
  showLeaderboard: boolean;
  progressTarget: number | null;
}

export interface RosterEntry {
  absen: number;
  nama: string;
  taken: boolean;
}

export interface AnswerResultMsg {
  correct: boolean;
  canRetry: boolean;
  chosen: AnswerPayload;
  correctAnswer?: AnswerPayload; // dikirim hanya setelah percobaan terakhir salah
  breakdown?: ScoreBreakdown;
  explanation?: string;
  streak: number;
  totalScore: number;
  answeredCorrect: number;
}

export interface FinalResultMsg {
  poin: number;
  benar: number;
  dijawab: number;
  rank: number;
  total: number;
  lencana: string[];
  saran: string;
  top3: PodiumEntry[];
}

export interface PodiumEntry {
  rank: number;
  nama: string;
  absen: number;
  poin: number;
  avatar: AvatarConfig;
}

/** Nama event Socket.IO (namespace /play untuk siswa, /teacher untuk guru). */
export const EV = {
  // klien siswa → server
  join: 'join', // {code, claimToken?} → ack
  claimIdentity: 'identity:claim', // {absen} → ack
  setAvatar: 'avatar:set',
  setReady: 'ready:set',
  enterWorld: 'world:enter', // {world} → ack
  leaveWorld: 'world:leave',
  state: 'player:state',
  interact: 'point:interact', // {pointId} → ack
  answer: 'answer:submit', // {token, answer} → ack
  closeQuestion: 'question:close',
  emote: 'emote',
  useLift: 'lift:use', // {liftId} → ack
  vehicleEnter: 'vehicle:enter', // {id} → ack {ok, vehicle}
  vehicleExit: 'vehicle:exit', // {x, y, z} → ack {ok, x, y, z}
  jetpack: 'jetpack:set', // {on, stationId?} → ack
  riftUse: 'rift:use', // {riftId} → ack {ok, target, nama}
  // server → klien siswa
  session: 'session:state',
  roster: 'roster',
  identityApproved: 'identity:approved',
  players: 'players:snapshot',
  points: 'points:update',
  question: 'question:show',
  result: 'answer:result',
  score: 'score:update',
  leaderboard: 'leaderboard',
  notify: 'notify',
  countdown: 'countdown',
  teleport: 'teleport',
  vehicles: 'vehicles:state', // VehicleStateMsg[] (penuh) saat masuk dunia & setiap perubahan
  ended: 'game:ended',
  podium: 'podium:show',
  kicked: 'kicked',
  waiting: 'waiting:list',
  // server → dashboard guru
  live: 'teacher:live',
  answerFeed: 'teacher:answer',
} as const;

export type { AnswerPayload, PublicQuestion };
