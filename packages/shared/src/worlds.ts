export type WorldId = 'kota' | 'hutan' | 'laut' | 'angkasa';
export type SceneId = 'lobi' | WorldId | 'podium';

export interface WorldInfo {
  id: WorldId;
  nama: string;
  mapel: string;
  /** Sudah tersedia di build ini (dunia lain dikerjakan pada tahap berikutnya). */
  tersedia: boolean;
}

export const WORLDS: readonly WorldInfo[] = [
  { id: 'kota', nama: 'Dunia Kota', mapel: 'Matematika · Bahasa Indonesia · Pancasila', tersedia: true },
  { id: 'hutan', nama: 'Dunia Hutan', mapel: 'IPAS: ekosistem, rantai makanan', tersedia: false },
  { id: 'laut', nama: 'Dunia Laut', mapel: 'Hewan laut, ekolokasi, sains', tersedia: false },
  { id: 'angkasa', nama: 'Dunia Luar Angkasa', mapel: 'Tata surya, planet, antariksa', tersedia: false },
];

export const WORLD_IDS: readonly WorldId[] = WORLDS.map((w) => w.id);

export function isWorldId(v: unknown): v is WorldId {
  return typeof v === 'string' && (WORLD_IDS as readonly string[]).includes(v);
}
