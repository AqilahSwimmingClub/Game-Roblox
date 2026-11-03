/**
 * Avatar pemain lain. Server mengirim snapshot 10×/detik hanya untuk pemain terdekat
 * (interest management); klien menginterpolasi 120 ms di belakang waktu server agar gerak halus,
 * dan menyembunyikan avatar terjauh bila melebihi batas kualitas grafis perangkat.
 */
import * as THREE from 'three';
import type { RemotePlayer, AvatarConfig } from '@eduverse/shared';
import { AvatarMesh } from '../engine/avatar.js';
import { makeLabelSprite } from '../engine/signs.js';

type Compact = [string, number, number, number, number, number, number];
interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  ry: number;
}

interface Remote {
  id: string;
  nama: string;
  absen: number;
  avatar: AvatarMesh;
  label: THREE.Sprite;
  samples: Sample[];
  anim: number;
  emote: number;
  pos: THREE.Vector3;
}

const DELAY = 120;

export class RemotePlayers {
  readonly root = new THREE.Group();
  private map = new Map<string, Remote>();
  private offset = 0; // serverTime − localTime
  maxVisible = 20;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Karakter avatar pemain lain yang sedang tampil (untuk uji otomatis). */
  characters(): { nama: string; karakter: number }[] {
    return [...this.map.values()].map((r) => ({ nama: r.nama, karakter: Number(r.avatar.key.split(':')[0]) }));
  }

  /** Terapkan snapshot server {t, list, gone}. */
  apply(msg: { t: number; list: (RemotePlayer | Compact)[]; gone: string[] }) {
    const localNow = performance.now();
    const off = msg.t - localNow;
    this.offset = this.offset === 0 ? off : this.offset * 0.9 + off * 0.1;
    for (const id of msg.gone) this.remove(id);
    for (const item of msg.list) {
      if (Array.isArray(item)) {
        const [id, x, y, z, ry, anim, emote] = item;
        const r = this.map.get(id);
        if (!r) continue;
        r.samples.push({ t: msg.t, x, y, z, ry });
        r.anim = anim;
        this.setEmote(r, emote);
      } else {
        let r = this.map.get(item.id);
        if (!r) r = this.add(item.id, item.nama, item.absen, item.avatar, item.x, item.y, item.z);
        else if (item.avatar) r.avatar.build(item.avatar); // karakter diganti (tidak membangun ulang bila sama)
        r.samples.push({ t: msg.t, x: item.x, y: item.y, z: item.z, ry: item.ry });
        r.anim = item.anim;
        this.setEmote(r, item.emote);
      }
    }
    for (const r of this.map.values()) if (r.samples.length > 20) r.samples.splice(0, r.samples.length - 20);
  }

  private setEmote(r: Remote, e: number) {
    if (r.emote === e) return;
    r.emote = e;
    r.avatar.emote = e;
  }

  private add(id: string, nama: string, absen: number, cfg: AvatarConfig, x: number, y: number, z: number): Remote {
    const avatar = new AvatarMesh(cfg);
    const label = makeLabelSprite(`${nama} · ${String(absen).padStart(2, '0')}`, { border: '#3BA7FF' });
    label.position.y = 2.55;
    avatar.root.add(label);
    avatar.root.position.set(x, y, z);
    this.root.add(avatar.root);
    const r: Remote = { id, nama, absen, avatar, label, samples: [], anim: 0, emote: -1, pos: new THREE.Vector3(x, y, z) };
    this.map.set(id, r);
    return r;
  }

  remove(id: string) {
    const r = this.map.get(id);
    if (!r) return;
    const mat = r.label.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.dispose();
    r.avatar.dispose();
    this.map.delete(id);
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }

  update(dt: number, camPos: THREE.Vector3) {
    const renderT = performance.now() + this.offset - DELAY;
    const vis: { r: Remote; d: number }[] = [];
    for (const r of this.map.values()) {
      const s = r.samples;
      if (!s.length) continue;
      let a = s[0]!;
      let b = s[s.length - 1]!;
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i]!.t <= renderT && s[i + 1]!.t >= renderT) {
          a = s[i]!;
          b = s[i + 1]!;
          break;
        }
      }
      const span = b.t - a.t;
      const f = span > 0 ? Math.max(0, Math.min(1, (renderT - a.t) / span)) : 1;
      r.pos.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      let dry = b.ry - a.ry;
      while (dry > Math.PI) dry -= Math.PI * 2;
      while (dry < -Math.PI) dry += Math.PI * 2;
      r.avatar.root.position.copy(r.pos);
      r.avatar.root.rotation.y = a.ry + dry * f;
      const moving = Math.hypot(b.x - a.x, b.z - a.z) / Math.max(0.05, span / 1000);
      r.avatar.update(dt, r.anim, Math.min(1, moving / 7.5));
      vis.push({ r, d: r.pos.distanceTo(camPos) });
    }
    vis.sort((p, q) => p.d - q.d);
    vis.forEach((v, i) => (v.r.avatar.root.visible = i < this.maxVisible));
  }

  count() {
    return this.map.size;
  }

  positions(): { x: number; z: number }[] {
    return [...this.map.values()].map((r) => ({ x: r.pos.x, z: r.pos.z }));
  }

  dispose() {
    this.clear();
    this.root.removeFromParent();
  }
}
