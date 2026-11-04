/**
 * Musik latar EDUVERSE — disintesis langsung dengan Web Audio (tanpa file audio / aset berlisensi; motif komposisi sendiri).
 * Setiap dunia punya identitas musik sendiri + ambience:
 *  - Kota: pop petualangan ceria (drum, bass hangat, pluck, melodi riang) + dengung kota halus.
 *  - Hutan: eksplorasi alam (flute, petikan akustik, shaker lembut) + kicau burung & angin; varian "misteri" ringan di Gua Kristal.
 *  - Laut: pad mengalun, lonceng ber-gema, bass panjang + ombak & gelembung; saat menyelam suara meredam (low-pass)
 *    dan ada lonceng peringatan lembut bila oksigen hampir habis.
 *  - Luar Angkasa: pad luas, kerlip arpeggio ber-delay, drone dalam + desir kosmik.
 *  - Lobi: lonceng ringan. Podium: fanfare perayaan meriah.
 * Penjadwal "lookahead" (setInterval ± 25 ms, jadwal 0,2 dtk ke depan) → tempo stabil walau frame rate HP turun.
 * Pergantian dunia memakai crossfade; volume musik terpisah dari efek suara dan bisa dimatikan di Menu.
 */
export type ThemeId = 'lobi' | 'kota' | 'hutan' | 'laut' | 'angkasa' | 'podium';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const KEY = 'eduverse-musik';

interface Voice {
  t: number; // waktu langkah (detik, jam AudioContext)
  step: number; // 0..∞ (1 langkah = 1/16 not)
  bar: number;
  s: number; // langkah dalam birama 0..15
  len: number; // durasi 1 langkah (detik)
  variant: string;
}

interface Theme {
  bpm: number;
  gain: number;
  delay?: { time: number; feedback: number; mix: number };
  play: (v: Voice, m: MusicEngine) => void;
  ambience?: (m: MusicEngine, out: AudioNode) => () => void;
}

// ───────────────────────── tema ─────────────────────────
const C_MAJ: number[][] = [
  [60, 64, 67],
  [55, 59, 62],
  [57, 60, 64],
  [53, 57, 60],
];
const KOTA_MELODI = [
  [64, 67, 69, 67, 64, 62, 60, -1],
  [62, 67, 71, 74, 71, 67, 62, -1],
  [60, 64, 69, 72, 71, 69, 64, -1],
  [65, 69, 72, 69, 67, 65, 64, 62],
];
const HUTAN_AKOR = [
  [50, 53, 57],
  [48, 52, 55],
  [55, 59, 62],
  [50, 53, 57],
];
const HUTAN_MISTERI = [
  [50, 53, 57],
  [46, 50, 53],
  [43, 46, 50],
  [45, 49, 52],
];
const HUTAN_FLUTE = [
  [74, -1, 72, -1, 69, -1, -1, -1],
  [67, -1, 69, 72, 74, -1, -1, -1],
  [74, -1, 79, -1, 76, -1, 74, -1],
  [72, -1, 69, -1, 74, -1, -1, -1],
];
const LAUT_AKOR = [
  [53, 57, 60, 64],
  [55, 59, 62, 66],
  [52, 55, 59, 62],
  [50, 53, 57, 60],
];
const ANGKASA_AKOR = [
  [45, 52, 55, 59],
  [41, 48, 52, 55],
  [48, 52, 55, 59],
  [43, 50, 54, 57],
];
const PODIUM_MELODI = [
  [67, 67, 67, 72, -1, 76, 74, 72],
  [74, 74, 74, 79, -1, 77, 76, 74],
  [72, 76, 79, 84, -1, 81, 79, 77],
  [76, 74, 72, 74, 72, -1, 72, -1],
];

const THEMES: Record<ThemeId, Theme> = {
  kota: {
    bpm: 112,
    gain: 0.5,
    play(v, m) {
      const ch = C_MAJ[v.bar % 4]!;
      if (v.s === 0 || v.s === 8 || (v.s === 10 && v.bar % 2)) m.kick(v.t, 0.55);
      if (v.s === 4 || v.s === 12) m.snare(v.t, 0.22);
      if (v.s % 2 === 0) m.hat(v.t, v.s % 4 === 2 ? 0.07 : 0.035);
      if (v.s % 2 === 0) m.bass(mtof(ch[0]! - 12 + (v.s % 8 === 6 ? 7 : 0)), v.t, v.len * 1.6, 0.26);
      if (v.s % 4 === 2) for (const n of ch) m.pluck(mtof(n + 12), v.t, v.len * 1.4, 0.06);
      // melodi pada 4 birama genap, arpeggio pada 4 birama berikutnya (tidak melelahkan)
      if (Math.floor(v.bar / 4) % 2 === 0) {
        if (v.s % 2 === 0) {
          const n = KOTA_MELODI[v.bar % 4]![v.s / 2]!;
          if (n > 0) m.lead(mtof(n + 12), v.t, v.len * 1.8, 0.075);
        }
      } else if (v.s % 2 === 1) m.pluck(mtof(ch[(v.s >> 1) % 3]! + 24), v.t, v.len, 0.04);
    },
    ambience(m, out) {
      // dengung kota yang sangat halus (lalu lintas jauh)
      return m.noiseBed(out, { type: 'lowpass', freq: 260, gain: 0.025, lfo: 0.05, lfoDepth: 0.01 });
    },
  },
  hutan: {
    bpm: 84,
    gain: 0.55,
    delay: { time: 0.36, feedback: 0.25, mix: 0.18 },
    play(v, m) {
      const misteri = v.variant === 'misteri';
      const ch = (misteri ? HUTAN_MISTERI : HUTAN_AKOR)[v.bar % 4]!;
      // petikan akustik 1/8
      if (v.s % 2 === 0) {
        const idx = [0, 1, 2, 1, 0, 2, 1, 2][v.s / 2]!;
        m.pluck(mtof(ch[idx]! + 12), v.t, v.len * 3, misteri ? 0.045 : 0.06);
      }
      if (v.s === 0) m.bass(mtof(ch[0]! - 12), v.t, v.len * 14, 0.18);
      if (!misteri) {
        if (v.s % 2 === 1) m.shaker(v.t, 0.018);
        if (v.s === 0 || v.s === 10) m.drum(v.t, 0.18, 90);
        if (Math.floor(v.bar / 4) % 2 === 1 && v.s % 2 === 0) {
          const n = HUTAN_FLUTE[v.bar % 4]![v.s / 2]!;
          if (n > 0) m.flute(mtof(n), v.t, v.len * 3.6, 0.07);
        }
      } else {
        if (v.s === 0) m.drum(v.t, 0.14, 70);
        if (v.s === 8 && v.bar % 2) m.flute(mtof(ch[2]! + 24), v.t, v.len * 7, 0.045);
      }
    },
    ambience(m, out) {
      const angin = m.noiseBed(out, { type: 'bandpass', freq: 700, gain: 0.02, lfo: 0.08, lfoDepth: 0.015 });
      const burung = m.every(2200, 5200, () => m.bird(out));
      return () => (angin(), burung());
    },
  },
  laut: {
    bpm: 74,
    gain: 0.55,
    delay: { time: 0.48, feedback: 0.38, mix: 0.3 },
    play(v, m) {
      const ch = LAUT_AKOR[v.bar % 4]!;
      if (v.s === 0) {
        m.pad(ch.map((n) => mtof(n)), v.t, v.len * 16, 0.05);
        m.bass(mtof(ch[0]! - 12), v.t, v.len * 15, 0.16);
      }
      if (v.s % 2 === 0) {
        const n = ch[[0, 2, 1, 3, 2, 1, 3, 2][v.s / 2]!]! + 24;
        if (v.s % 4 === 0 || v.bar % 2) m.bell(mtof(n), v.t, v.len * 6, 0.035);
      }
    },
    ambience(m, out) {
      const ombak = m.noiseBed(out, { type: 'lowpass', freq: 480, gain: 0.035, lfo: 0.12, lfoDepth: 0.03 });
      const gelembung = m.every(900, 2600, () => m.bubbles(out));
      return () => (ombak(), gelembung());
    },
  },
  angkasa: {
    bpm: 66,
    gain: 0.55,
    delay: { time: 0.55, feedback: 0.45, mix: 0.35 },
    play(v, m) {
      const ch = ANGKASA_AKOR[v.bar % 4]!;
      if (v.s === 0) {
        m.pad(ch.map((n) => mtof(n)), v.t, v.len * 16, 0.045);
        m.drone(mtof(ch[0]! - 12), v.t, v.len * 16, 0.1);
        m.kick(v.t, 0.18);
      }
      // kerlip bintang: arpeggio 1/16 acak-terstruktur (deterministik per langkah)
      if ((v.step * 7) % 3 === 0) {
        const n = ch[(v.step * 5) % 4]! + 24 + ((v.step >> 3) % 2) * 12;
        m.bell(mtof(n), v.t, v.len * 2, 0.022);
      }
    },
    ambience(m, out) {
      return m.noiseBed(out, { type: 'bandpass', freq: 1200, gain: 0.012, lfo: 0.04, lfoDepth: 800, lfoTarget: 'freq' });
    },
  },
  lobi: {
    bpm: 96,
    gain: 0.45,
    delay: { time: 0.3, feedback: 0.2, mix: 0.15 },
    play(v, m) {
      const ch = C_MAJ[v.bar % 4]!;
      if (v.s === 0) m.bass(mtof(ch[0]! - 12), v.t, v.len * 8, 0.14);
      if (v.s % 4 === 0) m.bell(mtof(ch[(v.s / 4) % 3]! + 24), v.t, v.len * 4, 0.04);
      if (v.s === 10) m.pluck(mtof(ch[1]! + 12), v.t, v.len * 3, 0.04);
    },
  },
  podium: {
    bpm: 128,
    gain: 0.6,
    play(v, m) {
      const ch = C_MAJ[[0, 3, 1, 0][v.bar % 4]!]!;
      if (v.s % 4 === 0) m.kick(v.t, 0.5);
      if (v.s === 4 || v.s === 12) m.snare(v.t, 0.28);
      if (v.s >= 13 && v.bar % 4 === 3) m.snare(v.t, 0.16); // gulungan drum
      if (v.s === 0 && v.bar % 4 === 0) m.crash(v.t, 0.12);
      if (v.s % 2 === 0) m.bass(mtof(ch[0]! - 12), v.t, v.len * 1.5, 0.24);
      if (v.s % 4 === 2) for (const n of ch) m.brass(mtof(n + 12), v.t, v.len * 1.2, 0.035);
      if (v.s % 2 === 0) {
        const n = PODIUM_MELODI[v.bar % 4]![v.s / 2]!;
        if (n > 0) m.brass(mtof(n), v.t, v.len * 1.9, 0.08);
      }
    },
  },
};

// ───────────────────────── mesin ─────────────────────────
export class MusicEngine {
  private c: AudioContext | null = null;
  private out: GainNode | null = null; // volume musik
  private under: BiquadFilterNode | null = null; // peredam bawah air
  private noise: AudioBuffer | null = null;
  private cur: { id: ThemeId; bus: GainNode; timer: number; stopAmb: () => void; step: number; next: number } | null = null;
  private variant = '';
  private wantTheme: ThemeId | null = null;
  private underwater = false;
  private oxyTimer = 0;
  enabled = true;

  constructor(private getCtx: () => AudioContext | null, private dest: () => AudioNode | null) {
    try {
      this.enabled = localStorage.getItem(KEY) !== '0';
    } catch {
      /* penyimpanan tidak tersedia */
    }
    // kebijakan autoplay: mulai/lanjutkan setelah sentuhan/klik pertama
    const kick = () => {
      if (this.wantTheme && !this.cur) this.setTheme(this.wantTheme, true);
      this.c?.state === 'suspended' && void this.c.resume();
    };
    window.addEventListener('pointerdown', kick, { passive: true });
    window.addEventListener('keydown', kick);
    document.addEventListener('visibilitychange', () => {
      if (!this.c) return;
      if (document.hidden) void this.c.suspend();
      else if (this.enabled) void this.c.resume();
    });
  }

  private ensure(): boolean {
    const c = this.getCtx();
    const d = this.dest();
    if (!c || !d) return false;
    if (this.c !== c) {
      this.c = c;
      this.out = c.createGain();
      this.out.gain.value = this.enabled ? 0.6 : 0;
      this.under = c.createBiquadFilter();
      this.under.type = 'lowpass';
      this.under.frequency.value = 18000;
      this.out.connect(this.under).connect(d);
      const len = c.sampleRate;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return true;
  }

  /** Ganti tema (crossfade 1,5 dtk). Dipanggil saat masuk adegan. */
  setTheme(id: ThemeId, force = false) {
    this.wantTheme = id;
    if (!force && this.cur?.id === id) return;
    if (!this.enabled || !this.ensure() || !this.c || !this.out) return;
    const c = this.c;
    if (this.cur) {
      const old = this.cur;
      clearInterval(old.timer);
      old.stopAmb();
      old.bus.gain.setTargetAtTime(0, c.currentTime, 0.4);
      setTimeout(() => old.bus.disconnect(), 2500);
    }
    this.variant = '';
    const th = THEMES[id];
    const bus = c.createGain();
    bus.gain.value = 0;
    bus.gain.setTargetAtTime(th.gain, c.currentTime + 0.1, 0.5);
    bus.connect(this.out);
    if (th.delay) {
      const dl = c.createDelay(1.5);
      dl.delayTime.value = th.delay.time;
      const fb = c.createGain();
      fb.gain.value = th.delay.feedback;
      const mix = c.createGain();
      mix.gain.value = th.delay.mix;
      bus.connect(dl);
      dl.connect(fb).connect(dl);
      dl.connect(mix).connect(this.out);
    }
    const state: { id: ThemeId; bus: GainNode; timer: number; stopAmb: () => void; step: number; next: number } = { id, bus, timer: 0, stopAmb: () => undefined, step: 0, next: c.currentTime + 0.15 };
    state.stopAmb = th.ambience ? th.ambience(this, bus) : () => undefined;
    const len = 60 / th.bpm / 4;
    state.timer = window.setInterval(() => {
      if (!this.c || this.c.state !== 'running') return;
      // jangan menumpuk jadwal setelah tab tertidur
      if (state.next < this.c.currentTime - 0.5) state.next = this.c.currentTime + 0.05;
      while (state.next < this.c.currentTime + 0.2) {
        const st = state.step;
        this.target = bus;
        th.play({ t: state.next, step: st, bar: Math.floor(st / 16), s: st % 16, len, variant: this.variant }, this);
        state.step++;
        state.next += len;
      }
    }, 25);
    this.cur = state;
  }

  /** Varian tema (mis. 'misteri' di Gua Kristal). */
  setVariant(v: string) {
    this.variant = v;
  }

  /** Bawah air: suara meredam (low-pass) & sedikit lebih pelan. */
  setUnderwater(on: boolean) {
    if (on === this.underwater || !this.c || !this.under || !this.out) return;
    this.underwater = on;
    this.under.frequency.setTargetAtTime(on ? 520 : 18000, this.c.currentTime, 0.25);
  }

  /** Lonceng peringatan oksigen (lembut, berulang tiap ±1,1 dtk selama aktif). */
  setOxygenLow(on: boolean) {
    if (on && !this.oxyTimer) {
      const ping = () => {
        if (!this.c || !this.out || !this.enabled) return;
        const t = this.c.currentTime;
        this.target = this.out;
        this.bell(mtof(84), t, 0.35, 0.09);
        this.bell(mtof(79), t + 0.16, 0.4, 0.07);
      };
      ping();
      this.oxyTimer = window.setInterval(ping, 1100);
    } else if (!on && this.oxyTimer) {
      clearInterval(this.oxyTimer);
      this.oxyTimer = 0;
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* abaikan */
    }
    if (!on) {
      this.setOxygenLow(false);
      if (this.cur) {
        clearInterval(this.cur.timer);
        this.cur.stopAmb();
        this.cur.bus.disconnect();
        this.cur = null;
      }
    } else if (this.wantTheme) this.setTheme(this.wantTheme, true);
    if (this.out && this.c) this.out.gain.setTargetAtTime(on ? 0.6 : 0, this.c.currentTime, 0.1);
  }

  state() {
    return { theme: this.cur?.id ?? null, want: this.wantTheme, variant: this.variant, underwater: this.underwater, oxygenAlarm: !!this.oxyTimer, enabled: this.enabled, running: this.c?.state === 'running' };
  }

  // ───────────── instrumen (semua menuju this.target) ─────────────
  private target: AudioNode | null = null;

  private env(g: GainNode, t: number, a: number, peak: number, dur: number, rel = 0.08) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0.0001, t + Math.max(a, dur - rel), rel);
  }
  private osc(type: OscillatorType, f: number, t: number, dur: number, peak: number, a = 0.01, filter?: number, rel = 0.08) {
    const c = this.c!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = c.createGain();
    this.env(g, t, a, peak, dur, rel);
    let node: AudioNode = o;
    if (filter) {
      const bq = c.createBiquadFilter();
      bq.type = 'lowpass';
      bq.frequency.value = filter;
      node = o.connect(bq);
    }
    node.connect(g).connect(this.target!);
    o.start(t);
    o.stop(t + dur + rel * 6);
    return o;
  }
  pluck(f: number, t: number, dur: number, v: number) {
    this.osc('triangle', f, t, Math.min(dur, 0.6), v, 0.005, 3000, 0.12);
  }
  lead(f: number, t: number, dur: number, v: number) {
    this.osc('square', f, t, dur, v, 0.01, 2400, 0.06);
    this.osc('triangle', f * 2, t, dur * 0.6, v * 0.4, 0.01, undefined, 0.05);
  }
  brass(f: number, t: number, dur: number, v: number) {
    const o = this.osc('sawtooth', f, t, dur, v, 0.03, 1900, 0.1);
    o.detune.setValueAtTime(-12, t);
    o.detune.linearRampToValueAtTime(0, t + 0.06);
  }
  bass(f: number, t: number, dur: number, v: number) {
    this.osc('sine', f, t, dur, v, 0.01, undefined, 0.1);
    this.osc('triangle', f, t, dur * 0.8, v * 0.3, 0.01, 600, 0.08);
  }
  flute(f: number, t: number, dur: number, v: number) {
    const c = this.c!;
    const o = this.osc('sine', f, t, dur, v, 0.08, undefined, 0.15);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = c.createGain();
    lg.gain.value = f * 0.006;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t + 0.15);
    lfo.stop(t + dur + 1);
    this.noiseHit(t, Math.min(0.12, dur), v * 0.25, 'bandpass', f * 2); // napas
  }
  bell(f: number, t: number, dur: number, v: number) {
    this.osc('sine', f, t, dur, v, 0.003, undefined, dur * 0.5);
    this.osc('sine', f * 2.76, t, dur * 0.4, v * 0.35, 0.003, undefined, dur * 0.2);
  }
  pad(fs: number[], t: number, dur: number, v: number) {
    for (const f of fs) {
      const a = this.osc('sawtooth', f, t, dur, v * 0.5, 0.9, 900, 0.9);
      a.detune.value = -7;
      const b = this.osc('sawtooth', f, t, dur, v * 0.5, 0.9, 900, 0.9);
      b.detune.value = 7;
    }
  }
  drone(f: number, t: number, dur: number, v: number) {
    this.osc('sine', f, t, dur, v, 1.2, undefined, 1.2);
  }
  kick(t: number, v: number) {
    const c = this.c!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    this.env(g, t, 0.004, v, 0.18, 0.06);
    o.connect(g).connect(this.target!);
    o.start(t);
    o.stop(t + 0.5);
  }
  drum(t: number, v: number, f: number) {
    const c = this.c!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    this.env(g, t, 0.004, v, 0.25, 0.08);
    o.connect(g).connect(this.target!);
    o.start(t);
    o.stop(t + 0.6);
  }
  private noiseHit(t: number, dur: number, v: number, type: BiquadFilterType, f: number) {
    const c = this.c!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bq = c.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = f;
    const g = c.createGain();
    this.env(g, t, 0.002, v, dur, dur * 0.4);
    src.connect(bq).connect(g).connect(this.target!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.3);
  }
  snare(t: number, v: number) {
    this.noiseHit(t, 0.12, v, 'bandpass', 1800);
    this.osc('triangle', 190, t, 0.06, v * 0.4, 0.002);
  }
  hat(t: number, v: number) {
    this.noiseHit(t, 0.04, v, 'highpass', 7000);
  }
  shaker(t: number, v: number) {
    this.noiseHit(t, 0.06, v, 'highpass', 5000);
  }
  crash(t: number, v: number) {
    this.noiseHit(t, 1.2, v, 'highpass', 4500);
  }

  // ───────────── ambience ─────────────
  /** Bunyi latar berkelanjutan dari derau terfilter, dengan LFO halus. Mengembalikan fungsi berhenti. */
  noiseBed(out: AudioNode, o: { type: BiquadFilterType; freq: number; gain: number; lfo: number; lfoDepth: number; lfoTarget?: 'gain' | 'freq' }) {
    const c = this.c!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bq = c.createBiquadFilter();
    bq.type = o.type;
    bq.frequency.value = o.freq;
    const g = c.createGain();
    g.gain.value = o.gain;
    const lfo = c.createOscillator();
    lfo.frequency.value = o.lfo;
    const lg = c.createGain();
    lg.gain.value = o.lfoDepth;
    lfo.connect(lg).connect(o.lfoTarget === 'freq' ? bq.frequency : g.gain);
    src.connect(bq).connect(g).connect(out);
    src.start();
    lfo.start();
    return () => {
      try {
        src.stop();
        lfo.stop();
      } catch {
        /* sudah berhenti */
      }
      g.disconnect();
    };
  }
  /** Jalankan fn secara acak tiap min..max ms. */
  every(min: number, max: number, fn: () => void) {
    let id = 0;
    const loop = () => {
      id = window.setTimeout(() => {
        if (this.c?.state === 'running') fn();
        loop();
      }, min + Math.random() * (max - min));
    };
    loop();
    return () => clearTimeout(id);
  }
  bird(out: AudioNode) {
    const c = this.c!;
    const t = c.currentTime + 0.02;
    const base = 2200 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator();
      const g = c.createGain();
      const s = t + i * 0.13;
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * 1.5, s + 0.06);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, s + 0.1);
      this.env(g, s, 0.01, 0.025, 0.1, 0.03);
      o.connect(g).connect(out);
      o.start(s);
      o.stop(s + 0.3);
    }
  }
  bubbles(out: AudioNode) {
    const c = this.c!;
    const t = c.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      const g = c.createGain();
      const s = t + i * 0.07 + Math.random() * 0.05;
      const f = 300 + Math.random() * 500;
      o.frequency.setValueAtTime(f, s);
      o.frequency.exponentialRampToValueAtTime(f * 2.4, s + 0.08);
      this.env(g, s, 0.005, 0.03, 0.08, 0.02);
      o.connect(g).connect(out);
      o.start(s);
      o.stop(s + 0.2);
    }
  }
}
