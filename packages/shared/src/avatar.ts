/** Kustomisasi avatar voxel EDUVERSE (dokumen layar 4: Badan, Rambut, Baju, Topi, Aksesori, Warna). */
export interface AvatarConfig {
  kulit: number;
  rambut: number;
  baju: number;
  topi: number;
  aksesori: number;
  warna: number;
}

export const AVATAR_OPTIONS = {
  kulit: [
    { nama: 'Terang', warna: '#F5D0A9' },
    { nama: 'Kuning Langsat', warna: '#E8B88A' },
    { nama: 'Sawo Matang', warna: '#C68A5B' },
    { nama: 'Gelap', warna: '#7A4B2A' },
  ],
  rambut: [
    { nama: 'Pendek' },
    { nama: 'Panjang' },
    { nama: 'Jilbab' },
    { nama: 'Kuncir' },
  ],
  baju: [
    { nama: 'Seragam SD', atas: '#FFFFFF', bawah: '#D32F2F' },
    { nama: 'Penjelajah', atas: '#C98A4B', bawah: '#5D6678' },
    { nama: 'Olahraga', atas: '#3BA7FF', bawah: '#1E2A4A' },
    { nama: 'Pramuka', atas: '#A07A4A', bawah: '#6B4F2A' },
  ],
  topi: [{ nama: 'Tanpa Topi' }, { nama: 'Topi SD' }, { nama: 'Topi Petualang' }, { nama: 'Helm Ajaib' }],
  aksesori: [{ nama: 'Tanpa' }, { nama: 'Ransel' }, { nama: 'Syal' }],
  warna: ['#3BA7FF', '#FFC93C', '#2FBF71', '#FF8A3D', '#8B5CF6', '#E86FA8'],
} as const;

export const DEFAULT_AVATAR: AvatarConfig = { kulit: 2, rambut: 0, baju: 0, topi: 1, aksesori: 1, warna: 0 };

function inRange(v: unknown, len: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < len;
}

/** Validasi ketat (dipakai server untuk data dari klien). */
export function sanitizeAvatar(raw: unknown): AvatarConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    kulit: inRange(r.kulit, AVATAR_OPTIONS.kulit.length) ? r.kulit : DEFAULT_AVATAR.kulit,
    rambut: inRange(r.rambut, AVATAR_OPTIONS.rambut.length) ? r.rambut : DEFAULT_AVATAR.rambut,
    baju: inRange(r.baju, AVATAR_OPTIONS.baju.length) ? r.baju : DEFAULT_AVATAR.baju,
    topi: inRange(r.topi, AVATAR_OPTIONS.topi.length) ? r.topi : DEFAULT_AVATAR.topi,
    aksesori: inRange(r.aksesori, AVATAR_OPTIONS.aksesori.length) ? r.aksesori : DEFAULT_AVATAR.aksesori,
    warna: inRange(r.warna, AVATAR_OPTIONS.warna.length) ? r.warna : DEFAULT_AVATAR.warna,
  };
}
