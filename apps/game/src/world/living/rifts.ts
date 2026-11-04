/**
 * Lubang Dimensi (Dimension Rift): pusaran energi biru-ungu berputar + partikel naik.
 * Deteksi masuk: pemain berjalan ke pusat portal (≤ 1,6 m). Portal "dipersenjatai" lagi hanya setelah
 * pemain menjauh ≥ 4 m dari semua portal → tidak ada teleport berulang tanpa sengaja.
 */
import * as THREE from 'three';
import type { Rift } from '@eduverse/shared';
import { makeLabelSprite } from '../../engine/signs.js';

function swirlTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, '#c4b5fd');
  grad.addColorStop(0.5, '#6d28d9');
  grad.addColorStop(0.8, '#1d4ed8');
  grad.addColorStop(1, 'rgba(29,78,216,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  for (let arm = 0; arm < 4; arm++) {
    g.beginPath();
    for (let t = 0; t < 1; t += 0.01) {
      const a = arm * (Math.PI / 2) + t * 5.5;
      const r = t * S * 0.48;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = arm % 2 ? 'rgba(125,211,252,0.9)' : 'rgba(232,121,249,0.85)';
    g.lineWidth = 10;
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface RiftView {
  rift: Rift;
  group: THREE.Group;
  disc: THREE.Mesh;
  disc2: THREE.Mesh;
  ring: THREE.Mesh;
  particles: THREE.Points;
  speeds: Float32Array;
}

export class RiftSystem {
  readonly root = new THREE.Group();
  private views: RiftView[] = [];
  private tex = swirlTexture();
  private armed = true;
  private cooldownUntil = 0;
  particleScale = 1;

  constructor(scene: THREE.Scene, rifts: Rift[], private nameOf: (id: string) => string) {
    scene.add(this.root);
    const discMat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x8b5cf6 });
    const ptsMat = new THREE.PointsMaterial({ color: 0xa5f3fc, size: 0.22, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const r of rifts) {
      const g = new THREE.Group();
      g.position.set(r.x, r.y, r.z);
      g.rotation.y = r.ry;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.9, 40), discMat);
      disc.position.y = 2.3;
      const disc2 = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), discMat);
      disc2.position.y = 2.3;
      disc2.position.z = 0.05;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.2, 8, 40), ringMat);
      ring.position.y = 2.3;
      const n = 60;
      const pos = new Float32Array(n * 3);
      const speeds = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = 0.5 + Math.random() * 1.8;
        pos[i * 3] = Math.cos(a) * rr;
        pos[i * 3 + 1] = Math.random() * 4.5;
        pos[i * 3 + 2] = Math.sin(a) * rr * 0.4;
        speeds[i] = 0.6 + Math.random() * 1.4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const particles = new THREE.Points(geo, ptsMat);
      const isGate = !r.to;
      const label = makeLabelSprite(isGate ? 'Gerbang Antardunia' : `Lubang Dimensi → ${this.nameOf(r.to)}`, { bg: '#1E1B4B', fg: '#FFFFFF', border: '#8B5CF6', scale: 0.011 });
      label.position.y = 5.1;
      g.add(disc, disc2, ring, particles, label);
      this.root.add(g);
      this.views.push({ rift: r, group: g, disc, disc2, ring, particles, speeds });
    }
  }

  /** Portal terdekat yang sedang dimasuki pemain (atau null). */
  check(x: number, y: number, z: number, now: number): Rift | null {
    let nearest = Infinity;
    let hit: Rift | null = null;
    for (const v of this.views) {
      const r = v.rift;
      const d = Math.hypot(r.x - x, r.z - z);
      if (Math.abs(r.y - y) < 3) {
        nearest = Math.min(nearest, d);
        if (d < 1.6) hit = r;
      }
    }
    if (nearest > 4) this.armed = true;
    if (!hit || !this.armed || now < this.cooldownUntil) return null;
    this.armed = false;
    this.cooldownUntil = now + 2.5;
    return hit;
  }

  /** Dipanggil setelah teleport: portal di tujuan tidak langsung memicu lagi. */
  disarm(now: number) {
    this.armed = false;
    this.cooldownUntil = now + 2.5;
  }

  /** Portal dalam jarak tertentu (untuk prompt "Masuk lubang dimensi"). */
  near(x: number, y: number, z: number, r = 3.5): Rift | null {
    for (const v of this.views) if (Math.hypot(v.rift.x - x, v.rift.z - z) < r && Math.abs(v.rift.y - y) < 3) return v.rift;
    return null;
  }

  update(dt: number, px: number, pz: number) {
    for (const v of this.views) {
      const far = Math.hypot(v.rift.x - px, v.rift.z - pz) > 260;
      v.group.visible = !far;
      if (far) continue;
      v.disc.rotation.z += dt * 2.2;
      v.disc2.rotation.z -= dt * 3.1;
      v.ring.rotation.z += dt * 0.6;
      const s = 1 + Math.sin(performance.now() / 300 + v.rift.x) * 0.04;
      v.disc.scale.setScalar(s);
      const pos = v.particles.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const n = Math.max(8, Math.floor((arr.length / 3) * this.particleScale));
      v.particles.geometry.setDrawRange(0, n);
      for (let i = 0; i < n; i++) {
        arr[i * 3 + 1]! += v.speeds[i]! * dt;
        if (arr[i * 3 + 1]! > 4.6) arr[i * 3 + 1] = 0;
      }
      pos.needsUpdate = true;
    }
  }

  dispose() {
    this.tex.dispose();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Points).isPoints) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      if ((o as THREE.Sprite).isSprite) {
        const mat = (o as THREE.Sprite).material;
        mat.map?.dispose();
        mat.dispose();
      }
    });
    this.root.removeFromParent();
  }
}
