/**
 * Lobi utama 3D (dokumen layar 5): pulau plaza 90 × 90 m dengan air mancur, balon,
 * empat gerbang portal dunia, papan pengumuman guru, maskot Edo, dan area latihan lompat.
 */
import { WorldBuilder, Transform, type Box, type Disc, type Sign, type Tree } from './kota/builder.js';
import type { WorldId } from './worlds.js';
import { WORLD_COLORS, hexToInt } from './palette.js';

export interface PortalDef {
  world: WorldId;
  x: number;
  z: number;
  color: number;
}

export interface LobbyLayout {
  boxes: Box[];
  discs: Disc[];
  signs: Sign[];
  trees: Tree[];
  portals: PortalDef[];
  spawnPoint: { x: number; y: number; z: number };
  edo: { x: number; z: number };
  half: number;
}

let cached: LobbyLayout | null = null;

export function buildLobby(): LobbyLayout {
  if (cached) return cached;
  const b = new WorldBuilder();
  const HALF = 45;
  b.box(0, -1, 0, HALF * 2, 2, HALF * 2, 0x7ccb6b);
  b.box(0, 0.03, 0, 58, 0.06, 58, 0xf1e6d2, 'decor');
  b.box(0, 0.07, 0, 36, 0.02, 36, 0xffe7a8, 'decor');
  b.box(0, -6, 0, HALF * 2 - 4, 8, HALF * 2 - 4, 0xb98b5e, 'decor');
  b.box(0, -13, 0, HALF * 2 - 20, 8, HALF * 2 - 20, 0x9c7148, 'decor');
  // Pagar keliling
  for (const s of [-1, 1]) {
    b.box(0, 0.7, s * (HALF - 0.3), HALF * 2, 1.4, 0.4, 0xffffff);
    b.box(s * (HALF - 0.3), 0.7, 0, 0.4, 1.4, HALF * 2, 0xffffff);
  }
  // Air mancur
  b.disc(0, 0.4, 0, 5, 0.8, 'y', 0xdce6f5, 'solid');
  b.disc(0, 0.85, 0, 4.5, 0.12, 'y', 0x5cc8ff, 'decor');
  b.disc(0, 1.6, 0, 0.8, 3.2, 'y', 0xdce6f5, 'solid');
  b.disc(0, 3.2, 0, 2.1, 0.4, 'y', 0xdce6f5, 'decor');
  // Balon
  const balloon = [0x3ba7ff, 0xffc93c, 0x2fbf71, 0xff8a3d, 0x8b5cf6, 0xe86fa8];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.26;
    const x = Math.cos(a) * 15;
    const z = Math.sin(a) * 15;
    b.box(x, 1.8, z, 0.05, 3.6, 0.05, 0xffffff, 'decor');
    b.disc(x, 4.2, z, 0.7, 1.4, 'y', balloon[i % balloon.length] as number, 'decor');
  }
  // Portal di empat diagonal, menghadap pusat
  const order: WorldId[] = ['kota', 'hutan', 'laut', 'angkasa'];
  const pos: [number, number][] = [
    [-21, -21],
    [21, -21],
    [-21, 21],
    [21, 21],
  ];
  const portals: PortalDef[] = order.map((w, i) => {
    const [x, z] = pos[i] as [number, number];
    const color = hexToInt(WORLD_COLORS[w]);
    b.disc(x, 0.15, z, 4.5, 0.3, 'y', color, 'decor');
    // Lengkung gerbang sejajar sumbu X (lubang gerbang menghadap utara-selatan)
    b.box(x - 3.6, 3.6, z, 1.2, 7.2, 1.2, color);
    b.box(x + 3.6, 3.6, z, 1.2, 7.2, 1.2, color);
    b.box(x, 7.8, z, 9, 1.2, 1.5, color);
    b.box(x, 9.2, z, 1.6, 1.6, 0.3, 0xffc93c, 'neon');
    return { world: w, x, z, color };
  });
  // Papan guru (utara, menghadap selatan)
  b.sign(0, 3.2, -33, 12, 4.2, 'PAPAN GURU', 'S', 0xf4f8ff, 0x1e2a4a);
  b.base(-5.6, 0, -33.2, 0.45, 3, 0.45, 0x1e2a4a);
  b.base(5.6, 0, -33.2, 0.45, 3, 0.45, 0x1e2a4a);
  // Latihan lompat (timur)
  const steps = [0x3ba7ff, 0x2fbf71, 0xffc93c, 0xff8a3d, 0x8b5cf6];
  steps.forEach((c, i) => b.base(33 + (i % 2) * 2.4, 0, -9 + i * 3.3, 2.4, 0.6 + (i + 1) * 0.55, 2.4, c));
  b.sign(29.5, 2, -12.5, 5, 2.1, 'Coba lompat!', 'W', 0xf4f8ff, 0x1e2a4a);
  b.sign(-29.5, 2, 9, 6, 2.1, 'Jelajahi lobi!', 'E', 0xf4f8ff, 0x1e2a4a);
  // Bangku & pohon
  const t = new Transform(b, 0, 0, 'N');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.bench(t, Math.cos(a) * 25, Math.sin(a) * 25);
    b.tree(Math.cos(a) * 38, Math.sin(a) * 38, 1.1);
  }
  cached = {
    boxes: b.boxes,
    discs: b.discs,
    signs: b.signs,
    trees: b.trees,
    portals,
    spawnPoint: { x: 0, y: 0.2, z: 12 },
    edo: { x: 5, z: 14 },
    half: HALF,
  };
  return cached;
}

/** Arena podium kemenangan (dokumen layar 13). Juara 1 tengah, 2 kiri, 3 kanan (dilihat penonton). */
export interface PodiumLayout {
  boxes: Box[];
  discs: Disc[];
  signs: Sign[];
  slots: { rank: number; x: number; y: number; z: number }[];
  camera: { x: number; y: number; z: number; tx: number; ty: number; tz: number };
  audience: { x: number; z: number };
}

export function buildPodium(): PodiumLayout {
  const b = new WorldBuilder();
  b.box(0, -0.5, 0, 80, 1, 80, 0x7ccb6b);
  b.box(0, 0.4, -6, 24, 0.8, 10, 0xf4f8ff);
  b.box(0, 4, -11.5, 24, 8, 0.6, 0x3ba7ff);
  b.sign(0, 6.6, -11.1, 16, 2, 'JUARA EDUVERSE', 'S', 0xffc93c, 0x1e2a4a);
  // Penonton menghadap utara (−Z): kiri = −X, kanan = +X
  const defs = [
    { rank: 1, x: 0, h: 2.8, c: 0xffc93c },
    { rank: 2, x: -4.4, h: 1.9, c: 0xc9d3e0 },
    { rank: 3, x: 4.4, h: 1.3, c: 0xd98c4a },
  ];
  const slots = defs.map((d) => {
    b.base(d.x, 0.8, -6, 3.6, d.h, 3.6, d.c);
    b.sign(d.x, 0.8 + d.h / 2, -4.15, 1.6, 1.4, String(d.rank), 'S', d.c, 0x1e2a4a);
    return { rank: d.rank, x: d.x, y: 0.8 + d.h, z: -6 };
  });
  for (let i = 0; i < 8; i++) b.disc(-14 + i * 4, 0.05, 6, 1.2, 0.1, 'y', [0x3ba7ff, 0xffc93c, 0x2fbf71, 0xff8a3d][i % 4] as number, 'decor');
  return {
    boxes: b.boxes,
    discs: b.discs,
    signs: b.signs,
    slots,
    camera: { x: 0, y: 4.2, z: 9, tx: 0, ty: 2.8, tz: -6 },
    audience: { x: 0, z: 6 },
  };
}
