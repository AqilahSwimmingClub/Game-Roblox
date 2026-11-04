/** Pemain lokal: fisika (collision.ts), animasi avatar, dan arah hadap relatif kamera. */
import * as THREE from 'three';
import type { AvatarConfig } from '@eduverse/shared';
import { AvatarMesh, ANIM } from '../engine/avatar.js';
import { BODY, stepBody, stepBodyFly, type BodyState, type CollisionWorld } from '../engine/collision.js';
import { makeLabelSprite } from '../engine/signs.js';
import type { Input } from '../engine/input.js';
import type { FollowCamera } from '../engine/camera.js';

export class LocalPlayer {
  readonly avatar: AvatarMesh;
  readonly body: BodyState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, swimming: false, submerged: 0 };
  ry = 0;
  anim: number = ANIM.idle;
  riding = false;
  frozen = false;
  lowGravity = false;
  private label: THREE.Sprite | null = null;
  private lastSafe = { x: 0, y: 0, z: 0 };
  private safeTimer = 0;

  constructor(
    scene: THREE.Scene,
    cfg: AvatarConfig,
    private name: string,
  ) {
    this.avatar = new AvatarMesh(cfg);
    scene.add(this.avatar.root);
    this.setName(name);
  }

  setName(name: string) {
    this.name = name;
    if (this.label) {
      const mat = this.label.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
      this.label.removeFromParent();
    }
    this.label = makeLabelSprite(this.name, { border: '#FFC93C', scale: 0.0065 });
    this.label.position.y = 2.55;
    this.avatar.root.add(this.label);
  }

  setAvatar(cfg: AvatarConfig) {
    this.avatar.build(cfg);
  }

  teleport(x: number, y: number, z: number, ry?: number) {
    this.body.x = x;
    this.body.y = y;
    this.body.z = z;
    this.body.vx = 0;
    this.body.vy = 0;
    this.body.vz = 0;
    this.body.grounded = false;
    if (ry !== undefined) this.ry = ry;
    this.lastSafe = { x, y, z };
    this.sync();
  }

  private sync() {
    this.avatar.root.position.set(this.body.x, this.body.y, this.body.z);
    this.avatar.root.rotation.y = this.ry;
  }

  update(dt: number, input: Input, cam: FollowCamera, world: CollisionWorld, seat?: { x: number; y: number; z: number; heading: number }) {
    if (seat) {
      this.body.x = seat.x;
      this.body.y = seat.y;
      this.body.z = seat.z;
      this.ry = seat.heading;
      this.anim = ANIM.sit;
      this.avatar.update(dt, this.anim, 0);
      this.sync();
      return;
    }
    let wishX = 0;
    let wishZ = 0;
    if (!this.frozen && input.enabled) {
      const f = cam.forward();
      // kanan kamera = (−f.z, f.x)
      wishX = f.x * input.moveY + -f.z * input.moveX;
      wishZ = f.z * input.moveY + f.x * input.moveX;
      const len = Math.hypot(wishX, wishZ);
      if (len > 1) {
        wishX /= len;
        wishZ /= len;
      }
    }
    const speed = input.run ? BODY.run : BODY.walk;
    stepBody(world, this.body, wishX, wishZ, speed, !this.frozen && input.jump, !this.frozen && input.dive, dt, this.lowGravity);
    const hs = Math.hypot(this.body.vx, this.body.vz);
    if (hs > 0.3) {
      const target = Math.atan2(this.body.vx, this.body.vz);
      let d = target - this.ry;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.ry += d * Math.min(1, dt * 12);
    }
    if (this.body.swimming) this.anim = ANIM.swim;
    else if (!this.body.grounded) this.anim = ANIM.air;
    else if (hs > 5.6) this.anim = ANIM.run;
    else if (hs > 0.4) this.anim = ANIM.walk;
    else this.anim = ANIM.idle;
    this.avatar.update(dt, this.anim, hs / BODY.run);
    this.sync();

    // Simpan posisi aman terakhir (untuk pemulihan bila terjebak/jatuh)
    this.safeTimer += dt;
    if (this.body.grounded && this.safeTimer > 1) {
      this.safeTimer = 0;
      this.lastSafe = { x: this.body.x, y: this.body.y, z: this.body.z };
    }
  }

  /**
   * Terbang dengan jetpack: arah gerak relatif kamera seperti berjalan, kecepatan vertikal targetVy.
   * Mengembalikan true bila sedang di udara.
   */
  updateFly(dt: number, input: Input, cam: FollowCamera, world: CollisionWorld, speed: number, targetVy: number): boolean {
    let wishX = 0;
    let wishZ = 0;
    if (!this.frozen && input.enabled) {
      const f = cam.forward();
      wishX = f.x * input.moveY + -f.z * input.moveX;
      wishZ = f.z * input.moveY + f.x * input.moveX;
      const len = Math.hypot(wishX, wishZ);
      if (len > 1) {
        wishX /= len;
        wishZ /= len;
      }
    }
    stepBodyFly(world, this.body, wishX, wishZ, speed, targetVy, dt);
    const hs = Math.hypot(this.body.vx, this.body.vz);
    if (hs > 0.3) {
      const target = Math.atan2(this.body.vx, this.body.vz);
      let d = target - this.ry;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.ry += d * Math.min(1, dt * 8);
    }
    this.anim = !this.body.grounded ? ANIM.air : hs > 0.4 ? ANIM.walk : ANIM.idle;
    this.avatar.update(dt, this.anim, hs / BODY.run);
    // condong ke depan saat terbang maju
    if (!this.body.grounded) this.avatar.root.rotation.x = 0;
    this.sync();
    if (this.body.grounded) {
      this.safeTimer += dt;
      if (this.safeTimer > 1) {
        this.safeTimer = 0;
        this.lastSafe = { x: this.body.x, y: this.body.y, z: this.body.z };
      }
    }
    return !this.body.grounded;
  }

  /** Tempelkan avatar ke kursi kendaraan (avatar ikut miring bersama pesawat/motor). */
  attachTo(parent: THREE.Object3D, local: THREE.Vector3) {
    parent.add(this.avatar.root);
    this.avatar.root.position.copy(local);
    this.avatar.root.rotation.set(0, 0, 0);
    this.anim = ANIM.sit;
  }

  /** Lepas dari kendaraan, kembali ke scene. */
  detachTo(scene: THREE.Object3D) {
    scene.add(this.avatar.root);
    this.sync();
  }

  /** Perbarui animasi saja (saat menempel di kendaraan). */
  animate(dt: number, anim: number) {
    this.anim = anim;
    this.avatar.update(dt, anim, 0);
  }

  get lastSafePos() {
    return this.lastSafe;
  }

  /** Kembali ke posisi aman terakhir (tombol "Tidak bisa gerak?"). */
  recover() {
    this.teleport(this.lastSafe.x, this.lastSafe.y + 0.5, this.lastSafe.z);
  }

  dispose() {
    this.avatar.dispose();
  }
}
