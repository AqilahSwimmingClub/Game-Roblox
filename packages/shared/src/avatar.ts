/**
 * Avatar EDUVERSE: 20 karakter preset orisinal (lihat characters.ts) + pilihan warna kulit untuk karakter manusia.
 * Semua karakter memakai SATU rig yang sama (kaki, badan, lengan, kepala) sehingga animasi idle/jalan/lari/lompat
 * dan animasi masa depan berlaku untuk semuanya.
 */
import { CHARACTERS } from './characters.js';

export interface AvatarConfig {
  /** Indeks karakter preset 0–19 (CHARACTERS). */
  karakter: number;
  /** Indeks warna kulit (AVATAR_OPTIONS.kulit); diabaikan oleh karakter robot. */
  kulit: number;
}

export const AVATAR_OPTIONS = {
  kulit: [
    { nama: 'Terang', warna: '#F5D0A9' },
    { nama: 'Kuning Langsat', warna: '#E8B88A' },
    { nama: 'Sawo Matang', warna: '#C68A5B' },
    { nama: 'Gelap', warna: '#7A4B2A' },
  ],
} as const;

/** Bawaan: Pelajar SD laki-laki, kulit sawo matang. */
export const DEFAULT_AVATAR: AvatarConfig = { karakter: 14, kulit: 2 };

function inRange(v: unknown, len: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < len;
}

/** Validasi ketat (dipakai server untuk data dari klien dan data lama di database). */
export function sanitizeAvatar(raw: unknown): AvatarConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    karakter: inRange(r.karakter, CHARACTERS.length) ? r.karakter : DEFAULT_AVATAR.karakter,
    kulit: inRange(r.kulit, AVATAR_OPTIONS.kulit.length) ? r.kulit : DEFAULT_AVATAR.kulit,
  };
}
