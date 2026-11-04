/**
 * Lalu lintas & warga NPC — ringan untuk HP Android:
 * - Kendaraan NPC mengikuti lintasan jalan (lajur KIRI seperti di Indonesia), bukan bergerak acak.
 *   State machine per kendaraan: JALAN → REM_LAMPU (lampu merah/kuning) / REM_ANTRE (kendaraan di depan)
 *   / REM_PEJALAN (pemain di depan) → JALAN. Simulasi semua kendaraan murah (aritmetika saja);
 *   hanya yang dekat pemain dirender lewat InstancedMesh (beberapa draw call untuk semua mobil).
 * - Pejalan kaki NPC di trotoar: BERJALAN → MENUNGGU_SEBERANG (zebra cross, lampu) → BERHENTI (melihat toko)
 *   + warga taman dengan rutinitas (senam, duduk, mengobrol, bermain).
 * - Lampu lalu lintas memakai jam yang sama di semua perangkat (lightFor) sehingga warnanya seragam.
 * Kendaraan NPC kosmetik (tidak disinkronkan antarpemain), tetapi deterministik pada lintasan yang sama.
 */
import * as THREE from 'three';
import { lightFor, type LivingLayout, type Pt, type TrafficLoop } from '@eduverse/shared';

interface Seg {
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  s0: number;
  axis: 'x' | 'z';
}

interface Path {
  segs: Seg[];
  total: number;
  stops: { s: number; axis: 'x' | 'z' }[]; // garis berhenti sebelum simpang berlampu
}

/** Bangun lintasan lajur dari garis tengah jalan, digeser `off` meter ke KIRI arah jalan. */
function buildPath(pts: Pt[], off: number, lights: Pt[], stopBefore: number): Path {
  const segs: Seg[] = [];
  let s = 0;
  const raw: { a: Pt; b: Pt }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (Math.hypot(b.x - a.x, b.z - a.z) < 0.01) continue;
    raw.push({ a, b });
  }
  const shifted = raw.map(({ a, b }) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const lx = uz * off;
    const lz = -ux * off;
    return { a: { x: a.x + lx, z: a.z + lz }, b: { x: b.x + lx, z: b.z + lz }, ux, uz, len };
  });
  // potong/sambung sudut: tiap segmen dimulai di akhir segmen sebelumnya
  for (let i = 0; i < shifted.length; i++) {
    const cur = shifted[i]!;
    const prev = shifted[(i - 1 + shifted.length) % shifted.length]!;
    const start = prev.b;
    const end = cur.b;
    const len = Math.hypot(end.x - start.x, end.z - start.z);
    if (len < 0.01) continue;
    const ux = (end.x - start.x) / len;
    const uz = (end.z - start.z) / len;
    segs.push({ ax: start.x, az: start.z, ux, uz, len, s0: s, axis: Math.abs(ux) > Math.abs(uz) ? 'x' : 'z' });
    s += len;
  }
  const stops: Path['stops'] = [];
  for (const sg of segs) {
    for (const L of lights) {
      // jarak titik simpang ke garis segmen
      const t = (L.x - sg.ax) * sg.ux + (L.z - sg.az) * sg.uz;
      const perp = Math.abs((L.x - sg.ax) * sg.uz - (L.z - sg.az) * sg.ux);
      if (perp < 12 && t > stopBefore + 2 && t < sg.len + 8) stops.push({ s: sg.s0 + t - stopBefore, axis: sg.axis });
    }
  }
  stops.sort((a, b) => a.s - b.s);
  return { segs, total: s, stops };
}

function at(p: Path, s: number, out: { x: number; z: number; h: number; axis: 'x' | 'z' }) {
  s = ((s % p.total) + p.total) % p.total;
  let lo = 0;
  let hi = p.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.segs[mid]!.s0 <= s) lo = mid;
    else hi = mid - 1;
  }
  const sg = p.segs[lo]!;
  const t = s - sg.s0;
  out.x = sg.ax + sg.ux * t;
  out.z = sg.az + sg.uz * t;
  out.h = Math.atan2(sg.ux, sg.uz);
  out.axis = sg.axis;
  return out;
}

type CarState = 'JALAN' | 'REM_LAMPU' | 'REM_ANTRE' | 'REM_PEJALAN';
interface Car {
  path: number;
  s: number;
  speed: number;
  max: number;
  kind: 'mobil' | 'motor' | 'sepeda' | 'bus';
  color: THREE.Color;
  state: CarState;
  x: number;
  z: number;
  h: number;
  wheel: number;
}

type PedState = 'BERJALAN' | 'MENUNGGU_SEBERANG' | 'BERHENTI' | 'AKTIVITAS';
interface Ped {
  path: number; // −1 = warga taman (diam di tempat dengan aktivitas)
  s: number;
  dir: 1 | -1;
  speed: number;
  state: PedState;
  timer: number;
  x: number;
  z: number;
  h: number;
  phase: number;
  shirt: THREE.Color;
  pants: THREE.Color;
  skin: THREE.Color;
  activity: string;
}

const SHIRTS = [0xe74c3c, 0x3ba7ff, 0xffc93c, 0x2fbf71, 0x8b5cf6, 0xff8a3d, 0xf4f8ff, 0xe86fa8, 0x1fb6d9];
const PANTS = [0x1e2a4a, 0x334155, 0x7c5c3b, 0x475569, 0x1d4ed8];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const CAR_COLORS = [0xe74c3c, 0x3ba7ff, 0xffc93c, 0x2fbf71, 0xf4f8ff, 0x8b5cf6, 0xff8a3d, 0x94a3b8];

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v3 = new THREE.Vector3();
const sc = new THREE.Vector3(1, 1, 1);

/** InstancedMesh untuk satu bagian (badan mobil, roda, kepala pejalan, dst). */
function inst(geo: THREE.BufferGeometry, color: number, n: number, perInstanceColor: boolean) {
  const mat = new THREE.MeshLambertMaterial({ color: perInstanceColor ? 0xffffff : color });
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false; // posisi berubah tiap frame; jumlah kecil → lebih murah daripada hitung ulang bounding
  if (perInstanceColor) m.setColorAt(0, new THREE.Color(color));
  return m;
}

function setPart(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, h: number, lx: number, ly: number, lz: number, rx = 0) {
  // posisi lokal (lx,ly,lz) diputar heading h
  const c = Math.cos(h);
  const s = Math.sin(h);
  v3.set(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
  e.set(rx, h, 0, 'YXZ');
  q.setFromEuler(e);
  m4.compose(v3, q, sc);
  m.setMatrixAt(i, m4);
}

export class TrafficSystem {
  readonly root = new THREE.Group();
  private paths: Path[] = [];
  private loops: TrafficLoop[] = [];
  private cars: Car[] = [];
  private peds: Ped[] = [];
  private walkPaths: Path[] = [];
  private lightPts: Pt[];
  // instanced parts
  private carBody: THREE.InstancedMesh;
  private carCabin: THREE.InstancedMesh;
  private carWheel: THREE.InstancedMesh;
  private busBody: THREE.InstancedMesh;
  private bikeBody: THREE.InstancedMesh;
  private riderBody: THREE.InstancedMesh;
  private riderHead: THREE.InstancedMesh;
  private pedBody: THREE.InstancedMesh;
  private pedHead: THREE.InstancedMesh;
  private pedLegL: THREE.InstancedMesh;
  private pedLegR: THREE.InstancedMesh;
  private pedArmL: THREE.InstancedMesh;
  private pedArmR: THREE.InstancedMesh;
  private lightLamps: { mesh: THREE.Mesh; axis: 'x' | 'z'; color: 'merah' | 'kuning' | 'hijau' }[] = [];
  private lampOn: Record<string, THREE.MeshBasicMaterial>;
  private lampOff = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
  /** Jumlah kendaraan & pejalan yang dirender (diatur kualitas grafis). */
  maxCars = 18;
  maxPeds = 30;
  radius = 170;
  private tmp = { x: 0, z: 0, h: 0, axis: 'x' as 'x' | 'z' };
  /** Halangan dinamis (pemain lokal & kendaraannya) agar NPC mengerem. */
  obstacles: { x: number; z: number; r: number }[] = [];
  /** Statistik untuk uji otomatis & debug. */
  stats = { cars: 0, peds: 0, carsVisible: 0, pedsVisible: 0, stoppedAtLight: 0, states: {} as Record<string, number> };

  constructor(scene: THREE.Scene, private L: LivingLayout) {
    scene.add(this.root);
    this.lightPts = L.lights.map((l) => ({ x: l.x, z: l.z }));
    const r = rand(42);
    this.loops = L.loops;
    for (const loop of L.loops) {
      const p = buildPath(loop.pts, 3, this.lightPts, 11);
      this.paths.push(p);
      const pi = this.paths.length - 1;
      for (let i = 0; i < loop.count; i++) {
        const kind = loop.kinds[i % loop.kinds.length]!;
        const max = kind === 'bus' ? 9 : kind === 'sepeda' ? 5 : kind === 'motor' ? 12 : 11 + r() * 3;
        this.cars.push({ path: pi, s: (i / loop.count) * p.total + r() * 5, speed: max * 0.6, max, kind, color: new THREE.Color(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]!), state: 'JALAN', x: 0, z: 0, h: 0, wheel: 0 });
      }
    }
    for (const w of L.walks) {
      const p = buildPath(w.pts, 0, this.lightPts, 9);
      this.walkPaths.push(p);
      const pi = this.walkPaths.length - 1;
      for (let i = 0; i < w.count; i++) this.peds.push(this.newPed(r, pi, (i / w.count) * p.total + r() * 4));
    }
    for (const sp of L.parkSpots) {
      const ped = this.newPed(r, -1, 0);
      ped.state = 'AKTIVITAS';
      ped.x = sp.x;
      ped.z = sp.z;
      ped.h = r() * Math.PI * 2;
      ped.activity = sp.activity;
      this.peds.push(ped);
    }
    const nC = this.cars.length;
    const nP = this.peds.length;
    this.carBody = inst(new THREE.BoxGeometry(1.9, 0.8, 4), 0xffffff, nC, true);
    this.carCabin = inst(new THREE.BoxGeometry(1.7, 0.7, 2.1), 0xbfe6ff, nC, false);
    this.carWheel = inst(new THREE.BoxGeometry(2.1, 0.62, 0.62), 0x1e2a4a, nC * 2, false);
    this.busBody = inst(new THREE.BoxGeometry(2.6, 2.6, 9), 0xff8a3d, nC, true);
    this.bikeBody = inst(new THREE.BoxGeometry(0.35, 0.7, 1.8), 0xffffff, nC, true);
    this.riderBody = inst(new THREE.BoxGeometry(0.6, 0.75, 0.35), 0xffffff, nC, true);
    this.riderHead = inst(new THREE.BoxGeometry(0.45, 0.45, 0.45), 0xffc93c, nC, false); // helm
    const legGeo = new THREE.BoxGeometry(0.22, 0.75, 0.24).translate(0, -0.37, 0);
    const armGeo = new THREE.BoxGeometry(0.18, 0.66, 0.2).translate(0, -0.3, 0);
    this.pedBody = inst(new THREE.BoxGeometry(0.62, 0.72, 0.34), 0xffffff, nP, true);
    this.pedHead = inst(new THREE.BoxGeometry(0.46, 0.46, 0.44), 0xffffff, nP, true);
    this.pedLegL = inst(legGeo, 0xffffff, nP, true);
    this.pedLegR = inst(legGeo, 0xffffff, nP, true);
    this.pedArmL = inst(armGeo, 0xffffff, nP, true);
    this.pedArmR = inst(armGeo, 0xffffff, nP, true);
    for (const m of [this.carBody, this.carCabin, this.carWheel, this.busBody, this.bikeBody, this.riderBody, this.riderHead, this.pedBody, this.pedHead, this.pedLegL, this.pedLegR, this.pedArmL, this.pedArmR]) this.root.add(m);
    this.lampOn = {
      merah: new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
      kuning: new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
      hijau: new THREE.MeshBasicMaterial({ color: 0x34d399 }),
    };
    this.buildLights();
    this.stats.cars = nC;
    this.stats.peds = nP;
  }

  private newPed(r: () => number, path: number, s: number): Ped {
    return {
      path,
      s,
      dir: r() < 0.5 ? 1 : -1,
      speed: 1.1 + r() * 0.6,
      state: 'BERJALAN',
      timer: 4 + r() * 20,
      x: 0,
      z: 0,
      h: 0,
      phase: r() * 6,
      shirt: new THREE.Color(SHIRTS[Math.floor(r() * SHIRTS.length)]!),
      pants: new THREE.Color(PANTS[Math.floor(r() * PANTS.length)]!),
      skin: new THREE.Color(SKINS[Math.floor(r() * SKINS.length)]!),
      activity: '',
    };
  }

  /** Tiang + kepala lampu di keempat sudut tiap simpang berlampu. */
  private buildLights() {
    const pole = new THREE.BoxGeometry(0.25, 4.2, 0.25);
    const box = new THREE.BoxGeometry(0.5, 1.4, 0.4);
    const lamp = new THREE.BoxGeometry(0.32, 0.32, 0.1);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    for (const l of this.L.lights) {
      // kepala lampu menghadap kendaraan yang datang dari ±x dan ±z
      const heads: { x: number; z: number; ry: number; axis: 'x' | 'z' }[] = [
        { x: l.x + 7.5, z: l.z + 7.5, ry: 0, axis: 'z' }, // menghadap +Z (kendaraan dari selatan menuju utara)
        { x: l.x - 7.5, z: l.z - 7.5, ry: Math.PI, axis: 'z' },
        { x: l.x - 7.5, z: l.z + 7.5, ry: -Math.PI / 2, axis: 'x' },
        { x: l.x + 7.5, z: l.z - 7.5, ry: Math.PI / 2, axis: 'x' },
      ];
      for (const hd of heads) {
        const g = new THREE.Group();
        g.position.set(hd.x, 0, hd.z);
        g.rotation.y = hd.ry;
        const p = new THREE.Mesh(pole, poleMat);
        p.position.y = 2.1;
        g.add(p);
        const b = new THREE.Mesh(box, poleMat);
        b.position.set(0, 4.6, 0);
        g.add(b);
        (['merah', 'kuning', 'hijau'] as const).forEach((c, i) => {
          const m = new THREE.Mesh(lamp, this.lampOff);
          m.position.set(0, 5.05 - i * 0.44, 0.22);
          g.add(m);
          this.lightLamps.push({ mesh: m, axis: hd.axis, color: c });
        });
        this.root.add(g);
      }
    }
  }

  setQuality(level: 'rendah' | 'sedang' | 'tinggi') {
    this.maxCars = level === 'rendah' ? 10 : level === 'sedang' ? 18 : 30;
    this.maxPeds = level === 'rendah' ? 16 : level === 'sedang' ? 30 : 50;
    this.radius = level === 'rendah' ? 120 : level === 'sedang' ? 170 : 240;
  }

  update(dt: number, px: number, pz: number, nowSec: number) {
    // ── lampu lalu lintas ──
    const lx = lightFor('x', nowSec);
    const lz = lightFor('z', nowSec);
    for (const l of this.lightLamps) {
      const cur = l.axis === 'x' ? lx : lz;
      const mat = cur === l.color ? this.lampOn[l.color]! : this.lampOff;
      if (l.mesh.material !== mat) l.mesh.material = mat;
    }
    // ── kendaraan NPC ──
    const byPath = new Map<number, Car[]>();
    for (const c of this.cars) {
      const list = byPath.get(c.path);
      if (list) list.push(c);
      else byPath.set(c.path, [c]);
    }
    const states: Record<string, number> = {};
    let atLight = 0;
    for (const [pi, list] of byPath) {
      const p = this.paths[pi]!;
      list.sort((a, b) => a.s - b.s);
      for (let i = 0; i < list.length; i++) {
        const c = list[i]!;
        const ahead = list[(i + 1) % list.length]!;
        let gap = ahead === c ? Infinity : ahead.s - c.s;
        if (gap < 0) gap += p.total;
        const lenSelf = c.kind === 'bus' ? 10 : c.kind === 'mobil' ? 5.5 : 3;
        let target = c.max;
        let state: CarState = 'JALAN';
        // antre di belakang kendaraan lain
        if (gap < lenSelf + 6 + c.speed * 0.8) {
          target = Math.max(0, Math.min(target, (gap - lenSelf - 2.5) * 0.9));
          state = 'REM_ANTRE';
        }
        // lampu lalu lintas: berhenti di garis bila merah/kuning (kuning: berhenti bila masih sempat)
        const sMod = ((c.s % p.total) + p.total) % p.total;
        for (const st of p.stops) {
          let d = st.s - sMod;
          if (d < -2) d += p.total;
          if (d > 45 || d < -0.5) continue;
          const col = lightFor(st.axis, nowSec);
          if (col === 'merah' || (col === 'kuning' && d > 8)) {
            const t = Math.max(0, (d - 0.5) * 0.7);
            if (t < target) {
              target = t;
              state = 'REM_LAMPU';
            }
          }
          break;
        }
        // pejalan / pemain di depan lajur
        at(p, c.s, this.tmp);
        const fx = Math.sin(this.tmp.h);
        const fz = Math.cos(this.tmp.h);
        for (const o of this.obstacles) {
          const dx = o.x - this.tmp.x;
          const dz = o.z - this.tmp.z;
          const along = dx * fx + dz * fz;
          const side = Math.abs(dx * fz - dz * fx);
          if (along > 0 && along < 14 + c.speed && side < 1.8 + o.r) {
            const t = Math.max(0, (along - 4 - o.r) * 0.6);
            if (t < target) {
              target = t;
              state = 'REM_PEJALAN';
            }
          }
        }
        c.state = state;
        states[state] = (states[state] ?? 0) + 1;
        if (state === 'REM_LAMPU' && c.speed < 0.5) atLight++;
        const acc = target > c.speed ? 3 : 7;
        c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), acc * dt);
        c.s += c.speed * dt;
        at(p, c.s, this.tmp);
        c.x = this.tmp.x;
        c.z = this.tmp.z;
        // heading halus di tikungan
        let dh = this.tmp.h - c.h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        c.h += dh * Math.min(1, dt * 6);
        c.wheel += c.speed * dt * 2;
      }
    }
    this.stats.states = states;
    this.stats.stoppedAtLight = atLight;
    // ── pejalan kaki ──
    const R2 = this.radius * this.radius;
    for (const ped of this.peds) {
      ped.phase += dt * (ped.state === 'BERJALAN' ? 7 : 3);
      if (ped.path < 0) continue;
      const p = this.walkPaths[ped.path]!;
      ped.timer -= dt;
      if (ped.state === 'BERHENTI') {
        if (ped.timer <= 0) {
          ped.state = 'BERJALAN';
          ped.timer = 10 + ((ped.phase * 7) % 20);
        }
      } else {
        // zebra cross: bila akan menyeberang jalan berlampu, tunggu lampu sejajar arah jalan hijau
        const sMod = ((ped.s % p.total) + p.total) % p.total;
        let waiting = false;
        for (const st of p.stops) {
          let d = ped.dir > 0 ? st.s - sMod : sMod - (st.s + 18);
          if (d < 0) d += p.total;
          if (d < 1.2 && d > -0.2) {
            if (lightFor(st.axis, nowSec) !== 'hijau') waiting = true;
          }
        }
        ped.state = waiting ? 'MENUNGGU_SEBERANG' : 'BERJALAN';
        if (!waiting) {
          ped.s += ped.speed * ped.dir * dt;
          if (ped.timer <= 0) {
            ped.state = 'BERHENTI';
            ped.timer = 2 + ((ped.phase * 13) % 5);
          }
        }
      }
      at(p, ped.s, this.tmp);
      ped.x = this.tmp.x;
      ped.z = this.tmp.z;
      const th = ped.dir > 0 ? this.tmp.h : this.tmp.h + Math.PI;
      ped.h = ped.state === 'BERHENTI' ? th + Math.PI / 2 : th;
    }
    // ── render yang terdekat saja ──
    this.renderCars(px, pz, R2);
    this.renderPeds(px, pz, R2);
  }

  private renderCars(px: number, pz: number, R2: number) {
    const near = this.cars.filter((c) => (c.x - px) ** 2 + (c.z - pz) ** 2 < R2).sort((a, b) => (a.x - px) ** 2 + (a.z - pz) ** 2 - ((b.x - px) ** 2 + (b.z - pz) ** 2)).slice(0, this.maxCars);
    let nc = 0;
    let nw = 0;
    let nb = 0;
    let nk = 0;
    let nr = 0;
    for (const c of near) {
      if (c.kind === 'mobil') {
        setPart(this.carBody, nc, c.x, 0, c.z, c.h, 0, 0.75, 0);
        this.carBody.setColorAt(nc, c.color);
        setPart(this.carCabin, nc, c.x, 0, c.z, c.h, 0, 1.45, -0.2);
        setPart(this.carWheel, nw++, c.x, 0, c.z, c.h, 0, 0.36, 1.3, c.wheel);
        setPart(this.carWheel, nw++, c.x, 0, c.z, c.h, 0, 0.36, -1.3, c.wheel);
        nc++;
      } else if (c.kind === 'bus') {
        setPart(this.busBody, nb, c.x, 0, c.z, c.h, 0, 1.75, 0);
        this.busBody.setColorAt(nb, c.color);
        setPart(this.carWheel, nw++, c.x, 0, c.z, c.h, 0.25, 0.45, 3, c.wheel);
        setPart(this.carWheel, nw++, c.x, 0, c.z, c.h, 0.25, 0.45, -3, c.wheel);
        nb++;
      } else {
        setPart(this.bikeBody, nk, c.x, 0, c.z, c.h, 0, 0.55, 0);
        this.bikeBody.setColorAt(nk, c.color);
        setPart(this.riderBody, nr, c.x, 0, c.z, c.h, 0, 1.3, -0.15);
        this.riderBody.setColorAt(nr, c.kind === 'motor' ? new THREE.Color(0x1e2a4a) : c.color);
        setPart(this.riderHead, nr, c.x, 0, c.z, c.h, 0, 1.92, -0.12);
        nk++;
        nr++;
      }
    }
    this.carBody.count = nc;
    this.carCabin.count = nc;
    this.carWheel.count = nw;
    this.busBody.count = nb;
    this.bikeBody.count = nk;
    this.riderBody.count = nr;
    this.riderHead.count = nr;
    for (const m of [this.carBody, this.carCabin, this.carWheel, this.busBody, this.bikeBody, this.riderBody, this.riderHead]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.stats.carsVisible = near.length;
  }

  private renderPeds(px: number, pz: number, R2: number) {
    const near = this.peds.filter((p) => (p.x - px) ** 2 + (p.z - pz) ** 2 < R2 * 0.6).sort((a, b) => (a.x - px) ** 2 + (a.z - pz) ** 2 - ((b.x - px) ** 2 + (b.z - pz) ** 2)).slice(0, this.maxPeds);
    let i = 0;
    for (const p of near) {
      let swing = 0;
      let armL = 0;
      let armR = 0;
      let bob = 0;
      let legY = 0.78;
      let sit = 0;
      if (p.state === 'BERJALAN') {
        swing = Math.sin(p.phase) * 0.6;
        armL = -swing;
        armR = swing;
        bob = Math.abs(Math.cos(p.phase)) * 0.04;
      } else if (p.state === 'AKTIVITAS') {
        if (p.activity === 'senam') {
          armL = armR = -2.6 * (0.5 + 0.5 * Math.sin(p.phase * 1.6));
          bob = Math.abs(Math.sin(p.phase * 1.6)) * 0.15;
        } else if (p.activity === 'duduk') {
          sit = 1;
          legY = 0.5;
        } else if (p.activity === 'main') {
          bob = Math.abs(Math.sin(p.phase * 2.2)) * 0.45;
          armL = armR = -1.2;
        } else {
          armR = -0.6 - Math.sin(p.phase) * 0.4;
        }
      } else if (p.state === 'MENUNGGU_SEBERANG') {
        armR = 0;
      }
      const y = bob - sit * 0.35;
      setPart(this.pedBody, i, p.x, y, p.z, p.h, 0, 1.15, 0);
      setPart(this.pedHead, i, p.x, y, p.z, p.h, 0, 1.75, 0);
      setPart(this.pedLegL, i, p.x, y, p.z, p.h, -0.16, legY, 0, sit ? -1.5 : swing);
      setPart(this.pedLegR, i, p.x, y, p.z, p.h, 0.16, legY, 0, sit ? -1.5 : -swing);
      setPart(this.pedArmL, i, p.x, y, p.z, p.h, -0.42, 1.48, 0, armL);
      setPart(this.pedArmR, i, p.x, y, p.z, p.h, 0.42, 1.48, 0, armR);
      this.pedBody.setColorAt(i, p.shirt);
      this.pedHead.setColorAt(i, p.skin);
      this.pedLegL.setColorAt(i, p.pants);
      this.pedLegR.setColorAt(i, p.pants);
      this.pedArmL.setColorAt(i, p.skin);
      this.pedArmR.setColorAt(i, p.skin);
      i++;
    }
    for (const m of [this.pedBody, this.pedHead, this.pedLegL, this.pedLegR, this.pedArmL, this.pedArmR]) {
      m.count = i;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.stats.pedsVisible = i;
  }

  /** Kendaraan NPC di sekitar titik (untuk tabrakan dengan kendaraan pemain). */
  carsNear(x: number, z: number, r: number) {
    return this.cars.filter((c) => Math.hypot(c.x - x, c.z - z) < r);
  }

  /** Ringkasan status (uji otomatis). */
  snapshot() {
    return { ...this.stats, sample: this.cars.slice(0, 3).map((c) => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), state: c.state, speed: +c.speed.toFixed(1) })), loops: this.loops.length };
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.root.removeFromParent();
  }
}
