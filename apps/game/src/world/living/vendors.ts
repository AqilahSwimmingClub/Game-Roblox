/**
 * Pedagang & warga interaktif: memakai rig karakter EDUVERSE (AvatarMesh) + gerobak/kios/meja/pos.
 * Hanya pedagang dalam radius pandang yang dibangun (lazy), yang jauh dibuang → hemat memori HP.
 * Penanda "!" kuning melayang bila misinya belum diselesaikan.
 */
import * as THREE from 'three';
import type { Vendor } from '@eduverse/shared';
import { AvatarMesh, ANIM } from '../../engine/avatar.js';
import { makeLabelSprite } from '../../engine/signs.js';
import { lambert } from './meshes.js';

interface VendorView {
  v: Vendor;
  group: THREE.Group | null;
  avatar: AvatarMesh | null;
  mark: THREE.Sprite | null;
  wave: number;
}

function stall(kind: Vendor['stall'], color: number): THREE.Group {
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(c));
    m.position.set(x, y, z);
    g.add(m);
  };
  if (kind === 'gerobak') {
    box(2, 0.9, 1, color, 0, 0.75, 1.1);
    box(2.1, 0.06, 1.1, 0xffffff, 0, 1.22, 1.1);
    for (const x of [-0.9, 0.9]) box(0.06, 1.3, 0.06, 0x7c5c3b, x, 1.85, 1.1);
    box(2.3, 0.1, 1.3, 0xffffff, 0, 2.5, 1.1);
    box(2.3, 0.2, 1.3, color, 0, 2.62, 1.1);
    box(0.5, 0.5, 0.12, 0x1e2a4a, -0.8, 0.3, 0.75);
    box(0.5, 0.5, 0.12, 0x1e2a4a, 0.8, 0.3, 0.75);
    box(0.3, 0.2, 0.2, 0xff6b6b, -0.4, 1.35, 1.1);
    box(0.3, 0.2, 0.2, 0xffd93d, 0.3, 1.35, 1.1);
  } else if (kind === 'kios') {
    box(2.6, 1, 1, 0xc98a4b, 0, 0.5, 1.1);
    for (const x of [-1.2, 1.2]) box(0.1, 2.6, 0.1, 0x7c5c3b, x, 1.3, 1.5);
    box(3, 0.12, 2.2, color, 0, 2.65, 1);
    for (let i = 0; i < 5; i++) box(0.36, 0.3, 0.36, [0xff6b6b, 0xffd93d, 0x2fbf71, 0xff8a3d, 0xe86fa8][i]!, -1 + i * 0.5, 1.15, 1.1);
  } else if (kind === 'meja') {
    box(2.2, 0.08, 1, 0xffffff, 0, 0.9, 1);
    for (const x of [-1, 1]) box(0.08, 0.9, 0.08, 0x334155, x, 0.45, 1);
    box(1.6, 0.06, 0.7, color, 0, 0.96, 1);
    box(0.5, 0.35, 0.4, color, -0.5, 1.15, 1);
  } else if (kind === 'pos') {
    box(1.4, 2.4, 1.4, 0xf4f8ff, 0, 1.2, -1.2);
    box(1.6, 0.25, 1.6, color, 0, 2.5, -1.2);
    box(0.08, 0.6, 0.08, 0xffffff, 0.5, 0.3, 0.9);
    box(0.08, 0.8, 0.08, 0xff8a3d, 0.5, 0.9, 0.9);
  }
  return g;
}

export class VendorSystem {
  readonly root = new THREE.Group();
  private views: VendorView[];
  viewDistance = 110;
  private accum = 1;
  done = new Set<string>();

  constructor(scene: THREE.Scene, vendors: Vendor[]) {
    scene.add(this.root);
    this.views = vendors.map((v) => ({ v, group: null, avatar: null, mark: null, wave: 0 }));
  }

  private build(vw: VendorView) {
    const v = vw.v;
    const g = new THREE.Group();
    g.position.set(v.x, v.y, v.z);
    g.rotation.y = v.ry;
    const av = new AvatarMesh({ karakter: v.karakter, kulit: v.karakter % 4 });
    g.add(av.root);
    if (v.stall !== 'none') g.add(stall(v.stall, v.stallColor));
    const label = makeLabelSprite(`${v.nama} · ${v.peran}`, { bg: '#FFFFFF', border: '#FF8A3D', scale: 0.0095 });
    label.position.y = 2.75;
    g.add(label);
    const mark = makeLabelSprite('!', { bg: '#FFC93C', fg: '#1E2A4A', border: '#FFFFFF', scale: 0.02, round: true });
    mark.position.y = 3.55;
    g.add(mark);
    this.root.add(g);
    vw.group = g;
    vw.avatar = av;
    vw.mark = mark;
  }

  private drop(vw: VendorView) {
    if (!vw.group) return;
    vw.avatar?.dispose();
    vw.group.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) {
        const mat = (o as THREE.Sprite).material;
        mat.map?.dispose();
        mat.dispose();
      }
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    vw.group.removeFromParent();
    vw.group = null;
    vw.avatar = null;
    vw.mark = null;
  }

  nearest(x: number, y: number, z: number, r = 3.4): Vendor | null {
    let best: Vendor | null = null;
    let bd = r;
    for (const { v } of this.views) {
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bd && Math.abs(v.y - y) < 3) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  /** Pedagang melambai saat diajak bicara. */
  greet(id: string) {
    const vw = this.views.find((w) => w.v.id === id);
    if (vw) vw.wave = 3;
  }

  update(dt: number, px: number, pz: number, t: number) {
    this.accum += dt;
    if (this.accum > 0.7) {
      this.accum = 0;
      for (const vw of this.views) {
        const d = Math.hypot(vw.v.x - px, vw.v.z - pz);
        if (d < this.viewDistance && !vw.group) this.build(vw);
        else if (d > this.viewDistance + 30 && vw.group) this.drop(vw);
      }
    }
    for (const vw of this.views) {
      if (!vw.avatar || !vw.group) continue;
      if (vw.wave > 0) {
        vw.wave -= dt;
        vw.avatar.emote = 0;
      } else vw.avatar.emote = -1;
      vw.avatar.update(dt, ANIM.idle, 0);
      if (vw.mark) {
        vw.mark.visible = !this.done.has(vw.v.id);
        vw.mark.position.y = 3.55 + Math.sin(t * 3 + vw.v.x) * 0.15;
      }
    }
  }

  dispose() {
    for (const vw of this.views) this.drop(vw);
    this.root.removeFromParent();
  }
}
