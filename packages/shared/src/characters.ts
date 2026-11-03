/**
 * 20 karakter preset EDUVERSE (gaya blocky low-poly, ramah anak) mengikuti gambar referensi kategori karakter.
 * Tidak memakai identitas, logo, atau emblem waralaba mana pun. Lambang pahlawan memakai bintang-buku EDUVERSE.
 * Bentuk 3D dibangun di klien (apps/game/src/engine/avatar.ts) dari kode `id`.
 */
export type CharacterCategory = 'pelajar' | 'budaya' | 'profesi' | 'petualang' | 'pahlawan';

export interface CharacterInfo {
  id: number;
  kode: string;
  nama: string;
  kategori: CharacterCategory;
  /** Robot tidak memakai warna kulit. */
  robot: boolean;
  /** Warna utama untuk lencana di Dashboard & kartu. */
  warna: string;
  deskripsi: string;
}

export const CHARACTER_CATEGORIES: { id: CharacterCategory | 'semua'; nama: string }[] = [
  { id: 'semua', nama: 'Semua' },
  { id: 'pelajar', nama: 'Pelajar' },
  { id: 'budaya', nama: 'Batik' },
  { id: 'profesi', nama: 'Profesi' },
  { id: 'petualang', nama: 'Petualang' },
  { id: 'pahlawan', nama: 'Pahlawan & Robot' },
];

export const CHARACTERS: readonly CharacterInfo[] = [
  { id: 0, kode: 'astronot', nama: 'Astronot', kategori: 'petualang', robot: false, warna: '#2F8BE6', deskripsi: 'Penjelajah antariksa: baju putih, helm visor biru, ransel oksigen.' },
  { id: 1, kode: 'robot-siber', nama: 'Robot Cyber', kategori: 'pahlawan', robot: true, warna: '#C62828', deskripsi: 'Robot zirah merah-hitam dengan visor hijau menyala.' },
  { id: 2, kode: 'robot-retro', nama: 'Robot Retro', kategori: 'pahlawan', robot: true, warna: '#8EA4BF', deskripsi: 'Robot logam klasik: dua antena, layar dada, tangan capit.' },
  { id: 3, kode: 'pahlawan-putra', nama: 'Superhero Putra', kategori: 'pahlawan', robot: false, warna: '#2F6FE0', deskripsi: 'Pahlawan EDUVERSE bertopeng biru, jubah kuning, lambang bintang-buku.' },
  { id: 4, kode: 'pahlawan-putri', nama: 'Superhero Putri', kategori: 'pahlawan', robot: false, warna: '#7B3FC4', deskripsi: 'Pahlawan EDUVERSE bertopeng ungu, jubah emas, lambang bintang.' },
  { id: 5, kode: 'petualang', nama: 'Petualang', kategori: 'petualang', robot: false, warna: '#C8B07E', deskripsi: 'Setelan khaki, topi safari, ransel dengan gulungan tikar.' },
  { id: 6, kode: 'detektif', nama: 'Detektif Cilik', kategori: 'petualang', robot: false, warna: '#8A6142', deskripsi: 'Mantel cokelat, topi detektif, kaca pembesar.' },
  { id: 7, kode: 'sma-putra', nama: 'Pelajar SMA Putra', kategori: 'pelajar', robot: false, warna: '#8C96A8', deskripsi: 'Seragam putih abu-abu, dasi abu, berkacamata.' },
  { id: 8, kode: 'sma-putri', nama: 'Pelajar SMA Putri', kategori: 'pelajar', robot: false, warna: '#9AA3B5', deskripsi: 'Jilbab putih, seragam abu-abu, rok panjang.' },
  { id: 9, kode: 'smp-putra', nama: 'Pelajar SMP Putra', kategori: 'pelajar', robot: false, warna: '#2C5BC9', deskripsi: 'Seragam putih biru dengan dasi biru.' },
  { id: 10, kode: 'smp-putri', nama: 'Pelajar SMP Putri', kategori: 'pelajar', robot: false, warna: '#3557A3', deskripsi: 'Jilbab putih, seragam putih, rok panjang biru.' },
  { id: 11, kode: 'dokter', nama: 'Dokter Cilik', kategori: 'profesi', robot: false, warna: '#4FB8C4', deskripsi: 'Jas putih, stetoskop, berkacamata.' },
  { id: 12, kode: 'pemadam', nama: 'Pemadam Kebakaran', kategori: 'profesi', robot: false, warna: '#F2B21B', deskripsi: 'Setelan kuning bergaris merah dan helm merah.' },
  { id: 13, kode: 'atlet', nama: 'Atlet Sekolah', kategori: 'profesi', robot: false, warna: '#E53935', deskripsi: 'Kaus & topi merah, membawa bola sepak.' },
  { id: 14, kode: 'sd-putra', nama: 'Pelajar SD Putra', kategori: 'pelajar', robot: false, warna: '#D32F2F', deskripsi: 'Seragam putih merah, dasi merah, ransel merah.' },
  { id: 15, kode: 'sd-putri', nama: 'Pelajar SD Putri', kategori: 'pelajar', robot: false, warna: '#E04848', deskripsi: 'Jilbab putih, seragam putih merah, ransel biru.' },
  { id: 16, kode: 'batik-putra', nama: 'Pelajar Batik Putra', kategori: 'budaya', robot: false, warna: '#B3261E', deskripsi: 'Kemeja batik merah-hitam dan celana hitam.' },
  { id: 17, kode: 'batik-putri', nama: 'Pelajar Batik Putri', kategori: 'budaya', robot: false, warna: '#8A5A2E', deskripsi: 'Blus batik merah, kain batik cokelat, rambut kepang.' },
  { id: 18, kode: 'chef', nama: 'Chef Cilik', kategori: 'profesi', robot: false, warna: '#FF8A3D', deskripsi: 'Jas koki putih, topi koki tinggi, sendok kayu.' },
  { id: 19, kode: 'seniman', nama: 'Seniman Cilik', kategori: 'profesi', robot: false, warna: '#E86FA8', deskripsi: 'Baret merah, celemek penuh cat, palet dan kuas.' },
];

export function characterName(id: number | undefined | null): string {
  return CHARACTERS[id ?? -1]?.nama ?? '—';
}
