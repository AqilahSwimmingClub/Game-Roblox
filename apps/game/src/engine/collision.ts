/**
 * Tabrakan dunia: semua penghalang berupa AABB (kotak sejajar sumbu) dari layout bersama.
 * Disimpan di grid spasial 8 m sehingga kueri di sekitar pemain murah walau dunia berisi ribuan kotak.
 */
import type { Box, Disc } from '@eduverse/shared';

export interface Aabb {
  id: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

export interface WaterRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  surface: number;
  bottom: number;
}

const CELL = 8;

export class CollisionWorld {
  private grid = new Map<number, Aabb[]>();
  readonly all: Aabb[] = [];
  readonly disabled = new Set<number>();
  water: WaterRect[] = [];

  private key(cx: number, cz: number) {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  add(a: Aabb) {
    this.all.push(a);
    const cx0 = Math.floor(a.x0 / CELL);
    const cx1 = Math.floor(a.x1 / CELL);
    const cz0 = Math.floor(a.z0 / CELL);
    const cz1 = Math.floor(a.z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = this.key(cx, cz);
        const list = this.grid.get(k);
        if (list) list.push(a);
        else this.grid.set(k, [a]);
      }
  }

  addBoxes(boxes: Box[]) {
    boxes.forEach((b, i) => {
      if (b.k !== 'solid' && b.k !== 'glass') return;
      this.add({ id: i, x0: b.x - b.sx / 2, x1: b.x + b.sx / 2, y0: b.y - b.sy / 2, y1: b.y + b.sy / 2, z0: b.z - b.sz / 2, z1: b.z + b.sz / 2 });
    });
  }

  addDiscs(discs: Disc[]) {
    for (const d of discs) {
      if (d.k !== 'solid') continue;
      if (d.axis === 'y') this.add({ id: -1, x0: d.x - d.r * 0.85, x1: d.x + d.r * 0.85, y0: d.y - d.h / 2, y1: d.y + d.h / 2, z0: d.z - d.r * 0.85, z1: d.z + d.r * 0.85 });
    }
  }

  /** Kotak di sekitar persegi (x0..x1, z0..z1). Hasil bisa berisi duplikat; pemanggil menandai. */
  query(x0: number, x1: number, z0: number, z1: number, out: Aabb[]): Aabb[] {
    out.length = 0;
    const cx0 = Math.floor(x0 / CELL);
    const cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL);
    const cz1 = Math.floor(z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const a of list) if (!out.includes(a) && !this.disabled.has(a.id)) out.push(a);
      }
    return out;
  }

  waterAt(x: number, z: number): WaterRect | null {
    for (const w of this.water) if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1) return w;
    return null;
  }

  /** Apakah titik berada di dalam kotak padat (dipakai kamera agar tidak menembus dinding). */
  pointBlocked(x: number, y: number, z: number, scratch: Aabb[]): boolean {
    for (const a of this.query(x - 0.2, x + 0.2, z - 0.2, z + 0.2, scratch)) {
      if (x > a.x0 - 0.15 && x < a.x1 + 0.15 && y > a.y0 - 0.15 && y < a.y1 + 0.15 && z > a.z0 - 0.15 && z < a.z1 + 0.15) return true;
    }
    return false;
  }
}

/** Fisika karakter kapsul sederhana vs AABB: langkah tangga, gravitasi, lompat, renang. */
export interface BodyState {
  x: number;
  y: number; // kaki
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  swimming: boolean;
  submerged: number; // 0..1
}

export const BODY = {
  radius: 0.38,
  height: 1.75,
  step: 0.42,
  gravity: 26,
  jump: 9.2,
  walk: 4.5,
  run: 7.5,
  swim: 3.2,
};

const scratch: Aabb[] = [];

export function stepBody(world: CollisionWorld, b: BodyState, wishX: number, wishZ: number, speed: number, wantJump: boolean, wantDive: boolean, dt: number, lowGravity = false) {
  const water = world.waterAt(b.x, b.z);
  const g = lowGravity ? BODY.gravity * 0.35 : BODY.gravity;
  b.swimming = !!water && b.y < water.surface - 0.6;
  b.submerged = water ? Math.max(0, Math.min(1, (water.surface - b.y) / BODY.height)) : 0;

  // Kecepatan horizontal (percepatan halus)
  const accel = b.grounded || b.swimming ? 14 : 5;
  const targetVx = wishX * (b.swimming ? BODY.swim : speed);
  const targetVz = wishZ * (b.swimming ? BODY.swim : speed);
  const k = Math.min(1, accel * dt);
  b.vx += (targetVx - b.vx) * k;
  b.vz += (targetVz - b.vz) * k;

  if (b.swimming && water) {
    // Mengapung ke permukaan; tombol selam menahan di bawah, tombol lompat naik
    const surfaceFeet = water.surface - 1.25;
    let targetVy = (surfaceFeet - b.y) * 2.2;
    if (wantDive) targetVy = -2.6;
    if (wantJump) targetVy = 3.4;
    b.vy += (targetVy - b.vy) * Math.min(1, 4 * dt);
    if (b.y < water.bottom + 0.1 && b.vy < 0) b.vy = 0;
  } else {
    b.vy -= g * dt;
    if (wantJump && b.grounded) {
      b.vy = BODY.jump * (lowGravity ? 1.15 : 1);
      b.grounded = false;
    }
  }

  // Sub-langkah agar tidak menembus dinding tipis saat cepat
  const dist = Math.hypot(b.vx * dt, b.vz * dt, b.vy * dt);
  const steps = Math.max(1, Math.ceil(dist / 0.3));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    moveHorizontal(world, b, b.vx * h, b.vz * h);
    moveVertical(world, b, b.vy * h);
  }
}

function moveHorizontal(world: CollisionWorld, b: BodyState, dx: number, dz: number) {
  b.x += dx;
  b.z += dz;
  const r = BODY.radius;
  const list = world.query(b.x - r - 0.5, b.x + r + 0.5, b.z - r - 0.5, b.z + r + 0.5, scratch);
  for (let iter = 0; iter < 3; iter++) {
    let pushed = false;
    for (const a of list) {
      if (a.y1 <= b.y + BODY.step) continue; // bisa dilangkahi (tangga/trotoar)
      if (a.y0 >= b.y + BODY.height) continue; // di atas kepala
      const cx = Math.max(a.x0, Math.min(b.x, a.x1));
      const cz = Math.max(a.z0, Math.min(b.z, a.z1));
      let ox = b.x - cx;
      let oz = b.z - cz;
      const d2 = ox * ox + oz * oz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-8) {
        // pusat di dalam kotak: dorong ke sisi terdekat
        const left = b.x - a.x0;
        const right = a.x1 - b.x;
        const back = b.z - a.z0;
        const front = a.z1 - b.z;
        const m = Math.min(left, right, back, front);
        if (m === left) b.x = a.x0 - r;
        else if (m === right) b.x = a.x1 + r;
        else if (m === back) b.z = a.z0 - r;
        else b.z = a.z1 + r;
      } else {
        const d = Math.sqrt(d2);
        ox /= d;
        oz /= d;
        b.x = cx + ox * r;
        b.z = cz + oz * r;
        // hapus komponen kecepatan menuju dinding
        const vn = b.vx * ox + b.vz * oz;
        if (vn < 0) {
          b.vx -= vn * ox;
          b.vz -= vn * oz;
        }
      }
      pushed = true;
    }
    if (!pushed) break;
  }
}

function moveVertical(world: CollisionWorld, b: BodyState, dy: number) {
  const r = BODY.radius * 0.85;
  const list = world.query(b.x - r, b.x + r, b.z - r, b.z + r, scratch);
  const wasGrounded = b.grounded;
  // Tanah tertinggi di bawah kaki (dalam jangkauan langkah)
  let ground = -Infinity;
  let ceiling = Infinity;
  for (const a of list) {
    if (b.x + r <= a.x0 || b.x - r >= a.x1 || b.z + r <= a.z0 || b.z - r >= a.z1) continue;
    if (a.y1 <= b.y + BODY.step + 0.001 && a.y1 > ground) ground = a.y1;
    if (a.y0 >= b.y + BODY.height - 0.05 && a.y0 < ceiling) ceiling = a.y0;
  }
  let ny = b.y + dy;
  if (dy > 0 && ny + BODY.height > ceiling) {
    ny = ceiling - BODY.height;
    b.vy = 0;
  }
  // Mendarat / naik anak tangga; menempel ke tanah saat menuruni tangga (snap ≤ 0,5 m)
  const snap = wasGrounded && b.vy <= 0 && !b.swimming ? 0.5 : 0;
  if (ground > -Infinity && b.vy <= 0 && ny <= ground + snap) {
    ny = ground;
    b.vy = 0;
    b.grounded = true;
  } else {
    b.grounded = false;
  }
  b.y = ny;
}
