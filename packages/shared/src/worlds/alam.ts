/**
 * Dunia Hutan, Dunia Laut, dan Dunia Luar Angkasa: layout deterministik dengan format yang SAMA dengan Dunia Kota
 * (kotak AABB, titik soal, pedagang/NPC misi, stasiun jetpack, lubang dimensi, kendaraan), sehingga server
 * (penilaian, validasi gerak, soal guru) dan klien (render, tabrakan) memakai kode yang sama untuk keempat dunia.
 */
import { Rng } from '../rng.js';
import { WorldBuilder, Transform } from '../kota/builder.js';
import type { KotaLayout, SpawnMarker, Zone } from '../kota/layout.js';
import { MISSION_SUBJECT, type LivingLayout, type Vendor, type VehicleKind, type Rift, type JetpackStation, type VehicleSpawn, type Pt } from '../kota/living.js';
import { items } from '../kota/shop.js';

type Obj = SpawnMarker['object'];

/** Perkakas bersama untuk membangun satu dunia alam. */
class AlamKit {
  readonly b = new WorldBuilder();
  readonly spawns: SpawnMarker[] = [];
  readonly vendors: Vendor[] = [];
  readonly vehicles: VehicleSpawn[] = [];
  readonly jetpacks: JetpackStation[] = [];
  readonly rifts: Rift[] = [];
  readonly water: KotaLayout['water'] = [];
  private sid = 0;
  private vid = 0;
  constructor(
    readonly prefix: string,
    readonly zones: Zone[],
    readonly rng: Rng,
  ) {}

  /** Titik soal biasa. */
  q(x: number, y: number, z: number, zone: string, object: Obj, o: { hidden?: boolean; difficulty?: SpawnMarker['difficulty']; subject?: string | null } = {}) {
    this.sid++;
    const zd = this.zones.find((zz) => zz.id === zone);
    this.spawns.push({
      id: `${this.prefix}${String(this.sid).padStart(3, '0')}`,
      x,
      y,
      z,
      zone,
      object,
      hidden: o.hidden ?? false,
      subject: o.subject !== undefined ? o.subject : (zd?.subject ?? null),
      difficulty: o.difficulty ?? (o.hidden ? 'sulit' : 'sedang'),
    });
  }

  /** Cari titik kosong di dekat (cx, cz). */
  free(cx: number, cz: number, r: number, maxR = 40): Pt {
    for (let rad = 0; rad <= maxR; rad += 2) {
      for (let a = 0; a < 12; a++) {
        const x = cx + Math.cos((a / 12) * Math.PI * 2) * rad;
        const z = cz + Math.sin((a / 12) * Math.PI * 2) * rad;
        if (this.b.isFree(x, z, r)) return { x, z };
        if (rad === 0) break;
      }
    }
    return { x: cx, z: cz };
  }

  /** Pedagang / NPC misi: titik soal misi selalu aktif (soal dari bank guru, dinilai server). */
  vendor(v: Omit<Vendor, 'x' | 'y' | 'z'> & { near: Pt; y?: number }) {
    const p = v.y !== undefined ? v.near : this.free(v.near.x, v.near.z, 2.4);
    const { near: _n, ...rest } = v;
    void _n;
    const out: Vendor = { ...rest, x: p.x, y: v.y ?? 0, z: p.z };
    this.b.occupy(p.x, p.z, 1.4, 1.4, 0.3);
    this.vendors.push(out);
    this.spawns.push({ id: out.id, x: out.x, y: out.y, z: out.z, zone: out.zone, object: 'npc', hidden: false, subject: MISSION_SUBJECT[out.mission], difficulty: 'sedang', always: true });
  }

  vehicle(kind: VehicleKind, x: number, z: number, heading: number, y = 0, color?: number) {
    this.vid++;
    const COLORS = [0xe74c3c, 0x3ba7ff, 0xffc93c, 0x2fbf71, 0x8b5cf6, 0xff8a3d, 0xf4f8ff];
    this.vehicles.push({ id: `${this.prefix}_${kind.toUpperCase()}${this.vid}`, kind, x, y, z, heading, color: color ?? COLORS[this.vid % COLORS.length]! });
  }

  station(id: string, label: string, x: number, z: number, y = 0) {
    const b = this.b;
    b.box(x, y + 0.08, z, 3, 0.16, 3, 0x1e2a4a, 'decor');
    b.box(x, y + 0.18, z, 2.2, 0.04, 2.2, 0x5cf2c8, 'neon');
    b.base(x - 1.3, y, z - 1.3, 0.25, 2.4, 0.25, 0xff8a3d, 'decor');
    b.sign(x - 1.3, y + 2.9, z - 1.2, 2.4, 0.9, 'JETPACK', 'S', 0xff8a3d, 0xffffff);
    b.occupy(x, z, 1.6, 1.6, 0.5);
    this.jetpacks.push({ id, label, x, y, z });
  }

  /** Lubang dimensi; `to` = '' berarti Gerbang Antardunia (pindah ke dunia lain). */
  rift(id: string, nama: string, x: number, z: number, ry: number, to: string, y = 0) {
    this.b.occupy(x, z, 3, 3, 1);
    this.rifts.push({ id, nama, x, y, z, ry, to });
  }

  /** Tanah datar berpetak (y atas = top). */
  ground(x0: number, x1: number, z0: number, z1: number, c: number, top = 0, thick = 2) {
    const step = 150;
    for (let x = x0; x < x1; x += step) {
      for (let z = z0; z < z1; z += step) {
        const xe = Math.min(x + step, x1);
        const ze = Math.min(z + step, z1);
        this.b.box((x + xe) / 2, top - thick / 2, (z + ze) / 2, xe - x, thick, ze - z, c);
      }
    }
  }

  /** Pagar batas dunia. */
  fence(H: number, c: number, h = 2) {
    for (const s of [-1, 1]) {
      this.b.box(0, h / 2, s * H, 2 * H, h, 0.6, c);
      this.b.box(s * H, h / 2, 0, 0.6, h, 2 * H, c);
    }
  }

  /** Lapak pedagang sederhana. */
  stall(x: number, z: number, c: number) {
    const b = this.b;
    b.base(x, 0, z + 1.6, 2.6, 1, 1, 0xc98a4b);
    b.base(x - 1.2, 0, z + 1.6, 0.15, 2.6, 0.15, 0x8b5a3c, 'decor');
    b.base(x + 1.2, 0, z + 1.6, 0.15, 2.6, 0.15, 0x8b5a3c, 'decor');
    b.box(x, 2.7, z + 1.6, 3, 0.2, 1.6, c, 'decor');
  }

  layout(spawnPoint: { x: number; y: number; z: number }, extra: Partial<KotaLayout> = {}): KotaLayout {
    const living: LivingLayout = {
      vehicles: this.vehicles,
      jetpacks: this.jetpacks,
      rifts: this.rifts,
      vendors: this.vendors,
      loops: [],
      lights: [],
      walks: [],
      parkSpots: [],
      runway: { x0: 0, x1: 0, z: 99999, w: 0 },
      airport: { x: 99999, z: 99999 },
      business: { x: 99999, z: 99999 },
      skyIsland: { x: 99999, y: 0, z: 99999 },
      gates: [],
    };
    return {
      boxes: this.b.boxes,
      discs: this.b.discs,
      signs: this.b.signs,
      trees: this.b.trees,
      lamps: this.b.lamps,
      spawns: this.spawns,
      halte: [],
      lifts: [],
      interactables: [],
      busLoop: [],
      busStops: [],
      spawnPoint,
      podium: { x: spawnPoint.x, z: spawnPoint.z - 10 },
      water: this.water,
      living,
      ...extra,
    };
  }
}

const zone = (id: string, nama: string, landmark: string, subject: string | null, color: number, x: number, z: number, hx: number, hz: number): Zone => ({
  id,
  nama,
  landmark,
  subject,
  color,
  rects: [{ x, z, hx, hz }],
  label: { x, z },
});

// ───────────────────────────────────────── DUNIA HUTAN ─────────────────────────────────────────

export const HUTAN_HALF = 300;
export const HUTAN_ZONES: Zone[] = [
  zone('perkemahan', 'Perkemahan Ranger', 'Tenda dan api unggun', null, 0xffc93c, 0, -235, 90, 60),
  zone('rimba', 'Hutan Hujan Tropis', 'Pohon raksasa berdaun lebat', 'IPAS', 0x2fbf71, -170, -50, 125, 125),
  zone('rumahpohon', 'Desa Rumah Pohon', 'Rumah di atas pohon dan jembatan gantung', 'Bahasa Indonesia', 0xc98a4b, 170, -50, 125, 125),
  zone('sungai', 'Sungai Jernih', 'Jembatan kayu', 'IPAS', 0x1fb6d9, 0, 125, 300, 25),
  zone('danau', 'Danau Teratai', 'Danau dengan bunga teratai', 'Matematika', 0x3ba7ff, -160, 225, 135, 70),
  zone('gua', 'Gua Kristal', 'Gua berkristal bercahaya', 'Matematika', 0x8b5cf6, 160, 225, 135, 70),
  zone('setapak', 'Jalan Setapak', 'Papan petunjuk arah', 'Pendidikan Pancasila', 0xd9a066, 0, -50, 40, 125),
];

let hutanCache: KotaLayout | null = null;
export function buildHutan(): KotaLayout {
  if (hutanCache) return hutanCache;
  const H = HUTAN_HALF;
  const k = new AlamKit('H', HUTAN_ZONES, new Rng(20261104));
  const { b, rng } = k;
  // Tanah + dasar sungai (z 112..138)
  k.ground(-H, H, -H, 112, 0x5aa04a);
  k.ground(-H, H, 138, H, 0x5aa04a);
  b.box(0, -3.5, 125, 2 * H, 1, 26, 0x8b6b4a);
  for (const s of [-1, 1]) b.box(0, -1.5, 125 + s * 13.5, 2 * H, 3, 1, 0x6b8f3a); // tebing sungai
  k.water.push({ x0: -H, x1: H, z0: 112, z1: 138, surface: -0.4, bottom: -3 });
  b.box(0, -0.35, 125, 2 * H, 0.1, 26, 0x5cc8e8, 'water');
  // Jembatan kayu (x = 0 dan x = ±160)
  for (const bx of [0, -160, 160]) {
    b.box(bx, 0.1, 125, 6, 0.3, 30, 0xb07a45);
    for (const s of [-1, 1]) b.box(bx + s * 3, 0.8, 125, 0.2, 1.2, 30, 0x8b5a3c);
    b.occupy(bx, 125, 4, 16, 0);
  }
  k.fence(H, 0x6b4a2c);
  // Jalan setapak tanah
  b.box(0, 0.02, -40, 8, 0.04, 2 * H - 40, 0xc9a06a, 'decor');
  b.box(0, 0.02, -50, 2 * H - 40, 0.04, 6, 0xc9a06a, 'decor');
  b.box(0, 0.02, 225, 2 * H - 40, 0.04, 6, 0xc9a06a, 'decor');
  b.occupy(0, -40, 5, H - 20, 0);
  b.occupy(0, -50, H - 20, 4, 0);
  b.occupy(0, 225, H - 20, 4, 0);

  // ── Perkemahan Ranger (spawn) ──
  b.sign(0, 4.2, -205, 9, 1.8, 'SELAMAT DATANG DI DUNIA HUTAN', 'S', 0x2fbf71, 0xffffff);
  b.base(-4.6, 0, -205, 0.4, 4, 0.4, 0x8b5a3c);
  b.base(4.6, 0, -205, 0.4, 4, 0.4, 0x8b5a3c);
  b.occupy(0, -205, 5, 1, 0);
  for (const [tx, tz, c] of [[-30, -250, 0xff8a3d], [-18, -262, 0x3ba7ff], [22, -255, 0x2fbf71], [34, -240, 0xe86fa8]] as const) {
    b.base(tx, 0, tz, 5, 2.6, 5, c);
    b.base(tx, 2.6, tz, 3.6, 0.8, 5.2, c, 'decor');
    b.box(tx, 1, tz - 2.52, 1.4, 2, 0.06, 0x1e2a4a, 'decor');
    b.occupy(tx, tz, 3, 3, 1);
  }
  b.disc(0, 0.2, -238, 1.6, 0.4, 'y', 0x8b8b8b, 'solid');
  b.base(0, 0.4, -238, 1, 1, 1, 0xff6b2c, 'neon');
  b.occupy(0, -238, 2, 2, 0.5);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.base(Math.cos(a) * 4.5, 0, -238 + Math.sin(a) * 4.5, 1.6, 0.45, 0.5, 0x8b5a3c);
  }

  // ── Desa Rumah Pohon: panggung tinggi 6 m, tangga, jembatan gantung ──
  const huts: Pt[] = [
    { x: 120, z: -110 },
    { x: 150, z: -40 },
    { x: 210, z: -90 },
    { x: 240, z: -10 },
    { x: 180, z: 40 },
  ];
  const DY = 6;
  huts.forEach((p, i) => {
    b.base(p.x, 0, p.z, 1.6, DY + 6, 1.6, 0x7a4e2d); // batang pohon raksasa
    b.box(p.x, DY - 0.2, p.z, 10, 0.4, 10, 0xb07a45); // lantai panggung
    for (const s of [-1, 1]) {
      b.box(p.x, DY + 0.5, p.z + s * 4.9, 10, 1, 0.2, 0x8b5a3c);
      b.box(p.x + s * 4.9, DY + 0.5, p.z + 1, 0.2, 1, 8, 0x8b5a3c);
    }
    // rumah kecil di atas panggung
    b.base(p.x + 2, DY, p.z + 2, 4, 2.6, 4, [0xffd6a5, 0xcdeac0, 0xbde0fe, 0xffc8dd, 0xfdffb6][i]!);
    b.base(p.x + 2, DY + 2.6, p.z + 2, 4.6, 0.5, 4.6, 0x6cc08b, 'decor');
    b.box(p.x + 2, DY + 2.95, p.z + 2, 0.1, 1.2, 0.1, 0x6cc08b, 'decor');
    b.trees.push({ x: p.x, y: DY + 4, z: p.z, s: 2.2 });
    // tangga dari tanah (sisi −Z) sampai lantai panggung
    const t = new Transform(b, p.x - 3, p.z, 'N');
    b.stairs(t, 0, 0, -5 - 9, 1.8, DY, 9, 0xb07a45);
    b.occupy(p.x, p.z - 5, 6, 10, 1);
    k.q(p.x - 2, DY + 0.1, p.z + 2, 'rumahpohon', i % 2 ? 'buku' : 'peti', { difficulty: i > 2 ? 'sulit' : 'sedang' });
  });
  // jembatan gantung antarpanggung (lantai dekor + pegangan)
  for (let i = 0; i < huts.length - 1; i++) {
    const a = huts[i]!;
    const c = huts[i + 1]!;
    const steps = Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 1.2);
    for (let s = 1; s < steps; s++) {
      const x = a.x + ((c.x - a.x) * s) / steps;
      const z = a.z + ((c.z - a.z) * s) / steps;
      b.box(x, DY - 0.15 - Math.sin((s / steps) * Math.PI) * 0.6, z, 2.2, 0.2, 2.2, 0xc98a4b);
    }
  }
  b.sign(130, 3.6, -122, 6, 1.4, 'DESA RUMAH POHON', 'S', 0xc98a4b, 0xffffff);

  // ── Gua Kristal ──
  {
    const cx = 170;
    const cz = 240;
    b.base(cx, 0, cz + 22, 46, 12, 4, 0x6b6b7a); // dinding belakang
    b.base(cx - 22, 0, cz, 4, 12, 48, 0x6b6b7a);
    b.base(cx + 22, 0, cz, 4, 12, 48, 0x6b6b7a);
    b.base(cx - 14, 0, cz - 22, 18, 12, 4, 0x6b6b7a);
    b.base(cx + 14, 0, cz - 22, 18, 12, 4, 0x6b6b7a);
    b.box(cx, 13, cz, 48, 2, 48, 0x5a5a68); // atap gua
    b.box(cx, 0.03, cz, 40, 0.06, 40, 0x3f3f4f, 'decor');
    b.sign(cx, 9, cz - 24.2, 8, 1.6, 'GUA KRISTAL', 'S', 0x8b5cf6, 0xffffff);
    const cols = [0x8b5cf6, 0x5cf2c8, 0x3ba7ff, 0xe86fa8];
    for (let i = 0; i < 26; i++) {
      const x = cx + rng.float(-17, 17);
      const z = cz + rng.float(-17, 19);
      if (Math.abs(x - cx) < 4 && z < cz - 10) continue;
      const h = rng.float(1, 3.6);
      b.base(x, 0, z, rng.float(0.5, 1.1), h, rng.float(0.5, 1.1), cols[i % cols.length]!, 'neon');
    }
    b.occupy(cx, cz, 24, 24, 0);
    k.q(cx - 10, 0, cz + 12, 'gua', 'kristal', { hidden: true });
    k.q(cx + 10, 0, cz + 14, 'gua', 'kristal', { hidden: true });
    k.q(cx, 0, cz + 4, 'gua', 'kristal');
  }

  // ── Danau Teratai ──
  {
    const cx = -165;
    const cz = 240;
    b.box(cx, -3.5, cz, 90, 1, 50, 0x6b5a3c);
    k.water.push({ x0: cx - 45, x1: cx + 45, z0: cz - 25, z1: cz + 25, surface: -0.4, bottom: -3 });
    b.box(cx, -0.35, cz, 90, 0.1, 50, 0x4fb8d6, 'water');
    // tanah di sekitar danau dipotong: ganti dengan tepi
    for (let i = 0; i < 22; i++) b.disc(cx + rng.float(-40, 40), -0.25, cz + rng.float(-20, 20), rng.float(0.6, 1.3), 0.08, 'y', i % 4 ? 0x2fbf71 : 0xffa8d0, 'decor');
    b.occupy(cx, cz, 46, 26, 1);
    b.box(cx + 45, 0.1, cz, 14, 0.3, 4, 0xb07a45); // dermaga kecil
    b.sign(cx + 52, 2.6, cz - 3, 5, 1.2, 'DANAU TERATAI', 'S', 0x3ba7ff, 0xffffff);
  }

  // ── Hewan (dekorasi tanpa tabrakan) ──
  const animal = (x: number, z: number, c: number, s = 1) => {
    b.box(x, 0.9 * s, z, 0.7 * s, 0.7 * s, 1.5 * s, c, 'decor');
    b.box(x, 1.45 * s, z + 0.85 * s, 0.45 * s, 0.5 * s, 0.6 * s, c, 'decor');
    for (const dx of [-0.25, 0.25]) for (const dz of [-0.55, 0.55]) b.box(x + dx * s, 0.3 * s, z + dz * s, 0.15 * s, 0.6 * s, 0.15 * s, 0x5a3a20, 'decor');
  };
  for (let i = 0; i < 14; i++) animal(rng.float(-260, 260), rng.float(-180, 90), i % 3 ? 0xb07a45 : 0x8b8b8b, rng.float(0.8, 1.3));

  // ── Pohon (rimba lebat, sisi lain lebih jarang) ──
  for (let i = 0; i < 900; i++) {
    const x = rng.float(-H + 6, H - 6);
    const z = rng.float(-H + 6, H - 6);
    if (z > 108 && z < 142) continue;
    const dense = x < -40;
    if (!dense && !rng.chance(0.45)) continue;
    if (!b.isFree(x, z, 1.5)) continue;
    const s = dense ? rng.float(1.2, 2.4) : rng.float(0.9, 1.6);
    b.tree(x, z, s);
    b.occupy(x, z, 0.6, 0.6, 1);
  }

  // ── Titik soal di semua zona ──
  const scatter = (zid: string, n: number, objs: Obj[]) => {
    const zd = HUTAN_ZONES.find((zz) => zz.id === zid)!.rects[0]!;
    let placed = 0;
    for (let tries = 0; placed < n && tries < 400; tries++) {
      const x = zd.x + rng.float(-zd.hx + 6, zd.hx - 6);
      const z = zd.z + rng.float(-zd.hz + 6, zd.hz - 6);
      if (!b.isFree(x, z, 1.2) || (z > 108 && z < 142)) continue;
      k.q(x, 0, z, zid, objs[placed % objs.length]!, { difficulty: placed % 3 === 2 ? 'sulit' : placed % 3 ? 'sedang' : 'mudah' });
      b.occupy(x, z, 0.8, 0.8, 0.5);
      placed++;
    }
  };
  scatter('rimba', 12, ['peti', 'batu', 'buku', 'botol']);
  scatter('rumahpohon', 6, ['papan', 'peti']);
  scatter('danau', 5, ['botol', 'batu']);
  scatter('gua', 4, ['batu', 'kristal']);
  scatter('setapak', 5, ['papan', 'buku']);
  scatter('perkemahan', 3, ['peti', 'buku']);
  for (const x of [-120, -60, 60, 120]) k.q(x, 0.25, 125, 'sungai', 'botol', { hidden: x % 120 === 0 }); // terapung di sungai

  // ── Pedagang & NPC misi ──
  k.stall(-14, -222, 0x2fbf71);
  k.vendor({ id: 'VH01', nama: 'Ranger Dewi', peran: 'Penjaga Hutan', zone: 'perkemahan', near: { x: -14, z: -224 }, ry: 0, karakter: 3, stall: 'pos', stallColor: 0x2fbf71, mission: 'ipas', items: items('air-mineral', 'pisang', 'atlas-indonesia'), lines: ['Selamat datang, penjelajah! Jaga kebersihan hutan ya.', 'Hutan adalah rumah bagi banyak hewan dan tumbuhan.'] });
  k.vendor({ id: 'VH02', nama: 'Pak Tani Lebah', peran: 'Petani Hutan', zone: 'setapak', near: { x: 16, z: -120 }, ry: Math.PI, karakter: 9, stall: 'gerobak', stallColor: 0xffc93c, mission: 'jumlah', items: items('jagung-rebus', 'ubi-kukus', 'pisang', 'teh-hangat'), lines: ['Lebah membantu bunga menjadi buah.', 'Hasil kebun hari ini melimpah!'] });
  k.vendor({ id: 'VH03', nama: 'Kak Lia', peran: 'Peneliti Tumbuhan', zone: 'rimba', near: { x: -110, z: -60 }, ry: 0, karakter: 14, stall: 'meja', stallColor: 0x3ba7ff, mission: 'bacaan', items: items('komik-sains', 'buku-cerita', 'kamus-kecil'), lines: ['Tumbuhan membuat makanannya sendiri lewat fotosintesis.', 'Mau membaca tentang hutan Indonesia?'] });
  k.vendor({ id: 'VH04', nama: 'Mbah Wiryo', peran: 'Penjaga Gua', zone: 'gua', near: { x: 140, z: 205 }, ry: 0, karakter: 18, stall: 'none', stallColor: 0x8b5cf6, mission: 'navigasi', items: items('telur-rebus', 'mangga', 'air-mineral'), lines: ['Kristal di gua ini terbentuk ribuan tahun.', 'Hati-hati, di dalam gua agak gelap.'] });
  k.vendor({ id: 'VH05', nama: 'Bu Ratna', peran: 'Penjaga Danau', zone: 'danau', near: { x: -110, z: 200 }, ry: 0, karakter: 7, stall: 'kios', stallColor: 0x1fb6d9, mission: 'pecahan', items: items('es-jeruk', 'jus-alpukat', 'salad-buah'), lines: ['Ikan di danau butuh air yang bersih.', 'Bantu aku membagi bekal ikan, yuk!'] });
  k.vendor({ id: 'VH06', nama: 'Raka Pramuka', peran: 'Pemandu Desa Pohon', zone: 'rumahpohon', near: { x: 147, z: -43 }, y: DY, ry: 0, karakter: 1, stall: 'none', stallColor: 0xc98a4b, mission: 'pancasila', items: items('roti', 'susu-kotak'), lines: ['Di desa kami, semua warga saling membantu.', 'Gotong royong membuat pekerjaan ringan!'] });

  // ── Kendaraan, jetpack, lubang dimensi ──
  for (let i = 0; i < 3; i++) k.vehicle('sepeda', 40 + i * 3.4, -225, Math.PI);
  k.vehicle('motor', 52, -225, Math.PI);
  k.vehicle('motor', 55.5, -225, Math.PI);
  b.box(47, 0.04, -225, 22, 0.06, 7, 0x8b7355, 'decor');
  b.occupy(47, -225, 11, 4, 1);
  k.station('JH_KEMAH', 'Perkemahan', 20, -200);
  k.station('JH_POHON', 'Desa Rumah Pohon', 120, -110, DY);
  k.station('JH_DANAU', 'Danau Teratai', -100, 180);
  k.rift('RH_DUNIA', 'Gerbang Antardunia', -26, -205, 0, '');
  k.rift('RH_KEMAH', 'Perkemahan', 26, -205, 0, 'RH_GUA');
  k.rift('RH_GUA', 'Gua Kristal', 160, 180, Math.PI, 'RH_KEMAH');
  k.rift('RH_RIMBA', 'Hutan Hujan', -170, -40, 0, 'RH_DANAU');
  k.rift('RH_DANAU', 'Danau Teratai', -230, 180, Math.PI, 'RH_RIMBA');

  hutanCache = k.layout({ x: 0, y: 0.2, z: -215 });
  return hutanCache;
}

// ───────────────────────────────────────── DUNIA LAUT ─────────────────────────────────────────

export const LAUT_HALF = 300;
export const LAUT_FLOOR = -14;
export const LAUT_ZONES: Zone[] = [
  zone('pelabuhan', 'Pulau Pelabuhan', 'Dermaga dan perahu warna-warni', null, 0xffc93c, 0, 0, 55, 55),
  zone('terumbu', 'Taman Terumbu Karang', 'Karang warna-warni di dasar laut', 'IPAS', 0xe86fa8, 130, 130, 70, 70),
  zone('mercusuar', 'Pulau Mercusuar', 'Mercusuar merah-putih', 'Matematika', 0xe74c3c, 180, -150, 45, 45),
  zone('penyu', 'Pulau Penyu', 'Pantai tempat penyu bertelur', 'IPAS', 0x2fbf71, -180, 150, 50, 50),
  zone('kapal', 'Bangkai Kapal Karam', 'Kapal kayu tua di dasar laut', 'Bahasa Indonesia', 0x8b5a3c, -130, -80, 50, 45),
  zone('palung', 'Palung Biru', 'Gua bawah laut', 'Matematika', 0x3ba7ff, 0, 220, 70, 50),
  zone('kelapa', 'Pulau Kelapa', 'Pohon kelapa melambai', 'Pendidikan Pancasila', 0x7fb548, -180, -190, 40, 40),
];

let lautCache: KotaLayout | null = null;
export function buildLaut(): KotaLayout {
  if (lautCache) return lautCache;
  const H = LAUT_HALF;
  const k = new AlamKit('L', LAUT_ZONES, new Rng(20261105));
  const { b, rng } = k;
  const F = LAUT_FLOOR;
  // Dasar laut berpasir + air di seluruh peta (permukaan y = 0)
  k.ground(-H, H, -H, H, 0xe8d6a0, F, 2);
  k.water.push({ x0: -H, x1: H, z0: -H, z1: H, surface: 0, bottom: F });
  // Permukaan air (dekor tipis) per petak besar agar tampil di semua chunk
  for (let x = -H; x < H; x += 150) for (let z = -H; z < H; z += 150) b.box(x + 75, 0.02, z + 75, 150, 0.04, 150, 0x37b6e6, 'water');
  // Dinding batas transparan berupa pelampung
  for (const s of [-1, 1]) {
    b.box(0, -6, s * H, 2 * H, 16, 0.6, 0x1e6f9f, 'glass');
    b.box(s * H, -6, 0, 0.6, 16, 2 * H, 0x1e6f9f, 'glass');
  }
  /** Pulau bertingkat: tepi berundak 0,4 m agar bisa naik dari air sambil berenang. */
  const island = (cx: number, cz: number, r: number, sand = 0xf3dfa2, grass = 0x7cc86b) => {
    const top = 1;
    const tiers = [-1.4, -1.0, -0.6, -0.2, 0.2, 0.6];
    tiers.forEach((ty, i) => {
      const rr = r + (tiers.length - i) * 1.6;
      b.box(cx, (F + ty) / 2, cz, rr * 2, ty - F, rr * 2, sand);
    });
    b.box(cx, (F + top) / 2, cz, r * 2, top - F, r * 2, sand);
    b.box(cx, top + 0.02, cz, r * 2 - 6, 0.04, r * 2 - 6, grass, 'decor');
    b.occupy(cx, cz, r + 10, r + 10, 0);
    return top;
  };
  const T = island(0, 0, 40);
  island(180, -150, 22);
  island(-180, 150, 26);
  island(-180, -190, 18);

  // ── Pulau Pelabuhan ──
  b.sign(0, T + 4, -22, 8, 1.6, 'SELAMAT DATANG DI DUNIA LAUT', 'S', 0x1fb6d9, 0xffffff);
  b.base(-4, T, -22, 0.4, 4, 0.4, 0xffffff);
  b.base(4, T, -22, 0.4, 4, 0.4, 0xffffff);
  // dermaga ke selatan (perahu)
  b.box(0, 0.6, -58, 6, 0.4, 24, 0xb07a45);
  for (const s of [-1, 1]) for (let z = -68; z <= -48; z += 5) b.base(s * 3, F, z, 0.4, -F + 1.2, 0.4, 0x8b5a3c, 'decor');
  // rumah nelayan
  for (const [hx, hz, c] of [[-22, 10, 0xffd6a5], [22, 12, 0xbde0fe], [-8, 26, 0xcaffbf]] as const) {
    b.base(hx, T, hz, 6, 3, 5, c);
    b.base(hx, T + 3, hz, 6.6, 0.5, 5.6, 0x1fb6d9, 'decor');
    b.box(hx, T + 1.1, hz - 2.52, 1.2, 2.2, 0.06, 0x8b5a3c, 'decor');
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.tree(Math.cos(a) * 32, Math.sin(a) * 32, 1.2, T);
  }
  // ── Mercusuar ──
  for (let i = 0; i < 8; i++) b.disc(180, T + 2 + i * 2, -150, 2.6 - i * 0.12, 2, 'y', i % 2 ? 0xffffff : 0xe74c3c, 'solid');
  b.disc(180, T + 18.4, -150, 1.6, 1.2, 'y', 0xffe066, 'neon');
  b.occupy(180, -150, 3, 3, 0);
  b.sign(180, T + 3, -146.8, 5, 1.1, 'MERCUSUAR', 'S', 0xe74c3c, 0xffffff);
  // ── Pulau Penyu: sarang telur (dekor) ──
  for (let i = 0; i < 8; i++) b.disc(-180 + rng.float(-14, 14), T + 0.1, 150 + rng.float(-14, 14), 0.9, 0.2, 'y', 0xf6efd8, 'decor');
  for (let i = 0; i < 4; i++) {
    const x = -165 + i * 6;
    b.box(x, T + 0.3, 172, 1.4, 0.5, 1.8, 0x3d8b4f, 'decor'); // penyu
    b.box(x, T + 0.4, 173.2, 0.5, 0.4, 0.6, 0x5aa86a, 'decor');
  }
  // ── Pulau Kelapa ──
  for (let i = 0; i < 9; i++) b.tree(-180 + rng.float(-12, 12), -190 + rng.float(-12, 12), 1.4, T);

  // ── Taman Terumbu Karang (bawah laut) ──
  const coral = [0xff6b6b, 0xffa94d, 0xe86fa8, 0x8b5cf6, 0x5cf2c8, 0xffe066];
  for (let i = 0; i < 160; i++) {
    const x = 130 + rng.float(-65, 65);
    const z = 130 + rng.float(-65, 65);
    const h = rng.float(0.8, 3.5);
    b.base(x, F, z, rng.float(0.6, 2), h, rng.float(0.6, 2), coral[i % coral.length]!, i % 5 ? 'decor' : 'solid');
    if (i % 3 === 0) b.disc(x, F + h + 0.2, z, rng.float(0.6, 1.4), 0.3, 'y', coral[(i + 2) % coral.length]!, 'decor');
  }
  // rumput laut di banyak tempat
  for (let i = 0; i < 220; i++) {
    const x = rng.float(-H + 10, H - 10);
    const z = rng.float(-H + 10, H - 10);
    if (Math.hypot(x, z) < 70) continue;
    b.base(x, F, z, 0.25, rng.float(2, 7), 0.25, 0x2f9e5b, 'decor');
  }
  // ikan (dekor melayang)
  for (let i = 0; i < 90; i++) {
    const x = rng.float(-H + 10, H - 10);
    const z = rng.float(-H + 10, H - 10);
    const y = rng.float(F + 2, -2);
    const c = coral[i % coral.length]!;
    b.box(x, y, z, 0.3, 0.35, 0.8, c, 'decor');
    b.box(x, y, z + 0.5, 0.06, 0.4, 0.3, c, 'decor');
  }
  // ── Bangkai Kapal Karam ──
  {
    const cx = -130;
    const cz = -80;
    const t = new Transform(b, cx, cz, 'E', F);
    t.box(0, 1.5, 0, 6, 3, 18, 0x7a4e2d);
    t.box(0, 3.4, -6, 5, 0.6, 5, 0x8b5a3c);
    t.box(0, 7, 0, 0.5, 9, 0.5, 0x5a3a20);
    t.box(0, 9, 0, 4, 3, 0.1, 0xf4f8ff, 'decor');
    t.box(0, 3.2, 4, 5.4, 0.3, 9, 0x9b6a3d);
    b.sign(cx, F + 5, cz - 3.4, 4, 1, 'KAPAL KARAM', 'S', 0x8b5a3c, 0xffffff);
  }
  // ── Palung Biru: gua bawah laut ──
  {
    const cx = 0;
    const cz = 225;
    b.base(cx - 12, F, cz, 4, 8, 22, 0x2c4f6b);
    b.base(cx + 12, F, cz, 4, 8, 22, 0x2c4f6b);
    b.base(cx, F, cz + 11, 28, 8, 4, 0x2c4f6b);
    b.box(cx, F + 9, cz, 28, 2, 26, 0x2c4f6b);
    for (let i = 0; i < 12; i++) b.base(cx + rng.float(-9, 9), F, cz + rng.float(-8, 8), 0.5, rng.float(0.6, 2), 0.5, 0x5cf2c8, 'neon');
  }

  // ── Titik soal ──
  // bawah laut: harus menyelam (oksigen terbatas) atau memakai kapal selam
  for (let i = 0; i < 10; i++) k.q(130 + rng.float(-55, 55), F, 130 + rng.float(-55, 55), 'terumbu', i % 2 ? 'kristal' : 'peti', { difficulty: i % 3 ? 'sedang' : 'mudah' });
  k.q(-130, F + 3.4, -86, 'kapal', 'peti', { hidden: true });
  for (let i = 0; i < 5; i++) k.q(-130 + rng.float(-35, 35), F, -80 + rng.float(-30, 30), 'kapal', i % 2 ? 'botol' : 'buku');
  for (let i = 0; i < 4; i++) k.q(rng.float(-8, 8), F, 222 + rng.float(-6, 6), 'palung', 'kristal', { hidden: i === 0 });
  // di pulau
  for (const [x, z, zid, o] of [
    [12, -10, 'pelabuhan', 'papan'],
    [-14, -12, 'pelabuhan', 'peti'],
    [26, 26, 'pelabuhan', 'buku'],
    [172, -140, 'mercusuar', 'papan'],
    [190, -160, 'mercusuar', 'peti'],
    [170, -162, 'mercusuar', 'buku'],
    [-170, 140, 'penyu', 'batu'],
    [-190, 160, 'penyu', 'peti'],
    [-176, 164, 'penyu', 'buku'],
    [-172, -182, 'kelapa', 'papan'],
    [-188, -196, 'kelapa', 'peti'],
  ] as const)
    k.q(x, T, z, zid, o);
  // terapung di permukaan (pakai perahu)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.q(Math.cos(a) * 110, -0.2, Math.sin(a) * 110, a < Math.PI ? 'terumbu' : 'kapal', 'botol');
  }

  // ── Pedagang & NPC misi ──
  k.stall(-14, 2, 0x1fb6d9);
  k.vendor({ id: 'VL01', nama: 'Pak Udin', peran: 'Nelayan', zone: 'pelabuhan', near: { x: -14, z: 0 }, y: T, ry: 0, karakter: 9, stall: 'kios', stallColor: 0x1fb6d9, mission: 'jumlah', items: items('nasi-pecel', 'tempe-goreng', 'teh-hangat', 'air-mineral'), lines: ['Nelayan menangkap ikan secukupnya saja.', 'Laut yang bersih membuat ikan sehat!'] });
  k.stall(14, 2, 0xffc93c);
  k.vendor({ id: 'VL02', nama: 'Bu Kelapa', peran: 'Penjual Es Kelapa', zone: 'pelabuhan', near: { x: 14, z: 0 }, y: T, ry: 0, karakter: 7, stall: 'gerobak', stallColor: 0xffc93c, mission: 'pecahan', items: items('es-jeruk', 'jus-alpukat', 'air-mineral', 'salad-buah'), lines: ['Segarnya es kelapa muda!', 'Satu kelapa dibagi empat, berapa bagian tiap orang?'] });
  k.vendor({ id: 'VL03', nama: 'Kak Rara', peran: 'Penyelam Peneliti', zone: 'pelabuhan', near: { x: 4, z: -40 }, y: T, ry: Math.PI, karakter: 14, stall: 'meja', stallColor: 0x3ba7ff, mission: 'ipas', items: items('komik-sains', 'atlas-indonesia'), lines: ['Terumbu karang adalah rumah ribuan ikan.', 'Saat menyelam, perhatikan oksigenmu!'] });
  k.vendor({ id: 'VL04', nama: 'Pak Bahar', peran: 'Penjaga Mercusuar', zone: 'mercusuar', near: { x: 186, z: -140 }, y: T, ry: 0, karakter: 18, stall: 'none', stallColor: 0xe74c3c, mission: 'navigasi', items: items('roti', 'teh-hangat'), lines: ['Cahaya mercusuar menuntun kapal di malam hari.', 'Kapal berlayar ke utara, lalu ke timur...'] });
  k.vendor({ id: 'VL05', nama: 'Dina', peran: 'Relawan Penyu', zone: 'penyu', near: { x: -186, z: 140 }, y: T, ry: 0, karakter: 4, stall: 'none', stallColor: 0x2fbf71, mission: 'bacaan', items: items('buku-cerita', 'air-mineral'), lines: ['Penyu bertelur di pantai berpasir.', 'Jangan buang sampah plastik ke laut ya!'] });

  // ── Kendaraan air, jetpack, lubang dimensi ──
  // perahu bersandar di kiri-kanan dermaga, kapal selam di ujung dermaga (semua terjangkau dari dermaga)
  for (const z of [-50, -58]) for (const x of [-5.6, 5.6]) k.vehicle('perahu', x, z, Math.PI, 0);
  k.vehicle('kapalselam', -6.6, -67, Math.PI, -1.2, 0xffc93c);
  k.vehicle('kapalselam', 6.6, -67, Math.PI, -1.2, 0xff8a3d);
  k.vehicle('perahu', 160, -128, Math.PI / 2, 0);
  k.vehicle('perahu', -158, 128, -Math.PI / 2, 0);
  k.station('JL_DERMAGA', 'Dermaga', 22, -26, T);
  k.station('JL_MERCU', 'Mercusuar', 170, -136, T);
  k.rift('RL_DUNIA', 'Gerbang Antardunia', -24, -24, 0, '', T);
  k.rift('RL_PELABUHAN', 'Pulau Pelabuhan', 24, -6, 0, 'RL_PENYU', T);
  k.rift('RL_PENYU', 'Pulau Penyu', -190, 140, 0, 'RL_PELABUHAN', T);
  k.rift('RL_MERCU', 'Pulau Mercusuar', 190, -140, Math.PI, 'RL_KELAPA', T);
  k.rift('RL_KELAPA', 'Pulau Kelapa', -186, -180, 0, 'RL_MERCU', T);

  lautCache = k.layout({ x: 0, y: T + 0.2, z: -14 });
  return lautCache;
}

// ───────────────────────────────────────── DUNIA LUAR ANGKASA ─────────────────────────────────────────

export const ANGKASA_HALF = 300;
export const ANGKASA_ZONES: Zone[] = [
  zone('stasiun', 'Stasiun Antariksa EDUVERSE', 'Kubah kaca dan antena', null, 0x3ba7ff, 0, -210, 80, 70),
  zone('kawah', 'Kawah Bulan', 'Kawah raksasa berdinding batu', 'Matematika', 0x9ca3af, -170, -40, 120, 110),
  zone('roket', 'Landasan Roket', 'Roket setinggi 40 m', 'Koding dan Kecerdasan Artifisial', 0xff8a3d, 170, -40, 120, 110),
  zone('asteroid', 'Sabuk Asteroid Melayang', 'Batu-batu melayang di langit', 'IPAS', 0x8b5cf6, 0, 120, 140, 70),
  zone('observatorium', 'Observatorium Bintang', 'Teleskop raksasa', 'IPAS', 0xffc93c, 0, 240, 100, 55),
  zone('meteor', 'Lembah Batu Meteor', 'Batu meteor berkilau', 'Bahasa Inggris', 0x5cf2c8, -200, 220, 95, 75),
  zone('planet', 'Taman Planet', 'Model planet tata surya', 'IPAS', 0xe86fa8, 200, 220, 95, 75),
];

let angkasaCache: KotaLayout | null = null;
export function buildAngkasa(): KotaLayout {
  if (angkasaCache) return angkasaCache;
  const H = ANGKASA_HALF;
  const k = new AlamKit('A', ANGKASA_ZONES, new Rng(20261106));
  const { b, rng } = k;
  k.ground(-H, H, -H, H, 0xb8bcc6);
  for (const s of [-1, 1]) {
    b.box(0, 3, s * H, 2 * H, 6, 0.6, 0x4b5563, 'glass');
    b.box(s * H, 3, 0, 0.6, 6, 2 * H, 0x4b5563, 'glass');
  }
  // bintik permukaan bulan
  for (let i = 0; i < 260; i++) b.disc(rng.float(-H + 5, H - 5), 0.02, rng.float(-H + 5, H - 5), rng.float(0.8, 4), 0.04, 'y', i % 2 ? 0x9ca3af : 0xd1d5db, 'decor');

  // ── Stasiun Antariksa (bisa dimasuki, 2 lantai + atap) ──
  const st = b.building({ x: 0, z: -235, facing: 'S', w: 30, d: 22, h: 10, floors: 2, wall: 0xe5e7eb, roof: 0x94a3b8, trim: 0x3ba7ff, glass: false, roofAccess: true });
  b.disc(0, 10.4, -235, 6, 0.6, 'y', 0x9fd4ff, 'glass');
  b.base(10, 10, -240, 0.3, 6, 0.3, 0x94a3b8, 'decor');
  b.disc(10, 16.4, -240, 1.6, 0.2, 'y', 0xffffff, 'decor');
  b.sign(0, 11.6, -223.4, 12, 1.6, 'STASIUN ANTARIKSA EDUVERSE', 'S', 0x1e3a8a, 0xffffff);
  b.sign(0, 4.2, -190, 9, 1.6, 'SELAMAT DATANG DI LUAR ANGKASA', 'S', 0x1e1b4b, 0xffffff);
  b.base(-4.6, 0, -190, 0.4, 4, 0.4, 0x94a3b8);
  b.base(4.6, 0, -190, 0.4, 4, 0.4, 0x94a3b8);
  b.occupy(0, -190, 5, 1, 0);
  // jalur bercahaya
  b.box(0, 0.03, -60, 6, 0.04, 260, 0x5cf2c8, 'neon');
  b.box(0, 0.03, -40, 400, 0.04, 4, 0x5cf2c8, 'neon');

  // ── Kawah Bulan: dinding melingkar dari kotak (bisa dilompati dengan gravitasi rendah) ──
  const crater = (cx: number, cz: number, r: number, hgt: number) => {
    const n = Math.ceil((Math.PI * 2 * r) / 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (i % 9 === 0) continue; // celah masuk
      b.base(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r, 4.2, hgt, 4.2, 0x8b919c);
    }
    b.disc(cx, 0.03, cz, r - 2, 0.04, 'y', 0x7b818c, 'decor');
    b.occupy(cx, cz, r + 3, r + 3, 0);
  };
  crater(-170, -40, 40, 3);
  crater(-110, 30, 16, 2);
  crater(-230, -110, 18, 2.2);

  // ── Landasan Roket ──
  {
    const cx = 170;
    const cz = -40;
    b.box(cx, 0.15, cz, 30, 0.3, 30, 0x4b5563);
    for (let i = 0; i < 6; i++) b.disc(cx, 0.3 + i * 6, cz, 3.2, 6, 'y', i % 2 ? 0xe5e7eb : 0xffffff, 'solid');
    b.disc(cx, 36.3, cz, 2.2, 3, 'y', 0xe74c3c, 'solid');
    b.disc(cx, 39.3, cz, 1.1, 2, 'y', 0xe74c3c, 'decor');
    for (const [dx, dz] of [[-4, 0], [4, 0], [0, -4], [0, 4]] as const) b.base(cx + dx, 0.3, cz + dz, 1, 6, 1, 0xe74c3c);
    // menara servis dengan tangga
    b.base(cx + 11, 0, cz, 3, 24, 3, 0x94a3b8, 'decor');
    const t = new Transform(b, cx + 16, cz, 'N');
    b.stairs(t, 0, 0, -10, 2, 6, 8, 0x94a3b8);
    b.box(cx + 16, 5.8, cz + 2, 6, 0.4, 8, 0x64748b);
    b.sign(cx, 3, cz - 16, 8, 1.4, 'LANDASAN ROKET', 'S', 0xff8a3d, 0xffffff);
    b.occupy(cx, cz, 20, 20, 0);
  }

  // ── Sabuk Asteroid: batu melayang bertingkat (lompat gravitasi rendah / jetpack) ──
  const rocks: { x: number; y: number; z: number }[] = [];
  {
    let x = -100;
    let y = 3;
    let z = 90;
    for (let i = 0; i < 22; i++) {
      const s = rng.float(4, 7);
      b.box(x, y - 0.6, z, s, 1.2, s, i % 3 ? 0x6b7280 : 0x8b5cf6);
      rocks.push({ x, y, z });
      x += rng.float(6, 9);
      z += rng.float(-6, 6);
      y = Math.min(32, y + rng.float(1.2, 3.2));
    }
  }
  // ── Observatorium Bintang melayang (y 32) ──
  const OY = 32;
  const last = rocks[rocks.length - 1]!;
  {
    const cx = last.x + 10;
    const cz = last.z;
    b.box(cx, OY - 0.5, cz, 22, 1, 22, 0x334155);
    for (const s of [-1, 1]) {
      b.box(cx, OY + 0.6, cz + s * 10.8, 22, 1.2, 0.3, 0x5cf2c8, 'glass');
      b.box(cx + s * 10.8, OY + 0.6, cz, 0.3, 1.2, 22, 0x5cf2c8, 'glass');
    }
    b.disc(cx, OY + 3, cz + 4, 2, 6, 'z', 0xf4f8ff, 'solid'); // teleskop
    b.sign(cx, OY + 4, cz - 10.6, 7, 1.3, 'OBSERVATORIUM BINTANG', 'S', 0xffc93c, 0x1e1b4b);
    k.q(cx - 6, OY, cz - 4, 'observatorium', 'buku');
    k.q(cx + 6, OY, cz - 4, 'observatorium', 'kristal', { hidden: true });
    k.q(cx, OY, cz + 8, 'observatorium', 'papan');
    k.vendor({ id: 'VA03', nama: 'Prof. Bintang', peran: 'Astronom', zone: 'observatorium', near: { x: cx - 4, z: cz + 4 }, y: OY, ry: 0, karakter: 18, stall: 'none', stallColor: 0xffc93c, mission: 'navigasi', items: items('atlas-indonesia', 'komik-sains'), lines: ['Bintang terdekat dari Bumi adalah Matahari!', 'Rasi bintang membantu pelaut menentukan arah.'] });
    k.rift('RA_OBS', 'Observatorium Bintang', cx + 6, cz + 6, Math.PI, 'RA_STASIUN', OY);
  }
  rocks.forEach((r, i) => {
    if (i % 4 === 2) k.q(r.x, r.y, r.z, 'asteroid', i % 8 === 2 ? 'kristal' : 'batu', { difficulty: r.y > 18 ? 'sulit' : 'sedang' });
  });

  // ── Taman Planet: model planet (lingkaran bertumpuk) ──
  const planet = (cx: number, cz: number, r: number, c: number, ring?: number) => {
    const y0 = r + 1;
    for (let i = -3; i <= 3; i++) {
      const rr = Math.sqrt(Math.max(0.01, 1 - (i / 3.5) ** 2)) * r;
      b.disc(cx, y0 + (i * r) / 3.5, cz, rr, r / 3.5 + 0.05, 'y', c, i === -3 ? 'solid' : 'decor');
    }
    if (ring) b.disc(cx, y0, cz, r * 1.8, 0.15, 'y', ring, 'decor');
    b.base(cx, 0, cz, 0.6, 1.2, 0.6, 0x94a3b8);
    b.occupy(cx, cz, r * 1.8, r * 1.8, 1);
  };
  const ps: [string, number, number, number, number?][] = [
    ['MERKURIUS', 1.2, 0x9ca3af, 0],
    ['VENUS', 1.8, 0xf2c38b, 0],
    ['BUMI', 2, 0x3ba7ff, 0],
    ['MARS', 1.5, 0xe0663b, 0],
    ['JUPITER', 4.5, 0xd9a066, 0],
    ['SATURNUS', 3.8, 0xf2dc9b, 0xe5d3a1],
    ['URANUS', 2.8, 0x9ee6e6, 0],
    ['NEPTUNUS', 2.7, 0x4169e1, 0],
  ];
  ps.forEach(([nama, r, c, ring], i) => {
    const x = 130 + (i % 4) * 34;
    const z = 185 + Math.floor(i / 4) * 50;
    planet(x, z, r, c, ring || undefined);
    b.sign(x, 0.9, z - r * 1.8 - 1, 4, 0.8, nama, 'S', 0x1e1b4b, 0xffffff);
    if (i % 2 === 0) k.q(x + r * 2 + 2, 0, z, 'planet', 'papan');
  });
  b.disc(110, 6, 210, 5, 0.8, 'y', 0xffd23f, 'neon'); // matahari mini

  // ── Lembah Batu Meteor ──
  for (let i = 0; i < 40; i++) {
    const x = -200 + rng.float(-85, 85);
    const z = 220 + rng.float(-65, 65);
    if (!b.isFree(x, z, 2)) continue;
    const s = rng.float(1.2, 4);
    b.base(x, 0, z, s, s * 0.8, s, i % 4 ? 0x4b5563 : 0x5cf2c8, i % 4 ? 'solid' : 'neon');
    b.occupy(x, z, s / 2, s / 2, 0.5);
  }

  // ── Titik soal permukaan ──
  const scatter = (zid: string, n: number, objs: Obj[]) => {
    const zd = ANGKASA_ZONES.find((zz) => zz.id === zid)!.rects[0]!;
    let placed = 0;
    for (let tries = 0; placed < n && tries < 400; tries++) {
      const x = zd.x + rng.float(-zd.hx + 6, zd.hx - 6);
      const z = zd.z + rng.float(-zd.hz + 6, zd.hz - 6);
      if (!b.isFree(x, z, 1.2)) continue;
      k.q(x, 0, z, zid, objs[placed % objs.length]!, { difficulty: placed % 3 === 2 ? 'sulit' : placed % 3 ? 'sedang' : 'mudah' });
      b.occupy(x, z, 0.8, 0.8, 0.5);
      placed++;
    }
  };
  scatter('stasiun', 4, ['peti', 'buku']);
  scatter('roket', 6, ['papan', 'peti', 'kristal']);
  scatter('meteor', 6, ['batu', 'kristal']);
  scatter('planet', 2, ['buku']);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    k.q(-170 + Math.cos(a) * 20, 0, -40 + Math.sin(a) * 20, 'kawah', i % 2 ? 'batu' : 'kristal', { hidden: i === 3 });
  }
  st.floorY.forEach((fy, i) => {
    const p = st.t.world((st.free.x0 + st.free.x1) / 2 + (i ? 3 : -3), fy, (st.free.z0 + st.free.z1) / 2);
    k.q(p.x, p.y, p.z, 'stasiun', i ? 'kristal' : 'buku');
  });

  // ── NPC misi ──
  k.vendor({ id: 'VA01', nama: 'Astronot Sari', peran: 'Komandan Stasiun', zone: 'stasiun', near: { x: -14, z: -195 }, ry: 0, karakter: 0, stall: 'pos', stallColor: 0x3ba7ff, mission: 'ipas', items: items('air-mineral', 'roti', 'biskuit'), lines: ['Di Bulan, gravitasi hanya seperenam Bumi!', 'Astronot minum air yang didaur ulang.'] });
  k.vendor({ id: 'VA02', nama: 'Robot Kiko', peran: 'Robot Mekanik', zone: 'roket', near: { x: 140, z: -60 }, ry: 0, karakter: 12, stall: 'meja', stallColor: 0xff8a3d, mission: 'koding', items: items('pensil', 'penggaris', 'buku-tulis'), lines: ['Bip-bup! Urutan perintah harus tepat.', 'Program roket dimulai dari hitungan mundur!'] });
  k.vendor({ id: 'VA04', nama: 'Kak Nadia', peran: 'Teknisi Rover', zone: 'kawah', near: { x: -110, z: -110 }, ry: 0, karakter: 14, stall: 'kios', stallColor: 0x9ca3af, mission: 'jumlah', items: items('susu-kotak', 'jus-alpukat', 'biskuit'), lines: ['Rover bulan memakai energi matahari.', 'Bantu aku menghitung baterai rover, yuk!'] });
  k.vendor({ id: 'VA05', nama: 'Lintang', peran: 'Pemandu Planet', zone: 'planet', near: { x: 120, z: 160 }, ry: 0, karakter: 5, stall: 'none', stallColor: 0xe86fa8, mission: 'bacaan', items: items('buku-cerita', 'kamus-kecil'), lines: ['Ada delapan planet di tata surya kita.', 'Planet terbesar adalah Jupiter!'] });
  k.vendor({ id: 'VA06', nama: 'Mr. Leo', peran: 'Astronaut from Abroad', zone: 'meteor', near: { x: -170, z: 170 }, ry: 0, karakter: 11, stall: 'none', stallColor: 0x5cf2c8, mission: 'inggris', items: items('teh-hangat', 'roti'), lines: ['Hello! Welcome to the Moon.', 'Can you say "bintang" in English? Star!'] });

  // ── Penjelajah Bulan (rover), jetpack, lubang dimensi ──
  for (let i = 0; i < 4; i++) k.vehicle('mobil', 30 + i * 4.5, -190, Math.PI, 0, [0xf4f8ff, 0xffc93c, 0x3ba7ff, 0xff8a3d][i]);
  b.box(37, 0.04, -190, 22, 0.06, 8, 0x64748b, 'decor');
  b.sign(26, 2.6, -185.5, 5, 1, 'PENJELAJAH BULAN', 'S', 0x1e1b4b, 0xffffff);
  b.occupy(37, -190, 11, 4, 1);
  k.station('JA_STASIUN', 'Stasiun Antariksa', -26, -190);
  k.station('JA_ASTEROID', 'Sabuk Asteroid', -110, 80);
  k.station('JA_ROKET', 'Landasan Roket', 140, -10);
  k.station('JA_METEOR', 'Lembah Meteor', -200, 160);
  k.rift('RA_DUNIA', 'Gerbang Antardunia', -40, -175, 0, '');
  k.rift('RA_STASIUN', 'Stasiun Antariksa', 20, -170, 0, 'RA_OBS');
  k.rift('RA_KAWAH', 'Kawah Bulan', -200, -40, 0, 'RA_ROKET');
  k.rift('RA_ROKET', 'Landasan Roket', 140, -40, 0, 'RA_KAWAH');

  angkasaCache = k.layout({ x: 0, y: 0.2, z: -180 });
  return angkasaCache;
}
