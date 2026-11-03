/** Confetti dan kembang api (partikel GPU sederhana) untuk podium & jawaban benar. */
import * as THREE from 'three';

const COLORS = [0x3ba7ff, 0xffc93c, 0x2fbf71, 0xff8a3d, 0x8b5cf6, 0xe86fa8];

interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  life: number;
  max: number;
  gravity: number;
}

export class Effects {
  private bursts: Burst[] = [];
  scale = 1; // pengali jumlah partikel (kualitas grafis)

  constructor(private scene: THREE.Scene) {}

  private spawn(n: number, origin: THREE.Vector3, speed: number, up: number, life: number, gravity: number, size: number, spread = 1) {
    const count = Math.max(8, Math.floor(n * this.scale));
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      pos[i * 3] = origin.x + (Math.random() - 0.5) * spread;
      pos[i * 3 + 1] = origin.y;
      pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      vel[i * 3] = Math.cos(a) * Math.cos(e) * speed * Math.random();
      vel[i * 3 + 1] = up + Math.sin(e) * speed * Math.random();
      vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * speed * Math.random();
      c.setHex(COLORS[i % COLORS.length]!);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, vel, life: life, max: life, gravity });
  }

  confetti(at: THREE.Vector3, n = 220) {
    this.spawn(n, at, 6, 4, 4.5, 5, 0.35, 10);
  }

  firework(at: THREE.Vector3) {
    this.spawn(160, at, 16, 0, 1.8, 6, 0.5);
  }

  sparkle(at: THREE.Vector3) {
    this.spawn(50, at, 4, 4, 1.1, 8, 0.25);
  }

  update(dt: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.life -= dt;
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const p = attr.array as Float32Array;
      for (let j = 0; j < b.vel.length; j += 3) {
        b.vel[j + 1]! -= b.gravity * dt;
        b.vel[j]! *= 0.985;
        b.vel[j + 2]! *= 0.985;
        p[j]! += b.vel[j]! * dt;
        p[j + 1]! += b.vel[j + 1]! * dt;
        p[j + 2]! += b.vel[j + 2]! * dt;
      }
      attr.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.min(1, b.life / (b.max * 0.4));
      if (b.life <= 0) {
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.scene.remove(b.points);
        this.bursts.splice(i, 1);
      }
    }
  }

  clear() {
    for (const b of this.bursts) {
      b.points.geometry.dispose();
      (b.points.material as THREE.Material).dispose();
      this.scene.remove(b.points);
    }
    this.bursts = [];
  }
}
