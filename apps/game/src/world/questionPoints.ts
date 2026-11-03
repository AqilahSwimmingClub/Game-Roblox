/**
 * Objek soal di dunia 3D: peti, NPC, buku, papan, kios, botol, kristal, batu misteri.
 * Data titik aktif datang dari server; klien hanya menggambar dan mendeteksi kedekatan.
 */
import * as THREE from 'three';
import type { ActivePoint } from '@eduverse/shared';
import { makeLabelSprite } from '../engine/signs.js';

const OBJECT_NAME: Record<string, string> = {
  peti: 'Peti',
  npc: 'Warga',
  buku: 'Buku',
  papan: 'Papan',
  kios: 'Kios',
  botol: 'Botol Pesan',
  kristal: 'Kristal',
  batu: 'Batu Misteri',
};

export const ACTION_LABEL: Record<string, string> = {
  peti: 'Buka Peti',
  npc: 'Bicara',
  buku: 'Baca Buku',
  papan: 'Lihat Papan',
  kios: 'Tanya Penjual',
  botol: 'Buka Botol',
  kristal: 'Sentuh Kristal',
  batu: 'Periksa Batu',
};

export function objectName(o: string) {
  return OBJECT_NAME[o] ?? 'Objek';
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const g = (w: number, h: number, d: number, y = 0) => {
  const k = `${w},${h},${d},${y}`;
  let geo = geoCache.get(k);
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d).translate(0, y, 0);
    geoCache.set(k, geo);
  }
  return geo;
};
const matCache = new Map<number, THREE.Material>();
const m = (c: number, basic = false) => {
  const key = basic ? c + 0x1000000 : c;
  let mat = matCache.get(key);
  if (!mat) {
    mat = basic ? new THREE.MeshBasicMaterial({ color: c }) : new THREE.MeshLambertMaterial({ color: c });
    matCache.set(key, mat);
  }
  return mat;
};
const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => new THREE.Mesh(geo, mat);

function buildObject(kind: string): THREE.Group {
  const o = new THREE.Group();
  switch (kind) {
    case 'peti':
      o.add(mesh(g(1.2, 0.8, 0.8, 0.4), m(0xb07a4a)), mesh(g(1.26, 0.28, 0.86, 0.94), m(0x8b5a3c)), mesh(g(1.28, 0.1, 0.88, 0.75), m(0xffc93c, true)));
      break;
    case 'npc': {
      const shirt = [0x3ba7ff, 0x2fbf71, 0xff8a3d, 0x8b5cf6][Math.floor(Math.random() * 4)]!;
      o.add(mesh(g(0.6, 0.75, 0.3, 0.38), m(0x1e2a4a)), mesh(g(0.66, 0.7, 0.36, 1.1), m(shirt)), mesh(g(0.52, 0.52, 0.5, 1.72), m(0xe0a878)), mesh(g(0.54, 0.14, 0.52, 2.02), m(0x3b2a20)));
      break;
    }
    case 'buku':
      o.add(mesh(g(0.6, 0.9, 0.6, 0.45), m(0xf4f8ff)), mesh(g(1, 0.14, 0.75, 1.0), m(0xe86fa8)), mesh(g(0.94, 0.06, 0.7, 1.1), m(0xffffff)));
      break;
    case 'papan':
      o.add(mesh(g(0.15, 1.6, 0.15, 0.8), m(0x4a5670)).translateX(-0.7), mesh(g(0.15, 1.6, 0.15, 0.8), m(0x4a5670)).translateX(0.7), mesh(g(1.7, 1.05, 0.12, 1.55), m(0x3ba7ff)), mesh(g(1.5, 0.85, 0.14, 1.55), m(0xf4f8ff)));
      break;
    case 'kios':
      o.add(mesh(g(1, 1, 1, 0.5), m(0xff8a3d)), mesh(g(1.2, 0.12, 1.2, 1.06), m(0xffc93c)));
      break;
    case 'botol':
      o.add(mesh(g(0.42, 0.85, 0.42, 0.43), m(0x7fd8be)), mesh(g(0.2, 0.25, 0.2, 0.98), m(0xb07a4a)));
      break;
    case 'kristal': {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), m(0x8b5cf6, true));
      c.position.y = 1;
      o.add(c);
      break;
    }
    default:
      o.add(mesh(g(1.1, 0.9, 1, 0.45), m(0x9aa0aa)), mesh(g(0.7, 0.4, 0.6, 1.1), m(0x7d8590)));
  }
  return o;
}

const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 30, 8, 1, true).translate(0, 15, 0);
const beamMatYellow = new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
const beamMatPurple = new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });

interface Entry {
  p: ActivePoint;
  group: THREE.Group;
  label: THREE.Sprite;
  beam: THREE.Mesh;
  done: boolean;
}

export class QuestionPoints {
  readonly root = new THREE.Group();
  private entries = new Map<string, Entry>();
  done = new Set<string>();

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  setPoints(list: ActivePoint[]) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, e] of this.entries) {
      if (!ids.has(id)) {
        this.disposeEntry(e);
        this.entries.delete(id);
      }
    }
    for (const p of list) {
      if (this.entries.has(p.id)) continue;
      const group = buildObject(p.object);
      group.position.set(p.x, p.y, p.z);
      group.rotation.y = (parseInt(p.id.replace(/\D/g, '') || '0', 10) * 1.7) % (Math.PI * 2);
      const beam = new THREE.Mesh(beamGeo, p.surprise ? beamMatPurple : beamMatYellow);
      beam.position.set(p.x, p.y, p.z);
      const label = makeLabelSprite(p.surprise ? '!' : '?', { bg: p.surprise ? '#8B5CF6' : '#FFC93C', fg: '#1E2A4A', border: '#ffffff', round: true, scale: 0.014 });
      label.position.set(p.x, p.y + 2.9, p.z);
      this.root.add(group, beam, label);
      this.entries.set(p.id, { p, group, label, beam, done: false });
    }
    this.refreshDone();
  }

  markDone(id: string) {
    this.done.add(id);
    this.refreshDone();
  }

  setDone(ids: string[]) {
    this.done = new Set(ids);
    this.refreshDone();
  }

  private refreshDone() {
    for (const [id, e] of this.entries) {
      const d = this.done.has(id);
      if (d === e.done) continue;
      e.done = d;
      e.beam.visible = !d;
      const mat = e.label.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      const nl = makeLabelSprite(d ? 'OK' : e.p.surprise ? '!' : '?', { bg: d ? '#2FBF71' : e.p.surprise ? '#8B5CF6' : '#FFC93C', fg: d ? '#ffffff' : '#1E2A4A', border: '#ffffff', round: true, scale: 0.014 });
      e.label.material = nl.material;
      e.label.scale.copy(nl.scale);
      mat.dispose();
    }
  }

  /** Titik terdekat yang belum selesai dalam jarak tertentu. */
  nearest(x: number, y: number, z: number, maxDist: number): ActivePoint | null {
    let best: ActivePoint | null = null;
    let bd = maxDist;
    for (const e of this.entries.values()) {
      if (e.done) continue;
      if (Math.abs(e.p.y - y) > 3) continue;
      const d = Math.hypot(e.p.x - x, e.p.z - z);
      if (d < bd) {
        bd = d;
        best = e.p;
      }
    }
    return best;
  }

  list(): { p: ActivePoint; done: boolean }[] {
    return [...this.entries.values()].map((e) => ({ p: e.p, done: e.done }));
  }

  animate(t: number) {
    for (const e of this.entries.values()) {
      e.label.position.y = e.p.y + 2.9 + Math.sin(t * 2.4 + e.p.x) * 0.15;
      if (e.p.object === 'kristal') e.group.rotation.y = t;
    }
  }

  private disposeEntry(e: Entry) {
    const mat = e.label.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.root.remove(e.group, e.beam, e.label);
  }

  clear() {
    for (const e of this.entries.values()) this.disposeEntry(e);
    this.entries.clear();
    this.done.clear();
  }

  dispose() {
    this.clear();
    this.root.removeFromParent();
  }
}
