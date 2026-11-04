/** Suara EDUVERSE disintesis dengan Web Audio (tanpa file audio/aset berlisensi). */
import { MusicEngine } from './music.js';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setSound(on: boolean) {
  enabled = on;
  if (master) master.gain.value = on ? 0.5 : 0;
}

export function soundOn() {
  return enabled;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'triangle', vol = 0.3) {
  const c = ac();
  if (!c || !master) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  click: () => tone(880, 0, 0.08, 'sine', 0.15),
  correct: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.25, 'triangle', 0.25)),
  retry: () => [392, 330].forEach((f, i) => tone(f, i * 0.12, 0.25, 'sine', 0.2)),
  open: () => [660, 990].forEach((f, i) => tone(f, i * 0.06, 0.15, 'sine', 0.18)),
  countdown: (final: boolean) => tone(final ? 1046 : 523, 0, final ? 0.5 : 0.18, 'square', 0.12),
  notify: () => tone(740, 0, 0.12, 'sine', 0.12),
  drum: () => {
    for (let i = 0; i < 10; i++) tone(110 + (i % 2) * 20, i * 0.11, 0.1, 'square', 0.12);
  },
  /** Jingle kemenangan pendek (komposisi sendiri). */
  victory: () => {
    const melody = [523, 523, 659, 784, 659, 784, 1047, 988, 1047, 1175, 1319];
    const dur = [0.15, 0.15, 0.15, 0.3, 0.15, 0.15, 0.45, 0.15, 0.15, 0.15, 0.7];
    let t = 0;
    melody.forEach((f, i) => {
      tone(f, t, dur[i]! + 0.1, 'triangle', 0.25);
      tone(f / 2, t, dur[i]! + 0.1, 'sine', 0.12);
      t += dur[i]!;
    });
  },
};

// ───────────── suara kendaraan, jetpack, portal (Kota Hidup) ─────────────

type LoopKind = 'mobil' | 'motor' | 'bus' | 'pesawat' | 'jetpack' | 'sepeda' | 'perahu' | 'kapalselam' | null;
let loop: { kind: LoopKind; osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
let noise: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

function noiseBuffer(c: AudioContext) {
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Suara mesin berkelanjutan. speed01 = 0..1 (kecepatan relatif), thrust = 0..1 (semburan jetpack).
 * Panggil setiap frame; kind null mematikan suara dengan halus.
 */
function stopLoop() {
  if (!loop) return;
  const l = loop;
  loop = null;
  l.gain.gain.setTargetAtTime(0, l.osc.context.currentTime, 0.1);
  setTimeout(() => {
    try {
      l.osc.stop();
      l.osc2.stop();
    } catch {
      /* sudah berhenti */
    }
  }, 400);
}
function stopNoise() {
  if (!noise) return;
  const n = noise;
  noise = null;
  n.gain.gain.setTargetAtTime(0, n.src.context.currentTime, 0.1);
  setTimeout(() => {
    try {
      n.src.stop();
    } catch {
      /* abaikan */
    }
  }, 400);
}

export function engineSound(kind: LoopKind, speed01: number, thrust = 0) {
  const c = enabled && kind !== null && kind !== 'sepeda' ? ac() : null;
  if (!c || !master) {
    stopLoop();
    stopNoise();
    return;
  }
  if (kind === 'jetpack') {
    stopLoop();
    if (!noise) {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c);
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 700;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(master);
      src.start();
      noise = { src, gain, filter };
    }
    noise.gain.gain.setTargetAtTime(0.03 + thrust * 0.22, c.currentTime, 0.08);
    noise.filter.frequency.setTargetAtTime(500 + thrust * 900, c.currentTime, 0.1);
    return;
  }
  stopNoise();
  if (!loop || loop.kind !== kind) {
    stopLoop();
    const osc = c.createOscillator();
    const osc2 = c.createOscillator();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = c.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(master);
    osc.start();
    osc2.start();
    loop = { kind, osc, osc2, gain, filter };
  }
  const base = kind === 'motor' ? 70 : kind === 'bus' ? 38 : kind === 'pesawat' ? 55 : 48;
  const range = kind === 'motor' ? 140 : kind === 'pesawat' ? 90 : 80;
  const f = base + range * speed01;
  loop.osc.frequency.setTargetAtTime(f, c.currentTime, 0.08);
  loop.osc2.frequency.setTargetAtTime(f * (kind === 'pesawat' ? 2.02 : 0.5), c.currentTime, 0.08);
  loop.filter.frequency.setTargetAtTime(kind === 'pesawat' ? 900 + 900 * speed01 : 400 + 600 * speed01, c.currentTime, 0.1);
  loop.gain.gain.setTargetAtTime(kind === 'pesawat' ? 0.06 + 0.06 * speed01 : 0.05 + 0.05 * speed01, c.currentTime, 0.1);
}

export const sfxLiving = {
  portal: () => {
    const c = ac();
    if (!c || !master) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    const t = c.currentTime;
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 1);
    [880, 1175, 1568].forEach((f, i) => tone(f, 0.55 + i * 0.07, 0.25, 'triangle', 0.12));
  },
  door: () => [330, 440].forEach((f, i) => tone(f, i * 0.07, 0.12, 'square', 0.08)),
  horn: () => {
    tone(392, 0, 0.35, 'square', 0.12);
    tone(494, 0, 0.35, 'square', 0.08);
  },
  bump: () => tone(110, 0, 0.18, 'square', 0.15),
  coin: () => [988, 1319].forEach((f, i) => tone(f, i * 0.08, 0.18, 'triangle', 0.16)),
};

/** Musik latar per dunia (lihat music.ts) — memakai AudioContext & volume utama yang sama dengan efek suara. */
export const music = new MusicEngine(
  () => ac(),
  () => master,
);
