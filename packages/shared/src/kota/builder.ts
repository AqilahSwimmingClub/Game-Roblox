/**
 * Primitif dunia EDUVERSE. Semua kotak sejajar sumbu (AABB) sehingga tabrakan di klien
 * sederhana dan cepat. Satuan: meter. Y = 0 adalah permukaan tanah.
 */
export type BoxKind = 'solid' | 'decor' | 'glass' | 'water' | 'neon';

export interface Box {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  c: number; // warna 0xRRGGBB
  k: BoxKind;
}

export interface Disc {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  axis: 'x' | 'y' | 'z';
  c: number;
  k: BoxKind;
}

export interface Sign {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  text: string;
  facing: Facing;
  bg: number;
  fg: number;
}

export interface Tree {
  x: number;
  y: number;
  z: number;
  s: number;
}

export interface Lamp {
  x: number;
  z: number;
}

export type Facing = 'N' | 'S' | 'E' | 'W'; // arah pintu menghadap (N = −Z)

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export class WorldBuilder {
  boxes: Box[] = [];
  discs: Disc[] = [];
  signs: Sign[] = [];
  trees: Tree[] = [];
  lamps: Lamp[] = [];
  occupied: Rect[] = [];

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number, k: BoxKind = 'solid'): Box {
    const b = { x, y, z, sx, sy, sz, c, k };
    this.boxes.push(b);
    return b;
  }

  /** Kotak dengan titik dasar (tengah-bawah). */
  base(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number, k: BoxKind = 'solid'): Box {
    return this.box(x, y + sy / 2, z, sx, sy, sz, c, k);
  }

  disc(x: number, y: number, z: number, r: number, h: number, axis: 'x' | 'y' | 'z', c: number, k: BoxKind = 'decor') {
    this.discs.push({ x, y, z, r, h, axis, c, k });
  }

  sign(x: number, y: number, z: number, w: number, h: number, text: string, facing: Facing, bg = 0xf4f8ff, fg = 0x1e2a4a) {
    this.signs.push({ x, y, z, w, h, text, facing, bg, fg });
  }

  occupy(cx: number, cz: number, hx: number, hz: number, margin = 1.5) {
    this.occupied.push({ x0: cx - hx - margin, x1: cx + hx + margin, z0: cz - hz - margin, z1: cz + hz + margin });
  }

  isFree(x: number, z: number, r = 0): boolean {
    for (const o of this.occupied) {
      if (x + r >= o.x0 && x - r <= o.x1 && z + r >= o.z0 && z - r <= o.z1) return false;
    }
    return true;
  }

  tree(x: number, z: number, s = 1, y = 0) {
    this.trees.push({ x, y, z, s });
    // Batang sebagai penghalang (daun tidak bertabrakan)
    this.base(x, y, z, 0.6 * s, 2.6 * s, 0.6 * s, 0x8b5a3c);
  }

  /** Tangga lurus naik ke arah +Z lokal dari (lx, ly, lz). */
  stairs(t: Transform, lx: number, ly: number, lz: number, width: number, rise: number, run: number, c: number) {
    const steps = Math.max(1, Math.round(rise / 0.25));
    const sr = rise / steps;
    const sl = run / steps;
    for (let i = 1; i <= steps; i++) {
      const h = sr * i;
      t.box(lx, ly + h / 2, lz + (i - 0.5) * sl, width, h, sl, c);
    }
  }

  /** Pelat dengan satu lubang persegi (koordinat lokal transform). */
  slabWithHole(t: Transform, ly: number, w: number, d: number, thick: number, hole: Rect | null, c: number, k: BoxKind = 'solid') {
    const piece = (x0: number, x1: number, z0: number, z1: number) => {
      if (x1 - x0 < 0.02 || z1 - z0 < 0.02) return;
      t.box((x0 + x1) / 2, ly - thick / 2, (z0 + z1) / 2, x1 - x0, thick, z1 - z0, c, k);
    };
    const hw = w / 2;
    const hd = d / 2;
    if (!hole) {
      piece(-hw, hw, -hd, hd);
      return;
    }
    piece(-hw, hole.x0, -hd, hd);
    piece(hole.x1, hw, -hd, hd);
    piece(hole.x0, hole.x1, -hd, hole.z0);
    piece(hole.x0, hole.x1, hole.z1, hd);
  }

  /**
   * Gedung berinterior: dinding dengan bukaan pintu di sisi depan (−Z lokal), beberapa lantai,
   * tangga bergantian kiri/kanan, pita jendela, atap datar (opsional akses atap dengan pagar).
   */
  building(o: BuildingOpts): BuildingInfo {
    const t = new Transform(this, o.x, o.z, o.facing, o.y ?? 0);
    const floors = o.floors ?? 1;
    const W = o.w;
    const D = o.d;
    const H = o.h;
    const fh = H / floors;
    const wt = 0.3;
    const wallK: BoxKind = o.glass ? 'glass' : 'solid';
    const doorW = o.doorW ?? 2.6;
    const doorH = Math.min(2.7, fh - 0.4);
    const floorC = o.floorColor ?? 0xece1cd;
    const trim = o.trim ?? 0xffffff;

    t.box(0, H / 2, D / 2 - wt / 2, W, H, wt, o.wall, wallK); // belakang
    t.box(-W / 2 + wt / 2, H / 2, 0, wt, H, D, o.wall, wallK); // kiri
    t.box(W / 2 - wt / 2, H / 2, 0, wt, H, D, o.wall, wallK); // kanan
    const side = (W - doorW) / 2;
    t.box(-W / 2 + side / 2, H / 2, -D / 2 + wt / 2, side, H, wt, o.wall, wallK);
    t.box(W / 2 - side / 2, H / 2, -D / 2 + wt / 2, side, H, wt, o.wall, wallK);
    t.box(0, doorH + (H - doorH) / 2, -D / 2 + wt / 2, doorW, H - doorH, wt, o.wall, wallK);
    t.box(0, doorH + 0.15, -D / 2 - 0.05, doorW + 0.6, 0.3, wt + 0.2, trim, 'decor');
    t.box(0, 0.06, 0, W - 2 * wt, 0.12, D - 2 * wt, floorC);

    const stairW = 1.4;
    const runLen = Math.min(D - 2 * wt - 2, fh * 1.25);
    const floorY: number[] = [0.12];
    const levels = floors - 1 + (o.roofAccess ? 1 : 0);
    for (let f = 1; f <= levels; f++) {
      const y = f * fh;
      const s = f % 2 === 1 ? 1 : -1;
      const sx = s * (W / 2 - wt - stairW / 2 - 0.05);
      const z0 = -D / 2 + wt + 1.2;
      const startY = (f - 1) * fh + (f === 1 ? 0.12 : 0);
      this.stairs(t, sx, startY, z0, stairW, fh - (f === 1 ? 0.12 : 0), runLen, 0xcdbea5);
      const hole: Rect = { x0: sx - stairW / 2 - 0.1, x1: sx + stairW / 2 + 0.1, z0: z0 - 0.1, z1: z0 + runLen + 0.15 };
      const isRoof = f === floors;
      this.slabWithHole(t, y, W - 2 * wt + 0.02, D - 2 * wt + 0.02, 0.25, hole, isRoof ? (o.roof ?? trim) : floorC);
      if (!isRoof) floorY.push(y);
      // Pagar di sisi dalam lubang tangga
      t.box(s > 0 ? hole.x0 : hole.x1, y + 0.5, (hole.z0 + hole.z1) / 2 + 0.6, 0.1, 1, hole.z1 - hole.z0 - 1.2, trim);
    }
    if (o.roofAccess) {
      for (const s of [-1, 1]) {
        t.box(0, H + 0.5, s * (D / 2 - 0.12), W, 1, 0.24, trim);
        t.box(s * (W / 2 - 0.12), H + 0.5, 0, 0.24, 1, D, trim);
      }
    } else {
      t.box(0, H + 0.15, 0, W + 0.4, 0.3, D + 0.4, o.roof ?? trim);
    }
    if (o.windows !== false) {
      for (let f = 1; f <= floors; f++) {
        const wy = (f - 1) * fh + fh * 0.58;
        const wh = Math.min(1.4, fh * 0.35);
        t.box(0, wy, D / 2 + 0.04, W * 0.8, wh, 0.06, 0xbfe6ff, 'decor');
        t.box(-W / 2 - 0.04, wy, 0, 0.06, wh, D * 0.7, 0xbfe6ff, 'decor');
        t.box(W / 2 + 0.04, wy, 0, 0.06, wh, D * 0.7, 0xbfe6ff, 'decor');
      }
    }
    const r = Math.max(W, D) / 2;
    this.occupy(o.x, o.z, r, r, 2);
    return {
      t,
      floorY,
      roofY: H,
      free: { x0: -W / 2 + wt + stairW + 0.6, x1: W / 2 - wt - stairW - 0.6, z0: -D / 2 + wt + 1.6, z1: D / 2 - wt - 0.8 },
    };
  }

  /** Gedung kota biasa (tidak bisa dimasuki). */
  cityBlock(x: number, z: number, w: number, d: number, h: number, c: number, roof: number) {
    this.base(x, 0, z, w, h, d, c);
    this.base(x, h, z, w + 0.4, 0.4, d + 0.4, roof, 'decor');
    const bands = Math.min(4, Math.max(1, Math.floor(h / 4)));
    for (let i = 1; i <= bands; i++) {
      const y = (i * h) / (bands + 1);
      this.box(x, y, z, w + 0.12, 1, d + 0.12, 0x9fd4ff, 'decor');
    }
    this.occupy(x, z, w / 2, d / 2, 1.2);
  }

  /** Rumah dekoratif kecil berpintu (atap limas bertingkat sederhana). */
  house(x: number, z: number, facing: Facing, wall: number, roof: number) {
    const t = new Transform(this, x, z, facing);
    t.box(0, 1.5, 0, 5, 3, 4.2, wall);
    t.box(0, 3.2, 0, 5.6, 0.4, 4.8, roof);
    t.box(0, 3.7, 0, 4.2, 0.6, 3.4, roof);
    t.box(0, 4.2, 0, 2.6, 0.4, 2, roof);
    t.box(0, 1.1, -2.12, 1.2, 2.2, 0.06, 0x8b5a3c, 'decor');
    t.box(-1.5, 1.7, -2.12, 1, 1, 0.06, 0xbfe6ff, 'decor');
    t.box(1.5, 1.7, -2.12, 1, 1, 0.06, 0xbfe6ff, 'decor');
    this.occupy(x, z, 3, 3, 1);
  }

  bench(t: Transform, lx: number, lz: number) {
    t.box(lx, 0.5, lz, 1.8, 0.15, 0.6, 0xc98a4b);
    t.box(lx, 0.85, lz + 0.27, 1.8, 0.55, 0.12, 0xc98a4b, 'decor');
    t.box(lx - 0.8, 0.22, lz, 0.12, 0.44, 0.5, 0x4a5670, 'decor');
    t.box(lx + 0.8, 0.22, lz, 0.12, 0.44, 0.5, 0x4a5670, 'decor');
  }
}

export interface BuildingOpts {
  x: number;
  z: number;
  y?: number; // ketinggian dasar (mis. di puncak bukit)
  w: number; // lebar (X lokal)
  d: number; // kedalaman (Z lokal)
  h: number;
  facing: Facing;
  floors?: number;
  wall: number;
  floorColor?: number;
  roof?: number;
  trim?: number;
  glass?: boolean;
  doorW?: number;
  roofAccess?: boolean;
  windows?: boolean;
}

export interface BuildingInfo {
  t: Transform;
  floorY: number[];
  roofY: number;
  free: Rect;
}

/** Transformasi lokal → dunia untuk rotasi 0/90/180/270 derajat (tetap AABB). */
export class Transform {
  constructor(
    private b: WorldBuilder,
    public cx: number,
    public cz: number,
    public facing: Facing,
    public baseY = 0,
  ) {}

  point(lx: number, lz: number): { x: number; z: number } {
    switch (this.facing) {
      case 'N':
        return { x: this.cx + lx, z: this.cz + lz };
      case 'S':
        return { x: this.cx - lx, z: this.cz - lz };
      case 'E':
        return { x: this.cx - lz, z: this.cz + lx };
      case 'W':
        return { x: this.cx + lz, z: this.cz - lx };
    }
  }

  size(sx: number, sz: number): { sx: number; sz: number } {
    return this.facing === 'E' || this.facing === 'W' ? { sx: sz, sz: sx } : { sx, sz };
  }

  box(lx: number, y: number, lz: number, sx: number, sy: number, sz: number, c: number, k: BoxKind = 'solid'): Box {
    const p = this.point(lx, lz);
    const s = this.size(sx, sz);
    return this.b.box(p.x, y + this.baseY, p.z, s.sx, sy, s.sz, c, k);
  }

  world(lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
    const p = this.point(lx, lz);
    return { x: p.x, y: ly + this.baseY, z: p.z };
  }
}
