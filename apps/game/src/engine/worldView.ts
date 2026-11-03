/**
 * Perender dunia berbasis chunk.
 * - Kotak layout digabung per chunk 100 m → satu draw call per material (bukan ribuan mesh).
 * - LOD: chunk di luar jarak pandang penuh hanya memuat kotak padat besar (siluet kota).
 * - Chunk di luar jarak LOD dibuang dari GPU (geometri di-dispose) → hemat memori HP.
 * - Pohon & lampu jalan memakai InstancedMesh per chunk.
 * - Frustum culling bawaan Three.js bekerja per chunk karena bounding sphere tiap chunk kecil.
 */
import * as THREE from 'three';
import type { Box, Disc, Sign, Tree, Lamp } from '@eduverse/shared';
import { makeSignTexture } from './signs.js';

export interface WorldData {
  boxes: Box[];
  discs: Disc[];
  signs: Sign[];
  trees: Tree[];
  lamps: Lamp[];
}

const CHUNK = 100;

type Level = 'none' | 'lod' | 'full';

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  boxes: number[];
  bigBoxes: number[]; // untuk LOD
  discs: Disc[];
  signs: Sign[];
  trees: Tree[];
  lamps: Lamp[];
  level: Level;
  group: THREE.Group | null;
}

const MAT = {
  solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
  decor: new THREE.MeshLambertMaterial({ vertexColors: true }),
  glass: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false }),
  neon: new THREE.MeshBasicMaterial({ vertexColors: true }),
  water: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false }),
};

const FACE_SHADE = [0.86, 0.86, 1.0, 0.62, 0.93, 0.78]; // +x −x +y −y +z −z (pencahayaan "voxel" lembut)

/** Gabungkan daftar kotak menjadi satu BufferGeometry ber-warna verteks. */
export function mergeBoxes(boxes: Box[], indices: number[], shade = true): THREE.BufferGeometry | null {
  if (!indices.length) return null;
  const n = indices.length;
  const pos = new Float32Array(n * 24 * 3);
  const nor = new Float32Array(n * 24 * 3);
  const col = new Float32Array(n * 24 * 3);
  const idx = new Uint32Array(n * 36);
  const c = new THREE.Color();
  let v = 0;
  let ii = 0;
  const faces: [number[], number[][]][] = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ];
  for (const bi of indices) {
    const b = boxes[bi]!;
    c.setHex(b.c).convertSRGBToLinear();
    const hx = b.sx / 2;
    const hy = b.sy / 2;
    const hz = b.sz / 2;
    faces.forEach(([nrm, corners], fi) => {
      const s = shade ? FACE_SHADE[fi]! : 1;
      const base = v;
      for (const cr of corners) {
        pos[v * 3] = b.x + cr[0]! * hx;
        pos[v * 3 + 1] = b.y + cr[1]! * hy;
        pos[v * 3 + 2] = b.z + cr[2]! * hz;
        nor[v * 3] = nrm[0]!;
        nor[v * 3 + 1] = nrm[1]!;
        nor[v * 3 + 2] = nrm[2]!;
        col[v * 3] = c.r * s;
        col[v * 3 + 1] = c.g * s;
        col[v * 3 + 2] = c.b * s;
        v++;
      }
      // berlawanan arah jarum jam dilihat dari luar → sisi depan menghadap normal
      idx[ii++] = base;
      idx[ii++] = base + 1;
      idx[ii++] = base + 2;
      idx[ii++] = base;
      idx[ii++] = base + 2;
      idx[ii++] = base + 3;
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const trunkGeo = new THREE.BoxGeometry(0.6, 2.6, 0.6).translate(0, 1.3, 0);
const leafGeo = new THREE.BoxGeometry(2.8, 2.2, 2.8).translate(0, 3.2, 0);
const leafTopGeo = new THREE.BoxGeometry(1.8, 1.3, 1.8).translate(0, 4.8, 0);
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8b5a3c });
const leafMat = new THREE.MeshLambertMaterial({ color: 0x3dbe5c });
const leafTopMat = new THREE.MeshLambertMaterial({ color: 0x5fd17a });
const poleGeo = new THREE.BoxGeometry(0.22, 4.2, 0.22).translate(0, 2.1, 0);
const bulbGeo = new THREE.BoxGeometry(0.7, 0.35, 0.7).translate(0, 4.3, 0);
const poleMat = new THREE.MeshLambertMaterial({ color: 0x4a5670 });
const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });

export class WorldView {
  readonly root = new THREE.Group();
  private chunks = new Map<string, Chunk>();
  private global: number[] = [];
  private lastUpdate = 0;
  private castShadow = false;
  viewDistance = 170;
  lodDistance = 340;
  /** Kotak yang disembunyikan sementara (rak rahasia yang bergeser). */
  hiddenBoxes = new Set<number>();

  constructor(
    readonly data: WorldData,
    scene: THREE.Scene,
  ) {
    scene.add(this.root);
    const get = (x: number, z: number) => {
      const cx = Math.floor(x / CHUNK);
      const cz = Math.floor(z / CHUNK);
      const key = `${cx},${cz}`;
      let ch = this.chunks.get(key);
      if (!ch) {
        ch = { key, cx, cz, boxes: [], bigBoxes: [], discs: [], signs: [], trees: [], lamps: [], level: 'none', group: null };
        this.chunks.set(key, ch);
      }
      return ch;
    };
    data.boxes.forEach((b, i) => {
      if (b.sx > CHUNK * 0.9 || b.sz > CHUNK * 0.9) {
        this.global.push(i); // tanah & jalan panjang: selalu dimuat
        return;
      }
      const ch = get(b.x, b.z);
      ch.boxes.push(i);
      if (b.k === 'solid' && Math.max(b.sx, b.sy, b.sz) >= 3.5) ch.bigBoxes.push(i);
    });
    for (const d of data.discs) get(d.x, d.z).discs.push(d);
    for (const s of data.signs) get(s.x, s.z).signs.push(s);
    for (const t of data.trees) get(t.x, t.z).trees.push(t);
    for (const l of data.lamps) get(l.x, l.z).lamps.push(l);
    this.buildGlobal();
  }

  private meshesFor(indices: number[], group: THREE.Group, shadows: boolean) {
    const byKind: Record<string, number[]> = { solid: [], decor: [], glass: [], neon: [], water: [] };
    for (const i of indices) if (!this.hiddenBoxes.has(i)) byKind[this.data.boxes[i]!.k]!.push(i);
    for (const k of Object.keys(byKind)) {
      const g = mergeBoxes(this.data.boxes, byKind[k]!);
      if (!g) continue;
      const m = new THREE.Mesh(g, MAT[k as keyof typeof MAT]);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      if (k === 'solid') {
        m.castShadow = shadows;
        m.receiveShadow = shadows;
      } else if (k === 'decor') m.receiveShadow = shadows;
      if (k === 'glass' || k === 'water') m.renderOrder = 2;
      group.add(m);
    }
  }

  private globalGroup = new THREE.Group();
  private buildGlobal() {
    this.root.add(this.globalGroup);
    this.meshesFor(this.global, this.globalGroup, false);
    this.globalGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true;
    });
  }

  setShadows(on: boolean) {
    if (this.castShadow === on) return;
    this.castShadow = on;
    for (const ch of this.chunks.values()) if (ch.level === 'full') this.setLevel(ch, 'none');
  }

  private disposeGroup(g: THREE.Group) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) {
        if (m.geometry && m.geometry !== trunkGeo && m.geometry !== leafGeo && m.geometry !== leafTopGeo && m.geometry !== poleGeo && m.geometry !== bulbGeo && !m.userData.sharedGeo) m.geometry.dispose();
        const mat = m.material as THREE.Material & { map?: THREE.Texture };
        if (m.userData.ownMaterial) {
          mat.map?.dispose();
          mat.dispose();
        }
      }
    });
  }

  private setLevel(ch: Chunk, level: Level) {
    if (ch.level === level) return;
    if (ch.group) {
      this.root.remove(ch.group);
      this.disposeGroup(ch.group);
      ch.group = null;
    }
    ch.level = level;
    if (level === 'none') return;
    const g = new THREE.Group();
    g.name = `chunk ${ch.key} ${level}`;
    if (level === 'lod') {
      this.meshesFor(ch.bigBoxes, g, false);
      if (ch.trees.length) {
        const inst = new THREE.InstancedMesh(leafGeo, leafMat, ch.trees.length);
        const m = new THREE.Matrix4();
        ch.trees.forEach((t, i) => inst.setMatrixAt(i, m.makeScale(t.s, t.s, t.s).setPosition(t.x, t.y, t.z)));
        inst.computeBoundingSphere();
        g.add(inst);
      }
    } else {
      this.meshesFor(ch.boxes, g, this.castShadow);
      if (ch.trees.length) {
        const n = ch.trees.length;
        const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
        const leaves = new THREE.InstancedMesh(leafGeo, leafMat, n);
        const tops = new THREE.InstancedMesh(leafTopGeo, leafTopMat, n);
        const m = new THREE.Matrix4();
        ch.trees.forEach((t, i) => {
          m.makeScale(t.s, t.s, t.s).setPosition(t.x, t.y, t.z);
          trunks.setMatrixAt(i, m);
          leaves.setMatrixAt(i, m);
          tops.setMatrixAt(i, m);
        });
        for (const im of [trunks, leaves, tops]) {
          im.computeBoundingSphere();
          im.castShadow = this.castShadow;
          g.add(im);
        }
      }
      if (ch.lamps.length) {
        const n = ch.lamps.length;
        const poles = new THREE.InstancedMesh(poleGeo, poleMat, n);
        const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, n);
        const m = new THREE.Matrix4();
        ch.lamps.forEach((l, i) => {
          m.makeTranslation(l.x, 0, l.z);
          poles.setMatrixAt(i, m);
          bulbs.setMatrixAt(i, m);
        });
        poles.computeBoundingSphere();
        bulbs.computeBoundingSphere();
        g.add(poles, bulbs);
      }
      for (const d of ch.discs) g.add(discMesh(d));
      for (const s of ch.signs) g.add(signMesh(s));
    }
    this.root.add(g);
    ch.group = g;
  }

  /** Bangun ulang satu chunk (mis. setelah kotak disembunyikan). */
  refreshAt(x: number, z: number) {
    const ch = this.chunks.get(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`);
    if (ch && ch.level !== 'none') {
      const lv = ch.level;
      this.setLevel(ch, 'none');
      this.setLevel(ch, lv);
    }
  }

  /** Muat/buang chunk sesuai posisi pemain (dipanggil tiap frame; bekerja 4×/detik). */
  update(x: number, z: number, t: number, force = false) {
    if (!force && t - this.lastUpdate < 0.25) return;
    this.lastUpdate = t;
    let builds = 0;
    const order = [...this.chunks.values()]
      .map((ch) => {
        const ccx = (ch.cx + 0.5) * CHUNK;
        const ccz = (ch.cz + 0.5) * CHUNK;
        const d = Math.max(0, Math.hypot(ccx - x, ccz - z) - CHUNK * 0.71);
        return { ch, d };
      })
      .sort((a, b) => a.d - b.d);
    for (const { ch, d } of order) {
      const want: Level = d <= this.viewDistance ? 'full' : d <= this.lodDistance ? 'lod' : 'none';
      if (want === ch.level) continue;
      // Batasi pembangunan per pembaruan agar tidak tersendat (kecuali paksa saat masuk dunia)
      if (want !== 'none' && !force && builds >= 3) continue;
      if (want !== 'none') builds++;
      this.setLevel(ch, want);
    }
  }

  stats() {
    let full = 0;
    let lod = 0;
    for (const ch of this.chunks.values()) {
      if (ch.level === 'full') full++;
      else if (ch.level === 'lod') lod++;
    }
    return { chunks: this.chunks.size, full, lod };
  }

  dispose() {
    for (const ch of this.chunks.values()) this.setLevel(ch, 'none');
    this.disposeGroup(this.globalGroup);
    this.root.removeFromParent();
  }
}

function discMesh(d: Disc): THREE.Mesh {
  const g = new THREE.CylinderGeometry(d.r, d.r, d.h, 20);
  const mat = d.k === 'neon' ? new THREE.MeshBasicMaterial({ color: d.c }) : new THREE.MeshLambertMaterial({ color: d.c, transparent: d.k === 'water', opacity: d.k === 'water' ? 0.7 : 1 });
  const m = new THREE.Mesh(g, mat);
  m.userData.ownMaterial = true;
  m.position.set(d.x, d.y, d.z);
  if (d.axis === 'x') m.rotation.z = Math.PI / 2;
  if (d.axis === 'z') m.rotation.x = Math.PI / 2;
  return m;
}

const FACING_ROT: Record<string, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

function signMesh(s: Sign): THREE.Group {
  const g = new THREE.Group();
  const tex = makeSignTexture(s.text, s.bg, s.fg, s.w / s.h);
  for (const back of [0, 1]) {
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
    m.userData.ownMaterial = true; // dispose tekstur dua kali aman di Three.js
    m.rotation.y = back ? Math.PI : 0;
    m.position.z = back ? -0.03 : 0.03;
    g.add(m);
  }
  const board = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.15, s.h + 0.15, 0.05), new THREE.MeshLambertMaterial({ color: s.bg }));
  board.userData.ownMaterial = true;
  g.add(board);
  g.position.set(s.x, s.y, s.z);
  g.rotation.y = FACING_ROT[s.facing] ?? 0;
  return g;
}
