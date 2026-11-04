/**
 * Acara Penghargaan Podium Juara 3D.
 *
 * Linimasa ditentukan sepenuhnya oleh (startAt jam server, daftar juara dari server) → setiap HP menghitung adegan
 * yang sama pada detik yang sama: juara & urutan identik di semua perangkat. Siswa yang tersambung ulang / memuat ulang
 * halaman melanjutkan dari detik yang sedang berjalan (adegan yang sudah lewat dipasang tanpa suara/efek) — acara
 * TIDAK diputar ulang. Tombol Lewati/Tutup hanya memengaruhi tampilan di perangkat itu, bukan hasil peringkat.
 *
 * Urutan: Pembukaan (kamera mengitari panggung, drum roll) → Juara 3 → Juara 2 (confetti) → crescendo drum roll →
 * Juara 1 (kembang api, confetti, lampu kemenangan) → Puncak "SELAMAT PARA JUARA!" (ketiga juara, lagu kemenangan).
 */
import * as THREE from 'three';
import type { PodiumEntry } from '@eduverse/shared';
import type { Engine } from '../engine/engine.js';
import { ANIM } from '../engine/avatar.js';
import type { Stage } from './stage.js';
import type { Effects } from './effects.js';
import type { MusicEngine } from './music.js';
import { h, ui } from '../ui/dom.js';

export interface PodiumMsg {
  id: number;
  startAt: number;
  top3: PodiumEntry[];
  total: number;
}

type Phase = 'menunggu' | 'pembukaan' | 'juara3' | 'juara2' | 'crescendo' | 'juara1' | 'puncak' | 'selesai';
interface Ev {
  at: number;
  phase: Phase;
  rank?: number;
}

const MEDALI: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const WARNA: Record<number, number> = { 1: 0xffd34d, 2: 0xdfe8f5, 3: 0xf0a868 };
const LAMPU = [0xffc93c, 0x3ba7ff, 0xe86fa8, 0x2fbf71, 0x8b5cf6, 0xffffff];

/** Linimasa deterministik dari daftar juara (sama di semua perangkat). Detik relatif terhadap startAt. */
export function podiumTimeline(top3: PodiumEntry[]): Ev[] {
  const ev: Ev[] = [{ at: 0, phase: 'pembukaan' }];
  let t = 5.5;
  for (const r of [3, 2]) {
    if (!top3.some((e) => e.rank === r)) continue;
    ev.push({ at: t, phase: r === 3 ? 'juara3' : 'juara2', rank: r });
    t += 6.5;
  }
  if (top3.some((e) => e.rank === 1)) {
    ev.push({ at: t, phase: 'crescendo' });
    t += 3.8;
    ev.push({ at: t, phase: 'juara1', rank: 1 });
    t += 7.5;
  }
  ev.push({ at: t, phase: 'puncak' });
  ev.push({ at: t + 18, phase: 'selesai' });
  return ev;
}

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export class PodiumShow {
  readonly id: number;
  readonly events: Ev[];
  private fired = new Set<number>();
  private skipTo = -Infinity; // detik linimasa minimum (tombol Lewati)
  private silentBefore = -Infinity;
  phase: Phase = 'menunggu';
  /** true selama kamera dikendalikan acara. */
  cinematic = true;
  ended = false;
  private group = new THREE.Group();
  private beams = new Map<number, THREE.Mesh>();
  private sweeps: THREE.Mesh[] = [];
  private bulbs: THREE.Mesh[] = [];
  private glow: THREE.Mesh;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private snapCam = true;
  private nextFx = 0;
  private lowFx: boolean;
  private baseScale: number;
  private el: HTMLElement;
  private titleEl: HTMLElement;
  private cardEl: HTMLElement;
  private trioEl: HTMLElement;
  private btnEl: HTMLButtonElement;
  private revealAt = new Map<number, number>();
  private soundsPlayed: string[] = [];

  constructor(
    private msg: PodiumMsg,
    private d: { engine: Engine; stage: Stage; effects: Effects; music: MusicEngine; serverNow: () => number; onEnd: (late: boolean) => void },
  ) {
    this.id = msg.id;
    this.events = podiumTimeline(msg.top3);
    for (const e of this.events) if (e.rank) this.revealAt.set(e.rank, e.at);
    // HP lemah: kurangi partikel & sorot lampu otomatis (acara tetap lengkap)
    this.baseScale = d.effects.scale;
    this.lowFx = d.engine.fps > 0 && d.engine.fps < 24 ? true : d.effects.scale < 0.6;
    d.effects.scale = this.baseScale * (this.lowFx ? 0.4 : 1);
    d.stage.showWinners(msg.top3, true);
    this.buildLights();
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.rotation.x = -Math.PI / 2;
    const s1 = d.stage.podiumAvatars.find((a) => a.rank === 1)?.slot;
    this.glow.position.set(0, (s1?.y ?? 3.6) + 0.03, -6);
    this.group.add(this.glow);
    d.engine.scene.add(this.group);

    // Overlay
    this.titleEl = h('div', { class: 'podium-judul' });
    this.cardEl = h('div', { class: 'podium-kartu' });
    this.trioEl = h('div', { class: 'podium-trio' });
    this.btnEl = h('button', { class: 'btn putih podium-lewati', type: 'button', 'data-testid': 'podium-lewati' }, 'Lewati ⏭') as HTMLButtonElement;
    this.btnEl.addEventListener('click', () => (this.phase === 'puncak' ? this.finish(false) : this.skip()));
    this.el = h('div', { class: 'podium-ui', 'aria-live': 'polite' }, this.titleEl, this.cardEl, this.trioEl, this.btnEl);
    ui.add(this.el);
    const fill = (e: PodiumEntry) =>
      h('div', { class: `podium-mini r${e.rank}` }, h('span', { class: 'medali' }, MEDALI[e.rank] ?? '🏅'), h('b', null, e.nama), h('small', null, `${e.poin} poin`));
    for (const r of [2, 1, 3]) {
      const e = msg.top3.find((x) => x.rank === r);
      if (e) this.trioEl.appendChild(fill(e));
    }
  }

  /** Detik linimasa saat ini (jam server, atau titik Lewati bila lebih jauh). */
  elapsed() {
    return Math.max((this.d.serverNow() - this.msg.startAt) / 1000, this.skipTo);
  }

  private at(phase: Phase) {
    return this.events.find((e) => e.phase === phase)?.at ?? 0;
  }

  /** Lewati ke puncak acara (hanya tampilan di perangkat ini; hasil peringkat tidak berubah). */
  skip() {
    const p = this.at('puncak');
    if (this.elapsed() >= p) return;
    this.silentBefore = p;
    this.skipTo = p;
  }

  private buildLights() {
    const add = (m: THREE.Mesh) => (this.group.add(m), m);
    const beamGeo = new THREE.ConeGeometry(1.7, 10, 24, 1, true);
    beamGeo.translate(0, -5, 0); // puncak kerucut di titik asal → membuka ke bawah
    for (const a of this.d.stage.podiumAvatars) {
      const m = add(new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: WARNA[a.rank] ?? 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
      m.position.set(a.slot.x, a.slot.y + 10, a.slot.z);
      this.beams.set(a.rank, m);
    }
    const sweepGeo = new THREE.ConeGeometry(1.2, 16, 16, 1, true);
    sweepGeo.translate(0, -8, 0);
    const n = this.lowFx ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const x = n === 2 ? (i ? 10 : -10) : -11 + (i * 22) / 3;
      const m = add(new THREE.Mesh(sweepGeo, new THREE.MeshBasicMaterial({ color: LAMPU[i % LAMPU.length], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
      m.position.set(x, 9.5, -10.5);
      this.sweeps.push(m);
    }
    const bulbGeo = new THREE.SphereGeometry(0.22, 8, 6);
    for (let i = 0; i < 22; i++) {
      const m = add(new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0x665522 })));
      m.position.set(-11.5 + (i * 23) / 21, 8.25, -11.05);
      this.bulbs.push(m);
    }
  }

  /** Dipanggil tiap frame. */
  update(dt: number, t: number) {
    if (this.ended) return;
    const e = this.elapsed();
    // Picu adegan yang terlewati secara berurutan; yang sudah lama lewat dipasang senyap (sambung ulang/Lewati)
    this.events.forEach((ev, i) => {
      if (this.fired.has(i) || e < ev.at) return;
      this.fired.add(i);
      const silent = ev.at < this.silentBefore || e - ev.at > 1.5;
      this.enter(ev, silent);
    });
    if (this.ended) return;
    this.animateAvatars(e, t);
    this.animateLights(e, t, dt);
    if (this.phase === 'puncak' && e >= this.nextFx) {
      this.nextFx = e + (this.lowFx ? 2.6 : 1.3);
      const fx = this.d.effects;
      fx.firework(new THREE.Vector3(-12 + Math.random() * 24, 12 + Math.random() * 5, -10 - Math.random() * 4));
      if (Math.random() < 0.5) fx.confetti(new THREE.Vector3(-6 + Math.random() * 12, 13, -5));
    }
  }

  private enter(ev: Ev, silent: boolean) {
    this.phase = ev.phase;
    const { music, effects } = this.d;
    if (ev.phase !== 'selesai') music.setVariant(ev.phase);
    const sound = (kind: 'tepuk' | 'sorak', lvl: number, dur: number) => {
      if (!silent && music.crowd(kind, lvl, dur)) this.soundsPlayed.push(`${ev.phase}:${kind}`);
    };
    const slot = ev.rank ? this.d.stage.podiumAvatars.find((a) => a.rank === ev.rank)?.slot : undefined;
    const top = slot ? new THREE.Vector3(slot.x, slot.y + 3, slot.z) : null;
    this.snapCam ||= silent;
    switch (ev.phase) {
      case 'pembukaan':
        this.title('PODIUM JUARA EDUVERSE', 'buka');
        this.card(null);
        sound('sorak', 0.45, 3);
        break;
      case 'juara3':
      case 'juara2':
        this.title('', '');
        this.card(ev.rank!);
        if (!silent && top) {
          effects.sparkle(top);
          if (ev.rank === 2) (effects.confetti(new THREE.Vector3(slot!.x, 11, -5)), effects.confetti(new THREE.Vector3(0, 12, -6), 160));
        }
        sound('tepuk', ev.rank === 3 ? 0.6 : 0.85, 4.5);
        if (ev.rank === 2) sound('sorak', 0.75, 3.5);
        break;
      case 'crescendo':
        this.card(null);
        this.title('Dan juara pertama adalah…', 'tegang');
        break;
      case 'juara1':
        this.title('', '');
        this.card(1);
        if (!silent && top) {
          effects.sparkle(top);
          for (let i = 0; i < (this.lowFx ? 2 : 4); i++) effects.firework(new THREE.Vector3(-10 + i * 7, 13 + (i % 2) * 3, -10));
          effects.confetti(new THREE.Vector3(0, 12, -5));
          if (!this.lowFx) effects.confetti(new THREE.Vector3(-5, 12, -4), 160), effects.confetti(new THREE.Vector3(5, 12, -4), 160);
        }
        sound('sorak', 1, 5);
        sound('tepuk', 1, 6.5);
        break;
      case 'puncak':
        this.card(null);
        this.title(this.msg.top3.length ? 'SELAMAT PARA JUARA!' : 'Terima kasih sudah bermain!', 'puncak');
        this.trioEl.classList.add('tampil');
        this.btnEl.textContent = 'Tutup ✕';
        this.nextFx = this.elapsed();
        sound('sorak', 1, 5);
        sound('tepuk', 1, 9);
        break;
      case 'selesai':
        this.finish(silent);
        break;
    }
  }

  private title(text: string, mode: string) {
    this.titleEl.textContent = text;
    this.titleEl.className = `podium-judul ${mode}`;
    if (text) {
      // ulangi animasi masuk
      void this.titleEl.offsetWidth;
      this.titleEl.classList.add('masuk');
    }
  }

  private card(rank: number | null) {
    const e = rank ? this.msg.top3.find((x) => x.rank === rank) : null;
    this.cardEl.replaceChildren();
    this.cardEl.className = 'podium-kartu';
    if (!e) return;
    this.cardEl.append(
      h('span', { class: 'medali' }, MEDALI[e.rank] ?? '🏅'),
      h('div', { class: 'peringkat' }, `JUARA ${e.rank}`),
      h('div', { class: 'nama' }, e.nama),
      h('div', { class: 'poin' }, `${e.poin} poin`),
    );
    void this.cardEl.offsetWidth;
    this.cardEl.classList.add('tampil', `r${e.rank}`);
  }

  /** Avatar: tersembunyi → muncul di depan podium → melompat naik ke podiumnya → bergembira. Murni dari waktu e. */
  private animateAvatars(e: number, t: number) {
    const puncak = this.at('puncak');
    for (const a of this.d.stage.podiumAvatars) {
      const r0 = this.revealAt.get(a.rank) ?? 0;
      const u = e - r0;
      const root = a.av.root;
      root.visible = u >= 0.25;
      a.label.visible = false; // nama & poin tampil besar di kartu layar; label 3D terlalu besar saat close-up
      if (u < 0.25) continue;
      const fromZ = a.slot.z + 3.2;
      const ju = (u - 0.9) / 1.0; // fase lompat 0..1
      if (ju < 0) {
        root.position.set(a.slot.x, 0.8, fromZ);
        a.anim = ANIM.idle;
        a.av.emote = 0; // melambai ke penonton
      } else if (ju < 1) {
        const k = ease(ju);
        root.position.set(a.slot.x, 0.8 + (a.slot.y - 0.8) * k + Math.sin(Math.PI * ju) * 1.7, fromZ + (a.slot.z - fromZ) * k);
        a.anim = ANIM.air;
        a.av.emote = -1;
      } else {
        root.position.set(a.slot.x, a.slot.y, a.slot.z);
        a.anim = ANIM.idle;
        // Gembira: hore saat diumumkan; di puncak bergantian hore/joget/lambai
        a.av.emote = e >= puncak ? [1, 3, 1, 0][(Math.floor(t / 2.2) + a.rank) % 4]! : 1;
      }
      root.rotation.y = 0;
    }
  }

  private animateLights(e: number, t: number, dt: number) {
    const k = 1 - Math.exp(-dt * 3);
    const ph = this.phase;
    for (const [rank, m] of this.beams) {
      const on = e >= (this.revealAt.get(rank) ?? 0) + 0.3;
      const want = !on ? 0 : ph === 'puncak' ? 0.16 + Math.sin(t * 3 + rank) * 0.04 : (ph === 'juara' + rank ? 0.26 : 0.1);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity += (want - mat.opacity) * k;
    }
    const sweepOn = ph === 'pembukaan' || ph === 'crescendo' || ph === 'juara1' || ph === 'puncak';
    this.sweeps.forEach((m, i) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity += ((sweepOn ? (this.lowFx ? 0.09 : 0.13) : 0) - mat.opacity) * k;
      const speed = ph === 'crescendo' ? 3.2 : 1.1;
      m.rotation.z = Math.sin(t * speed + i * 1.7) * 0.55;
      m.rotation.x = 0.35 + Math.cos(t * speed * 0.7 + i) * 0.2;
      if (ph === 'puncak') mat.color.setHex(LAMPU[(Math.floor(t * 1.5) + i) % LAMPU.length]!);
    });
    const blink = ph === 'juara1' || ph === 'puncak';
    this.bulbs.forEach((b, i) => {
      const mat = b.material as THREE.MeshBasicMaterial;
      const lit = blink ? (Math.floor(t * 6) + i) % 3 !== 0 : ph === 'crescendo' ? (Math.floor(t * 10) + i) % 2 === 0 : true;
      mat.color.setHex(!lit ? 0x443311 : blink ? LAMPU[(i + Math.floor(t * 2)) % LAMPU.length]! : 0xffe7a0);
    });
    const g = this.glow.material as THREE.MeshBasicMaterial;
    g.opacity += ((e >= (this.revealAt.get(1) ?? Infinity) ? 0.35 + Math.sin(t * 4) * 0.1 : 0) - g.opacity) * k;
  }

  /** Jarak kamera agar lebar×tinggi tertentu muat di layar (potret/lanskap/tablet/laptop). */
  private fit(cam: THREE.PerspectiveCamera, w: number, hgt: number) {
    const v = THREE.MathUtils.degToRad(cam.fov);
    const hf = 2 * Math.atan(Math.tan(v / 2) * cam.aspect);
    return Math.max(w / 2 / Math.tan(hf / 2), hgt / 2 / Math.tan(v / 2));
  }

  /** Kamera sinematik: target pose per adegan, dihaluskan. */
  applyCamera(cam: THREE.PerspectiveCamera, dt: number, t: number) {
    const e = this.elapsed();
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3(0, 2.6, -6);
    const slotOf = (r: number) => this.d.stage.podiumAvatars.find((a) => a.rank === r)?.slot;
    const orbit = (ang: number, dist: number, hgt: number) => pos.set(look.x + Math.sin(ang) * dist, look.y + hgt, look.z + Math.cos(ang) * dist);
    switch (this.phase) {
      case 'menunggu':
      case 'pembukaan': {
        const p = Math.min(1, Math.max(0, e / 5.5));
        orbit(-1.0 + 1.0 * ease(p), this.fit(cam, 17, 9) + 6 - 4 * p, 6 - 3 * p);
        break;
      }
      case 'juara3':
      case 'juara2':
      case 'juara1': {
        const r = this.phase === 'juara1' ? 1 : this.phase === 'juara2' ? 2 : 3;
        const s = slotOf(r);
        // lanskap: titik pandang lebih rendah → avatar naik di layar, tidak tertutup kartu nama di bawah
        if (s) look.set(s.x, s.y + (cam.aspect > 1.2 ? 0.55 : 1.2), s.z);
        const since = e - (this.revealAt.get(r) ?? 0);
        // awalnya agak lebar (melihat avatar naik), lalu mendekat ke wajah + nama
        const w = since < 2 ? 6.5 : 4;
        orbit(Math.sign(s?.x ?? 0) * 0.35 + Math.sin(t * 0.4) * 0.12, this.fit(cam, w, 5), 0.9);
        break;
      }
      case 'crescendo': {
        const p = Math.min(1, (e - this.at('crescendo')) / 3.8);
        look.set(0, 3.2, -6);
        orbit(Math.sin(t * 0.5) * 0.08, this.fit(cam, 16 - 9 * p, 7), 1.2 + p * 0.6);
        pos.x += Math.sin(t * 40) * 0.03 * p; // getar tegang
        break;
      }
      default: {
        // bidikan lebar: titik pandang agak tinggi → podium turun ke tengah layar, judul di atas tidak menutupi kepala
        look.set(0, 4.2, -6);
        orbit(Math.sin(t * 0.25) * 0.35, this.fit(cam, 15, 10.5), 0.8);
      }
    }
    if (this.snapCam) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.snapCam = false;
    } else {
      const k = 1 - Math.exp(-dt * 2.4);
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, k);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  /** Akhiri acara (otomatis di akhir linimasa atau tombol Tutup). Juara tetap berdiri di podium. */
  finish(late: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.cinematic = false;
    this.phase = 'selesai';
    this.d.music.setVariant('akhir');
    for (const a of this.d.stage.podiumAvatars) {
      a.av.root.visible = true;
      a.label.visible = true;
      a.av.root.position.set(a.slot.x, a.slot.y, a.slot.z);
      a.anim = ANIM.idle;
      a.av.emote = 1;
    }
    this.el.remove();
    this.disposeLights();
    this.d.effects.scale = this.baseScale;
    this.d.onEnd(late);
  }

  private disposeLights() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.group.removeFromParent();
  }

  /** Bersihkan tanpa memicu onEnd (mis. pindah adegan). */
  dispose() {
    if (!this.ended) {
      this.ended = true;
      this.cinematic = false;
      this.el.remove();
      this.disposeLights();
      this.d.effects.scale = this.baseScale;
    }
  }

  state() {
    const e = this.elapsed();
    return {
      id: this.id,
      phase: this.phase,
      elapsed: Math.round(e * 10) / 10,
      revealed: [...this.revealAt.entries()].filter(([, at]) => e >= at).map(([r]) => r).sort(),
      order: this.events.map((x) => x.phase),
      juara: this.msg.top3.map((x) => ({ rank: x.rank, nama: x.nama, poin: x.poin, karakter: x.avatar.karakter })),
      skipped: this.skipTo > -Infinity,
      lowFx: this.lowFx,
      sounds: [...this.soundsPlayed],
      ended: this.ended,
    };
  }
}
