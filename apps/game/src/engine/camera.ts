/** Kamera third-person yang mengikuti avatar, bisa diputar, dan tidak menembus dinding. */
import * as THREE from 'three';
import type { CollisionWorld, Aabb } from './collision.js';

export class FollowCamera {
  yaw = 0; // 0 = kamera di sisi +Z, memandang ke −Z (utara)
  pitch = 0.32;
  distance = 7;
  minDist = 2.5;
  maxDist = 14;
  private current = new THREE.Vector3();
  private target = new THREE.Vector3();
  private scratch: Aabb[] = [];
  private initialized = false;

  constructor(private cam: THREE.PerspectiveCamera) {}

  snap() {
    this.initialized = false;
  }

  /** Arah maju relatif kamera di bidang XZ. */
  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  update(dt: number, px: number, py: number, pz: number, world: CollisionWorld | null) {
    this.target.set(px, py + 1.55, pz);
    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    let dist = this.distance;
    if (world) {
      // Mundurkan kamera bila ada dinding di antara avatar dan kamera
      for (let d = 0.6; d <= this.distance; d += 0.35) {
        const x = this.target.x + dir.x * d;
        const y = this.target.y + dir.y * d;
        const z = this.target.z + dir.z * d;
        if (world.pointBlocked(x, y, z, this.scratch)) {
          dist = Math.max(0.8, d - 0.45);
          break;
        }
      }
    }
    const desired = this.target.clone().addScaledVector(dir, dist);
    if (!this.initialized) {
      this.current.copy(desired);
      this.initialized = true;
    } else {
      // Mendekat cepat (hindari menembus), menjauh pelan (halus)
      const k = desired.distanceTo(this.target) < this.current.distanceTo(this.target) ? 18 : 6;
      this.current.lerp(desired, Math.min(1, k * dt));
    }
    this.cam.position.copy(this.current);
    this.cam.lookAt(this.target);
  }
}
