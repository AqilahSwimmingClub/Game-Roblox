/**
 * Kendaraan yang bisa dikendarai: fisika kinematik ringan (tanpa physics engine).
 * - Darat (sepeda, motor, mobil, bus): model sepeda (bicycle model) + tabrakan lingkaran ganda vs AABB,
 *   naik trotoar ≤ 0,6 m, gravitasi, pemulihan otomatis bila tercebur/terjebak.
 * - Pesawat: gas (throttle), taksi di landasan, lepas landas di atas 21 m/detik, belok miring, naik/turun,
 *   pendaratan lembut, batas zona udara, dan "kembali ke bandara" bila menabrak gedung.
 * Kendaraan parkir dirender dari daftar status (server pada mode kelas, lokal pada Mode Demo).
 */
import * as THREE from 'three';
import { VEHICLE_SPEC, FLIGHT, type VehicleKind, type VehicleStateMsg } from '@eduverse/shared';
import { circleBlocked, groundBelow, type CollisionWorld } from '../../engine/collision.js';
import { buildVehicle, disposeModel, type VehicleModel } from './meshes.js';
import { makeLabelSprite } from '../../engine/signs.js';

export interface DriveInput {
  throttle: number; // −1..1 (gas / mundur-rem)
  steer: number; // −1..1 (kanan +)
  up: boolean; // pesawat: naik
  down: boolean; // pesawat: turun
  brake: boolean;
}

export interface VehicleBody {
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  vy: number;
  pitch: number;
  roll: number;
  throttle: number; // pesawat 0..1
  grounded: boolean;
  steerVis: number;
  stuck: number;
}

export type DriveEvent = { type: 'bump' } | { type: 'crash'; text: string } | { type: 'recover'; text: string } | { type: 'boundary' } | { type: 'takeoff' } | { type: 'landing' };

const LABEL: Record<VehicleKind, string> = { sepeda: 'Naik Sepeda', motor: 'Naik Motor', mobil: 'Masuk Mobil', bus: 'Kemudikan Bus', pesawat: 'Naik Pesawat' };
export const vehicleActionLabel = (k: VehicleKind) => LABEL[k];

export function newBody(v: { kind: string; x: number; y: number; z: number; heading: number }): VehicleBody {
  return { kind: v.kind as VehicleKind, x: v.x, y: v.y, z: v.z, heading: v.heading, speed: 0, vy: 0, pitch: 0, roll: 0, throttle: 0, grounded: true, steerVis: 0, stuck: 0 };
}

/** Titik pusat lingkaran tabrakan sepanjang badan kendaraan. */
function circles(b: VehicleBody, x: number, z: number, h: number): { x: number; z: number }[] {
  const s = VEHICLE_SPEC[b.kind];
  const n = Math.max(1, Math.round(s.length / (2 * s.radius)));
  const out: { x: number; z: number }[] = [];
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : -s.length / 2 + s.radius + (i * (s.length - 2 * s.radius)) / (n - 1);
    out.push({ x: x + fx * t, z: z + fz * t });
  }
  return out;
}

function blockedAt(world: CollisionWorld, b: VehicleBody, x: number, y: number, z: number, h: number) {
  const s = VEHICLE_SPEC[b.kind];
  for (const c of circles(b, x, z, h)) if (circleBlocked(world, c.x, c.z, s.radius, y + 0.6, y + s.height)) return true;
  return false;
}

/** Fisika kendaraan darat. Mengembalikan event (tabrakan dsb.) bila ada. */
export function stepGround(world: CollisionWorld, b: VehicleBody, inp: DriveInput, dt: number): DriveEvent | null {
  const s = VEHICLE_SPEC[b.kind];
  let ev: DriveEvent | null = null;
  // percepatan / rem / mundur
  if (inp.brake) b.speed -= Math.sign(b.speed) * Math.min(Math.abs(b.speed), s.brake * dt);
  else if (inp.throttle > 0.05) {
    if (b.speed < -0.2) b.speed = Math.min(0, b.speed + s.brake * dt);
    else b.speed = Math.min(s.maxSpeed * inp.throttle, b.speed + s.accel * dt * (1 - b.speed / (s.maxSpeed + 0.01) * 0.6));
  } else if (inp.throttle < -0.05) {
    if (b.speed > 0.2) b.speed = Math.max(0, b.speed - s.brake * dt);
    else b.speed = Math.max(-s.reverse, b.speed - s.accel * 0.6 * dt);
  } else b.speed -= Math.sign(b.speed) * Math.min(Math.abs(b.speed), 2.2 * dt); // menggelinding
  // belok (lebih tajam saat pelan, tidak bisa belok saat diam)
  const sf = Math.min(1, Math.abs(b.speed) / 4) * (1 - Math.min(0.5, Math.abs(b.speed) / (s.maxSpeed * 2.4)));
  const dh = -inp.steer * s.turn * sf * Math.sign(b.speed || 1) * dt;
  b.steerVis += (inp.steer * 0.5 - b.steerVis) * Math.min(1, dt * 8);
  const nh = b.heading + dh;
  if (!blockedAt(world, b, b.x, b.y, b.z, nh)) b.heading = nh;
  // gerak dengan sub-langkah
  const dist = b.speed * dt;
  const steps = Math.max(1, Math.ceil(Math.abs(dist) / 0.25));
  for (let i = 0; i < steps; i++) {
    const nx = b.x + Math.sin(b.heading) * (dist / steps);
    const nz = b.z + Math.cos(b.heading) * (dist / steps);
    if (blockedAt(world, b, nx, b.y, nz, b.heading)) {
      if (Math.abs(b.speed) > 4) ev = { type: 'bump' };
      b.speed = -b.speed * 0.2;
      break;
    }
    b.x = nx;
    b.z = nz;
  }
  // tanah (naik trotoar/tangga landai ≤ 0,6 m), gravitasi
  const g = groundBelow(world, b.x, b.z, b.y + 0.6, 0.4);
  const water = world.waterAt(b.x, b.z);
  if (g > -Infinity && b.y <= g + 0.05) {
    b.y = g;
    b.vy = 0;
    b.grounded = true;
  } else {
    b.vy -= 26 * dt;
    b.y += b.vy * dt;
    if (g > -Infinity && b.y < g) {
      b.y = g;
      b.vy = 0;
    }
    b.grounded = g > -Infinity && b.y - g < 0.05;
  }
  if (water && b.y < water.surface - 0.8) return { type: 'recover', text: 'Kendaraan tidak bisa berenang! Kendaraan dikembalikan ke jalan.' };
  // terjebak: gas ditekan tetapi tidak bergerak
  if (Math.abs(inp.throttle) > 0.5 && Math.abs(b.speed) < 0.3) b.stuck += dt;
  else b.stuck = Math.max(0, b.stuck - dt);
  b.pitch = 0;
  b.roll = b.kind === 'motor' || b.kind === 'sepeda' ? -b.steerVis * Math.min(1, Math.abs(b.speed) / 8) * 0.5 : 0;
  return ev;
}

/** Fisika pesawat ringan. */
export function stepPlane(world: CollisionWorld, b: VehicleBody, inp: DriveInput, dt: number): DriveEvent | null {
  const s = VEHICLE_SPEC.pesawat;
  let ev: DriveEvent | null = null;
  // gas: W / tombol GAS menaikkan throttle, S / REM menurunkan
  if (inp.throttle > 0.05) b.throttle = Math.min(1, b.throttle + 0.45 * dt * inp.throttle);
  if (inp.throttle < -0.05 || inp.brake) b.throttle = Math.max(0, b.throttle - 0.6 * dt);
  const target = b.throttle * s.maxSpeed;
  const drag = b.grounded && (inp.brake || inp.throttle < -0.05) ? s.brake : 2.5;
  if (b.speed < target) b.speed = Math.min(target, b.speed + s.accel * dt);
  else b.speed = Math.max(target, b.speed - drag * dt);
  if (b.grounded) {
    // taksi: kemudi roda depan
    const sf = Math.min(1, b.speed / 3);
    b.heading += -inp.steer * 1.1 * sf * dt;
    b.roll += (0 - b.roll) * Math.min(1, dt * 5);
    if (b.speed > FLIGHT.takeoffSpeed && inp.up) {
      b.grounded = false;
      b.vy = 4;
      ev = { type: 'takeoff' };
    }
    b.pitch += ((inp.up && b.speed > FLIGHT.takeoffSpeed * 0.8 ? 0.15 : 0) - b.pitch) * Math.min(1, dt * 4);
  } else {
    const fly = Math.min(1, b.speed / 30);
    b.heading += -inp.steer * s.turn * fly * dt;
    b.roll += (-inp.steer * 0.6 - b.roll) * Math.min(1, dt * 3);
    let targetVy = inp.up ? 9 : inp.down ? -10 : 0;
    if (b.speed < FLIGHT.stallSpeed) targetVy = Math.min(targetVy, -6 * (1 - b.speed / FLIGHT.stallSpeed) - 1.5);
    b.vy += (targetVy - b.vy) * Math.min(1, dt * 2);
    b.pitch += (Math.atan2(b.vy, Math.max(8, b.speed)) - b.pitch) * Math.min(1, dt * 4);
  }
  // gerak
  const dist = b.speed * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.8));
  for (let i = 0; i < steps; i++) {
    b.x += Math.sin(b.heading) * (dist / steps);
    b.z += Math.cos(b.heading) * (dist / steps);
    b.y += (b.vy * dt) / steps;
    // menabrak gedung → aman: kembali ke bandara
    if (circleBlocked(world, b.x, b.z, 1.6, b.y + 0.9, b.y + 2.4)) {
      if (b.grounded && b.speed < 9) {
        b.x -= Math.sin(b.heading) * (dist / steps) * 2;
        b.z -= Math.cos(b.heading) * (dist / steps) * 2;
        b.speed = 0;
        b.throttle = 0;
        return { type: 'bump' };
      }
      return { type: 'crash', text: 'Hati-hati! Pesawat menyentuh bangunan — pesawat dikembalikan ke bandara dengan aman.' };
    }
  }
  if (b.y > FLIGHT.maxY) {
    b.y = FLIGHT.maxY;
    b.vy = Math.min(0, b.vy);
  }
  // batas zona udara: belokkan kembali
  if (Math.abs(b.x) > FLIGHT.half || Math.abs(b.z) > FLIGHT.half) {
    const back = Math.atan2(-b.x, -b.z);
    let d = back - b.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    b.heading += Math.sign(d) * Math.min(Math.abs(d), 1.2 * dt);
    b.x = Math.max(-FLIGHT.half - 15, Math.min(FLIGHT.half + 15, b.x));
    b.z = Math.max(-FLIGHT.half - 15, Math.min(FLIGHT.half + 15, b.z));
    ev = ev ?? { type: 'boundary' };
  }
  // tanah / mendarat
  const g = groundBelow(world, b.x, b.z, b.y + 0.4, 0.8);
  const ground = g > -Infinity ? g : 0;
  if (b.y <= ground) {
    if (!b.grounded) {
      b.grounded = true;
      ev = { type: 'landing' };
      if (b.vy < -8) b.speed *= 0.5; // pendaratan keras: melambat, tetap aman
    }
    b.y = ground;
    b.vy = 0;
  } else if (b.grounded && b.y > ground + 0.05) {
    b.y = Math.max(ground, b.y - 9 * dt);
  }
  const water = world.waterAt(b.x, b.z);
  if (water && b.grounded) return { type: 'recover', text: 'Pesawat tidak bisa mendarat di air — dikembalikan ke bandara.' };
  return ev;
}

/** Cari titik turun yang aman di samping kendaraan (kiri, kanan, belakang, depan, lalu di atas). */
export function exitSpot(world: CollisionWorld, b: VehicleBody): { x: number; y: number; z: number } {
  const s = VEHICLE_SPEC[b.kind];
  const side = s.radius + 1.1;
  const fx = Math.sin(b.heading);
  const fz = Math.cos(b.heading);
  const cands = [
    { x: b.x + fz * side, z: b.z - fx * side },
    { x: b.x - fz * side, z: b.z + fx * side },
    { x: b.x - fx * (s.length / 2 + 1), z: b.z - fz * (s.length / 2 + 1) },
    { x: b.x + fx * (s.length / 2 + 1), z: b.z + fz * (s.length / 2 + 1) },
    { x: b.x + fz * (side + 2.5), z: b.z - fx * (side + 2.5) },
  ];
  for (const c of cands) {
    const g = groundBelow(world, c.x, c.z, b.y + 1.2, 0.35);
    if (g === -Infinity || Math.abs(g - b.y) > 1.5) continue;
    if (!circleBlocked(world, c.x, c.z, 0.45, g + 0.45, g + 1.75)) return { x: c.x, y: g + 0.05, z: c.z };
  }
  return { x: b.x, y: b.y + s.height + 0.3, z: b.z };
}

/** Terapkan pose body ke model 3D (dipakai pemain lokal & kendaraan parkir). */
export function poseModel(m: VehicleModel, b: { x: number; y: number; z: number; heading: number; pitch?: number; roll?: number; speed?: number; steerVis?: number }, dt: number, spin = true) {
  m.group.position.set(b.x, b.y, b.z);
  m.group.rotation.set(0, 0, 0);
  m.group.rotation.order = 'YXZ';
  m.group.rotation.y = b.heading;
  m.group.rotation.x = -(b.pitch ?? 0);
  m.group.rotation.z = b.roll ?? 0;
  const sp = b.speed ?? 0;
  if (spin) for (const w of m.wheels) w.rotation.x += (sp / m.wheelRadius) * dt;
  if (m.steer) m.steer.rotation.y = -(b.steerVis ?? 0);
  if (m.prop) m.prop.rotation.z += dt * (sp > 0.5 ? 40 : 0);
}

/** Kendaraan parkir/terlihat di dunia (yang tidak sedang dikemudikan siapa pun). */
export class ParkedVehicles {
  private items = new Map<string, { state: VehicleStateMsg; model: VehicleModel | null; label: THREE.Sprite | null }>();
  private accum = 0;
  hiddenId: string | null = null; // kendaraan yang sedang dikemudikan pemain lokal
  viewDistance = 220;

  constructor(private scene: THREE.Scene) {}

  setStates(list: VehicleStateMsg[]) {
    const seen = new Set<string>();
    for (const st of list) {
      seen.add(st.id);
      const it = this.items.get(st.id);
      if (it) {
        it.state = st;
        if (it.model) poseModel(it.model, st, 0, false);
      } else this.items.set(st.id, { state: st, model: null, label: null });
    }
    for (const [id, it] of this.items) if (!seen.has(id)) this.drop(id, it);
    this.refreshVisibility(true);
  }

  get(id: string) {
    return this.items.get(id)?.state ?? null;
  }

  all() {
    return [...this.items.values()].map((i) => i.state);
  }

  /** Kendaraan bebas terdekat dalam jarak naik. */
  nearest(x: number, y: number, z: number): VehicleStateMsg | null {
    let best: VehicleStateMsg | null = null;
    let bd = Infinity;
    for (const { state: s } of this.items.values()) {
      if (s.driver || s.id === this.hiddenId) continue;
      const spec = VEHICLE_SPEC[s.kind as VehicleKind];
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < spec.interact && Math.abs(s.y - y) < 2.5 && d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private drop(id: string, it: { model: VehicleModel | null; label: THREE.Sprite | null }) {
    if (it.model) disposeModel(it.model);
    if (it.label) {
      it.label.material.map?.dispose();
      it.label.material.dispose();
    }
    this.items.delete(id);
  }

  private px = 0;
  private pz = 0;
  update(dt: number, px: number, pz: number) {
    this.px = px;
    this.pz = pz;
    this.accum += dt;
    if (this.accum > 0.5) {
      this.accum = 0;
      this.refreshVisibility(false);
    }
  }

  private refreshVisibility(force: boolean) {
    void force;
    for (const it of this.items.values()) {
      const s = it.state;
      const visible = !s.driver && s.id !== this.hiddenId && Math.hypot(s.x - this.px, s.z - this.pz) < this.viewDistance;
      if (visible && !it.model) {
        it.model = buildVehicle(s.kind as VehicleKind, s.color);
        poseModel(it.model, s, 0, false);
        const lbl = makeLabelSprite(VEHICLE_SPEC[s.kind as VehicleKind].nama, { bg: '#FFFFFF', border: '#3BA7FF', scale: 0.009 });
        lbl.position.y = VEHICLE_SPEC[s.kind as VehicleKind].height + 1.3;
        it.model.group.add(lbl);
        it.label = lbl;
        this.scene.add(it.model.group);
      } else if (!visible && it.model) {
        disposeModel(it.model);
        it.label?.material.map?.dispose();
        it.label?.material.dispose();
        it.model = null;
        it.label = null;
      }
    }
  }

  dispose() {
    for (const [id, it] of [...this.items]) this.drop(id, it);
  }
}
