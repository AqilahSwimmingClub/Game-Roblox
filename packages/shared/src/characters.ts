/**
 * 20 karakter preset EDUVERSE — semuanya desain ORISINAL EDUVERSE (gaya blocky low-poly, ramah anak).
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
  { id: 0, kode: 'astronot', nama: 'Astronot Bintang', kategori: 'petualang', robot: false, warna: '#F4F7FB', deskripsi: 'Penjelajah antariksa dengan helm kaca dan tabung oksigen.' },
  { id: 1, kode: 'robot-siber', nama: 'Robo Neon', kategori: 'pahlawan', robot: true, warna: '#243B6B', deskripsi: 'Robot siber dengan garis cahaya biru dan layar wajah.' },
  { id: 2, kode: 'robot-retro', nama: 'Robo Klasik', kategori: 'pahlawan', robot: true, warna: '#D9483B', deskripsi: 'Robot kotak gaya lama dengan antena lampu dan kenop dada.' },
  { id: 3, kode: 'pahlawan-putra', nama: 'Kapten Cakrawala', kategori: 'pahlawan', robot: false, warna: '#1FA39A', deskripsi: 'Pahlawan pelindung kota dengan jubah jingga dan lambang bintang-buku.' },
  { id: 4, kode: 'pahlawan-putri', nama: 'Srikandi Cahaya', kategori: 'pahlawan', robot: false, warna: '#8B5CF6', deskripsi: 'Pahlawan cahaya berjubah merah muda dengan mahkota bintang.' },
  { id: 5, kode: 'petualang', nama: 'Penjelajah Rimba', kategori: 'petualang', robot: false, warna: '#C98A4B', deskripsi: 'Petualang bertopi lebar dengan ransel dan teropong.' },
  { id: 6, kode: 'detektif', nama: 'Detektif Cilik', kategori: 'petualang', robot: false, warna: '#8A6A47', deskripsi: 'Pemecah misteri dengan mantel, topi, dan kaca pembesar.' },
  { id: 7, kode: 'sma-putra', nama: 'Pelajar SMA Putra', kategori: 'pelajar', robot: false, warna: '#8C96A8', deskripsi: 'Seragam putih abu-abu dengan dasi abu.' },
  { id: 8, kode: 'sma-putri', nama: 'Pelajar SMA Putri', kategori: 'pelajar', robot: false, warna: '#9AA3B5', deskripsi: 'Seragam putih abu-abu, rambut panjang, dasi abu.' },
  { id: 9, kode: 'smp-putra', nama: 'Pelajar SMP Putra', kategori: 'pelajar', robot: false, warna: '#2C4A8C', deskripsi: 'Seragam putih biru dengan dasi biru.' },
  { id: 10, kode: 'smp-putri', nama: 'Pelajar SMP Putri', kategori: 'pelajar', robot: false, warna: '#3557A3', deskripsi: 'Seragam putih biru dengan jilbab putih.' },
  { id: 11, kode: 'dokter', nama: 'Dokter Cilik', kategori: 'profesi', robot: false, warna: '#5EC4E8', deskripsi: 'Jas putih, baju biru muda, dan stetoskop.' },
  { id: 12, kode: 'pemadam', nama: 'Pemadam Kebakaran', kategori: 'profesi', robot: false, warna: '#E53935', deskripsi: 'Jaket merah bergaris pemantul dan helm kuning.' },
  { id: 13, kode: 'atlet', nama: 'Atlet Sekolah', kategori: 'profesi', robot: false, warna: '#2FBF71', deskripsi: 'Kaus olahraga bernomor, ikat kepala, dan sepatu lari.' },
  { id: 14, kode: 'sd-putra', nama: 'Pelajar SD Putra', kategori: 'pelajar', robot: false, warna: '#D32F2F', deskripsi: 'Seragam putih merah dengan topi dan dasi merah.' },
  { id: 15, kode: 'sd-putri', nama: 'Pelajar SD Putri', kategori: 'pelajar', robot: false, warna: '#E04848', deskripsi: 'Seragam putih merah dengan rambut berkuncir.' },
  { id: 16, kode: 'batik-putra', nama: 'Pelajar Batik Putra', kategori: 'budaya', robot: false, warna: '#9A5B22', deskripsi: 'Kemeja batik cokelat emas dan peci hitam.' },
  { id: 17, kode: 'batik-putri', nama: 'Pelajar Batik Putri', kategori: 'budaya', robot: false, warna: '#B5476B', deskripsi: 'Blus batik, rok panjang, dan sanggul berhias bunga.' },
  { id: 18, kode: 'chef', nama: 'Chef Cilik', kategori: 'profesi', robot: false, warna: '#FF8A3D', deskripsi: 'Topi koki tinggi, celemek, dan sendok kayu.' },
  { id: 19, kode: 'seniman', nama: 'Seniman Cilik', kategori: 'profesi', robot: false, warna: '#E86FA8', deskripsi: 'Baret, kaus bergaris, palet, dan kuas.' },
];

export function characterName(id: number | undefined | null): string {
  return CHARACTERS[id ?? -1]?.nama ?? '—';
}
