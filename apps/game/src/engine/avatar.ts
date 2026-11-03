/** Avatar voxel EDUVERSE dari AvatarConfig + animasi prosedural. */
import * as THREE from 'three';
import { AVATAR_OPTIONS, type AvatarConfig } from '@eduverse/shared';

export const ANIM = { idle: 0, walk: 1, run: 2, air: 3, swim: 4, sit: 5 } as const;

const box = (w: number, h: number, d: number, color: number | string, y = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, y, 0), new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
};

export class AvatarMesh {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private phase = 0;
  emote = -1;
  private emoteT = 0;

  constructor(cfg: AvatarConfig) {
    this.build(cfg);
    this.root.add(this.body);
  }

  build(cfg: AvatarConfig) {
    for (const g of [this.body, this.head, this.armL, this.armR, this.legL, this.legR]) {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      g.clear();
    }
    const skin = AVATAR_OPTIONS.kulit[cfg.kulit]?.warna ?? '#C68A5B';
    const outfit = AVATAR_OPTIONS.baju[cfg.baju] ?? AVATAR_OPTIONS.baju[0];
    const accent = AVATAR_OPTIONS.warna[cfg.warna] ?? '#3BA7FF';
    const hairC = '#2D1B10';

    // Kaki (poros di pinggul)
    for (const [leg, x] of [
      [this.legL, -0.17],
      [this.legR, 0.17],
    ] as const) {
      leg.position.set(x, 0.78, 0);
      leg.add(box(0.3, 0.62, 0.32, outfit.bawah, -0.31), box(0.32, 0.16, 0.38, '#1F2937', -0.7));
      this.body.add(leg);
    }
    // Badan
    const torso = box(0.72, 0.72, 0.4, outfit.atas, 1.14);
    this.body.add(torso);
    if (cfg.baju === 0) this.body.add(box(0.12, 0.34, 0.02, '#D32F2F', 1.32).translateZ(0.21)); // dasi seragam
    if (cfg.baju === 3) this.body.add(box(0.5, 0.08, 0.02, '#D32F2F', 1.38).translateZ(0.21)); // hasduk pramuka
    // Lengan (poros di bahu)
    for (const [arm, x] of [
      [this.armL, -0.48],
      [this.armR, 0.48],
    ] as const) {
      arm.position.set(x, 1.46, 0);
      arm.add(box(0.24, 0.3, 0.28, outfit.atas, -0.15), box(0.22, 0.4, 0.26, skin, -0.5));
      this.body.add(arm);
    }
    // Kepala
    this.head.position.set(0, 1.5, 0);
    this.head.add(box(0.62, 0.62, 0.6, skin, 0.31));
    const eye = (x: number) => box(0.08, 0.1, 0.02, '#1E2A4A', 0.36).translateX(x).translateZ(0.305);
    this.head.add(eye(-0.13), eye(0.13), box(0.18, 0.04, 0.02, '#9B3B3B', 0.18).translateZ(0.305));
    switch (cfg.rambut) {
      case 0:
        this.head.add(box(0.66, 0.16, 0.64, hairC, 0.66), box(0.66, 0.3, 0.12, hairC, 0.5).translateZ(-0.27));
        break;
      case 1:
        this.head.add(box(0.66, 0.16, 0.64, hairC, 0.66), box(0.68, 0.7, 0.14, hairC, 0.32).translateZ(-0.28), box(0.1, 0.5, 0.5, hairC, 0.4).translateX(-0.34), box(0.1, 0.5, 0.5, hairC, 0.4).translateX(0.34));
        break;
      case 2: // jilbab
        this.head.add(box(0.7, 0.2, 0.66, accent, 0.68), box(0.12, 0.72, 0.66, accent, 0.3).translateX(-0.36), box(0.12, 0.72, 0.66, accent, 0.3).translateX(0.36), box(0.72, 0.74, 0.14, accent, 0.32).translateZ(-0.3), box(0.74, 0.22, 0.5, accent, -0.04));
        break;
      default: // kuncir
        this.head.add(box(0.66, 0.16, 0.64, hairC, 0.66), box(0.2, 0.42, 0.2, hairC, 0.5).translateZ(-0.38), box(0.24, 0.1, 0.24, accent, 0.62).translateZ(-0.38));
    }
    switch (cfg.topi) {
      case 1:
        this.head.add(box(0.68, 0.2, 0.66, '#E53935', 0.74), box(0.68, 0.06, 0.32, '#E53935', 0.66).translateZ(0.44));
        break;
      case 2:
        this.head.add(box(1, 0.06, 1, '#C98A4B', 0.7), box(0.64, 0.3, 0.64, '#C98A4B', 0.86), box(0.66, 0.08, 0.66, accent, 0.75));
        break;
      case 3:
        this.head.add(box(0.76, 0.5, 0.74, accent, 0.62), box(0.56, 0.14, 0.04, '#5CF2C8', 0.42).translateZ(0.38), box(0.06, 0.3, 0.06, '#1E2A4A', 1.02));
        break;
    }
    if (cfg.aksesori === 1) this.body.add(box(0.54, 0.6, 0.24, accent, 1.12).translateZ(-0.32), box(0.4, 0.2, 0.06, '#FFC93C', 0.96).translateZ(-0.46));
    if (cfg.aksesori === 2) this.body.add(box(0.76, 0.14, 0.46, accent, 1.46), box(0.14, 0.36, 0.06, accent, 1.25).translateX(0.18).translateZ(0.23));
    this.body.add(this.head);
  }

  /** Perbarui pose. anim: kode ANIM; speed 0..1 relatif terhadap lari. */
  update(dt: number, anim: number, speed01: number) {
    const b = this.body;
    let swing = 0;
    let armSwing = 0;
    b.rotation.x = 0;
    b.position.y = 0;
    this.head.rotation.set(0, 0, 0);
    if (anim === ANIM.walk || anim === ANIM.run) {
      this.phase += dt * (anim === ANIM.run ? 13 : 8.5) * Math.max(0.4, speed01);
      swing = Math.sin(this.phase) * (anim === ANIM.run ? 0.95 : 0.6);
      armSwing = -swing * 0.9;
      b.position.y = Math.abs(Math.cos(this.phase)) * 0.06;
      if (anim === ANIM.run) b.rotation.x = 0.12;
    } else if (anim === ANIM.air) {
      swing = 0.4;
      armSwing = -2.6;
    } else if (anim === ANIM.swim) {
      this.phase += dt * 6;
      b.rotation.x = 1.25;
      b.position.y = 0.6;
      swing = Math.sin(this.phase) * 0.5;
      armSwing = Math.sin(this.phase) * 2.2;
    } else if (anim === ANIM.sit) {
      this.legL.rotation.x = -1.5;
      this.legR.rotation.x = -1.5;
      b.position.y = -0.35;
      this.armL.rotation.x = -0.3;
      this.armR.rotation.x = -0.3;
      return;
    } else {
      this.phase += dt * 2;
      b.position.y = Math.sin(this.phase) * 0.012;
    }
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.set(armSwing, 0, 0);
    this.armR.rotation.set(anim === ANIM.air ? armSwing : -armSwing, 0, 0);

    // Emote (dari roda emote): 0 lambai, 1 hore, 2 tunjuk, 3 joget, 4 berpikir, 5 hati
    if (this.emote >= 0) {
      this.emoteT += dt;
      const t = this.emoteT;
      switch (this.emote) {
        case 0:
          this.armR.rotation.set(-2.8, 0, Math.sin(t * 10) * 0.4);
          break;
        case 1:
          this.armL.rotation.set(-2.9, 0, 0);
          this.armR.rotation.set(-2.9, 0, 0);
          b.position.y = Math.abs(Math.sin(t * 8)) * 0.3;
          break;
        case 2:
          this.armR.rotation.set(-1.6, 0, 0);
          break;
        case 3:
          b.rotation.y = Math.sin(t * 6) * 0.5;
          this.armL.rotation.set(-1.4 + Math.sin(t * 12) * 0.6, 0, 0);
          this.armR.rotation.set(-1.4 - Math.sin(t * 12) * 0.6, 0, 0);
          break;
        case 4:
          this.armR.rotation.set(-2.2, 0, -0.6);
          this.head.rotation.z = 0.2;
          break;
        default:
          this.armL.rotation.set(-2.4, 0, 0.6);
          this.armR.rotation.set(-2.4, 0, -0.6);
      }
    } else {
      this.emoteT = 0;
      b.rotation.y = 0;
    }
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
