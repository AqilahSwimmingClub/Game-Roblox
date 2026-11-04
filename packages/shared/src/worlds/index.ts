/**
 * Registri empat dunia EDUVERSE: layout, zona, batas, dan lingkungan (gravitasi, langit, oksigen).
 * Dipakai server (validasi & soal) dan klien (render, fisika) agar keempat dunia berperilaku konsisten.
 */
import type { WorldId } from '../worlds.js';
import { buildKota, KOTA_ZONES, type KotaLayout, type Zone } from '../kota/layout.js';
import { KOTA_WORLD_HALF } from '../kota/living.js';
import { buildHutan, buildLaut, buildAngkasa, HUTAN_ZONES, LAUT_ZONES, ANGKASA_ZONES, HUTAN_HALF, LAUT_HALF, ANGKASA_HALF } from './alam.js';

export * from './alam.js';

export interface WorldEnv {
  /** Setengah lebar peta (m): batas validasi server & peta. */
  half: number;
  /** Setengah lebar area peta utama (untuk peta/minimap). */
  mapHalf: number;
  sky: number;
  fog: number;
  /** Gravitasi rendah (Luar Angkasa). */
  lowGravity: boolean;
  /** Oksigen terbatas saat menyelam (Laut). */
  oxygen: boolean;
  /** Warna dasar peta mini. */
  mapBg: string;
}

export const WORLD_ENV: Record<WorldId, WorldEnv> = {
  kota: { half: KOTA_WORLD_HALF, mapHalf: 600, sky: 0x9fd8ff, fog: 0xcfe9ff, lowGravity: false, oxygen: false, mapBg: '#BFE3A8' },
  hutan: { half: HUTAN_HALF, mapHalf: HUTAN_HALF, sky: 0xa8e0b8, fog: 0xcdeccf, lowGravity: false, oxygen: false, mapBg: '#7FBF6A' },
  laut: { half: LAUT_HALF, mapHalf: LAUT_HALF, sky: 0x8fd8ff, fog: 0xbfe8ff, lowGravity: false, oxygen: true, mapBg: '#5CC8E8' },
  angkasa: { half: ANGKASA_HALF, mapHalf: ANGKASA_HALF, sky: 0x0b1030, fog: 0x1b2150, lowGravity: true, oxygen: false, mapBg: '#2B3150' },
};

/** Oksigen menyelam (detik) sebelum otomatis naik ke permukaan. */
export const OXYGEN_SECONDS = 45;

export function worldLayout(w: WorldId): KotaLayout {
  switch (w) {
    case 'hutan':
      return buildHutan();
    case 'laut':
      return buildLaut();
    case 'angkasa':
      return buildAngkasa();
    default:
      return buildKota();
  }
}

export function worldZones(w: WorldId): Zone[] {
  return w === 'hutan' ? HUTAN_ZONES : w === 'laut' ? LAUT_ZONES : w === 'angkasa' ? ANGKASA_ZONES : KOTA_ZONES;
}

/** Zona pada posisi (x, z) di sebuah dunia. */
export function zoneIn(w: WorldId, x: number, z: number): Zone | null {
  for (const zone of worldZones(w)) for (const r of zone.rects) if (Math.abs(x - r.x) <= r.hx && Math.abs(z - r.z) <= r.hz) return zone;
  return null;
}

/** Cari zona berdasarkan id di semua dunia. */
export function findZone(id: string): Zone | undefined {
  for (const w of ['kota', 'hutan', 'laut', 'angkasa'] as const) {
    const z = worldZones(w).find((zz) => zz.id === id);
    if (z) return z;
  }
  return undefined;
}
