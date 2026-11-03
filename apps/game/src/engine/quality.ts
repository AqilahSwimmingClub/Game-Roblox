/**
 * Kualitas grafis: Rendah, Sedang, Tinggi, Otomatis.
 * Otomatis memilih awal dari kemampuan perangkat, lalu menurunkan level bila FPS rendah.
 */
export type QualityLevel = 'rendah' | 'sedang' | 'tinggi';
export type QualitySetting = QualityLevel | 'otomatis';

export interface QualityProfile {
  level: QualityLevel;
  pixelRatio: number;
  shadows: boolean;
  viewDistance: number; // meter — radius chunk detail penuh
  lodDistance: number; // meter — radius chunk LOD sederhana
  fogFar: number;
  maxRemotePlayers: number;
  particles: number; // pengali jumlah partikel
  antialias: boolean;
}

const KEY = 'eduverse.quality';

export function loadQualitySetting(): QualitySetting {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'rendah' || v === 'sedang' || v === 'tinggi' || v === 'otomatis') return v;
  } catch {
    /* penyimpanan tidak tersedia */
  }
  return 'otomatis';
}

export function saveQualitySetting(v: QualitySetting) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* abaikan */
  }
}

/** Tebakan awal untuk mode Otomatis. */
export function detectLevel(): QualityLevel {
  const touch = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (touch && (cores <= 4 || mem <= 3)) return 'rendah';
  if (touch) return 'sedang';
  return cores >= 8 ? 'tinggi' : 'sedang';
}

export function profileFor(level: QualityLevel): QualityProfile {
  const dpr = window.devicePixelRatio || 1;
  switch (level) {
    case 'rendah':
      return { level, pixelRatio: Math.min(dpr, 1), shadows: false, viewDistance: 110, lodDistance: 220, fogFar: 230, maxRemotePlayers: 12, particles: 0.35, antialias: false };
    case 'sedang':
      return { level, pixelRatio: Math.min(dpr, 1.5), shadows: false, viewDistance: 170, lodDistance: 340, fogFar: 360, maxRemotePlayers: 20, particles: 0.7, antialias: false };
    case 'tinggi':
      return { level, pixelRatio: Math.min(dpr, 2), shadows: true, viewDistance: 260, lodDistance: 520, fogFar: 560, maxRemotePlayers: 30, particles: 1, antialias: true };
  }
}

/** Pemantau FPS untuk mode Otomatis: turun satu level bila rata-rata < 26 FPS selama 6 detik. */
export class FpsGovernor {
  private frames = 0;
  private acc = 0;
  private lowSeconds = 0;
  fps = 60;

  tick(dt: number): 'turun' | null {
    this.frames++;
    this.acc += dt;
    if (this.acc < 1) return null;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    if (this.fps < 26) this.lowSeconds++;
    else this.lowSeconds = Math.max(0, this.lowSeconds - 1);
    if (this.lowSeconds >= 6) {
      this.lowSeconds = 0;
      return 'turun';
    }
    return null;
  }
}
