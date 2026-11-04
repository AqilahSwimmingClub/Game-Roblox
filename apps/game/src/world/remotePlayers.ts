/**
 * Avatar pemain lain. Server mengirim snapshot 10×/detik hanya untuk pemain terdekat
 * (interest management); klien menginterpolasi 120 ms di belakang waktu server agar gerak halus,
 * dan menyembunyikan avatar terjauh bila melebihi batas kualitas grafis perangkat.
 */
import * as THREE from 'three';
import { modeFromCode, type RemotePlayer, type AvatarConfig, type CompactPlayer, type MoveMode, type VehicleKind } from '@eduverse/shared';
import { AvatarMesh, ANIM } from '../engine/avatar.js';
import { makeLabelSprite } from '../engine/signs.js';
import { buildVehicle, buildJetpack, disposeModel, type VehicleModel } from './living/meshes.js';

type Compact = CompactPlayer | [string, number, number, number, number, number, number];
const VEHICLE_MODES: MoveMode[] = ['sepeda', 'motor', 'mobil', 'bus', 'pesawat'];
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
  /** Grup yang dipindah & diputar (avatar + kendaraan). */
  holder: THREE.Group;
  mode: MoveMode;
  color: number;
  tp: number;
  vehicle: VehicleModel | null;
  jet: ReturnType<typeof buildJetpack> | null;
  prevY: number;
}

const DELAY = 120;

export class RemotePlayers {
  readonly root = new THREE.Group();
  private map = new Map<string, Remote>();
  private offset = 0; // serverTime − localTime
  maxVisible = 20;
  /** Efek saat pemain lain keluar dari lubang dimensi / teleport. */
  onTeleport: ((x: number, y: number, z: number) => void) | null = null;

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
        const [id, x, y, z, ry, anim, emote, mode, tp, vc] = item as CompactPlayer;
        const r = this.map.get(id);
        if (!r) continue;
        this.setTp(r, tp, x, y, z);
        r.samples.push({ t: msg.t, x, y, z, ry });
        r.anim = anim;
        this.setEmote(r, emote);
        this.setMode(r, mode ?? 0, vc ?? 0);
      } else {
        let r = this.map.get(item.id);
        if (!r) r = this.add(item.id, item.nama, item.absen, item.avatar, item.x, item.y, item.z);
        else if (item.avatar) r.avatar.build(item.avatar); // karakter diganti (tidak membangun ulang bila sama)
        this.setTp(r, item.tp, item.x, item.y, item.z);
        r.samples.push({ t: msg.t, x: item.x, y: item.y, z: item.z, ry: item.ry });
        r.anim = item.anim;
        this.setEmote(r, item.emote);
        this.setMode(r, item.mode ?? 0, item.vc ?? 0);
      }
    }
    for (const r of this.map.values()) if (r.samples.length > 20) r.samples.splice(0, r.samples.length - 20);
  }

  /** Teleport (lift / lubang dimensi): langsung pindah tanpa interpolasi melintasi kota. */
  private setTp(r: Remote, tp: number | undefined, x: number, y: number, z: number) {
    if (tp === undefined || tp === r.tp) return;
    const first = r.tp < 0;
    r.tp = tp;
    if (first) return;
    r.samples.length = 0;
    r.pos.set(x, y, z);
    r.holder.position.set(x, y, z);
    this.onTeleport?.(x, y, z);
  }

  /** Ganti tampilan sesuai mode gerak: kendaraan di bawah avatar, jetpack di punggung. */
  private setMode(r: Remote, code: number, color: number) {
    const mode = modeFromCode(code);
    if (mode === r.mode && color === r.color) return;
    r.mode = mode;
    r.color = color;
    if (r.vehicle) {
      disposeModel(r.vehicle);
      r.vehicle = null;
    }
    if (r.jet) {
      r.jet.group.removeFromParent();
      r.jet = null;
    }
    r.holder.add(r.avatar.root);
    r.avatar.root.position.set(0, 0, 0);
    if (VEHICLE_MODES.includes(mode)) {
      const m = buildVehicle(mode as VehicleKind, color || 0x3ba7ff);
      r.holder.add(m.group);
      m.group.add(r.avatar.root);
      r.avatar.root.position.copy(m.seat).setY(m.seat.y - (m.straddle ? 0.5 : 0.43));
      r.vehicle = m;
    } else if (mode === 'jetpack') {
      r.jet = buildJetpack();
      r.avatar.root.add(r.jet.group);
    }
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
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.add(avatar.root);
    this.root.add(holder);
    const r: Remote = { id, nama, absen, avatar, label, samples: [], anim: 0, emote: -1, pos: new THREE.Vector3(x, y, z), holder, mode: 'jalan', color: 0, tp: -1, vehicle: null, jet: null, prevY: y };
    this.map.set(id, r);
    return r;
  }

  remove(id: string) {
    const r = this.map.get(id);
    if (!r) return;
    const mat = r.label.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.dispose();
    if (r.vehicle) disposeModel(r.vehicle);
    r.avatar.dispose();
    r.holder.removeFromParent();
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
      r.holder.position.copy(r.pos);
      r.holder.rotation.y = a.ry + dry * f;
      const moving = Math.hypot(b.x - a.x, b.z - a.z) / Math.max(0.05, span / 1000);
      if (r.vehicle) {
        r.avatar.update(dt, ANIM.sit, 0);
        const v = r.vehicle;
        for (const w of v.wheels) w.rotation.x += (moving / v.wheelRadius) * dt;
        if (v.prop) v.prop.rotation.z += dt * (moving > 1 ? 40 : 0);
        if (r.mode === 'pesawat') {
          const vy = (b.y - a.y) / Math.max(0.05, span / 1000);
          v.group.rotation.x += (-Math.atan2(vy, Math.max(8, moving)) - v.group.rotation.x) * Math.min(1, dt * 4);
        }
      } else {
        r.avatar.update(dt, r.anim, Math.min(1, moving / 7.5));
        if (r.jet) for (const fl of r.jet.flames) fl.visible = r.anim === ANIM.air;
      }
      vis.push({ r, d: r.pos.distanceTo(camPos) });
    }
    vis.sort((p, q) => p.d - q.d);
    vis.forEach((v, i) => (v.r.holder.visible = i < this.maxVisible));
  }

  count() {
    return this.map.size;
  }

  /** Mode gerak pemain lain yang tampil (uji otomatis: kendaraan terlihat oleh pemain lain). */
  modes(): { nama: string; mode: MoveMode; vehicleVisible: boolean; jetpackVisible: boolean; x: number; y: number; z: number }[] {
    return [...this.map.values()].map((r) => ({ nama: r.nama, mode: r.mode, vehicleVisible: !!r.vehicle, jetpackVisible: !!r.jet, x: Math.round(r.pos.x), y: Math.round(r.pos.y), z: Math.round(r.pos.z) }));
  }

  positions(): { x: number; z: number }[] {
    return [...this.map.values()].map((r) => ({ x: r.pos.x, z: r.pos.z }));
  }

  dispose() {
    this.clear();
    this.root.removeFromParent();
  }
}
