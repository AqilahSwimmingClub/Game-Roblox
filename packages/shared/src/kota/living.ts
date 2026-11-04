/**
 * Kota Hidup (Living City) — data deterministik yang dipakai klien (render, NPC, kendaraan)
 * dan server (validasi kendaraan, jetpack, lubang dimensi, misi pedagang).
 *
 * Isi tambahan di atas layout Dunia Kota yang sudah ada:
 * - Bandara EDUVERSE (timur, di luar pagar kota) + zona udara 2,4 × 2,4 km.
 * - Kawasan Gedung Tinggi & Pusat Teknologi (barat) dengan atap yang bisa didarati.
 * - Taman Langit (area rahasia melayang) yang hanya bisa dicapai lewat lubang dimensi/jetpack/pesawat.
 * - Area parkir, kendaraan yang bisa dikendarai, stasiun jetpack, lubang dimensi, pedagang/warga interaktif.
 * - Jalur lalu lintas (lajur kiri, seperti di Indonesia), lampu lalu lintas, zebra cross, jalur pejalan kaki.
 *
 * Semua koordinat dalam meter. Heading: 0 = menghadap +Z, π/2 = menghadap +X (sama dengan bus kota).
 */
import { Rng } from '../rng.js';
import type { WorldBuilder, Facing } from './builder.js';

// ───────────────────────── mode gerak ─────────────────────────

export type MoveMode = 'jalan' | 'penumpang' | 'sepeda' | 'motor' | 'mobil' | 'bus' | 'pesawat' | 'jetpack';
export type VehicleKind = 'sepeda' | 'motor' | 'mobil' | 'bus' | 'pesawat';

export const MOVE_MODES: readonly MoveMode[] = ['jalan', 'penumpang', 'sepeda', 'motor', 'mobil', 'bus', 'pesawat', 'jetpack'];
export const MODE_CODE: Record<MoveMode, number> = { jalan: 0, penumpang: 1, sepeda: 2, motor: 3, mobil: 4, bus: 5, pesawat: 6, jetpack: 7 };
export function modeFromCode(c: number): MoveMode {
  return MOVE_MODES[c] ?? 'jalan';
}

/**
 * Batas yang divalidasi server per mode. maxSpeed = kecepatan horizontal maksimum (m/detik),
 * maxY = ketinggian kaki maksimum. Klien memakai angka yang lebih kecil (lihat VEHICLE_SPEC).
 */
export const MODE_LIMITS: Record<MoveMode, { maxSpeed: number; maxY: number; label: string }> = {
  jalan: { maxSpeed: 8.5, maxY: 260, label: 'Berjalan' },
  penumpang: { maxSpeed: 14, maxY: 260, label: 'Naik Bus Kota' },
  sepeda: { maxSpeed: 10, maxY: 260, label: 'Bersepeda' },
  motor: { maxSpeed: 19, maxY: 260, label: 'Naik Motor' },
  mobil: { maxSpeed: 21, maxY: 260, label: 'Mengemudi Mobil' },
  bus: { maxSpeed: 15, maxY: 260, label: 'Mengemudi Bus' },
  pesawat: { maxSpeed: 62, maxY: 320, label: 'Menerbangkan Pesawat' },
  jetpack: { maxSpeed: 13, maxY: 170, label: 'Terbang dengan Jetpack' },
};

export interface VehicleSpec {
  nama: string;
  maxSpeed: number; // m/detik (≤ MODE_LIMITS)
  reverse: number;
  accel: number;
  brake: number;
  turn: number; // rad/detik pada kecepatan penuh
  radius: number; // jari-jari tabrakan
  length: number; // panjang (untuk tabrakan lingkaran ganda)
  height: number;
  interact: number; // jarak naik
}

export const VEHICLE_SPEC: Record<VehicleKind, VehicleSpec> = {
  sepeda: { nama: 'Sepeda', maxSpeed: 8.5, reverse: 2, accel: 4, brake: 9, turn: 2.4, radius: 0.5, length: 1.8, height: 1.2, interact: 3 },
  motor: { nama: 'Sepeda Motor', maxSpeed: 17, reverse: 3, accel: 7, brake: 14, turn: 2.1, radius: 0.55, length: 2, height: 1.2, interact: 3.2 },
  mobil: { nama: 'Mobil', maxSpeed: 19, reverse: 5, accel: 6, brake: 16, turn: 1.6, radius: 1.05, length: 4.2, height: 1.7, interact: 4 },
  bus: { nama: 'Bus Penumpang', maxSpeed: 13, reverse: 3, accel: 3.5, brake: 10, turn: 0.95, radius: 1.4, length: 9, height: 3.4, interact: 6 },
  pesawat: { nama: 'Pesawat Ringan', maxSpeed: 58, reverse: 0, accel: 7, brake: 8, turn: 0.7, radius: 2.2, length: 8, height: 2.6, interact: 7 },
};

export const JETPACK = {
  speed: 11, // m/detik horizontal
  climb: 7, // m/detik naik
  sink: 6, // m/detik turun
  maxY: 150,
  fuelMax: 100,
  burnUp: 7, // energi/detik saat naik
  burnHover: 2.5, // energi/detik saat melayang/maju
  recharge: 30, // energi/detik di tanah
  glideSink: 3.2, // turun pelan saat energi habis (aman, tidak jatuh keras)
} as const;

export const FLIGHT = {
  half: 1180, // zona udara ±1.180 m (2,36 × 2,36 km)
  maxY: 300,
  takeoffSpeed: 21,
  stallSpeed: 17,
} as const;

/** Batas peta Dunia Kota (termasuk Bandara, Kawasan Gedung Tinggi, dan padang di sekitar kota). */
export const KOTA_WORLD_HALF = 1200;

// ───────────────────────── data layout ─────────────────────────

export interface VehicleSpawn {
  id: string;
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  heading: number;
  color: number;
}

export interface JetpackStation {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface Rift {
  id: string;
  nama: string; // nama lokasi portal ini
  x: number;
  y: number;
  z: number;
  ry: number; // arah keluar (heading)
  to: string; // id rift tujuan
  secret?: boolean;
}

export type MissionKind = 'kembalian' | 'pecahan' | 'jumlah' | 'sehat' | 'inggris' | 'koding' | 'lalulintas' | 'navigasi' | 'bacaan' | 'pancasila' | 'ipas';

export const MISSION_SUBJECT: Record<MissionKind, string> = {
  kembalian: 'Matematika',
  pecahan: 'Matematika',
  jumlah: 'Matematika',
  sehat: 'IPAS',
  ipas: 'IPAS',
  inggris: 'Bahasa Inggris',
  koding: 'Koding',
  lalulintas: 'Pendidikan Pancasila',
  navigasi: 'IPAS',
  bacaan: 'Bahasa Indonesia',
  pancasila: 'Pendidikan Pancasila',
};

export interface Vendor {
  id: string; // juga id titik soal misi (server)
  nama: string;
  peran: string;
  zone: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  karakter: number; // salah satu dari 20 karakter EDUVERSE
  stall: 'gerobak' | 'kios' | 'meja' | 'pos' | 'none';
  stallColor: number;
  mission: MissionKind;
  items: { nama: string; harga: number }[];
  lines: string[];
}

export interface Pt {
  x: number;
  z: number;
}

export interface TrafficLoop {
  id: string;
  pts: Pt[]; // garis tengah jalan (polyline tertutup)
  kinds: ('mobil' | 'motor' | 'sepeda' | 'bus')[];
  count: number; // jumlah kendaraan NPC bawaan (kualitas tinggi)
}

export interface TrafficLightDef {
  id: string;
  x: number;
  z: number;
}

export interface WalkLoop {
  id: string;
  pts: Pt[];
  count: number;
}

export interface ParkSpot {
  x: number;
  z: number;
  activity: 'senam' | 'duduk' | 'ngobrol' | 'main';
}

export interface LivingLayout {
  vehicles: VehicleSpawn[];
  jetpacks: JetpackStation[];
  rifts: Rift[];
  vendors: Vendor[];
  loops: TrafficLoop[];
  lights: TrafficLightDef[];
  walks: WalkLoop[];
  parkSpots: ParkSpot[];
  runway: { x0: number; x1: number; z: number; w: number };
  airport: { x: number; z: number };
  business: { x: number; z: number };
  skyIsland: { x: number; y: number; z: number };
  gates: { x: number; z: number }[];
}

/** Fase lampu lalu lintas (sama di semua perangkat karena dihitung dari jam). */
export const LIGHT_CYCLE = { green: 13, yellow: 3 } as const;
export type LightColor = 'hijau' | 'kuning' | 'merah';
/** Warna lampu untuk kendaraan yang bergerak sepanjang sumbu `axis` pada waktu t (detik). */
export function lightFor(axis: 'x' | 'z', tSec: number): LightColor {
  const half = LIGHT_CYCLE.green + LIGHT_CYCLE.yellow;
  const u = ((tSec % (2 * half)) + 2 * half) % (2 * half);
  const zPhase = u < half;
  const inPhase = axis === 'z' ? zPhase : !zPhase;
  if (!inPhase) return 'merah';
  const local = zPhase ? u : u - half;
  return local < LIGHT_CYCLE.green ? 'hijau' : 'kuning';
}

const FACING_RY: Record<Facing, number> = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 };

/**
 * Tambahkan Kota Hidup ke builder Dunia Kota. Dipanggil sekali di akhir buildKota()
 * (setelah semua isi lama) sehingga id titik soal & kotak lama tidak bergeser.
 */
export function addLivingCity(b: WorldBuilder, H: number, ring: number, extraSpawn: (id: string, x: number, y: number, z: number, zone: string, object: 'npc' | 'peti' | 'kristal' | 'papan', hidden: boolean, subject: string | null, always?: boolean) => void): LivingLayout {
  const rng = new Rng(77_2026);
  const C = { jalan: 0x5d6678, garis: 0xffe27a, putih: 0xffffff, rumput: 0x86d174, navy: 0x1e2a4a, paving: 0xd9dde6, aspal: 0x4a5266 };
  const R = ring;

  /** Cari titik kosong terdekat (spiral) yang muat lingkaran r. */
  const findFree = (cx: number, cz: number, r: number, maxR = 90): Pt => {
    if (b.isFree(cx, cz, r)) return { x: cx, z: cz };
    for (let d = 3; d <= maxR; d += 3) {
      const n = Math.max(8, Math.round(d * 1.2));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(a) * d);
        const z = Math.round(cz + Math.sin(a) * d);
        if (Math.abs(x) < H - 8 && Math.abs(z) < H - 8 && !(z > -490 && z < -440) && b.isFree(x, z, r)) return { x, z };
      }
    }
    return { x: cx, z: cz };
  };

  // ───────── padang di luar kota (agar zona udara punya daratan) ─────────
  const W = KOTA_WORLD_HALF;
  const step = 200;
  for (let x = -W; x < W; x += step)
    for (let z = -W; z < W; z += step) {
      if (x >= -H && x + step <= H && z >= -H && z + step <= H) continue;
      b.box(x + step / 2, -1, z + step / 2, step, 2, step, C.rumput);
    }
  // pagar batas dunia (setinggi 3 m) — pesawat/jetpack tetap bisa terbang di atasnya sampai batas zona udara
  for (const s of [-1, 1]) {
    b.box(0, 1.5, s * W, 2 * W, 3, 1, 0xe2e8f0);
    b.box(s * W, 1.5, 0, 1, 3, 2 * W, 0xe2e8f0);
  }

  const road = (cx: number, cz: number, sx: number, sz: number, alongX: boolean) => {
    b.box(cx, 0.03, cz, sx, 0.06, sz, C.jalan, 'decor');
    b.box(cx, 0.065, cz, alongX ? sx : 0.2, 0.01, alongX ? 0.2 : sz, C.garis, 'decor');
    b.occupy(cx, cz, sx / 2, sz / 2, 0.8);
  };
  const gates = [
    { x: H, z: 0 },
    { x: -H, z: 0 },
  ];
  // Gerbang kota timur & barat (jalan z = 0 diteruskan keluar pagar)
  for (const g of gates) {
    const s = Math.sign(g.x);
    b.box(g.x, 4, -9, 1.2, 8, 1.2, 0xff8a3d);
    b.box(g.x, 4, 9, 1.2, 8, 1.2, 0xff8a3d);
    b.box(g.x, 8.4, 0, 1.2, 1, 19.2, 0xffc93c, 'decor');
    b.sign(g.x - s * 0.7, 6.6, 0, 9, 1.6, s > 0 ? 'Ke Bandara EDUVERSE' : 'Ke Kawasan Gedung Tinggi', s > 0 ? 'W' : 'E', 0x3ba7ff, 0xffffff);
  }

  // ───────── Bandara EDUVERSE (timur) ─────────
  const AX = 900;
  const runway = { x0: 700, x1: 1140, z: -40, w: 30 };
  road((H + 700) / 2, 0, 700 - H + 6, 12, true);
  road(700, 75, 12, 150 - 6, false);
  road(800, 150, 212, 12, true);
  b.box(920, 0.025, 30, 460, 0.05, 160, 0x9aa3b5, 'decor'); // apron & lapangan
  b.box((runway.x0 + runway.x1) / 2, 0.055, runway.z, runway.x1 - runway.x0, 0.03, runway.w, C.aspal, 'decor');
  for (let x = runway.x0 + 20; x < runway.x1 - 20; x += 24) b.box(x, 0.075, runway.z, 10, 0.01, 0.8, C.putih, 'decor');
  for (const xe of [runway.x0 + 6, runway.x1 - 6]) for (let k = -3; k <= 3; k++) b.box(xe, 0.075, runway.z + k * 3.6, 8, 0.01, 1.4, C.putih, 'decor');
  b.box(760, 0.07, 18, 120, 0.02, 14, 0x6b7487, 'decor'); // taksi
  // Terminal bandara (bisa dimasuki), menara kontrol (atap bisa didarati), hangar
  const term = b.building({ x: 760, z: 110, w: 44, d: 18, h: 7.2, facing: 'N', floors: 2, wall: 0xe0f2ff, glass: true, roof: 0x3ba7ff, trim: 0x1fb6d9, doorW: 6, roofAccess: true, windows: false });
  void term;
  b.sign(760, 9.2, 100.6, 22, 2.4, 'BANDARA EDUVERSE', 'N', 0x1fb6d9, 0xffffff);
  b.base(880, 0, 105, 7, 26, 7, 0xf4f8ff);
  b.base(880, 26, 105, 10, 4, 10, 0xbfe6ff, 'glass');
  b.base(880, 30, 105, 11, 0.6, 11, 0x3ba7ff);
  b.occupy(880, 105, 6, 6, 1.5);
  b.sign(880, 22, 101.4, 6, 1.2, 'Menara Kontrol', 'N', 0x1e2a4a, 0xffffff);
  b.building({ x: 1030, z: 115, w: 34, d: 24, h: 11, facing: 'N', wall: 0xcbd5e1, roof: 0x94a3b8, trim: 0xff8a3d, doorW: 18, windows: false });
  b.sign(1030, 12.6, 102.8, 12, 1.6, 'Hangar Pesawat', 'N', 0xff8a3d, 0xffffff);
  // kantong angin
  b.base(1100, 0, 20, 0.3, 7, 0.3, 0xe2e8f0, 'decor');
  b.box(1101.5, 6.6, 20, 3, 0.8, 0.8, 0xff8a3d, 'decor');
  b.occupy(1100, 20, 0.5, 0.5, 0.5);
  b.sign(runway.x0 + 2, 1.4, runway.z - 18, 8, 1.4, 'Landasan 09 · Lepas Landas →', 'S', 0xffffff, 0x1e2a4a);

  // ───────── Kawasan Gedung Tinggi & Pusat Teknologi (barat) ─────────
  const BX = -830;
  road((-H - 700) / 2, 0, 700 - H + 6, 12, true);
  road(-700, 0, 12, 252, false);
  road(-960, 0, 12, 252, false);
  road(-830, -120, 272, 12, true);
  road(-830, 120, 272, 12, true);
  b.box(-830, 0.025, 0, 248, 0.05, 228, 0xe5e7eb, 'decor'); // trotoar/plaza bisnis
  const towers = [
    { x: -760, z: -60, w: 18, d: 18, h: 42, c: 0xbfe6ff },
    { x: -830, z: -62, w: 20, d: 20, h: 66, c: 0x8b5cf6 }, // Menara EDUVERSE (tertinggi)
    { x: -900, z: -60, w: 18, d: 18, h: 36, c: 0x1fb6d9 },
    { x: -760, z: 62, w: 16, d: 16, h: 30, c: 0xffc93c },
    { x: -900, z: 62, w: 18, d: 16, h: 48, c: 0xe86fa8 },
  ];
  let menaraTop = 0;
  for (const t of towers) {
    b.base(t.x, 0, t.z, t.w, t.h, t.d, t.c);
    for (let y = 4; y < t.h - 2; y += 4) b.box(t.x, y, t.z, t.w + 0.14, 1.4, t.d + 0.14, 0x9fd4ff, 'decor');
    // atap: pagar rendah + helipad (bisa didarati jetpack)
    for (const s of [-1, 1]) {
      b.box(t.x, t.h + 0.5, t.z + s * (t.d / 2 - 0.15), t.w, 1, 0.3, 0xffffff);
      b.box(t.x + s * (t.w / 2 - 0.15), t.h + 0.5, t.z, 0.3, 1, t.d, 0xffffff);
    }
    b.box(t.x, t.h + 0.03, t.z, 7, 0.06, 7, 0xffc93c, 'decor');
    b.box(t.x, t.h + 0.07, t.z, 1, 0.02, 4.4, C.navy, 'decor');
    b.box(t.x - 1.6, t.h + 0.07, t.z, 0.8, 0.02, 4.4, C.navy, 'decor');
    b.box(t.x + 1.6, t.h + 0.07, t.z, 0.8, 0.02, 4.4, C.navy, 'decor');
    b.occupy(t.x, t.z, t.w / 2, t.d / 2, 2);
    if (t.h === 66) menaraTop = t.h;
  }
  b.sign(-830, 8, -50.9, 14, 2, 'MENARA EDUVERSE', 'S', 0x8b5cf6, 0xffffff);
  const tech = b.building({ x: -830, z: 66, w: 26, d: 18, h: 8.4, facing: 'N', floors: 2, wall: 0xdcfce7, roof: 0x2fbf71, trim: 0x16a34a, doorW: 5, roofAccess: true });
  void tech;
  b.sign(-830, 10.4, 56.6, 16, 2, 'Pusat Teknologi & Koding', 'N', 0x16a34a, 0xffffff);

  // ───────── Taman Langit (area rahasia melayang) ─────────
  const sky = { x: -860, y: 150, z: -380 };
  b.box(sky.x, sky.y - 1.5, sky.z, 34, 3, 34, 0x7ccb6b);
  b.box(sky.x, sky.y - 5, sky.z, 24, 4, 24, 0x9b7653, 'decor');
  b.box(sky.x, sky.y - 9, sky.z, 12, 4, 12, 0x8b6a4a, 'decor');
  for (const [dx, dz] of [
    [-11, -11],
    [11, -10],
    [-10, 11],
    [12, 12],
  ] as [number, number][]) {
    b.tree(sky.x + dx, sky.z + dz, 1.1, sky.y);
  }
  for (const s of [-1, 1]) {
    b.box(sky.x, sky.y + 0.5, sky.z + s * 16.8, 34, 1, 0.4, 0xffffff);
    b.box(sky.x + s * 16.8, sky.y + 0.5, sky.z, 0.4, 1, 34, 0xffffff);
  }
  b.box(sky.x, sky.y + 0.04, sky.z, 8, 0.08, 8, 0xe2c2ff, 'decor');
  b.sign(sky.x, sky.y + 3.2, sky.z + 16.4, 10, 1.6, 'Taman Langit Rahasia', 'N', 0x8b5cf6, 0xffffff);
  extraSpawn('S01', sky.x + 6, sky.y, sky.z - 6, 'bisnis', 'kristal', true, null);

  // Titik soal biasa di Bandara & Kawasan Gedung Tinggi (ikut pengaturan kepadatan guru)
  const pointsAt: [string, number, number, 'peti' | 'papan', string][] = [
    ['A01', 700, 60, 'papan', 'bandara'],
    ['A02', 735, 98, 'peti', 'bandara'],
    ['A03', 790, 98, 'papan', 'bandara'],
    ['A04', 872, 92, 'peti', 'bandara'],
    ['A05', 960, 70, 'papan', 'bandara'],
    ['A06', 1010, 96, 'peti', 'bandara'],
    ['A07', 1090, 40, 'papan', 'bandara'],
    ['A08', 900, -70, 'peti', 'bandara'],
    ['B01', -720, -30, 'papan', 'bisnis'],
    ['B02', -745, 30, 'peti', 'bisnis'],
    ['B03', -795, -30, 'papan', 'bisnis'],
    ['B04', -865, 30, 'peti', 'bisnis'],
    ['B05', -930, -20, 'papan', 'bisnis'],
    ['B06', -940, 95, 'peti', 'bisnis'],
    ['B07', -790, 98, 'papan', 'bisnis'],
    ['B08', -880, -100, 'peti', 'bisnis'],
  ];
  for (const [id, x, z, obj, zone] of pointsAt) {
    const p = findFree(x, z, 1.2, 30);
    b.occupy(p.x, p.z, 0.8, 0.8, 0.3);
    extraSpawn(id, p.x, 0, p.z, zone, obj, false, zone === 'bandara' ? 'IPAS' : null, false);
  }

  // ───────── lampu lalu lintas & zebra cross ─────────
  const lights: TrafficLightDef[] = [
    { id: 'TL1', x: R, z: 0 },
    { id: 'TL2', x: -R, z: 0 },
    { id: 'TL3', x: 0, z: -R },
    { id: 'TL4', x: 0, z: R },
    { id: 'TL5', x: 360, z: 0 },
    { id: 'TL6', x: -360, z: 0 },
  ];
  const zebra = (x: number, z: number, alongX: boolean, width: number) => {
    for (let k = -3; k <= 3; k++) {
      if (alongX) b.box(x + k * 1.3, 0.072, z, 0.7, 0.01, width, C.putih, 'decor');
      else b.box(x, 0.072, z + k * 1.3, width, 0.01, 0.7, C.putih, 'decor');
    }
  };
  for (const l of lights) {
    // zebra di keempat lengan simpang, 10 m dari pusat
    zebra(l.x + 10, l.z, false, 11);
    zebra(l.x - 10, l.z, false, 11);
    zebra(l.x, l.z + 10, true, 11);
    zebra(l.x, l.z - 10, true, 11);
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as [number, number][]) b.occupy(l.x + sx * 7.5, l.z + sz * 7.5, 0.4, 0.4, 0.3);
  }
  // zebra di depan sekolah & pasar (tanpa lampu, pejalan kaki tetap waspada)
  zebra(120, -R, true, 11);
  zebra(-120, -R, true, 11);

  // ───────── area parkir, kendaraan, stasiun jetpack ─────────
  const vehicles: VehicleSpawn[] = [];
  const jetpacks: JetpackStation[] = [];
  const COLORS = [0xe74c3c, 0x3ba7ff, 0xffc93c, 0x2fbf71, 0x8b5cf6, 0xff8a3d, 0xf4f8ff];
  let vid = 0;
  const addVehicle = (kind: VehicleKind, x: number, z: number, heading: number, y = 0) => {
    vid++;
    vehicles.push({ id: `${kind.toUpperCase()}${vid}`, kind, x, y, z, heading, color: COLORS[vid % COLORS.length]! });
  };
  /** Lot parkir 18 × 12 m: garis putih + papan "P". */
  const parking = (near: Pt, label: string, fill: VehicleKind[]) => {
    const p = findFree(near.x, near.z, 11);
    b.box(p.x, 0.04, p.z, 18, 0.06, 12, 0x6b7487, 'decor');
    for (let i = -2; i <= 2; i++) b.box(p.x + i * 3.6 + 1.8, 0.08, p.z - 2.5, 0.15, 0.01, 5, C.putih, 'decor');
    b.base(p.x - 9.5, 0, p.z + 6.2, 0.2, 3, 0.2, C.navy);
    b.sign(p.x - 9.5, 3.4, p.z + 6.3, 2.6, 1.2, `P · ${label}`, 'S', 0x3ba7ff, 0xffffff);
    b.occupy(p.x, p.z, 9, 6, 1);
    fill.forEach((k, i) => {
      const lx = p.x - 7.2 + i * 3.6;
      addVehicle(k, lx, k === 'bus' ? p.z + 1 : p.z - 2.5, Math.PI);
    });
    return p;
  };
  const station = (id: string, label: string, near: Pt, y = 0) => {
    const p = y > 0 ? near : findFree(near.x, near.z, 2.5);
    b.box(p.x, y + 0.08, p.z, 3, 0.16, 3, 0x1e2a4a, 'decor');
    b.box(p.x, y + 0.18, p.z, 2.2, 0.04, 2.2, 0x5cf2c8, 'neon');
    b.base(p.x - 1.3, y, p.z - 1.3, 0.25, 2.4, 0.25, 0xff8a3d, 'decor');
    b.sign(p.x - 1.3, y + 2.9, p.z - 1.2, 2.4, 0.9, 'JETPACK', 'S', 0xff8a3d, 0xffffff);
    if (y === 0) b.occupy(p.x, p.z, 1.6, 1.6, 0.5);
    jetpacks.push({ id, label, x: p.x, y, z: p.z });
  };

  parking({ x: 62, z: 62 }, 'Alun-alun', ['mobil', 'mobil', 'motor', 'sepeda', 'sepeda']);
  parking({ x: -150, z: 180 }, 'Terminal', ['bus', 'mobil', 'motor']);
  parking({ x: 150, z: -180 }, 'Sekolah', ['sepeda', 'sepeda', 'motor', 'mobil']);
  parking({ x: 300, z: -60 }, 'Taman', ['sepeda', 'sepeda', 'motor']);
  parking({ x: -300, z: -200 }, 'Perumahan', ['mobil', 'motor', 'sepeda']);
  // Parkir bandara (luar kota, pasti kosong)
  {
    const px = 690;
    const pz = 150 + 18;
    b.box(px, 0.04, pz, 18, 0.06, 12, 0x6b7487, 'decor');
    b.sign(px - 9.5, 3.4, pz + 6.3, 2.6, 1.2, 'P · Bandara', 'S', 0x3ba7ff, 0xffffff);
    addVehicle('mobil', px - 5, pz, Math.PI);
    addVehicle('motor', px, pz, Math.PI);
    addVehicle('sepeda', px + 4, pz, Math.PI);
  }
  // Parkir bisnis
  {
    const px = -720;
    const pz = -150 + 6;
    addVehicle('mobil', px - 40, pz - 18, Math.PI / 2);
    addVehicle('motor', px - 46, pz - 18, Math.PI / 2);
    addVehicle('sepeda', px - 52, pz - 18, Math.PI / 2);
    b.box(px - 46, 0.04, pz - 18, 18, 0.06, 8, 0x6b7487, 'decor');
  }
  // Pesawat ringan di apron bandara, menghadap landasan (+X)
  addVehicle('pesawat', 740, 40, Math.PI / 2);
  addVehicle('pesawat', 790, 40, Math.PI / 2);
  addVehicle('pesawat', 840, 40, Math.PI / 2);

  station('JP_ALUN', 'Alun-alun', { x: -30, z: 30 });
  station('JP_TAMAN', 'Taman Kota', { x: 330, z: 40 });
  station('JP_BANDARA', 'Bandara', { x: 720, z: 85 });
  station('JP_BISNIS', 'Kawasan Gedung Tinggi', { x: -720, z: -95 });
  station('JP_PERPUS', 'Perpustakaan', { x: 150, z: -280 });

  // ───────── lubang dimensi (pasangan) ─────────
  const rifts: Rift[] = [];
  const rift = (id: string, nama: string, near: Pt, ry: number, to: string, y = 0, secret = false) => {
    const p = y > 0 ? near : findFree(near.x, near.z, 3.2);
    b.box(p.x, y + 0.05, p.z, 5, 0.1, 5, 0x312e81, 'decor');
    if (y === 0) b.occupy(p.x, p.z, 2.5, 2.5, 0.5);
    rifts.push({ id, nama, x: p.x, y, z: p.z, ry, to, secret });
  };
  rift('R_ALUN', 'Alun-alun', { x: 26, z: -26 }, 0, 'R_BANDARA');
  // Gerbang Antardunia: Hutan/Laut/Angkasa belum tersedia → tidak memindahkan pemain (jujur "segera hadir").
  rift('R_DUNIA', 'Gerbang Antardunia', { x: -26, z: -30 }, 0, '');
  rift('R_BANDARA', 'Bandara EDUVERSE', { x: 740, z: 75 }, -Math.PI / 2, 'R_ALUN');
  rift('R_SEKOLAH', 'Distrik Sekolah', { x: 100, z: -60 }, 0, 'R_PERPUS');
  rift('R_PERPUS', 'Perpustakaan Raksasa', { x: 180, z: -300 }, 0, 'R_SEKOLAH');
  rift('R_PASAR', 'Pasar Edukatif', { x: -60, z: -100 }, 0, 'R_TAMAN');
  rift('R_TAMAN', 'Taman Kota', { x: 300, z: 20 }, 0, 'R_PASAR');
  rift('R_TERMINAL', 'Terminal', { x: -100, z: 70 }, 0, 'R_BISNIS');
  rift('R_BISNIS', 'Kawasan Gedung Tinggi', { x: -830, z: -10 }, 0, 'R_TERMINAL');
  rift('R_MENARA', 'Atap Menara EDUVERSE', { x: -834, z: -66 }, Math.PI, 'R_LANGIT', menaraTop);
  rift('R_LANGIT', 'Taman Langit Rahasia', { x: sky.x, z: sky.z + 8 }, 0, 'R_MENARA', sky.y, true);

  // ───────── pedagang & warga interaktif ─────────
  const vendors: Vendor[] = [];
  const vendor = (v: Omit<Vendor, 'x' | 'y' | 'z'> & { near: Pt; y?: number }) => {
    const p = v.y ? v.near : findFree(v.near.x, v.near.z, 2.4, 60);
    const { near: _n, ...rest } = v;
    void _n;
    const out: Vendor = { ...rest, x: p.x, y: v.y ?? 0, z: p.z };
    if (!v.y) b.occupy(p.x, p.z, 1.4, 1.4, 0.3);
    vendors.push(out);
    extraSpawn(out.id, out.x, out.y, out.z, out.zone, 'npc', false, MISSION_SUBJECT[out.mission]);
  };
  vendor({ id: 'V01', nama: 'Bu Sari', peran: 'Pedagang Buah', zone: 'pasar', near: { x: -95, z: -95 }, ry: 0, karakter: 7, stall: 'kios', stallColor: 0x2fbf71, mission: 'jumlah', items: [{ nama: 'Apel', harga: 3000 }, { nama: 'Jeruk', harga: 2000 }, { nama: 'Pisang', harga: 1500 }, { nama: 'Mangga', harga: 5000 }], lines: ['Buahnya segar-segar, Nak! Baru dipetik pagi ini.', 'Buah itu sumber vitamin. Makan buah setiap hari ya!'] });
  vendor({ id: 'V02', nama: 'Pak Budi', peran: 'Penjual Makanan', zone: 'pasar', near: { x: -130, z: -60 }, ry: Math.PI / 2, karakter: 9, stall: 'gerobak', stallColor: 0xff8a3d, mission: 'kembalian', items: [{ nama: 'Nasi Goreng', harga: 12000 }, { nama: 'Bakso', harga: 10000 }, { nama: 'Soto Ayam', harga: 11000 }, { nama: 'Gado-gado', harga: 9000 }], lines: ['Mau makan apa hari ini? Semua dimasak bersih.', 'Jangan lupa cuci tangan sebelum makan!'] });
  vendor({ id: 'V03', nama: 'Mas Joko', peran: 'Penjual Minuman', zone: 'alunalun', near: { x: -24, z: -18 }, ry: 0, karakter: 11, stall: 'gerobak', stallColor: 0x3ba7ff, mission: 'pecahan', items: [{ nama: 'Air Mineral', harga: 3000 }, { nama: 'Es Jeruk', harga: 5000 }, { nama: 'Susu Kotak', harga: 4000 }, { nama: 'Jus Alpukat', harga: 8000 }], lines: ['Panas ya? Minum air putih yang cukup!', 'Bisa bantu aku menghitung uang?'] });
  vendor({ id: 'V04', nama: 'Bu Rina', peran: 'Penjual Perlengkapan Sekolah', zone: 'sekolah', near: { x: 90, z: -95 }, ry: Math.PI, karakter: 1, stall: 'kios', stallColor: 0x3ba7ff, mission: 'kembalian', items: [{ nama: 'Buku Tulis', harga: 4000 }, { nama: 'Pensil', harga: 2000 }, { nama: 'Penghapus', harga: 1000 }, { nama: 'Penggaris', harga: 3000 }], lines: ['Sudah siap belajar hari ini?', 'Rawat alat tulismu supaya awet.'] });
  vendor({ id: 'V05', nama: 'Kak Dina', peran: 'Pedagang Buku', zone: 'perpustakaan', near: { x: 160, z: -305 }, ry: 0, karakter: 13, stall: 'meja', stallColor: 0xe86fa8, mission: 'bacaan', items: [{ nama: 'Buku Cerita', harga: 15000 }, { nama: 'Komik Sains', harga: 12000 }, { nama: 'Kamus Kecil', harga: 10000 }, { nama: 'Atlas Indonesia', harga: 20000 }], lines: ['Membaca membuka jendela dunia!', 'Ayo coba baca cerita ini bersamaku.'] });
  vendor({ id: 'V06', nama: 'Pak Anto', peran: 'Warung Sehat', zone: 'taman', near: { x: 320, z: 0 }, ry: -Math.PI / 2, karakter: 3, stall: 'gerobak', stallColor: 0x7fb548, mission: 'sehat', items: [{ nama: 'Salad Buah', harga: 7000 }, { nama: 'Jagung Rebus', harga: 4000 }, { nama: 'Telur Rebus', harga: 3000 }, { nama: 'Ubi Kukus', harga: 3000 }], lines: ['Habis olahraga, makan makanan sehat ya!', 'Mana yang lebih sehat? Coba tebak!'] });
  vendor({ id: 'V07', nama: 'Pak RT Harun', peran: 'Petugas Balai Warga', zone: 'museum', near: { x: 150, z: 90 }, ry: Math.PI, karakter: 15, stall: 'meja', stallColor: 0x8b5cf6, mission: 'pancasila', items: [], lines: ['Selamat datang di Balai Warga. Di sini kita bermusyawarah.', 'Gotong royong membuat kampung kita bersih dan rukun.'] });
  vendor({ id: 'V08', nama: 'Pak Bima', peran: 'Polisi Lalu Lintas', zone: 'terminal', near: { x: -R - 14, z: 16 }, ry: Math.PI / 2, karakter: 17, stall: 'pos', stallColor: 0x1e2a4a, mission: 'lalulintas', items: [], lines: ['Selalu menyeberang di zebra cross saat lampu pejalan kaki hijau.', 'Pakai helm saat naik motor atau sepeda!'] });
  vendor({ id: 'V09', nama: 'Kak Laras', peran: 'Petugas Bandara', zone: 'bandara', near: { x: 760, z: 92 }, ry: Math.PI, karakter: 19, stall: 'meja', stallColor: 0x1fb6d9, mission: 'navigasi', items: [], lines: ['Selamat datang di Bandara EDUVERSE! Pesawat parkir di apron.', 'Pilot memakai arah mata angin untuk menentukan arah terbang.'] }, );
  vendor({ id: 'V10', nama: 'Kak Bayu', peran: 'Pemandu Pusat Teknologi', zone: 'bisnis', near: { x: -830, z: 52 }, ry: Math.PI, karakter: 18, stall: 'meja', stallColor: 0x16a34a, mission: 'koding', items: [], lines: ['Komputer mengikuti perintah langkah demi langkah. Itulah algoritma!', 'Mau coba memprogram robot kecil?'] });
  vendor({ id: 'V11', nama: 'Tom', peran: 'Turis dari Luar Negeri', zone: 'alunalun', near: { x: 30, z: 26 }, ry: Math.PI, karakter: 12, stall: 'none', stallColor: 0, mission: 'inggris', items: [], lines: ['Hello! Can you help me? I am lost.', 'Thank you, friend! Terima kasih!'] });
  vendor({ id: 'V12', nama: 'Mbak Wati', peran: 'Penjaga Minimarket', zone: 'terminal', near: { x: -150, z: 70 }, ry: 0, karakter: 6, stall: 'kios', stallColor: 0xe74c3c, mission: 'kembalian', items: [{ nama: 'Roti', harga: 6000 }, { nama: 'Susu', harga: 7000 }, { nama: 'Biskuit', harga: 5000 }, { nama: 'Pasta Gigi', harga: 8000 }], lines: ['Selamat datang di Minimarket EDUVERSE!', 'Simpan struk belanja dan cek kembaliannya ya.'] });
  vendor({ id: 'V13', nama: 'Bu Ningsih', peran: 'Pemilik Warung Makan', zone: 'perumahan', near: { x: -400, z: 0 }, ry: 0, karakter: 5, stall: 'kios', stallColor: 0xffc93c, mission: 'jumlah', items: [{ nama: 'Nasi Pecel', harga: 8000 }, { nama: 'Tempe Goreng', harga: 1000 }, { nama: 'Teh Hangat', harga: 3000 }], lines: ['Warung Bu Ningsih buka dari pagi!', 'Hari ini ramai pembeli, bantu aku menghitung ya.'] });
  vendor({ id: 'V14', nama: 'Bu Endah', peran: 'Pemandu Museum', zone: 'museum', near: { x: 110, z: 160 }, ry: 0, karakter: 14, stall: 'none', stallColor: 0, mission: 'ipas', items: [], lines: ['Museum ini menyimpan fosil dan batuan dari zaman dulu.', 'Tahukah kamu bagian-bagian tumbuhan?'] });

  // Bangunan toko kecil bertanda di dekat beberapa pedagang (minimarket, restoran, warung)
  const shop = (near: Pt, label: string, wall: number, roof: number, facing: Facing) => {
    const p = findFree(near.x, near.z, 7.5, 70);
    b.building({ x: p.x, z: p.z, w: 11, d: 8, h: 3.9, facing, wall, roof, trim: roof, doorW: 3 });
    const ry = FACING_RY[facing];
    const fx = Math.sin(ry) * 4.25;
    const fz = Math.cos(ry) * 4.25;
    b.sign(p.x + fx * 1.02, 4.6, p.z + fz * 1.02, 7, 1.2, label, facing, roof, 0xffffff);
  };
  shop({ x: -165, z: 70 }, 'Minimarket', 0xffffff, 0xe74c3c, 'S');
  shop({ x: 60, z: 110 }, 'Restoran Nusantara', 0xfff3e0, 0xff8a3d, 'N');
  shop({ x: -420, z: 20 }, 'Warung Bu Ningsih', 0xfffbeb, 0xffc93c, 'E');
  shop({ x: -60, z: -150 }, 'Toko Kelontong', 0xe0f2fe, 0x3ba7ff, 'S');

  // ───────── lintasan lalu lintas (garis tengah jalan) ─────────
  const loops: TrafficLoop[] = [
    { id: 'ring-a', pts: [{ x: -R, z: -R }, { x: R, z: -R }, { x: R, z: R }, { x: -R, z: R }], kinds: ['mobil', 'mobil', 'motor', 'bus', 'mobil', 'sepeda'], count: 9 },
    { id: 'ring-b', pts: [{ x: -R, z: R }, { x: R, z: R }, { x: R, z: -R }, { x: -R, z: -R }], kinds: ['mobil', 'motor', 'mobil', 'motor'], count: 7 },
    { id: 'tengah', pts: [{ x: R, z: 0 }, { x: 360, z: 0 }, { x: 360, z: 390 }, { x: -360, z: 390 }, { x: -360, z: 0 }, { x: -R, z: 0 }, { x: -R, z: R }, { x: R, z: R }], kinds: ['mobil', 'motor', 'mobil', 'sepeda'], count: 9 },
    { id: 'utara', pts: [{ x: 0, z: -R }, { x: 0, z: -430 }], kinds: ['mobil', 'motor'], count: 3 },
    { id: 'selatan', pts: [{ x: 0, z: R }, { x: 0, z: 390 }], kinds: ['mobil', 'sepeda'], count: 2 },
    { id: 'bandara', pts: [{ x: 360, z: 0 }, { x: 700, z: 0 }, { x: 700, z: 150 }, { x: 900, z: 150 }, { x: 700, z: 150 }, { x: 700, z: 0 }], kinds: ['mobil', 'bus', 'mobil'], count: 4 },
    { id: 'bisnis', pts: [{ x: -360, z: 0 }, { x: -700, z: 0 }, { x: -700, z: -120 }, { x: -960, z: -120 }, { x: -960, z: 120 }, { x: -700, z: 120 }, { x: -700, z: 0 }], kinds: ['mobil', 'motor', 'mobil'], count: 5 },
  ];

  // ───────── jalur pejalan kaki (trotoar) & aktivitas taman ─────────
  const s = R - 8;
  const walks: WalkLoop[] = [
    { id: 'dalam-ring', pts: [{ x: -s, z: -s }, { x: s, z: -s }, { x: s, z: s }, { x: -s, z: s }], count: 22 },
    { id: 'luar-ring', pts: [{ x: -R - 8, z: R + 8 }, { x: R + 8, z: R + 8 }, { x: R + 8, z: -R - 8 }, { x: -R - 8, z: -R - 8 }], count: 14 },
    { id: 'alun', pts: [{ x: -44, z: -44 }, { x: 44, z: -44 }, { x: 44, z: 44 }, { x: -44, z: 44 }], count: 12 },
    { id: 'taman', pts: [{ x: 352, z: -400 }, { x: 352, z: 200 }, { x: 368, z: 200 }, { x: 368, z: -400 }], count: 10 },
    { id: 'selatan', pts: [{ x: -340, z: 382 }, { x: 340, z: 382 }, { x: 340, z: 398 }, { x: -340, z: 398 }], count: 10 },
    { id: 'bisnis', pts: [{ x: -708, z: -112 }, { x: -952, z: -112 }, { x: -952, z: 112 }, { x: -708, z: 112 }], count: 8 },
    { id: 'bandara', pts: [{ x: 692, z: 10 }, { x: 692, z: 158 }, { x: 830, z: 158 }, { x: 692, z: 158 }], count: 5 },
  ];
  const parkSpots: ParkSpot[] = [];
  const acts: ParkSpot['activity'][] = ['senam', 'duduk', 'ngobrol', 'main'];
  for (let i = 0; i < 18; i++) {
    const p = findFree(380 + rng.float(-150, 150), -100 + rng.float(-250, 250), 1, 30);
    parkSpots.push({ x: p.x, z: p.z, activity: acts[i % acts.length]! });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parkSpots.push({ x: Math.cos(a) * 26, z: Math.sin(a) * 26, activity: i % 2 ? 'ngobrol' : 'main' });
  }

  return {
    vehicles,
    jetpacks,
    rifts,
    vendors,
    loops,
    lights,
    walks,
    parkSpots,
    runway,
    airport: { x: AX, z: 30 },
    business: { x: BX, z: 0 },
    skyIsland: sky,
    gates,
  };
}

/** Titik keluar dari sebuah lubang dimensi (8 m di depan portal tujuan, agar kamera tidak berada di dalam pusaran). */
export const RIFT_EXIT_DIST = 8;
export function riftExit(r: Rift): { x: number; y: number; z: number; ry: number } {
  return { x: r.x + Math.sin(r.ry) * RIFT_EXIT_DIST, y: r.y + 0.3, z: r.z + Math.cos(r.ry) * RIFT_EXIT_DIST, ry: r.ry };
}
