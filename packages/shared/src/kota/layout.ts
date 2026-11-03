/**
 * Dunia Kota (Revisi Tahap 1 bagian 2) — layout deterministik.
 * 1.200 × 1.200 m (± 4 menit berjalan dari ujung ke ujung pada 4,5 m/detik), 10 zona,
 * jalan lingkar + jalan utama + jalan sekunder, sungai, gedung berinterior, jalur rahasia.
 * Server memakai titik soal/zona/lift; klien memakai semua untuk render + tabrakan.
 */
import { Rng } from '../rng.js';
import { WorldBuilder, Transform, type Box, type Disc, type Sign, type Tree, type Lamp, type Facing } from './builder.js';

export const KOTA = {
  half: 600,
  ring: 210,
  mainRoad: 12,
  sideRoad: 9,
  sideX: 360,
  southZ: 390,
  riverZ0: -480,
  riverZ1: -450,
  seed: 20261103,
} as const;

export interface ZoneRect {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export interface Zone {
  id: string;
  nama: string;
  landmark: string;
  subject: string | null;
  color: number;
  rects: ZoneRect[];
  label: { x: number; z: number };
}

export const KOTA_ZONES: Zone[] = [
  { id: 'alunalun', nama: 'Alun-alun', landmark: 'Menara Jam Kota', subject: null, color: 0xffc93c, rects: [{ x: 0, z: 0, hx: 42, hz: 42 }], label: { x: 0, z: 0 } },
  { id: 'sekolah', nama: 'Distrik Sekolah', landmark: 'Gedung Sekolah EDUVERSE', subject: 'Matematika', color: 0x3ba7ff, rects: [{ x: 114, z: -114, hx: 72, hz: 72 }], label: { x: 114, z: -114 } },
  { id: 'pasar', nama: 'Pasar Edukatif', landmark: 'Atap warna-warni dan menara air', subject: 'Matematika', color: 0xff8a3d, rects: [{ x: -114, z: -114, hx: 72, hz: 72 }], label: { x: -114, z: -114 } },
  { id: 'museum', nama: 'Balai Warga dan Museum', landmark: 'Museum berpilar', subject: 'Pendidikan Pancasila', color: 0x8b5cf6, rects: [{ x: 114, z: 114, hx: 72, hz: 72 }], label: { x: 114, z: 114 } },
  { id: 'terminal', nama: 'Terminal dan Halte Pusat', landmark: 'Terminal bus kaca', subject: 'Pendidikan Pancasila', color: 0x1fb6d9, rects: [{ x: -114, z: 114, hx: 72, hz: 72 }], label: { x: -114, z: 114 } },
  { id: 'perpustakaan', nama: 'Perpustakaan Raksasa', landmark: 'Gedung tumpukan buku 3 lantai', subject: 'Bahasa Indonesia', color: 0xe86fa8, rects: [{ x: 180, z: -335, hx: 174, hz: 110 }], label: { x: 180, z: -335 } },
  { id: 'bukit', nama: 'Bukit Pemandangan', landmark: 'Teropong dan papan nama kota', subject: null, color: 0x7fb548, rects: [{ x: -180, z: -335, hx: 174, hz: 110 }], label: { x: -180, z: -335 } },
  { id: 'sungai', nama: 'Kawasan Sungai', landmark: 'Jembatan Pelangi', subject: 'Matematika', color: 0x1fb6d9, rects: [{ x: 0, z: -522, hx: 600, hz: 78 }], label: { x: 0, z: -520 } },
  { id: 'taman', nama: 'Taman Kota dan Lapangan', landmark: 'Air mancur dan stadion mini', subject: null, color: 0x2fbf71, rects: [{ x: 405, z: -105, hx: 189, hz: 330 }], label: { x: 405, z: -105 } },
  {
    id: 'perumahan',
    nama: 'Perumahan Warga',
    landmark: 'Kompleks rumah warna pastel',
    subject: 'Bahasa Indonesia',
    color: 0xf2a65a,
    rects: [
      { x: -405, z: -105, hx: 189, hz: 330 },
      { x: 0, z: 405, hx: 600, hz: 189 },
    ],
    label: { x: -405, z: 0 },
  },
];

export function zoneAt(x: number, z: number): Zone | null {
  if (Math.abs(x) > KOTA.half || Math.abs(z) > KOTA.half) return null;
  for (const zone of KOTA_ZONES) {
    for (const r of zone.rects) {
      if (Math.abs(x - r.x) <= r.hx && Math.abs(z - r.z) <= r.hz) return zone;
    }
  }
  return null;
}

export interface SpawnMarker {
  id: string;
  x: number;
  y: number;
  z: number;
  zone: string;
  object: 'peti' | 'npc' | 'buku' | 'papan' | 'kios' | 'botol' | 'kristal' | 'batu';
  hidden: boolean;
  subject: string | null;
  difficulty: 'mudah' | 'sedang' | 'sulit';
}

export interface Halte {
  id: string;
  nama: string;
  x: number;
  z: number;
  facing: Facing;
}

export interface Lift {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  target: { x: number; y: number; z: number };
  locked: boolean;
}

export interface Interactable {
  id: string;
  kind: 'rak';
  label: string;
  x: number;
  y: number;
  z: number;
  boxIndex: number; // kotak yang dinonaktifkan sementara (rak rahasia)
}

export interface KotaLayout {
  boxes: Box[];
  discs: Disc[];
  signs: Sign[];
  trees: Tree[];
  lamps: Lamp[];
  spawns: SpawnMarker[];
  halte: Halte[];
  lifts: Lift[];
  interactables: Interactable[];
  busLoop: { x: number; z: number }[];
  busStops: { x: number; z: number; halteId: string }[];
  spawnPoint: { x: number; y: number; z: number };
  podium: { x: number; z: number };
  water: { x0: number; x1: number; z0: number; z1: number; surface: number; bottom: number }[];
}

const PASTEL = [0xffd6a5, 0xcdeac0, 0xbde0fe, 0xffc8dd, 0xfdffb6, 0xcaffbf, 0xe2c2ff, 0xffadad];
const ROOFS = [0xe56b5d, 0x5d8be5, 0xf2a65a, 0x6cc08b, 0x9b7be0];
const C = {
  rumput: 0x7ccb6b,
  paving: 0xf2eadb,
  jalan: 0x5d6678,
  garis: 0xffe27a,
  putih: 0xffffff,
  navy: 0x1e2a4a,
  kayu: 0xb07a4a,
  batu: 0xb9b2a6,
};

let cached: KotaLayout | null = null;

/** Bangun (sekali, lalu di-cache) layout Dunia Kota. */
export function buildKota(): KotaLayout {
  if (cached) return cached;
  const b = new WorldBuilder();
  const rng = new Rng(KOTA.seed);
  const spawns: SpawnMarker[] = [];
  const lifts: Lift[] = [];
  const interactables: Interactable[] = [];
  let sid = 0;
  const spawn = (x: number, y: number, z: number, zone: string, object: SpawnMarker['object'], o: Partial<SpawnMarker> = {}) => {
    sid += 1;
    const zoneDef = KOTA_ZONES.find((zz) => zz.id === zone);
    spawns.push({
      id: `K${String(sid).padStart(3, '0')}`,
      x,
      y,
      z,
      zone,
      object,
      hidden: o.hidden ?? false,
      subject: o.subject !== undefined ? o.subject : (zoneDef?.subject ?? null),
      difficulty: o.difficulty ?? 'sedang',
    });
  };
  const H = KOTA.half;

  // ---------------- Tanah (tanpa pita sungai) ----------------
  const ground = (x0: number, x1: number, z0: number, z1: number) => {
    const step = 200;
    for (let x = x0; x < x1; x += step) {
      for (let z = z0; z < z1; z += step) {
        const xe = Math.min(x + step, x1);
        const ze = Math.min(z + step, z1);
        b.box((x + xe) / 2, -1, (z + ze) / 2, xe - x, 2, ze - z, C.rumput);
      }
    }
  };
  ground(-H, H, -H, KOTA.riverZ0);
  ground(-H, H, KOTA.riverZ1, H);
  b.box(0, 0.02, 0, 2 * KOTA.ring - 12, 0.04, 2 * KOTA.ring - 12, C.paving, 'decor');
  // Batas dunia
  for (const s of [-1, 1]) {
    b.box(0, 1, s * H, 2 * H, 2, 0.6, C.putih);
    b.box(s * H, 1, 0, 0.6, 2, 2 * H, C.putih);
  }

  // ---------------- Jalan ----------------
  type HR = { z: number; x0: number; x1: number; w: number };
  type VR = { x: number; z0: number; z1: number; w: number; gaps?: [number, number][] };
  const R = KOTA.ring;
  const river: [number, number] = [KOTA.riverZ0 - 3, KOTA.riverZ1 + 3];
  const hRoads: HR[] = [
    { z: -R, x0: -R - 6, x1: R + 6, w: KOTA.mainRoad },
    { z: R, x0: -R - 6, x1: R + 6, w: KOTA.mainRoad },
    { z: 0, x0: -H + 6, x1: -45, w: KOTA.mainRoad },
    { z: 0, x0: 45, x1: H - 6, w: KOTA.mainRoad },
    { z: KOTA.southZ, x0: -H + 6, x1: H - 6, w: KOTA.sideRoad },
  ];
  const vRoads: VR[] = [
    { x: -R, z0: -R - 6, z1: R + 6, w: KOTA.mainRoad },
    { x: R, z0: -R - 6, z1: R + 6, w: KOTA.mainRoad },
    { x: 0, z0: -H + 6, z1: -45, w: KOTA.mainRoad, gaps: [river] },
    { x: 0, z0: 45, z1: H - 6, w: KOTA.mainRoad },
    { x: -KOTA.sideX, z0: -H + 6, z1: H - 6, w: KOTA.sideRoad, gaps: [river] },
    { x: KOTA.sideX, z0: -H + 6, z1: H - 6, w: KOTA.sideRoad, gaps: [river] },
  ];
  const road = (cx: number, cz: number, sx: number, sz: number, alongX: boolean) => {
    if (sx < 0.5 || sz < 0.5) return;
    b.box(cx, 0.03, cz, sx, 0.06, sz, C.jalan, 'decor');
    b.box(cx, 0.065, cz, alongX ? sx : 0.2, 0.01, alongX ? 0.2 : sz, C.garis, 'decor');
    b.occupy(cx, cz, sx / 2, sz / 2, 0.8);
  };
  for (const r of hRoads) road((r.x0 + r.x1) / 2, r.z, r.x1 - r.x0, r.w, true);
  for (const v of vRoads) {
    const cuts: [number, number][] = [];
    for (const h of hRoads) {
      if (v.x >= h.x0 && v.x <= h.x1 && h.z >= v.z0 && h.z <= v.z1) cuts.push([h.z - h.w / 2, h.z + h.w / 2]);
    }
    for (const g of v.gaps ?? []) cuts.push(g);
    cuts.sort((a, c) => a[0] - c[0]);
    let z = v.z0;
    for (const c of cuts) {
      if (c[0] > z) road(v.x, (z + c[0]) / 2, v.w, c[0] - z, false);
      z = Math.max(z, c[1]);
    }
    if (v.z1 > z) road(v.x, (z + v.z1) / 2, v.w, v.z1 - z, false);
  }
  // Lampu jalan
  const nearAny = (v: number, list: number[]) => list.some((c) => Math.abs(v - c) < 10);
  for (let d = -570; d <= 570; d += 33) {
    if (Math.abs(d) > 52 && !nearAny(d, [-R, R, KOTA.southZ]) && !(d > KOTA.riverZ0 - 10 && d < KOTA.riverZ1 + 10)) {
      b.lamps.push({ x: 8, z: d });
      b.occupy(8, d, 0.4, 0.4, 0.4);
    }
    if (Math.abs(d) > 52 && !nearAny(d, [-R, R, -KOTA.sideX, KOTA.sideX])) {
      b.lamps.push({ x: d, z: 8 });
      b.occupy(d, 8, 0.4, 0.4, 0.4);
    }
  }

  // ---------------- Alun-alun + Menara Jam ----------------
  b.box(0, 0.04, 0, 90, 0.08, 90, 0xefe4cf, 'decor');
  b.box(0, 0.085, 0, 60, 0.01, 60, 0xffe7a8, 'decor');
  {
    // Menara 10 × 10 m, tinggi 54 m, pintu di selatan (+Z), tangga spiral persegi di dalam.
    const TH = 54;
    const O = 10;
    const wt = 0.4;
    const wall = 0xf4e1c1;
    const trim = 0xff8a3d;
    b.box(0, TH / 2, -O / 2 + wt / 2, O, TH, wt, wall);
    b.box(-O / 2 + wt / 2, TH / 2, 0, wt, TH, O, wall);
    b.box(O / 2 - wt / 2, TH / 2, 0, wt, TH, O, wall);
    const dw = 2.4;
    const dh = 2.8;
    const sw = (O - dw) / 2;
    b.box(-O / 2 + sw / 2, TH / 2, O / 2 - wt / 2, sw, TH, wt, wall);
    b.box(O / 2 - sw / 2, TH / 2, O / 2 - wt / 2, sw, TH, wt, wall);
    b.box(0, dh + (TH - dh) / 2, O / 2 - wt / 2, dw, TH - dh, wt, wall);
    for (const y of [12, 27, 42]) b.box(0, y, 0, O + 0.3, 0.9, O + 0.3, trim, 'decor');
    // Tangga spiral persegi: lintasan keliling selebar 1,6 m (pusat menara terbuka)
    const inner = O - 2 * wt; // 9,2
    const lane = 1.6;
    const half = inner / 2 - lane / 2; // jarak garis tengah lintasan dari pusat
    const sideLen = 2 * half;
    const perim = 4 * sideLen;
    const stepRun = 0.4;
    const stepRise = 0.2;
    const steps = Math.round(TH / stepRise);
    // Mulai di sisi selatan dekat pintu, bergerak ke barat (searah jarum jam dari atas)
    const pathPoint = (s: number) => {
      const u = ((s % perim) + perim) % perim;
      const sideIdx = Math.floor(u / sideLen);
      const t = u - sideIdx * sideLen;
      switch (sideIdx) {
        case 0:
          return { x: half - t, z: half, ax: 'x' as const }; // selatan, ke barat
        case 1:
          return { x: -half, z: half - t, ax: 'z' as const }; // barat, ke utara
        case 2:
          return { x: -half + t, z: -half, ax: 'x' as const }; // utara, ke timur
        default:
          return { x: half, z: -half + t, ax: 'z' as const }; // timur, ke selatan
      }
    };
    const startS = 2.4; // mulai sedikit ke barat dari pintu
    let lastSide = 0;
    for (let i = 1; i <= steps; i++) {
      const s = startS + (i - 0.5) * stepRun;
      const p = pathPoint(s);
      const top = i * stepRise;
      const sx = p.ax === 'x' ? stepRun + 0.02 : lane;
      const sz = p.ax === 'x' ? lane : stepRun + 0.02;
      b.box(p.x, top - 0.15, p.z, sx, 0.3, sz, i % 2 === 0 ? 0xffc93c : 0xffb000);
      if (i === steps) lastSide = Math.floor((((s % perim) + perim) % perim) / sideLen);
    }
    // Dek puncak: seluruh lantai kecuali lajur sisi tempat anak tangga terakhir tiba
    const hi = inner / 2;
    const holes: Record<number, { x0: number; x1: number; z0: number; z1: number }> = {
      0: { x0: -hi, x1: hi, z0: hi - lane, z1: hi },
      1: { x0: -hi, x1: -hi + lane, z0: -hi, z1: hi },
      2: { x0: -hi, x1: hi, z0: -hi, z1: -hi + lane },
      3: { x0: hi - lane, x1: hi, z0: -hi, z1: hi },
    };
    const deck = new Transform(b, 0, 0, 'N');
    b.slabWithHole(deck, TH, inner, inner, 0.3, holes[lastSide] ?? null, 0xe8d5b5);
    // Pagar keliling dek, tiang & atap, kubah
    for (const s of [-1, 1]) {
      b.box(0, TH + 0.6, s * (O / 2 - 0.15), O, 1.2, 0.3, wall);
      b.box(s * (O / 2 - 0.15), TH + 0.6, 0, 0.3, 1.2, O, wall);
      for (const t of [-1, 1]) b.box(s * (O / 2 - 0.4), TH + 3, t * (O / 2 - 0.4), 0.7, 6, 0.7, trim);
    }
    b.box(0, TH + 6.3, 0, O + 1.2, 0.6, O + 1.2, trim);
    b.box(0, TH + 8, 0, 4.2, 3, 4.2, 0xffc93c);
    b.box(0, TH + 11.5, 0, 0.35, 4, 0.35, C.navy, 'decor');
    // Teropong
    b.box(3, TH + 0.6, 3, 0.3, 1.2, 0.3, C.navy, 'decor');
    b.box(3, TH + 1.3, 3, 0.45, 0.45, 1.6, 0x3ba7ff, 'decor');
    // Muka jam di empat sisi
    for (const [dx, dz, ax] of [
      [0, O / 2 + 0.2, 'z'],
      [0, -O / 2 - 0.2, 'z'],
      [O / 2 + 0.2, 0, 'x'],
      [-O / 2 - 0.2, 0, 'x'],
    ] as [number, number, 'x' | 'z'][]) {
      b.disc(dx, 45, dz, 3.2, 0.3, ax, 0xffffff);
      b.box(dx + (ax === 'x' ? Math.sign(dx) * 0.2 : 0), 46, dz + (ax === 'z' ? Math.sign(dz) * 0.2 : 0), ax === 'z' ? 0.25 : 0.1, 2, ax === 'z' ? 0.1 : 0.25, C.navy, 'decor');
      b.box(dx + (ax === 'x' ? Math.sign(dx) * 0.22 : 0), 45, dz + (ax === 'z' ? Math.sign(dz) * 0.22 : 0), ax === 'z' ? 1.8 : 0.1, 0.22, ax === 'z' ? 0.1 : 1.8, C.navy, 'decor');
    }
    b.occupy(0, 0, 5.5, 5.5, 1);
    spawn(3, TH, -3, 'alunalun', 'peti', { hidden: true, difficulty: 'sulit' });
  }
  const alun = new Transform(b, 0, 0, 'N');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.bench(alun, Math.cos(a) * 18, Math.sin(a) * 18);
  }
  b.sign(12, 3.4, 12, 3.4, 1.2, 'Perpustakaan: utara-timur', 'S', 0x3ba7ff, 0xffffff);
  b.sign(12, 2, 12, 3.4, 1.2, 'Taman: timur', 'S', 0x2fbf71, 0xffffff);
  b.base(12, 0, 12.3, 0.2, 4, 0.2, C.navy);
  for (const [x, z] of [
    [21, -15],
    [-21, -15],
    [-27, 27],
    [30, 30],
    [36, -3],
    [-36, 6],
    [0, 37],
    [15, -36],
  ] as [number, number][]) {
    spawn(x, 0.16, z, 'alunalun', rng.pick(['papan', 'peti'] as const));
  }
  b.sign(0, 4.5, -38, 10, 1.6, 'Panggung Juara', 'S', 0xffc93c, 0x1e2a4a);

  // ---------------- Halte (6) ----------------
  const halte: Halte[] = [
    { id: 'H1', nama: 'Halte Utara', x: 27, z: -R - 10, facing: 'S' },
    { id: 'H2', nama: 'Halte Timur Laut', x: R + 10, z: -R + 27, facing: 'W' },
    { id: 'H3', nama: 'Halte Timur', x: R + 10, z: 27, facing: 'W' },
    { id: 'H4', nama: 'Halte Selatan', x: -27, z: R + 10, facing: 'N' },
    { id: 'H5', nama: 'Halte Barat Daya', x: -R - 10, z: R - 27, facing: 'E' },
    { id: 'H6', nama: 'Halte Barat', x: -R - 10, z: -27, facing: 'E' },
  ];
  for (const h of halte) {
    const t = new Transform(b, h.x, h.z, h.facing);
    t.box(0, 0.1, 0, 5.4, 0.2, 2.4, 0xd9dde6);
    t.box(-2.4, 1.6, 0.9, 0.2, 3, 0.2, C.navy);
    t.box(2.4, 1.6, 0.9, 0.2, 3, 0.2, C.navy);
    t.box(0, 3.15, 0.15, 5.7, 0.25, 2.7, 0x3ba7ff);
    t.box(0, 1.6, 1.12, 5.4, 2.1, 0.08, 0xcfefff, 'glass');
    b.bench(t, 0, 0.5);
    const p = t.world(3.1, 2.2, 0);
    b.sign(p.x, 2.2, p.z, 1.8, 1.1, h.nama, h.facing, 0x3ba7ff, 0xffffff);
    b.occupy(h.x, h.z, 3.5, 3.5, 0.5);
  }
  const lane = R + 3;
  const busLoop = [
    { x: -lane, z: -lane },
    { x: lane, z: -lane },
    { x: lane, z: lane },
    { x: -lane, z: lane },
  ];
  const busStops = halte.map((h) => {
    const clampToRing = (v: number) => Math.max(-lane, Math.min(lane, v));
    const onX = Math.abs(Math.abs(h.z) - (R + 10)) < 1;
    return onX ? { x: clampToRing(h.x), z: Math.sign(h.z) * lane, halteId: h.id } : { x: Math.sign(h.x) * lane, z: clampToRing(h.z), halteId: h.id };
  });

  // ---------------- Distrik Sekolah ----------------
  {
    const s = b.building({ x: 120, z: -142, w: 29, d: 16, h: 9, facing: 'S', floors: 2, wall: 0xf4f8ff, roof: 0xe56b5d, trim: 0x3ba7ff, doorW: 4 });
    for (let row = 0; row < 3; row++) {
      for (const col of [-3, -2, -1, 1, 2, 3]) {
        s.t.box(col * 2.4, 0.78, 0.6 + row * 2.1, 1.2, 0.1, 0.8, 0xd9a066);
        s.t.box(col * 2.4, 0.4, 0.6 + row * 2.1, 0.1, 0.7, 0.1, C.navy, 'decor');
        s.t.box(col * 2.4, 0.45, 1.35 + row * 2.1, 0.7, 0.1, 0.6, 0x3ba7ff);
      }
    }
    s.t.box(-6, 1.9, 7.4, 9, 2.4, 0.1, 0x2e5e4e, 'decor');
    s.t.box(6, 1.9, 7.4, 9, 2.4, 0.1, 0x2e5e4e, 'decor');
    const y2 = s.floorY[1] ?? 4.5;
    s.t.box(0, y2 + 0.45, 5.7, 12, 0.9, 3, 0xb07a4a);
    s.t.box(0, y2 + 2.4, 7.4, 12, 3, 0.15, 0xc0392b, 'decor');
    for (const i of [-1, 0, 1]) s.t.box(i * 4.2, y2 + 0.45, 0.6, 3, 0.9, 1.2, 0xffffff);
    b.box(120, 0.07, -120, 24, 0.14, 15, 0xd9dde6, 'decor');
    b.base(120, 0, -115.5, 0.25, 8, 0.25, 0xffffff);
    b.box(121.3, 7.4, -115.5, 2.4, 0.75, 0.06, 0xe53935, 'decor');
    b.box(121.3, 6.65, -115.5, 2.4, 0.75, 0.06, 0xffffff, 'decor');
    b.occupy(120, -120, 12, 7.5, 0.5);
    const at = (lx: number, ly: number, lz: number) => s.t.world(lx, ly, lz);
    const p1 = at(-9, 0.12, -1);
    spawn(p1.x, p1.y, p1.z, 'sekolah', 'buku', { subject: 'Matematika' });
    const p2 = at(9, 0.12, -1);
    spawn(p2.x, p2.y, p2.z, 'sekolah', 'buku', { subject: 'Bahasa Indonesia' });
    const p3 = at(-9, y2, 0);
    spawn(p3.x, p3.y, p3.z, 'sekolah', 'papan', { subject: 'Matematika' });
    const p4 = at(9, y2, 0);
    spawn(p4.x, p4.y, p4.z, 'sekolah', 'peti', { subject: 'Bahasa Indonesia' });
    const p5 = at(4.8, y2 + 0.9, 6.6);
    spawn(p5.x, p5.y, p5.z, 'sekolah', 'peti', { hidden: true, difficulty: 'sulit' });
    spawn(111, 0.14, -118, 'sekolah', 'papan');
    spawn(120, 0, -156, 'sekolah', 'peti', { hidden: true });
  }

  // ---------------- Pasar Edukatif ----------------
  {
    const canopies = [0xff5d5d, 0xffc93c, 0x3ba7ff, 0x2fbf71, 0x8b5cf6];
    b.box(-120, 0.07, -129, 39, 0.14, 30, 0xe9d8b4, 'decor');
    let i = 0;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        i++;
        const x = -135 + col * 9.6;
        const z = -141 + row * 9;
        const t = new Transform(b, x, z, row % 2 === 0 ? 'N' : 'S');
        t.box(0, 0.45, 0, 3, 0.9, 1.35, 0xd9a066);
        for (const sx of [-1.65, 1.65]) for (const sz of [-0.95, 0.95]) t.box(sx, 1.35, sz, 0.18, 2.7, 0.18, C.navy, 'decor');
        t.box(0, 2.8, 0, 3.75, 0.24, 2.55, canopies[i % canopies.length] as number);
        for (let k = -2; k <= 2; k++) t.box(k * 0.54, 1.08, 0, 0.36, 0.36, 0.36, rng.pick([0xff9f40, 0x6bcb77, 0xff5d5d, 0xffd93d]), 'decor');
        if ((row + col) % 2 === 0) {
          const p = t.world(0, 0, -1.8);
          spawn(p.x, 0.14, p.z, 'pasar', 'kios', { subject: 'Matematika' });
        }
      }
    }
    b.occupy(-120, -129, 19.5, 15, 0.5);
    // Menara air dengan tangga luar ke puncak
    const tx = -75;
    const tz = -168;
    for (const [dx, dz] of [
      [-1.8, -1.8],
      [1.8, -1.8],
      [-1.8, 1.8],
      [1.8, 1.8],
    ] as [number, number][]) b.base(tx + dx, 0, tz + dz, 0.45, 12, 0.45, C.navy);
    b.box(tx, 12, tz, 6.6, 0.3, 6.6, 0xffffff);
    b.disc(tx, 14.2, tz, 3, 4.2, 'y', 0x3ba7ff, 'solid');
    // Tangga luar lurus dari tanah (z − 14) ke tepi timur platform 12 m
    b.stairs(new Transform(b, tx + 3.9, tz, 'N'), 0, 0, -14, 1.2, 12, 14.4, 0xffc93c);
    b.occupy(tx + 1, tz - 5, 5, 10, 0.5);
    spawn(tx - 1.5, 12.15, tz - 1.5, 'pasar', 'peti', { hidden: true, difficulty: 'sulit' });
    spawn(tx - 4.5, 0, tz, 'pasar', 'papan', { subject: 'Matematika' });
    // Pasar dalam
    const hall = b.building({ x: -150, z: -75, w: 19, d: 12, h: 4.8, facing: 'E', wall: 0xffe0b2, roof: 0xff8a3d, trim: 0xff8a3d, doorW: 4 });
    for (const k of [-1, 0, 1]) {
      hall.t.box(k * 5.4, 0.45, 2.4, 3, 0.9, 1.35, 0xd9a066);
      hall.t.box(k * 5.4, 2.5, 2.4, 3.6, 0.2, 2.4, canopies[k + 1] as number, 'decor');
    }
    const h1 = hall.t.world(-5.4, 0.12, -1.2);
    spawn(h1.x, h1.y, h1.z, 'pasar', 'kios', { subject: 'Matematika' });
    const h2 = hall.t.world(5.4, 0.12, -1.2);
    spawn(h2.x, h2.y, h2.z, 'pasar', 'npc', { subject: 'Matematika' });
  }

  // ---------------- Terowongan rahasia (Y = −8) ----------------
  const TY = -8;
  const TW = 4.8;
  const TH2 = 3.6;
  const tunM = { x: 114, z: 114 };
  const tunJ1 = { x: -114, z: 114 };
  const tunJ2 = { x: -114, z: -330 };
  const tunB = { x: -195, z: -330 };
  const corridor = (ax: number, az: number, bx: number, bz: number) => {
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const len = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const sx = alongX ? len : TW;
    const sz = alongX ? TW : len;
    b.box(cx, TY - 0.15, cz, sx, 0.3, sz, 0x6e6385);
    b.box(cx, TY + TH2 + 0.15, cz, sx, 0.3, sz, 0x8c7a9e);
    if (alongX) {
      b.box(cx, TY + TH2 / 2, cz - TW / 2 - 0.15, len, TH2, 0.3, 0x8c7a9e);
      b.box(cx, TY + TH2 / 2, cz + TW / 2 + 0.15, len, TH2, 0.3, 0x8c7a9e);
    } else {
      b.box(cx - TW / 2 - 0.15, TY + TH2 / 2, cz, 0.3, TH2, len, 0x8c7a9e);
      b.box(cx + TW / 2 + 0.15, TY + TH2 / 2, cz, 0.3, TH2, len, 0x8c7a9e);
    }
    b.box(cx, TY + TH2 - 0.05, cz, alongX ? len : 0.3, 0.1, alongX ? 0.3 : len, 0xc9a7ff, 'neon');
  };
  const room = (c: { x: number; z: number }, walls: [number, number][]) => {
    b.box(c.x, TY - 0.15, c.z, TW, 0.3, TW, 0x6e6385);
    b.box(c.x, TY + TH2 + 0.15, c.z, TW, 0.3, TW, 0x8c7a9e);
    for (const [dx, dz] of walls) {
      const px = c.x + dx * (TW / 2 + 0.15);
      const pz = c.z + dz * (TW / 2 + 0.15);
      b.box(px, TY + TH2 / 2, pz, dx !== 0 ? 0.3 : TW + 0.6, TH2, dx !== 0 ? TW + 0.6 : 0.3, 0x8c7a9e);
    }
  };
  corridor(tunM.x - TW / 2, tunM.z, tunJ1.x + TW / 2, tunJ1.z);
  corridor(tunJ1.x, tunJ1.z - TW / 2, tunJ2.x, tunJ2.z + TW / 2);
  corridor(tunJ2.x - TW / 2, tunJ2.z, tunB.x + TW / 2, tunB.z);
  room(tunM, [
    [1, 0],
    [0, 1],
    [0, -1],
  ]);
  room(tunJ1, [
    [-1, 0],
    [0, 1],
  ]);
  room(tunJ2, [
    [1, 0],
    [0, -1],
  ]);
  room(tunB, [
    [-1, 0],
    [0, 1],
    [0, -1],
  ]);
  for (const [x, z] of [
    [30, 114],
    [-60, 114],
    [-114, -60],
    [-114, -240],
    [-156, -330],
  ] as [number, number][]) {
    spawn(x, TY, z, z > 0 ? 'terminal' : 'bukit', 'kristal', { hidden: true, subject: 'Pendidikan Pancasila', difficulty: 'sulit' });
  }

  // ---------------- Museum & Balai Warga ----------------
  {
    const m = b.building({ x: 129, z: 141, w: 23, d: 16, h: 7.2, facing: 'N', wall: 0xf2ebdd, roof: 0xb9b2a6, trim: 0x8b5cf6, doorW: 4 });
    for (const i of [-3, -2, -1, 1, 2, 3]) m.t.box(i * 3, 3.3, -9.3, 1, 6.6, 1, 0xffffff);
    m.t.box(0, 6.9, -9.3, 23, 0.6, 3, 0xffffff);
    m.t.box(0, 7.5, -9.3, 16, 0.6, 2.6, 0xffffff);
    m.t.box(0, 8.1, -9.3, 9, 0.6, 2.2, 0xffffff);
    m.t.box(0, 0.15, -9.3, 18, 0.3, 3, 0xffffff);
    const colors = [0xffc93c, 0xff8a3d, 0x2fbf71, 0x3ba7ff];
    for (let i = 0; i < 4; i++) {
      m.t.box(-7.2 + i * 4.8, 0.45, 4.2, 1.5, 0.9, 1.5, 0xffffff);
      m.t.box(-7.2 + i * 4.8, 1.5, 4.2, 1.4, 1.2, 1.4, 0xcfefff, 'glass');
      m.t.box(-7.2 + i * 4.8, 1.2, 4.2, 0.5, 0.6, 0.5, colors[i] as number, 'decor');
    }
    const sp = m.t.world(0, 3.6, 7.85);
    b.sign(sp.x, 3.6, sp.z, 9, 1.8, 'Museum Kota — Sejarah Gotong Royong', 'S', 0x8b5cf6, 0xffffff);
    const lp = m.t.world(8.4, 0.12, 6);
    lifts.push({ id: 'L_MUSEUM', label: 'Turun ke terowongan', x: lp.x, y: lp.y, z: lp.z, target: { x: tunM.x, y: TY + 0.5, z: tunM.z }, locked: true });
    lifts.push({ id: 'L_TUN_MUSEUM', label: 'Naik ke Museum', x: tunM.x, y: TY, z: tunM.z, target: { x: lp.x - 1.5, y: 0.6, z: lp.z }, locked: false });
    const balai = b.building({ x: 168, z: 75, w: 15.6, d: 10.8, h: 4.2, facing: 'W', wall: 0xe2c2ff, roof: 0x8b5cf6, doorW: 3.6 });
    balai.t.box(0, 0.55, 1.8, 7.2, 0.85, 2.4, 0xd9a066);
    const pts = [m.t.world(-6, 0.12, 0), m.t.world(6, 0.12, 0), m.t.world(0, 0.12, 6), balai.t.world(-3.6, 0.12, -1.2), balai.t.world(4.2, 0.12, 3.6)];
    pts.forEach((p, i) => spawn(p.x, p.y, p.z, 'museum', i % 2 === 0 ? 'npc' : 'papan', { subject: 'Pendidikan Pancasila' }));
  }

  // ---------------- Terminal ----------------
  {
    const term = b.building({ x: -129, z: 135, w: 25, d: 12, h: 4.8, facing: 'N', wall: 0xbfe6ff, glass: true, roof: 0x1fb6d9, trim: 0x1fb6d9, doorW: 4.8, windows: false });
    for (let i = -2; i <= 2; i++) b.bench(term.t, i * 3.6, 1.8);
    term.t.box(-7.8, 0.6, 4.2, 6, 1.2, 0.9, 0x1fb6d9);
    const sp = term.t.world(0, 3.4, 5.6);
    b.sign(sp.x, 3.4, sp.z, 9, 1.2, 'TERMINAL KOTA', 'S', 0x1fb6d9, 0xffffff);
    const lp = term.t.world(9.6, 0.12, 3.6);
    lifts.push({ id: 'L_TERMINAL', label: 'Turun ke terowongan', x: lp.x, y: lp.y, z: lp.z, target: { x: tunJ1.x, y: TY + 0.5, z: tunJ1.z }, locked: true });
    lifts.push({ id: 'L_TUN_TERMINAL', label: 'Naik ke Terminal', x: tunJ1.x, y: TY, z: tunJ1.z, target: { x: lp.x - 1.5, y: 0.6, z: lp.z }, locked: false });
    b.box(-129, 0.07, 120, 30, 0.14, 7.8, 0x8c95a8, 'decor');
    b.occupy(-129, 120, 15, 4, 0.5);
    // Zebra cross + lampu lalu lintas
    for (let k = -4; k <= 4; k++) b.box(-90 + k * 1.8, 0.13, 0, 0.9, 0.02, 11.4, 0xffffff, 'decor');
    b.base(-99, 0, 7.2, 0.3, 4.2, 0.3, C.navy);
    b.box(-99, 4.8, 7.2, 0.9, 2.4, 0.9, C.navy);
    b.box(-99, 5.5, 6.7, 0.5, 0.5, 0.2, 0xff4d4d, 'neon');
    b.box(-99, 4.8, 6.7, 0.5, 0.5, 0.2, 0xffd93d, 'decor');
    b.box(-99, 4.1, 6.7, 0.5, 0.5, 0.2, 0x6bcb77, 'decor');
    const pts = [
      { x: -93, z: 9 },
      { x: -87, z: -9 },
    ];
    pts.forEach((p) => spawn(p.x, 0.13, p.z, 'terminal', 'papan', { subject: 'Pendidikan Pancasila' }));
    const t1 = term.t.world(-6, 0.12, 0);
    spawn(t1.x, t1.y, t1.z, 'terminal', 'papan', { subject: 'Pendidikan Pancasila' });
    const t2 = term.t.world(4.8, 0.12, -0.6);
    spawn(t2.x, t2.y, t2.z, 'terminal', 'npc');
    spawn(-141, 0.14, 118.5, 'terminal', 'papan');
  }

  // ---------------- Perpustakaan Raksasa ----------------
  {
    const lib = b.building({ x: 180, z: -336, w: 25, d: 19, h: 12.6, facing: 'S', floors: 3, wall: 0xfff3e0, roof: 0xcdeac0, trim: 0xe86fa8, roofAccess: true, doorW: 4.8 });
    const bookC = [0xe86fa8, 0x3ba7ff, 0xffc93c, 0x2fbf71, 0x8b5cf6, 0xff8a3d];
    for (let k = 0; k < 6; k++) {
      const off = k % 2 === 0 ? 0.45 : -0.45;
      lib.t.box(-13.1, 1.05 + k * 2.1, off, 1.2, 1.98, 19.8 + off, bookC[k] as number);
      lib.t.box(13.1, 1.05 + k * 2.1, -off, 1.2, 1.98, 19.8 - off, bookC[5 - k] as number);
    }
    const shelf = (lx: number, ly: number, lz: number, len: number) => {
      lib.t.box(lx, ly + 1.35, lz, len, 2.7, 0.66, 0xa0673f);
      for (let row = 0; row < 3; row++) {
        let x = -len / 2 + 0.25;
        while (x < len / 2 - 0.3) {
          const w = rng.float(0.15, 0.33);
          lib.t.box(lx + x + w / 2, ly + 0.48 + row * 0.84, lz, w, rng.float(0.54, 0.72), 0.72, rng.pick([0xe56b5d, 0x3ba7ff, 0xffc93c, 0x2fbf71, 0x8b5cf6]), 'decor');
          x += w + 0.05;
        }
      }
    };
    lib.floorY.forEach((y, f) => {
      for (let row = 0; row < 3; row++) shelf(-1.8, y, -2.4 + row * 3, 9);
      const a = lib.t.world(5.4, y, -4.8);
      spawn(a.x, a.y, a.z, 'perpustakaan', 'buku', { subject: 'Bahasa Indonesia' });
      const c = lib.t.world(-7.8, y, 6.6);
      spawn(c.x, c.y, c.z, 'perpustakaan', 'buku', { subject: 'Bahasa Indonesia' });
      if (f === 1) {
        const n = lib.t.world(3.6, y, 6.6);
        spawn(n.x, n.y, n.z, 'perpustakaan', 'npc', { subject: 'Bahasa Indonesia' });
      }
    });
    // Bilik rahasia di balik rak (lantai 3, sudut belakang kiri)
    const y3 = lib.floorY[2] ?? 8.4;
    lib.t.box(-4.8, y3 + 1.95, 7.2, 0.24, 3.9, 3.6, 0xfff3e0);
    const shelfBox = lib.t.box(-8.5, y3 + 1.8, 5.1, 7.4, 3.6, 0.6, 0x8b5a3c);
    const shelfPos = lib.t.world(-8.5, y3, 4.4);
    interactables.push({ id: 'RAK_RAHASIA', kind: 'rak', label: 'Geser rak', x: shelfPos.x, y: y3, z: shelfPos.z, boxIndex: b.boxes.indexOf(shelfBox) });
    const sb = lib.t.world(-8.5, y3, 7.2);
    spawn(sb.x, sb.y, sb.z, 'perpustakaan', 'peti', { hidden: true, difficulty: 'sulit' });
    // Taman atap
    const roofY = lib.roofY;
    lib.t.box(4.8, roofY + 0.06, 3.6, 9, 0.12, 7.2, C.rumput);
    const tr1 = lib.t.world(7.2, roofY, 5.4);
    b.tree(tr1.x, tr1.z, 0.6, roofY + 0.12);
    const tr2 = lib.t.world(2.4, roofY, 5.4);
    b.tree(tr2.x, tr2.z, 0.6, roofY + 0.12);
    const rg = lib.t.world(4.8, roofY + 0.12, 2.4);
    spawn(rg.x, rg.y, rg.z, 'perpustakaan', 'peti', { hidden: true });
  }

  // ---------------- Bukit Pemandangan ----------------
  {
    const cx = -195;
    const cz = -330;
    const tiers: [number, number][] = [
      [72, 4],
      [54, 4],
      [36, 4],
      [21, 4],
    ];
    const greens = [0x86d47a, 0x7ccb6b, 0x6fbf5e, 0x63b353];
    let y = 0;
    tiers.forEach(([half, h], i) => {
      b.box(cx, y + h / 2, cz, half * 2, h, half * 2, greens[i] as number);
      // Tangga dari teras bawah ke teras ini di sisi selatan
      const st = new Transform(b, cx, cz + half + 0.01, 'S');
      b.stairs(st, 0, y, -6.2, 4, h, 6, 0xe9d8b4);
      y += h;
    });
    b.occupy(cx, cz, 75, 75, 1);
    const top = y;
    const obs = b.building({ x: cx, z: cz, y: top, w: 8, d: 8, h: 4.2, facing: 'S', wall: 0xf4f8ff, roof: 0x3ba7ff, doorW: 2.4 });
    b.disc(cx, top + 4.8, cz, 3.6, 1.6, 'y', 0x3ba7ff);
    const lp = obs.t.world(-1.8, 0.12, 1.2);
    lifts.push({ id: 'L_BUKIT', label: 'Turun ke terowongan', x: lp.x, y: lp.y, z: lp.z, target: { x: tunB.x, y: TY + 0.5, z: tunB.z }, locked: true });
    lifts.push({ id: 'L_TUN_BUKIT', label: 'Naik ke Bukit', x: tunB.x, y: TY, z: tunB.z, target: { x: lp.x + 1.5, y: top + 0.6, z: lp.z }, locked: false });
    b.base(cx + 9, top, cz + 9, 0.6, 2.4, 0.6, C.navy);
    b.box(cx + 9, top + 3, cz + 9.6, 1, 1, 4.8, 0x8b5cf6, 'decor');
    b.sign(cx + 24, 9, cz + 66, 21, 4.2, 'EDUVERSE', 'S', 0xffc93c, 0x1e2a4a);
    b.base(cx + 15, 4, cz + 66.3, 0.6, 7.2, 0.6, C.navy);
    b.base(cx + 33, 4, cz + 66.3, 0.6, 7.2, 0.6, C.navy);
    spawn(cx - 45, 4, cz + 36, 'bukit', 'batu', { difficulty: 'sulit' });
    spawn(cx + 39, 8, cz - 24, 'bukit', 'papan', { difficulty: 'sulit' });
    spawn(cx - 18, 12, cz - 21, 'bukit', 'batu', { difficulty: 'sulit' });
    spawn(cx + 9, top, cz - 9, 'bukit', 'peti', { difficulty: 'sulit' });
    const o2 = obs.t.world(1.8, 0.12, 1.2);
    spawn(o2.x, o2.y, o2.z, 'bukit', 'npc', { difficulty: 'sulit' });
    spawn(cx + 24, 4, cz + 64, 'bukit', 'peti', { hidden: true, difficulty: 'sulit' });
    spawn(cx + 60, 0, cz - 66, 'bukit', 'batu');
  }

  // ---------------- Sungai ----------------
  const water = [{ x0: -H, x1: H, z0: KOTA.riverZ0, z1: KOTA.riverZ1, surface: -0.4, bottom: -4.5 }];
  {
    const zMid = (KOTA.riverZ0 + KOTA.riverZ1) / 2;
    const width = KOTA.riverZ1 - KOTA.riverZ0;
    b.box(0, -4.8, zMid, 2 * H, 0.6, width, 0xc8b48a);
    for (const z of [KOTA.riverZ0, KOTA.riverZ1]) b.box(0, -2.25, z + (z === KOTA.riverZ0 ? -0.3 : 0.3), 2 * H, 4.5, 0.6, C.batu);
    b.box(0, -2.4, zMid, 2 * H, 4, width, 0x3fb4e8, 'water');
    // Tangga naik dari sungai (agar tidak terjebak) setiap 60 m di kedua tepi
    for (let x = -540; x <= 540; x += 60) {
      for (const side of [-1, 1]) {
        const z = side < 0 ? KOTA.riverZ0 + 0.6 : KOTA.riverZ1 - 0.6;
        // 9 anak tangga sepanjang +X menempel tanggul, puncak = 0 (tinggi tepi)
        for (let i = 0; i < 9; i++) {
          const top = -4.5 + (i + 1) * 0.5;
          b.box(x + i * 0.5, (top - 4.5) / 2, z, 0.5, top + 4.5, 1.2, C.batu);
        }
      }
    }
    // Jembatan Pelangi
    const z0 = KOTA.riverZ0 - 3;
    const z1 = KOTA.riverZ1 + 3;
    const span = z1 - z0;
    b.box(0, -0.25, (z0 + z1) / 2, 12, 0.5, span, C.putih);
    const rainbow = [0xff5d5d, 0xff9f40, 0xffd93d, 0x6bcb77, 0x4d96ff, 0x6a5acd, 0xb76ef0];
    const segs = 22;
    for (const sx of [-6.3, 6.3]) {
      for (let i = 0; i < segs; i++) {
        const a = ((i + 0.5) / segs) * Math.PI;
        const zz = z0 + ((1 - Math.cos(a)) / 2) * span;
        const yy = Math.sin(a) * 7.8;
        b.box(sx, yy, zz, 0.6, 0.6, span / segs + 0.4, rainbow[Math.floor((i / segs) * rainbow.length)] as number, 'neon');
      }
      b.box(sx * 0.95, 0.5, (z0 + z1) / 2, 0.3, 1, span, C.putih);
    }
    for (const bx of [-KOTA.sideX, KOTA.sideX]) {
      b.box(bx, -0.25, (z0 + z1) / 2, 9, 0.5, span, C.kayu);
      for (const sx of [-4.5, 4.5]) b.box(bx + sx, 0.5, (z0 + z1) / 2, 0.3, 1, span, 0x8b5a3c);
    }
    // Rumah perahu + dermaga + perahu wisata
    const bh = b.building({ x: 126, z: -495, w: 9.6, d: 6.6, h: 3.6, facing: 'S', wall: 0xb07a4a, roof: 0x1fb6d9, doorW: 3 });
    b.box(126, -0.15, -477, 3, 0.3, 12, C.kayu);
    b.box(78, -0.7, zMid, 4.2, 1, 10, 0xff8a3d);
    b.box(78, 0.1, zMid, 3.6, 0.2, 9, 0xfff3e0, 'decor');
    b.box(78, 1.1, zMid + 1.8, 3, 1.8, 3, 0xf4f8ff, 'decor');
    spawn(126, 0, -472, 'sungai', 'botol', { subject: 'Matematika' });
    const b1 = bh.t.world(-2.4, 0.12, 0.6);
    spawn(b1.x, b1.y, b1.z, 'sungai', 'npc', { subject: 'Matematika' });
    const b2 = bh.t.world(2.4, 0.12, 1.8);
    spawn(b2.x, b2.y, b2.z, 'sungai', 'peti', { hidden: true });
    spawn(0, 0, -444, 'sungai', 'papan');
    spawn(-18, 0, -489, 'sungai', 'botol');
    spawn(-KOTA.sideX, 0, -492, 'sungai', 'botol', { subject: 'Matematika' });
    spawn(KOTA.sideX, 0, -441, 'sungai', 'botol', { subject: 'Matematika' });
  }

  // ---------------- Taman Kota & Lapangan ----------------
  {
    const fx = 396;
    const fz = -60;
    b.disc(fx, 0.45, fz, 9, 0.9, 'y', 0xdce6f5, 'solid');
    b.disc(fx, 0.95, fz, 8.1, 0.12, 'y', 0x5cc8ff, 'decor');
    b.disc(fx, 2.1, fz, 1.2, 4.2, 'y', 0xdce6f5, 'solid');
    b.occupy(fx, fz, 9.5, 9.5, 1);
    b.box(fx, 0.03, -99, 2.4, 0.06, 168, 0xe9d8b4, 'decor');
    b.box(423, 0.03, fz, 114, 0.06, 2.4, 0xe9d8b4, 'decor');
    // Taman bermain
    const px = 450;
    const pz = 15;
    b.box(px, 0.05, pz, 18, 0.1, 15, 0xffd6a5, 'decor');
    b.base(px - 4.5, 0, pz, 3, 2.4, 3, 0x3ba7ff);
    b.stairs(new Transform(b, px - 4.5, pz - 1.5, 'N'), 0, 0, -3.2, 1.2, 2.4, 3, 0xff8a3d);
    for (let i = 0; i < 6; i++) b.box(px - 4.5, 2.4 - (i + 0.5) * 0.4, pz + 1.5 + (i + 0.5) * 0.6, 1.2, 0.2, 0.6, 0xffc93c);
    for (let k = 0; k < 3; k++) b.base(px + 3 + k * 1.8, 0, pz - 2.4, 0.3, 3, 0.3, C.navy);
    b.box(px + 4.8, 3, pz - 2.4, 4.2, 0.3, 0.3, C.navy);
    b.occupy(px, pz, 9, 7.5, 0.5);
    // Stadion mini
    const sx = 426;
    const sz = -225;
    b.box(sx, 0.05, sz, 54, 0.1, 33, 0x4cb85c, 'decor');
    b.box(sx, 0.11, sz - 15, 51, 0.01, 0.3, 0xffffff, 'decor');
    b.box(sx, 0.11, sz + 15, 51, 0.01, 0.3, 0xffffff, 'decor');
    b.box(sx, 0.11, sz, 0.3, 0.01, 30, 0xffffff, 'decor');
    for (const gx of [-24.6, 24.6]) {
      b.base(sx + gx, 0, sz - 2.4, 0.3, 2.4, 0.3, 0xffffff);
      b.base(sx + gx, 0, sz + 2.4, 0.3, 2.4, 0.3, 0xffffff);
      b.box(sx + gx, 2.4, sz, 0.3, 0.3, 5.1, 0xffffff);
    }
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) b.base(sx, 0, sz + s * (18.6 + k * 1.5), 51, 0.6 + k * 0.6, 1.5, k % 2 === 0 ? 0x3ba7ff : 0xff8a3d);
    b.occupy(sx, sz, 27, 24, 1);
    const locker = b.building({ x: sx, z: sz + 30, w: 9.6, d: 6, h: 3.6, facing: 'S', wall: 0xcdeac0, roof: 0x2fbf71, doorW: 3 });
    spawn(fx + 11, 0, fz, 'taman', 'peti');
    spawn(fx - 11, 0, fz + 6, 'taman', 'papan');
    spawn(px - 4.5, 2.4, pz, 'taman', 'peti', { hidden: true });
    spawn(px + 6, 0.1, pz + 4.2, 'taman', 'npc');
    spawn(sx, 0.1, sz, 'taman', 'peti');
    spawn(sx - 18, 2.4, sz + 23.1, 'taman', 'peti', { hidden: true });
    const l1 = locker.t.world(0, 0.12, 1.2);
    spawn(l1.x, l1.y, l1.z, 'taman', 'npc');
  }

  // ---------------- Perumahan Warga ----------------
  {
    const enterable: [number, number][] = [
      [-345 + 0, -78],
      [-345, -51],
      [-345, 51],
      [-375, -64.5],
      [-375, 64.5],
      [-375, 90],
    ];
    enterable.forEach(([x, z], i) => {
      const facing: Facing = x > -KOTA.sideX ? 'W' : 'E';
      const h = b.building({ x: x + (x > -KOTA.sideX ? 12 : -12), z, w: 7.8, d: 6.6, h: 3.6, facing, wall: PASTEL[i] as number, roof: ROOFS[i % ROOFS.length] as number, doorW: 2.4 });
      h.t.box(1.2, 0.55, 1.2, 1.2, 0.1, 0.8, 0xd9a066);
      h.t.box(-2.1, 0.35, 1.8, 2.4, 0.5, 1.5, 0xbde0fe);
      const p = h.t.world(-1.8, 0.12, -0.6);
      spawn(p.x, p.y, p.z, 'perumahan', i % 2 === 0 ? 'npc' : 'buku', { subject: i % 2 === 0 ? 'Pendidikan Pancasila' : 'Bahasa Indonesia' });
    });
    for (let z = -420; z <= 375; z += 21) {
      if (Math.abs(z) > 100 && Math.abs(z - KOTA.southZ) > 12) {
        for (const s of [-1, 1]) {
          const x = -KOTA.sideX + s * 12;
          if (b.isFree(x, z, 3)) b.house(x, z, s > 0 ? 'W' : 'E', rng.pick(PASTEL), rng.pick(ROOFS));
        }
      }
    }
    for (let x = -570; x <= 570; x += 22.5) {
      if (Math.abs(x) > 18 && Math.abs(Math.abs(x) - KOTA.sideX) > 12) {
        for (const s of [-1, 1]) {
          const z = KOTA.southZ + s * 11.4;
          if (b.isFree(x, z, 3)) b.house(x, z, s > 0 ? 'N' : 'S', rng.pick(PASTEL), rng.pick(ROOFS));
        }
      }
    }
    b.box(-399, 0.03, 0, 2.4, 0.06, 270, 0xd9dde6, 'decor');
    b.box(0, 0.03, 420, 360, 0.06, 2.4, 0xd9dde6, 'decor');
  }

  // ---------------- Pengisi: gedung, pohon, titik soal tambahan ----------------
  const fill = (zoneId: string, buildings: number, trees: number, extra: number) => {
    const zone = KOTA_ZONES.find((z) => z.id === zoneId);
    if (!zone) return;
    const rp = () => {
      for (let n = 0; n < 30; n++) {
        const r = rng.pick(zone.rects);
        const x = r.x + rng.float(-r.hx + 6, r.hx - 6);
        const z = r.z + rng.float(-r.hz + 6, r.hz - 6);
        const inRiver = z > KOTA.riverZ0 - 6 && z < KOTA.riverZ1 + 6;
        if (!inRiver && Math.abs(x) < H - 9 && Math.abs(z) < H - 9) return { x, z };
      }
      return null;
    };
    let placed = 0;
    for (let n = 0; n < buildings * 8 && placed < buildings; n++) {
      const p = rp();
      if (!p) continue;
      const w = rng.int(6, 10);
      const d = rng.int(6, 10);
      if (b.isFree(p.x, p.z, Math.max(w, d) / 2 + 2)) {
        b.cityBlock(p.x, p.z, w, d, rng.int(6, 18), rng.pick(PASTEL), rng.pick(ROOFS));
        placed++;
      }
    }
    let tp = 0;
    for (let n = 0; n < trees * 5 && tp < trees; n++) {
      const p = rp();
      if (p && b.isFree(p.x, p.z, 2)) {
        b.tree(p.x, p.z, rng.float(0.9, 1.4));
        b.occupy(p.x, p.z, 1, 1, 0.3);
        tp++;
      }
    }
    let sp = 0;
    for (let n = 0; n < extra * 10 && sp < extra; n++) {
      const p = rp();
      if (p && b.isFree(p.x, p.z, 1.5)) {
        spawn(p.x, 0, p.z, zoneId, rng.pick(['peti', 'papan', 'npc'] as const));
        b.occupy(p.x, p.z, 1, 1, 0.3);
        sp++;
      }
    }
  };
  fill('sekolah', 14, 18, 3);
  fill('pasar', 14, 14, 2);
  fill('museum', 14, 18, 3);
  fill('terminal', 14, 16, 3);
  fill('perpustakaan', 22, 50, 4);
  fill('sungai', 18, 70, 4);
  fill('taman', 10, 150, 4);
  fill('perumahan', 50, 150, 6);

  cached = {
    boxes: b.boxes,
    discs: b.discs,
    signs: b.signs,
    trees: b.trees,
    lamps: b.lamps,
    spawns,
    halte,
    lifts,
    interactables,
    busLoop,
    busStops,
    spawnPoint: { x: 0, y: 0.2, z: 21 },
    podium: { x: 0, z: -28 },
    water,
  };
  return cached;
}

/** Posisi bus kota pada waktu t (ms) — deterministik, sama di semua klien. */
export function busPosition(tMs: number): { x: number; z: number; heading: number; stopped: boolean; stopId: string | null } {
  const k = buildKota();
  const speed = 11; // m/detik
  const stopSec = 10;
  // Susun lintasan dengan halte di urutan perjalanan
  type Node = { x: number; z: number; stop: string | null };
  const nodes: Node[] = [];
  for (let i = 0; i < 4; i++) {
    const a = k.busLoop[i]!;
    const c = k.busLoop[(i + 1) % 4]!;
    nodes.push({ x: a.x, z: a.z, stop: null });
    const dir = { x: Math.sign(c.x - a.x), z: Math.sign(c.z - a.z) };
    const stops = k.busStops
      .filter((s) => (dir.x !== 0 ? Math.abs(s.z - a.z) < 0.5 && (s.x - a.x) * dir.x > 0 && (c.x - s.x) * dir.x > 0 : Math.abs(s.x - a.x) < 0.5 && (s.z - a.z) * dir.z > 0 && (c.z - s.z) * dir.z > 0))
      .sort((p, q) => (dir.x !== 0 ? (p.x - a.x) * dir.x - (q.x - a.x) * dir.x : (p.z - a.z) * dir.z - (q.z - a.z) * dir.z));
    for (const s of stops) nodes.push({ x: s.x, z: s.z, stop: s.halteId });
  }
  // Durasi tiap segmen
  const segs: { a: Node; b: Node; dur: number; wait: number }[] = [];
  let total = 0;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    const c = nodes[(i + 1) % nodes.length]!;
    const dur = Math.hypot(c.x - a.x, c.z - a.z) / speed;
    const wait = c.stop ? stopSec : 0;
    segs.push({ a, b: c, dur, wait });
    total += dur + wait;
  }
  let t = ((tMs / 1000) % total + total) % total;
  for (const s of segs) {
    const heading = Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z);
    if (t < s.dur) {
      const f = t / s.dur;
      return { x: s.a.x + (s.b.x - s.a.x) * f, z: s.a.z + (s.b.z - s.a.z) * f, heading, stopped: false, stopId: null };
    }
    t -= s.dur;
    if (t < s.wait) return { x: s.b.x, z: s.b.z, heading, stopped: true, stopId: s.b.stop };
    t -= s.wait;
  }
  return { x: nodes[0]!.x, z: nodes[0]!.z, heading: 0, stopped: false, stopId: null };
}
