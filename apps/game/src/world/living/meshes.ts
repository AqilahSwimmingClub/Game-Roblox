/**
 * Model 3D low-poly/blocky kendaraan EDUVERSE (dibuat dari kotak & silinder, tanpa aset eksternal).
 * Setiap model punya titik duduk (seat) relatif terhadap titik asal (permukaan tanah, tengah kendaraan),
 * bagian yang dianimasikan (roda, baling-baling, api jet), dan menghadap +Z.
 */
import * as THREE from 'three';
import type { VehicleKind } from '@eduverse/shared';

export interface VehicleModel {
  group: THREE.Group;
  /** Posisi pinggul pengemudi (relatif). Avatar diletakkan di sini dengan anim duduk. */
  seat: THREE.Vector3;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  prop: THREE.Object3D | null;
  /** Sudut setang/kemudi (diputar saat berbelok). */
  steer: THREE.Object3D | null;
  /** Avatar tampak menunggang (sepeda/motor) — kaki tidak dilipat penuh. */
  straddle: boolean;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<number, THREE.MeshLambertMaterial>();
function boxGeo(w: number, h: number, d: number) {
  const k = `b${w},${h},${d}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}
function cylGeo(r: number, h: number, seg = 12) {
  const k = `c${r},${h},${seg}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.CylinderGeometry(r, r, h, seg).rotateZ(Math.PI / 2)));
  return g;
}
export function lambert(c: number) {
  let m = matCache.get(c);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: c });
    m.userData.shared = true;
    matCache.set(c, m);
  }
  return m;
}

function add(g: THREE.Object3D, w: number, h: number, d: number, c: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(boxGeo(w, h, d), lambert(c));
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}
function wheel(g: THREE.Object3D, r: number, w: number, x: number, y: number, z: number, c = 0x1e2a4a) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const m = new THREE.Mesh(cylGeo(r, w), lambert(c));
  pivot.add(m);
  const hub = new THREE.Mesh(boxGeo(w + 0.02, r * 0.5, r * 0.5), lambert(0xd9dde6));
  pivot.add(hub);
  g.add(pivot);
  return pivot;
}

export function buildVehicle(kind: VehicleKind, color: number): VehicleModel {
  const g = new THREE.Group();
  const wheels: THREE.Object3D[] = [];
  switch (kind) {
    case 'mobil': {
      add(g, 2, 0.75, 4.2, color, 0, 0.75, 0);
      add(g, 1.8, 0.7, 2.2, 0xf4f8ff, 0, 1.45, -0.25);
      add(g, 1.84, 0.5, 2, 0x9fd4ff, 0, 1.45, -0.25);
      add(g, 1.9, 0.12, 2.3, color, 0, 1.86, -0.25);
      add(g, 0.4, 0.2, 0.06, 0xfff7c2, -0.65, 0.85, 2.11);
      add(g, 0.4, 0.2, 0.06, 0xfff7c2, 0.65, 0.85, 2.11);
      add(g, 0.4, 0.18, 0.06, 0xe74c3c, -0.65, 0.85, -2.11);
      add(g, 0.4, 0.18, 0.06, 0xe74c3c, 0.65, 0.85, -2.11);
      add(g, 0.9, 0.2, 0.04, 0xffffff, 0, 0.62, 2.12); // pelat nomor
      for (const z of [-1.35, 1.35]) for (const x of [-1, 1]) wheels.push(wheel(g, 0.38, 0.3, x, 0.38, z));
      return { group: g, seat: new THREE.Vector3(-0.42, 0.75, -0.1), wheels, wheelRadius: 0.38, prop: null, steer: null, straddle: false };
    }
    case 'bus': {
      add(g, 2.6, 0.35, 9, 0x5d6678, 0, 0.75, 0);
      add(g, 2.6, 2.2, 9, color, 0, 2, 0);
      add(g, 2.64, 0.9, 7.6, 0xbfe6ff, 0, 2.4, -0.4);
      add(g, 2.4, 1.1, 0.06, 0xbfe6ff, 0, 2.4, 4.52);
      add(g, 2.7, 0.3, 9.1, 0xf4f8ff, 0, 3.25, 0);
      add(g, 2.2, 0.35, 0.06, 0xffc93c, 0, 3.0, 4.54);
      for (const z of [-3, 3]) for (const x of [-1.3, 1.3]) wheels.push(wheel(g, 0.5, 0.35, x, 0.5, z));
      return { group: g, seat: new THREE.Vector3(-0.7, 1.3, 3.4), wheels, wheelRadius: 0.5, prop: null, steer: null, straddle: false };
    }
    case 'motor': {
      add(g, 0.32, 0.4, 1.3, color, 0, 0.75, 0.05);
      add(g, 0.36, 0.22, 0.75, 0x1e2a4a, 0, 0.98, -0.2); // jok
      add(g, 0.3, 0.32, 0.4, color, 0, 1.0, 0.55); // tangki
      const steer = new THREE.Group();
      steer.position.set(0, 1.0, 0.75);
      add(steer, 0.08, 0.6, 0.08, 0x94a3b8, 0, 0.1, 0.05);
      add(steer, 0.85, 0.07, 0.07, 0x1e2a4a, 0, 0.42, 0.05);
      add(steer, 0.22, 0.16, 0.1, 0xfff7c2, 0, 0.2, 0.18);
      g.add(steer);
      wheels.push(wheel(g, 0.36, 0.16, 0, 0.36, 0.78), wheel(g, 0.36, 0.18, 0, 0.36, -0.7));
      add(g, 0.12, 0.08, 0.5, 0x94a3b8, 0.18, 0.45, -0.55); // knalpot
      return { group: g, seat: new THREE.Vector3(0, 0.98, -0.2), wheels, wheelRadius: 0.36, prop: null, steer, straddle: true };
    }
    case 'sepeda': {
      add(g, 0.06, 0.06, 1.0, color, 0, 0.62, 0.02);
      add(g, 0.06, 0.55, 0.06, color, 0, 0.62, -0.25);
      add(g, 0.06, 0.4, 0.06, color, 0, 0.75, 0.45);
      add(g, 0.22, 0.07, 0.32, 0x1e2a4a, 0, 0.94, -0.28); // sadel
      const steer = new THREE.Group();
      steer.position.set(0, 0.95, 0.5);
      add(steer, 0.7, 0.05, 0.05, 0x1e2a4a, 0, 0.12, 0);
      add(steer, 0.05, 0.25, 0.05, 0x94a3b8, 0, 0, 0);
      g.add(steer);
      add(g, 0.16, 0.12, 0.12, 0x94a3b8, 0, 0.36, -0.05); // pedal
      wheels.push(wheel(g, 0.34, 0.06, 0, 0.34, 0.55, 0x334155), wheel(g, 0.34, 0.06, 0, 0.34, -0.55, 0x334155));
      return { group: g, seat: new THREE.Vector3(0, 0.92, -0.28), wheels, wheelRadius: 0.34, prop: null, steer, straddle: true };
    }
    case 'pesawat': {
      add(g, 1.5, 1.4, 6.4, 0xf4f8ff, 0, 1.6, 0);
      add(g, 1.52, 0.3, 6.42, color, 0, 1.3, 0);
      add(g, 1.3, 0.7, 1.6, 0x9fd4ff, 0, 2.5, 0.8); // kanopi
      add(g, 9.6, 0.18, 1.7, color, 0, 2.2, 0.4); // sayap
      add(g, 0.4, 0.2, 1.7, 0xffffff, -4.6, 2.2, 0.4);
      add(g, 0.4, 0.2, 1.7, 0xffffff, 4.6, 2.2, 0.4);
      add(g, 3.2, 0.12, 0.9, color, 0, 1.9, -2.9); // ekor horizontal
      add(g, 0.14, 1.3, 1.0, color, 0, 2.6, -2.9); // sirip
      add(g, 0.8, 0.8, 0.5, 0x94a3b8, 0, 1.6, 3.35); // hidung
      const prop = new THREE.Group();
      prop.position.set(0, 1.6, 3.65);
      add(prop, 0.18, 2.4, 0.06, 0x1e2a4a, 0, 0, 0);
      add(prop, 0.25, 0.25, 0.2, 0xffc93c, 0, 0, 0.05);
      g.add(prop);
      add(g, 0.08, 0.9, 0.08, 0x475569, -1.2, 0.75, 0.9);
      add(g, 0.08, 0.9, 0.08, 0x475569, 1.2, 0.75, 0.9);
      add(g, 0.08, 0.7, 0.08, 0x475569, 0, 0.6, -2.4);
      wheels.push(wheel(g, 0.3, 0.2, -1.2, 0.3, 0.9), wheel(g, 0.3, 0.2, 1.2, 0.3, 0.9), wheel(g, 0.22, 0.15, 0, 0.22, -2.4));
      return { group: g, seat: new THREE.Vector3(0, 1.45, 0.8), wheels, wheelRadius: 0.3, prop, steer: null, straddle: false };
    }
  }
}

/** Jetpack yang dipakai di punggung avatar (+ api semburan yang bisa dinyalakan). */
export function buildJetpack(): { group: THREE.Group; flames: THREE.Mesh[] } {
  const g = new THREE.Group();
  add(g, 0.62, 0.7, 0.28, 0x94a3b8, 0, 1.2, -0.36);
  add(g, 0.22, 0.62, 0.26, 0xff8a3d, -0.2, 1.18, -0.5);
  add(g, 0.22, 0.62, 0.26, 0xff8a3d, 0.2, 1.18, -0.5);
  add(g, 0.5, 0.08, 0.3, 0x1e2a4a, 0, 1.56, -0.4);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.9 });
  const flames: THREE.Mesh[] = [];
  for (const x of [-0.2, 0.2]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.6, 8).rotateX(Math.PI), flameMat);
    f.position.set(x, 0.62, -0.5);
    f.visible = false;
    g.add(f);
    flames.push(f);
  }
  return { group: g, flames };
}

/** Hapus model kendaraan (geometri/material dipakai bersama — cukup lepas dari scene). */
export function disposeModel(m: { group: THREE.Group }) {
  m.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(mesh.material as THREE.Material).userData.shared) (mesh.material as THREE.Material).dispose();
  });
  m.group.removeFromParent();
}
