/**
 * Stage: memuat satu adegan (lobi, kota, podium) — tampilan chunk, tabrakan, objek interaktif.
 * Dunia lain (Hutan, Laut, Angkasa) cukup menambah builder layout baru di paket shared;
 * engine, chunk, tabrakan, dan sistem soal tidak perlu diubah.
 */
import * as THREE from 'three';
import { buildKota, buildLobby, buildPodium, WORLDS, type ActivePoint, type PodiumEntry, type SceneId, type WorldId } from '@eduverse/shared';
import { CollisionWorld } from '../engine/collision.js';
import { WorldView } from '../engine/worldView.js';
import { AvatarMesh } from '../engine/avatar.js';
import { makeLabelSprite } from '../engine/signs.js';
import type { Engine } from '../engine/engine.js';
import { QuestionPoints, ACTION_LABEL, objectName } from './questionPoints.js';
import { Bus } from './bus.js';

export interface Prompt {
  kind: 'soal' | 'lift' | 'rak' | 'bus' | 'portal';
  id: string;
  label: string;
  object?: string;
  world?: WorldId;
}

export class Stage {
  readonly scene: SceneId;
  readonly collision = new CollisionWorld();
  view: WorldView | null = null;
  points: QuestionPoints | null = null;
  bus: Bus | null = null;
  half = 50;
  spawn = { x: 0, y: 0.2, z: 0 };
  private extras = new THREE.Group();
  private portalDiscs: { mesh: THREE.Mesh; world: WorldId; x: number; z: number }[] = [];
  private podiumAvatars: AvatarMesh[] = [];
  private lifts: { id: string; label: string; x: number; y: number; z: number }[] = [];
  private rak: { id: string; label: string; x: number; y: number; z: number; boxIndex: number } | null = null;
  private rakOpenUntil = 0;
  enabledWorlds: WorldId[] = ['kota'];

  constructor(
    private engine: Engine,
    scene: SceneId,
  ) {
    this.scene = scene;
    engine.scene.add(this.extras);
    if (scene === 'lobi') this.loadLobby();
    else if (scene === 'podium') this.loadPodium();
    else this.loadKota();
    this.applyQuality();
  }

  applyQuality() {
    if (!this.view) return;
    const p = this.engine.profile;
    this.view.viewDistance = p.viewDistance;
    this.view.lodDistance = p.lodDistance;
    this.view.setShadows(p.shadows);
  }

  private loadLobby() {
    const l = buildLobby();
    this.half = l.half;
    this.spawn = l.spawnPoint;
    this.view = new WorldView({ boxes: l.boxes, discs: l.discs, signs: l.signs, trees: l.trees, lamps: [] }, this.engine.scene);
    this.collision.addBoxes(l.boxes);
    this.collision.addDiscs(l.discs);
    for (const p of l.portals) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(3, 32), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      disc.position.set(p.x, 3.7, p.z);
      this.extras.add(disc);
      const info = WORLDS.find((w) => w.id === p.world)!;
      const label = makeLabelSprite(info.nama.toUpperCase(), { border: '#' + p.color.toString(16).padStart(6, '0'), scale: 0.016 });
      label.position.set(p.x, 10.6, p.z);
      this.extras.add(label);
      this.portalDiscs.push({ mesh: disc, world: p.world, x: p.x, z: p.z });
    }
    // Maskot Edo 3D: robot kubus dengan layar wajah
    const edo = new THREE.Group();
    const b = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, basic = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic ? new THREE.MeshBasicMaterial({ color: c }) : new THREE.MeshLambertMaterial({ color: c }));
      m.position.set(x, y, z);
      edo.add(m);
    };
    b(1.6, 1.6, 1.6, 0x3ba7ff, 0, 1.6, 0);
    b(1.2, 0.8, 0.05, 0x1e2a4a, 0, 1.75, 0.82);
    b(0.18, 0.3, 0.02, 0x5cf2c8, -0.26, 1.85, 0.86, true);
    b(0.18, 0.3, 0.02, 0x5cf2c8, 0.26, 1.85, 0.86, true);
    b(0.4, 0.08, 0.02, 0x5cf2c8, 0, 1.55, 0.86, true);
    b(0.1, 0.5, 0.1, 0x1e2a4a, 0, 2.65, 0);
    b(0.3, 0.3, 0.3, 0xffc93c, 0, 2.95, 0, true);
    b(1, 0.8, 1, 0x1e2a4a, 0, 0.4, 0);
    edo.position.set(l.edo.x, 0, l.edo.z);
    edo.rotation.y = -0.4;
    edo.userData.edo = true;
    const say = makeLabelSprite('Halo! Aku Edo. Pilih portal dunia!', { border: '#3BA7FF', scale: 0.009 });
    say.position.y = 3.6;
    edo.add(say);
    this.extras.add(edo);
    this.collision.add({ id: -2, x0: l.edo.x - 0.8, x1: l.edo.x + 0.8, y0: 0, y1: 2.4, z0: l.edo.z - 0.8, z1: l.edo.z + 0.8 });
  }

  /** Tandai portal yang dibuka guru (lainnya redup). */
  setEnabledWorlds(worlds: WorldId[]) {
    this.enabledWorlds = worlds;
    for (const p of this.portalDiscs) {
      const on = worlds.includes(p.world) && !!WORLDS.find((w) => w.id === p.world)?.tersedia;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = on ? 0.6 : 0.18;
    }
  }

  private loadKota() {
    const k = buildKota();
    this.half = 600;
    this.spawn = k.spawnPoint;
    this.view = new WorldView({ boxes: k.boxes, discs: k.discs, signs: k.signs, trees: k.trees, lamps: k.lamps }, this.engine.scene);
    this.collision.addBoxes(k.boxes);
    this.collision.addDiscs(k.discs);
    this.collision.water = k.water;
    this.points = new QuestionPoints(this.engine.scene);
    this.bus = new Bus(this.engine.scene);
    this.lifts = k.lifts.map((l) => ({ id: l.id, label: l.label, x: l.x, y: l.y, z: l.z }));
    for (const l of k.lifts) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.6), new THREE.MeshBasicMaterial({ color: l.locked ? 0x8b5cf6 : 0x5cf2c8 }));
      pad.position.set(l.x, l.y + 0.05, l.z);
      this.extras.add(pad);
    }
    const r = k.interactables.find((i) => i.kind === 'rak');
    if (r) this.rak = { id: r.id, label: r.label, x: r.x, y: r.y, z: r.z, boxIndex: r.boxIndex };
  }

  private loadPodium() {
    const p = buildPodium();
    this.half = 40;
    this.spawn = { x: p.audience.x, y: 0.2, z: p.audience.z + 4 };
    this.view = new WorldView({ boxes: p.boxes, discs: p.discs, signs: p.signs, trees: [], lamps: [] }, this.engine.scene);
    this.collision.addBoxes(p.boxes);
  }

  /** Tempatkan avatar juara di podium: 1 tengah (tertinggi), 2 kiri, 3 kanan. */
  showWinners(top3: PodiumEntry[]) {
    for (const a of this.podiumAvatars) a.dispose();
    this.podiumAvatars = [];
    const layout = buildPodium();
    for (const e of top3) {
      const slot = layout.slots.find((s) => s.rank === e.rank);
      if (!slot) continue;
      const av = new AvatarMesh(e.avatar);
      av.root.position.set(slot.x, slot.y, slot.z);
      av.root.rotation.y = 0; // menghadap penonton (+Z)
      av.emote = 1;
      const trophy = new THREE.Group();
      const gold = new THREE.MeshBasicMaterial({ color: e.rank === 1 ? 0xffc93c : e.rank === 2 ? 0xc9d3e0 : 0xd98c4a });
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.16, 0.4, 12), gold);
      cup.position.y = 0.3;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), gold);
      trophy.add(cup, base);
      trophy.position.set(0.55, 1.2, 0.3);
      av.root.add(trophy);
      const label = makeLabelSprite(`Juara ${e.rank} · ${e.nama} · ${e.poin} poin`, { bg: '#FFFFFF', border: e.rank === 1 ? '#FFC93C' : e.rank === 2 ? '#C9D3E0' : '#D98C4A', scale: 0.012 });
      label.position.y = 3;
      av.root.add(label);
      this.engine.scene.add(av.root);
      this.podiumAvatars.push(av);
    }
  }

  /** Objek interaktif terdekat (soal, lift, rak, bus, portal). */
  nearestPrompt(x: number, y: number, z: number): Prompt | null {
    if (this.scene === 'lobi') {
      for (const p of this.portalDiscs) {
        if (Math.hypot(p.x - x, p.z - z) < 4.5) {
          const info = WORLDS.find((w) => w.id === p.world)!;
          return { kind: 'portal', id: p.world, world: p.world, label: `Masuk ${info.nama}` };
        }
      }
      return null;
    }
    if (this.points) {
      const pt = this.points.nearest(x, y, z, 3.2);
      if (pt) return { kind: 'soal', id: pt.id, label: ACTION_LABEL[pt.object] ?? 'Buka', object: objectName(pt.object) };
    }
    for (const l of this.lifts) if (Math.hypot(l.x - x, l.z - z) < 2 && Math.abs(l.y - y) < 2.5) return { kind: 'lift', id: l.id, label: l.label };
    if (this.rak && Math.hypot(this.rak.x - x, this.rak.z - z) < 3 && Math.abs(this.rak.y - y) < 3) return { kind: 'rak', id: this.rak.id, label: this.rak.label };
    if (this.bus && Math.hypot(this.bus.x - x, this.bus.z - z) < 5.5) return { kind: 'bus', id: 'bus', label: 'Naik Bus' };
    return null;
  }

  /** Geser rak rahasia perpustakaan selama 15 detik (hanya di perangkat ini). */
  openRak(now: number) {
    if (!this.rak || !this.view) return;
    this.collision.disabled.add(this.rak.boxIndex);
    this.view.hiddenBoxes.add(this.rak.boxIndex);
    this.view.refreshAt(this.rak.x, this.rak.z);
    this.rakOpenUntil = now + 15;
  }

  setPoints(list: ActivePoint[], done?: string[]) {
    this.points?.setPoints(list);
    if (done) this.points?.setDone(done);
  }

  update(dt: number, t: number, px: number, pz: number, serverNow: number) {
    this.view?.update(px, pz, t);
    this.points?.animate(t);
    this.bus?.update(serverNow);
    for (const p of this.portalDiscs) p.mesh.rotation.z += dt * 0.8;
    this.extras.children.forEach((c) => {
      if (c.userData.edo) c.position.y = Math.sin(t * 2) * 0.12;
    });
    for (const a of this.podiumAvatars) a.update(dt, 0, 0);
    if (this.rak && this.rakOpenUntil && t > this.rakOpenUntil) {
      this.rakOpenUntil = 0;
      this.collision.disabled.delete(this.rak.boxIndex);
      this.view?.hiddenBoxes.delete(this.rak.boxIndex);
      this.view?.refreshAt(this.rak.x, this.rak.z);
    }
  }

  dispose() {
    this.view?.dispose();
    this.points?.dispose();
    this.bus?.dispose();
    for (const a of this.podiumAvatars) a.dispose();
    this.extras.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      if ((o as THREE.Sprite).isSprite) {
        const mat = (o as THREE.Sprite).material;
        mat.map?.dispose();
        mat.dispose();
      }
    });
    this.extras.removeFromParent();
  }
}
