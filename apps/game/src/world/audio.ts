/** Suara EDUVERSE disintesis dengan Web Audio (tanpa file audio/aset berlisensi). */
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
