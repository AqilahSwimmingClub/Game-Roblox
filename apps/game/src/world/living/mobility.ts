/**
 * Mobility — pengendali gerak pemain lokal di Kota Hidup:
 * berjalan ↔ naik/turun kendaraan (sepeda, motor, mobil, bus, pesawat) ↔ jetpack, lubang dimensi,
 * percakapan pedagang, dan kontrol kontekstual (HP: tombol besar seperlunya; komputer: keyboard).
 *
 * Semua perubahan status yang penting (naik/turun kendaraan, ambil jetpack, teleport portal) melewati
 * MobilityHost: di mode kelas = server (divalidasi), di Mode Demo = registri lokal.
 */
import * as THREE from 'three';
import { JETPACK, MODE_CODE, VEHICLE_SPEC, type MoveMode, type Rift, type Vendor, type VehicleKind, type VehicleStateMsg } from '@eduverse/shared';
import type { Input } from '../../engine/input.js';
import type { FollowCamera } from '../../engine/camera.js';
import type { CollisionWorld } from '../../engine/collision.js';
import { ANIM } from '../../engine/avatar.js';
import type { LocalPlayer } from '../localPlayer.js';
import type { LivingCity } from './index.js';
import { buildVehicle, buildJetpack, disposeModel, type VehicleModel } from './meshes.js';
import { newBody, stepGround, stepPlane, stepWater, exitSpot, poseModel, vehicleActionLabel, type VehicleBody, type DriveInput } from './vehicles.js';
import { vendorDialog, worldGateDialog, riftTransition, dialogOpen, closeDialog, type GateWorld } from './missions.js';
import { engineSound, sfxLiving } from '../audio.js';
import { h } from '../../ui/dom.js';
import { formatRp } from '@eduverse/shared';
import { openBag, type WalletStore, type BuyResult, type UseResult, type OfferCtx } from './inventory.js';

type Fail = { ok: false; error: string };
export interface MobilityHost {
  enterVehicle(id: string): Promise<{ ok: true; vehicle: VehicleStateMsg } | Fail>;
  exitVehicle(p: { x: number; y: number; z: number }): Promise<{ ok: true; x: number; y: number; z: number } | Fail>;
  setJetpack(on: boolean, stationId?: string): Promise<{ ok: true } | Fail>;
  useRift(id: string): Promise<{ ok: true; target: { x: number; y: number; z: number; ry: number }; nama: string } | Fail>;
  startMission(v: Vendor): void;
  missionDone(id: string): boolean;
  toLobby: (() => void) | null;
  /** Dunia tujuan Gerbang Antardunia (mode kelas); kosong di Mode Demo. */
  gateWorlds?: () => GateWorld[];
  notify(text: string, kind?: string): void;
  /** Dipanggil saat dialog dibuka/ditutup (agar input jalan berhenti). */
  setBusy(busy: boolean): void;
  /** Dompet & tas (salinan dari server / Mode Demo) + aksi toko. */
  wallet: WalletStore;
  buy(vendorId: string, itemId: string, qty: number): Promise<BuyResult>;
  useItem(itemId: string): Promise<UseResult>;
  /** Hadiah & tukar barang dengan persetujuan (null = tidak tersedia). */
  offers: OfferCtx | null;
}

export interface MobilityPrompt {
  kind: 'kendaraan' | 'turun' | 'jetpack' | 'pedagang';
  id: string;
  label: string;
}

interface Driving {
  id: string;
  kind: VehicleKind;
  model: VehicleModel;
  body: VehicleBody;
  home: { x: number; y: number; z: number; heading: number };
  lastSafe: { x: number; y: number; z: number; heading: number };
  safeT: number;
}

const CAM_DIST: Record<VehicleKind, number> = { sepeda: 6, motor: 7, mobil: 9, bus: 15, pesawat: 17, perahu: 9, kapalselam: 10 };

/** Tombol tekan-tahan (pointer) → callback down/up. */
function holdBtn(label: string, cls: string, set: (v: boolean) => void) {
  const b = h('button', { type: 'button', class: `btn ${cls} mv-btn`, 'aria-label': label }, label);
  const on = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    set(true);
    b.classList.add('ditekan');
  };
  const off = (e: Event) => {
    e.preventDefault();
    set(false);
    b.classList.remove('ditekan');
  };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('pointerleave', off);
  return b;
}
function tapBtn(label: string, cls: string, fn: () => void) {
  const b = h('button', { type: 'button', class: `btn ${cls} mv-btn`, 'aria-label': label }, label);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
  return b;
}

export class Mobility {
  mode: MoveMode = 'jalan';
  driving: Driving | null = null;
  hasJetpack = false;
  fuel: number = JETPACK.fuelMax;
  living: LivingCity | null = null;
  world: CollisionWorld | null = null;
  busy = false;
  private jet = buildJetpack();
  private thrust = 0;
  private ctl = { gas: false, brake: false, up: false, down: false };
  private savedCamDist = 7;
  private camHoldUntil = 0;
  private lastPrompt = '';
  readonly el: HTMLElement;
  private teleEl: HTMLElement;
  private setDrive: HTMLElement;
  private setPlane: HTMLElement;
  private setJet: HTMLElement;
  private jetToggle: HTMLButtonElement;
  private exitBtns: HTMLButtonElement[] = [];
  private recoverBtn: HTMLButtonElement;
  private actionBtn: HTMLButtonElement;
  private hintEl: HTMLElement;
  readonly walletBtn: HTMLButtonElement;
  private currentPrompt: MobilityPrompt | null = null;
  /** Statistik untuk uji otomatis. */
  stats = { maxAltitude: 0, maxSpeed: 0, rifts: 0, landedOnRoof: false, takeoffs: 0, landings: 0, itemsUsed: 0 };

  constructor(
    private scene: THREE.Scene,
    private input: Input,
    private cam: FollowCamera,
    private player: LocalPlayer,
    private host: MobilityHost,
    private touch: boolean,
  ) {
    this.teleEl = h('div', { class: 'mv-tele panel tipis' });
    this.hintEl = h('div', { class: 'mv-hint panel tipis desk-only' });
    this.actionBtn = tapBtn('Aksi', 'kuning', () => void this.act());
    this.actionBtn.style.display = 'none'; // hanya tampil saat berkendara/jetpack & dekat objek (sebelumnya terlihat sejak awal & menutupi Lompat)
    this.recoverBtn = tapBtn('Pulihkan', 'putih', () => this.recover());
    this.recoverBtn.style.display = 'none';
    const exit = () => tapBtn('TURUN', 'merah', () => void this.exitVehicle());
    const e1 = exit();
    const e2 = exit();
    e2.textContent = 'KELUAR';
    this.exitBtns = [e1, e2];
    this.setDrive = h('div', { class: 'mv-set' }, e1, holdBtn('REM', 'putih', (v) => (this.ctl.brake = v)), holdBtn('GAS', 'hijau besar-gas', (v) => (this.ctl.gas = v)));
    this.setPlane = h(
      'div',
      { class: 'mv-set' },
      e2,
      h('div', { class: 'mv-col' }, holdBtn('NAIK', 'biru', (v) => (this.ctl.up = v)), holdBtn('TURUN', 'ungu', (v) => (this.ctl.down = v))),
      h('div', { class: 'mv-col' }, holdBtn('GAS +', 'hijau', (v) => (this.ctl.gas = v)), holdBtn('GAS −', 'putih', (v) => (this.ctl.brake = v))),
    );
    this.setJet = h('div', { class: 'mv-set' }, tapBtn('MATIKAN', 'merah', () => void this.toggleJetpack(false)), h('div', { class: 'mv-col' }, holdBtn('NAIK', 'biru', (v) => (this.ctl.up = v)), holdBtn('TURUN', 'ungu', (v) => (this.ctl.down = v))));
    this.jetToggle = tapBtn('JETPACK', 'oranye', () => void this.toggleJetpack(true));
    this.jetToggle.classList.add('mv-jet-toggle');
    this.walletBtn = tapBtn('🎒 Tas', 'putih', () => this.openBag());
    this.walletBtn.classList.add('mv-wallet');
    // lencana 🎁 tetap tampil sampai tas dibuka (pemberitahuan banner hanya 3 detik dan mudah terlewat)
    const renderWallet = () => {
      const w = this.host.wallet;
      this.walletBtn.textContent = `🎒 ${formatRp(w.saldo)}${w.unseen ? ` · 🎁${w.unseen}` : ''}`;
      this.walletBtn.classList.toggle('ada-hadiah', w.unseen > 0);
    };
    renderWallet();
    this.host.wallet.on(renderWallet);
    this.jetToggle.style.display = 'none';
    this.el = h('div', { class: 'mv-ui' }, this.teleEl, this.hintEl, h('div', { class: 'mv-right' }, h('div', { class: 'mv-row' }, this.recoverBtn, this.actionBtn), this.setDrive, this.setPlane, this.setJet), this.jetToggle, this.walletBtn);
    document.body.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'KeyF' && this.living && !this.driving && this.input.enabled) void this.toggleJetpack(this.mode !== 'jetpack');
      if (e.code === 'KeyH' && this.driving && this.driving.kind !== 'sepeda') sfxLiving.horn();
      if ((e.code === 'KeyB' || e.code === 'KeyI') && this.living && !this.driving && this.input.enabled) this.openBag();
    });
    this.refreshUi();
  }

  /** Dipanggil saat adegan berganti (Kota dimuat/dibuang). */
  setCity(living: LivingCity | null, world: CollisionWorld | null) {
    this.forceWalk();
    this.living = living;
    this.world = world;
    this.refreshUi();
  }

  get active() {
    return this.mode !== 'jalan' && this.mode !== 'penumpang';
  }

  modeCode() {
    return MODE_CODE[this.mode];
  }

  /** Paksa kembali berjalan tanpa server (adegan berganti, sambung ulang, koreksi server). */
  forceWalk() {
    if (this.driving) {
      const d = this.driving;
      this.player.detachTo(this.scene);
      disposeModel(d.model);
      if (this.living) this.living.parked.hiddenId = null;
      this.driving = null;
      this.cam.distance = this.savedCamDist;
    }
    this.jet.group.removeFromParent();
    this.mode = 'jalan';
    this.ctl = { gas: false, brake: false, up: false, down: false };
    engineSound(null, 0);
    this.refreshUi();
  }

  private refreshUi() {
    const m = this.mode;
    const veh = this.driving?.kind;
    document.body.classList.toggle('mv-drive', !!veh);
    document.body.classList.toggle('mv-jet', m === 'jetpack');
    this.setDrive.style.display = veh && veh !== 'pesawat' && veh !== 'kapalselam' ? '' : 'none';
    this.setPlane.style.display = veh === 'pesawat' || veh === 'kapalselam' ? '' : 'none';
    this.setJet.style.display = m === 'jetpack' ? '' : 'none';
    this.jetToggle.style.display = this.living && this.hasJetpack && m === 'jalan' ? '' : 'none';
    this.walletBtn.style.display = this.living && !veh ? '' : 'none';
    this.teleEl.style.display = veh || m === 'jetpack' ? '' : 'none';
    this.hintEl.style.display = veh || m === 'jetpack' ? '' : 'none';
    this.hintEl.textContent =
      veh === 'pesawat'
        ? 'W/S gas · A/D belok · Spasi naik · C turun · E keluar (setelah mendarat)'
        : veh === 'kapalselam'
          ? 'W maju · S mundur · A/D belok · Spasi naik · C menyelam · E keluar'
          : veh === 'perahu'
            ? 'W maju · S mundur · A/D belok · E turun (dekat dermaga/pantai)'
            : veh
          ? 'W gas · S rem/mundur · A/D belok · H klakson · E turun'
          : 'WASD gerak · Spasi naik · C turun · F matikan jetpack · B tas';
    if (!this.touch) for (const b of this.el.querySelectorAll<HTMLElement>('.mv-set')) b.classList.add('ringkas');
  }

  // ───────────── prompt & aksi ─────────────

  nearestPrompt(): MobilityPrompt | null {
    if (!this.living) return null;
    const b = this.player.body;
    if (this.driving) {
      const d = this.driving;
      if (d.kind === 'pesawat' && (!d.body.grounded || d.body.speed > 3)) return null;
      return { kind: 'turun', id: d.id, label: d.kind === 'pesawat' ? 'Keluar Pesawat' : `Turun dari ${VEHICLE_SPEC[d.kind].nama}` };
    }
    const v = this.living.vendors.nearest(b.x, b.y, b.z);
    if (v) return { kind: 'pedagang', id: v.id, label: `Bicara dengan ${v.nama}` };
    if (this.mode === 'jalan') {
      const veh = this.living.parked.nearest(b.x, b.y, b.z);
      if (veh) return { kind: 'kendaraan', id: veh.id, label: vehicleActionLabel(veh.kind as VehicleKind) };
    }
    for (const j of this.living.layout.jetpacks) {
      if (Math.hypot(j.x - b.x, j.z - b.z) < 2.6 && Math.abs(j.y - b.y) < 3 && this.mode === 'jalan') return { kind: 'jetpack', id: j.id, label: this.hasJetpack ? 'Pakai Jetpack' : 'Ambil Jetpack' };
    }
    return null;
  }

  /** Jalankan aksi untuk prompt Mobility (dipanggil dari tombol Aksi/E). Mengembalikan true bila ditangani. */
  async act(p: MobilityPrompt | null = this.currentPrompt): Promise<boolean> {
    if (!p || this.busy) return false;
    if (p.kind === 'turun') return void (await this.exitVehicle()), true;
    if (p.kind === 'kendaraan') return void (await this.enterVehicle(p.id)), true;
    if (p.kind === 'jetpack') return void (await this.toggleJetpack(true, p.id)), true;
    if (p.kind === 'pedagang') {
      const v = this.living?.layout.vendors.find((x) => x.id === p.id);
      if (!v) return false;
      this.living?.vendors.greet(v.id);
      this.host.setBusy(true);
      vendorDialog(v, {
        startMission: (vv) => this.host.startMission(vv),
        missionDone: (id) => this.host.missionDone(id),
        onClose: () => this.host.setBusy(false),
        wallet: this.host.wallet,
        buy: (vid, itemId, qty) => this.host.buy(vid, itemId, qty),
      });
      return true;
    }
    return false;
  }

  async enterVehicle(id: string) {
    if (!this.living || this.driving || this.busy) return;
    this.busy = true;
    try {
      if (this.mode === 'jetpack') await this.toggleJetpack(false);
      const r = await this.host.enterVehicle(id);
      if (!r.ok) return this.host.notify(r.error, 'peringatan');
      const v = r.vehicle;
      const kind = v.kind as VehicleKind;
      const model = buildVehicle(kind, v.color);
      const body = newBody(v);
      poseModel(model, body, 0, false);
      this.scene.add(model.group);
      const seat = model.seat.clone();
      seat.y -= model.straddle ? 0.5 : 0.43;
      this.player.attachTo(model.group, seat);
      this.living.parked.hiddenId = v.id;
      const home = this.living.layout.vehicles.find((x) => x.id === v.id) ?? v;
      this.driving = { id: v.id, kind, model, body, home: { x: home.x, y: home.y, z: home.z, heading: home.heading }, lastSafe: { x: v.x, y: v.y, z: v.z, heading: v.heading }, safeT: 0 };
      this.mode = kind;
      this.savedCamDist = this.cam.distance;
      this.cam.distance = CAM_DIST[kind];
      this.cam.yaw = v.heading + Math.PI;
      this.cam.snap();
      sfxLiving.door();
      this.host.notify(
        kind === 'pesawat'
          ? 'Nyalakan mesin: tahan GAS (W). Saat cukup cepat di landasan, tahan NAIK (Spasi) untuk lepas landas!'
          : kind === 'kapalselam'
            ? 'Kapal selam siap! Tahan TURUN untuk menyelam ke terumbu karang — di dalam kapal selam oksigen tidak berkurang.'
            : kind === 'perahu'
              ? 'Perahu siap berlayar! Jelajahi pulau-pulau dan ambil botol pesan yang terapung.'
              : `Kamu mengendarai ${VEHICLE_SPEC[kind].nama}. Patuhi lampu lalu lintas & lajur kiri ya!`,
        'info',
      );
      this.refreshUi();
    } finally {
      this.busy = false;
    }
  }

  async exitVehicle() {
    const d = this.driving;
    if (!d || !this.world || this.busy) return;
    if (d.kind === 'pesawat' && (!d.body.grounded || d.body.speed > 3)) return this.host.notify('Mendarat dan berhenti dulu sebelum keluar pesawat.', 'peringatan');
    if (Math.abs(d.body.speed) > 6) return this.host.notify('Pelankan kendaraan dulu (tekan REM).', 'peringatan');
    this.busy = true;
    try {
      const spot = exitSpot(this.world, d.body);
      const r = await this.host.exitVehicle(spot);
      const p = r.ok ? r : spot;
      this.player.detachTo(this.scene);
      this.player.teleport(p.x, p.y, p.z, d.body.heading);
      disposeModel(d.model);
      this.living!.parked.hiddenId = null;
      this.driving = null;
      this.mode = 'jalan';
      this.cam.distance = this.savedCamDist;
      engineSound(null, 0);
      sfxLiving.door();
      this.refreshUi();
    } finally {
      this.busy = false;
    }
  }

  async toggleJetpack(on: boolean, stationId?: string) {
    if (!this.living || this.driving || this.busy) return;
    if (on && this.mode === 'jetpack') return;
    if (!on && this.mode !== 'jetpack') return;
    this.busy = true;
    try {
      const r = await this.host.setJetpack(on, stationId);
      if (!r.ok) return this.host.notify(r.error, 'peringatan');
      if (on) {
        const first = !this.hasJetpack;
        this.hasJetpack = true;
        this.mode = 'jetpack';
        this.player.avatar.root.add(this.jet.group);
        if (first) this.host.notify('Jetpack terpasang! Tahan NAIK (Spasi) untuk terbang, TURUN (C) untuk turun. Energi terisi lagi saat menapak tanah.', 'misi');
      } else {
        this.mode = 'jalan';
        this.jet.group.removeFromParent();
        engineSound(null, 0);
      }
      this.refreshUi();
    } finally {
      this.busy = false;
    }
  }

  /** Buka tas; makanan/minuman/buah yang dipakai mengisi penuh energi jetpack. */
  openBag() {
    if (this.busy || dialogOpen()) return;
    this.host.setBusy(true);
    openBag(
      this.host.wallet,
      (id) => this.host.useItem(id),
      () => {
        this.fuel = JETPACK.fuelMax;
        this.stats.itemsUsed++;
      },
      () => this.host.setBusy(false),
      this.host.offers,
    );
  }

  private recover() {
    const d = this.driving;
    if (!d) return;
    const s = d.kind === 'pesawat' ? d.home : d.lastSafe;
    Object.assign(d.body, { x: s.x, y: s.y, z: s.z, heading: s.heading, speed: 0, vy: 0, throttle: 0, grounded: true, stuck: 0, pitch: 0, roll: 0 });
    this.cam.snap();
    this.host.notify('Kendaraan dipulihkan ke tempat aman.', 'info');
  }

  // ───────────── frame ─────────────

  /**
   * Perbarui gerak bila sedang berkendara / memakai jetpack.
   * Mengembalikan true bila Mobility mengatur posisi pemain frame ini (pemanggil tidak perlu player.update).
   */
  update(dt: number, t: number): boolean {
    const living = this.living;
    const world = this.world;
    if (!living || !world) return false;
    let handled = false;
    const inp = this.input;
    if (this.driving) {
      handled = true;
      const d = this.driving;
      const di: DriveInput = {
        throttle: Math.max(-1, Math.min(1, (inp.enabled ? inp.moveY : 0) + (this.ctl.gas ? 1 : 0) - (this.ctl.brake && d.kind === 'pesawat' ? 1 : 0))),
        steer: inp.enabled ? inp.moveX : 0,
        up: (inp.enabled && inp.jump) || this.ctl.up,
        down: (inp.enabled && inp.dive) || this.ctl.down,
        brake: d.kind !== 'pesawat' && this.ctl.brake,
      };
      if (this.busy) {
        di.throttle = 0;
        di.brake = true;
      }
      const ev = d.kind === 'pesawat' ? stepPlane(world, d.body, di, dt) : d.kind === 'perahu' || d.kind === 'kapalselam' ? stepWater(world, d.body, di, dt) : stepGround(world, d.body, di, dt);
      // tabrakan dengan kendaraan NPC → memantul pelan (aman)
      for (const c of living.traffic.carsNear(d.body.x, d.body.z, 2.6)) {
        if (d.body.y > 2) break;
        const dot = (c.x - d.body.x) * Math.sin(d.body.heading) + (c.z - d.body.z) * Math.cos(d.body.heading);
        if (dot * d.body.speed > 0) {
          d.body.speed = -d.body.speed * 0.3;
          sfxLiving.bump();
        }
      }
      if (ev) this.onDriveEvent(ev);
      // posisi aman berkala
      d.safeT += dt;
      if (d.safeT > 1 && d.body.grounded && Math.abs(d.body.speed) > 0.5) {
        d.safeT = 0;
        d.lastSafe = { x: d.body.x, y: d.body.y, z: d.body.z, heading: d.body.heading };
      }
      this.recoverBtn.style.display = d.body.stuck > 3 ? '' : 'none';
      poseModel(d.model, d.body, dt);
      this.player.animate(dt, ANIM.sit);
      // tubuh pemain = posisi kendaraan (untuk jaringan, minimap, prompt)
      const pb = this.player.body;
      pb.x = d.body.x;
      pb.y = d.body.y;
      pb.z = d.body.z;
      pb.vx = pb.vy = pb.vz = 0;
      this.player.ry = d.body.heading;
      // kamera mengikuti di belakang kendaraan (kecuali pemain sedang memutar kamera)
      if (inp.camYaw !== 0) this.camHoldUntil = t + 2;
      if (t > this.camHoldUntil) {
        let dy = d.body.heading + Math.PI - this.cam.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.cam.yaw += dy * Math.min(1, dt * 2.5);
        if (d.kind === 'pesawat') this.cam.pitch += (0.18 - d.body.pitch * 0.5 - this.cam.pitch) * Math.min(1, dt * 2);
      }
      const spec = VEHICLE_SPEC[d.kind];
      const kmh = Math.abs(d.body.speed) * 3.6;
      this.stats.maxSpeed = Math.max(this.stats.maxSpeed, kmh);
      this.stats.maxAltitude = Math.max(this.stats.maxAltitude, d.body.y);
      engineSound(d.kind as never, Math.min(1, Math.abs(d.body.speed) / spec.maxSpeed + (d.kind === 'pesawat' ? d.body.throttle * 0.3 : 0)));
      this.teleEl.textContent =
        d.kind === 'pesawat'
          ? `Pesawat · ${kmh.toFixed(0)} km/j · Gas ${(d.body.throttle * 100).toFixed(0)}% · Ketinggian ${d.body.y.toFixed(0)} m${d.body.grounded ? (d.body.speed > 3 ? ' · di landasan' : ' · parkir') : ' · terbang'}`
          : `${spec.nama} · ${kmh.toFixed(0)} km/j`;
      living.traffic.obstacles = [{ x: d.body.x, z: d.body.z, r: spec.radius }];
    } else if (this.mode === 'jetpack') {
      handled = true;
      const b = this.player.body;
      const wantUp = ((inp.enabled && inp.jump) || this.ctl.up) && this.fuel > 0;
      const wantDown = (inp.enabled && inp.dive) || this.ctl.down;
      let vy = wantUp ? JETPACK.climb : wantDown ? -JETPACK.sink : 0;
      if (this.fuel <= 0 && !b.grounded) vy = -JETPACK.glideSink;
      if (b.y > JETPACK.maxY && vy > 0) vy = 0;
      if (b.grounded && !wantUp) vy = -2;
      const airborne = this.player.updateFly(dt, inp, this.cam, world, JETPACK.speed, vy);
      if (wantUp) this.fuel = Math.max(0, this.fuel - JETPACK.burnUp * dt);
      else if (airborne) this.fuel = Math.max(0, this.fuel - JETPACK.burnHover * dt);
      else this.fuel = Math.min(JETPACK.fuelMax, this.fuel + JETPACK.recharge * dt);
      this.thrust += ((wantUp ? 1 : airborne ? 0.45 : 0) - this.thrust) * Math.min(1, dt * 8);
      for (const f of this.jet.flames) {
        f.visible = this.thrust > 0.05;
        f.scale.set(1, 0.4 + this.thrust * (0.8 + Math.random() * 0.4), 1);
      }
      engineSound('jetpack', 0, this.thrust);
      this.stats.maxAltitude = Math.max(this.stats.maxAltitude, b.y);
      if (b.grounded && b.y > 5) this.stats.landedOnRoof = true;
      const bar = '█'.repeat(Math.round(this.fuel / 10)) + '░'.repeat(10 - Math.round(this.fuel / 10));
      this.teleEl.textContent = `Jetpack · Ketinggian ${b.y.toFixed(0)} m · Energi ${bar}${this.fuel <= 0 ? ' · melayang turun…' : ''}`;
      living.traffic.obstacles = [{ x: b.x, z: b.z, r: 0.5 }];
    } else {
      const b = this.player.body;
      living.traffic.obstacles = [{ x: b.x, z: b.z, r: 0.5 }];
      if (this.fuel < JETPACK.fuelMax) this.fuel = Math.min(JETPACK.fuelMax, this.fuel + JETPACK.recharge * dt);
    }
    // lubang dimensi: berjalan/terbang masuk ke pusaran
    if (!this.driving && !this.busy && !dialogOpen()) {
      const b = this.player.body;
      const r = living.rifts.check(b.x, b.y, b.z, t);
      if (r) void this.enterRift(r, t);
    }
    // prompt & tombol aksi kontekstual
    this.currentPrompt = this.nearestPrompt();
    const key = this.currentPrompt ? this.currentPrompt.label : '';
    if (key !== this.lastPrompt) {
      this.lastPrompt = key;
      const show = !!this.currentPrompt && (this.mode === 'jetpack' || (!!this.driving && this.currentPrompt.kind !== 'turun'));
      this.actionBtn.style.display = show ? '' : 'none';
      this.actionBtn.textContent = this.currentPrompt?.label ?? 'Aksi';
      for (const e of this.exitBtns) e.disabled = !!this.driving && !this.currentPrompt;
    }
    return handled;
  }

  get prompt() {
    return this.currentPrompt;
  }

  private onDriveEvent(ev: NonNullable<ReturnType<typeof stepGround>>) {
    const d = this.driving!;
    switch (ev.type) {
      case 'bump':
        sfxLiving.bump();
        break;
      case 'crash':
      case 'recover': {
        this.host.notify(ev.text, 'peringatan');
        const s = d.kind === 'pesawat' ? d.home : d.lastSafe;
        Object.assign(d.body, { x: s.x, y: s.y, z: s.z, heading: s.heading, speed: 0, vy: 0, throttle: 0, grounded: true, stuck: 0, pitch: 0, roll: 0 });
        this.cam.snap();
        break;
      }
      case 'boundary':
        if (Math.random() < 0.02) this.host.notify('Batas zona udara — pesawat berbelok kembali.', 'info');
        break;
      case 'takeoff':
        this.stats.takeoffs++;
        this.host.notify('Lepas landas! Gunakan A/D untuk berbelok, Spasi/C untuk naik-turun.', 'sukses');
        break;
      case 'landing':
        this.stats.landings++;
        this.host.notify('Pendaratan berhasil!', 'sukses');
        break;
    }
  }

  private async enterRift(r: Rift, t: number) {
    if (!r.to) {
      this.host.setBusy(true);
      worldGateDialog({ toLobby: this.host.toLobby, worlds: this.host.gateWorlds?.() ?? [], onClose: () => this.host.setBusy(false) });
      return;
    }
    this.busy = true;
    this.host.setBusy(true);
    const res = await this.host.useRift(r.id);
    if (!res.ok) {
      this.host.notify(res.error, 'peringatan');
      this.busy = false;
      this.host.setBusy(false);
      return;
    }
    riftTransition(res.nama, () => {
      this.player.teleport(res.target.x, res.target.y, res.target.z, res.target.ry);
      this.cam.yaw = res.target.ry + Math.PI;
      this.cam.snap();
      this.living?.rifts.disarm(t + 1);
      this.stats.rifts++;
      this.busy = false;
      this.host.setBusy(false);
    });
  }

  /** Setelah pindah adegan: tutup dialog sisa adegan lama & lepaskan status sibuk agar kontrol langsung bisa dipakai. */
  resetTransient() {
    if (dialogOpen()) closeDialog();
    this.busy = false;
    this.ctl = { gas: false, brake: false, up: false, down: false };
  }

  /** Ekstra untuk paket posisi (visual pesawat di perangkat lain). */
  netExtras() {
    const d = this.driving;
    return { mode: MODE_CODE[this.mode], pitch: d ? Math.round(d.body.pitch * 100) / 100 : 0, roll: d ? Math.round(d.body.roll * 100) / 100 : 0 };
  }

  /** Target kamera (lebih tinggi untuk bus & pesawat). */
  camTarget(): { x: number; y: number; z: number } {
    const b = this.player.body;
    const d = this.driving;
    const lift = d ? (d.kind === 'pesawat' ? 1.6 : d.kind === 'bus' ? 2.2 : 0.4) : 0;
    return { x: b.x, y: b.y + lift, z: b.z };
  }

  /** Status ringkas (uji otomatis). */
  snapshot() {
    const d = this.driving;
    return {
      mode: this.mode,
      vehicle: d ? { id: d.id, kind: d.kind, x: +d.body.x.toFixed(1), y: +d.body.y.toFixed(2), z: +d.body.z.toFixed(1), speed: +d.body.speed.toFixed(2), grounded: d.body.grounded, throttle: +d.body.throttle.toFixed(2), heading: +d.body.heading.toFixed(2) } : null,
      hasJetpack: this.hasJetpack,
      fuel: Math.round(this.fuel),
      saldo: this.host.wallet.saldo,
      tas: { ...this.host.wallet.tas },
      giftsUnseen: this.host.wallet.unseen,
      prompt: this.currentPrompt?.kind ?? null,
      promptId: this.currentPrompt?.id ?? null,
      ...this.stats,
    };
  }

  /** Kontrol uji otomatis (tombol virtual). */
  setControl(c: Partial<{ gas: boolean; brake: boolean; up: boolean; down: boolean }>) {
    Object.assign(this.ctl, c);
  }
}
