/** Identitas visual EDUVERSE (dokumen Tahap 1, bagian A). */
export const PALETTE = {
  biru: '#3BA7FF',
  kuning: '#FFC93C',
  hijau: '#2FBF71',
  oranye: '#FF8A3D',
  ungu: '#8B5CF6',
  putih: '#F4F8FF',
  navy: '#1E2A4A',
  merah: '#E5484D',
  abuTeks: '#55607A',
  abuLembut: '#DCE6F5',
  emas: '#FFC93C',
  perak: '#C9D3E0',
  perunggu: '#D98C4A',
} as const;

/** Warna aksen per dunia (dokumen bagian D). */
export const WORLD_COLORS = {
  kota: '#FF8A3D',
  hutan: '#2FBF71',
  laut: '#1FB6D9',
  angkasa: '#7C5CFF',
} as const;

export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}
