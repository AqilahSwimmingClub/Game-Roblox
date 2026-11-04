/**
 * Toko & Tas EDUVERSE — katalog barang virtual dan aturan dompet (dipakai klien & server).
 *
 * Mata uang: Rupiah virtual, supaya jual beli sekaligus melatih berhitung uang (harga, total, kembalian).
 * - Setiap siswa mulai dengan SHOP.saldoAwal.
 * - Setiap jawaban BENAR (titik soal atau misi pedagang) menambah SHOP.hadiahBenar — dinilai server.
 * - Saldo & tas TIDAK memengaruhi poin/peringkat (penilaian tetap adil).
 * - Makanan, minuman & buah bisa DIPAKAI (mengisi penuh energi jetpack); alat tulis, buku & barang lain jadi KOLEKSI.
 */
export type ItemKategori = 'makanan' | 'minuman' | 'buah' | 'alat' | 'buku' | 'kebutuhan';

export interface ShopItem {
  id: string;
  nama: string;
  harga: number; // Rupiah virtual
  kategori: ItemKategori;
  ikon: string;
}

export const SHOP = {
  saldoAwal: 20_000,
  hadiahBenar: 5_000,
  maksBeliSekali: 5,
  maksIsiTas: 40,
  jarakBeli: 5, // meter dari pedagang
  beliPerMenit: 20,
} as const;

/** Barang yang memberi energi saat dipakai. */
export function isConsumable(k: ItemKategori) {
  return k === 'makanan' || k === 'minuman' || k === 'buah';
}

const I = (id: string, nama: string, harga: number, kategori: ItemKategori, ikon: string): ShopItem => ({ id, nama, harga, kategori, ikon });

export const CATALOG: Record<string, ShopItem> = Object.fromEntries(
  [
    I('apel', 'Apel', 3000, 'buah', '🍎'),
    I('jeruk', 'Jeruk', 2000, 'buah', '🍊'),
    I('pisang', 'Pisang', 1500, 'buah', '🍌'),
    I('mangga', 'Mangga', 5000, 'buah', '🥭'),
    I('nasi-goreng', 'Nasi Goreng', 12000, 'makanan', '🍛'),
    I('bakso', 'Bakso', 10000, 'makanan', '🍲'),
    I('soto-ayam', 'Soto Ayam', 11000, 'makanan', '🍜'),
    I('gado-gado', 'Gado-gado', 9000, 'makanan', '🥗'),
    I('air-mineral', 'Air Mineral', 3000, 'minuman', '💧'),
    I('es-jeruk', 'Es Jeruk', 5000, 'minuman', '🧃'),
    I('susu-kotak', 'Susu Kotak', 4000, 'minuman', '🥛'),
    I('jus-alpukat', 'Jus Alpukat', 8000, 'minuman', '🥤'),
    I('buku-tulis', 'Buku Tulis', 4000, 'alat', '📒'),
    I('pensil', 'Pensil', 2000, 'alat', '✏️'),
    I('penghapus', 'Penghapus', 1000, 'alat', '🧽'),
    I('penggaris', 'Penggaris', 3000, 'alat', '📏'),
    I('buku-cerita', 'Buku Cerita', 15000, 'buku', '📖'),
    I('komik-sains', 'Komik Sains', 12000, 'buku', '🔬'),
    I('kamus-kecil', 'Kamus Kecil', 10000, 'buku', '📘'),
    I('atlas-indonesia', 'Atlas Indonesia', 20000, 'buku', '🗺️'),
    I('salad-buah', 'Salad Buah', 7000, 'makanan', '🥗'),
    I('jagung-rebus', 'Jagung Rebus', 4000, 'makanan', '🌽'),
    I('telur-rebus', 'Telur Rebus', 3000, 'makanan', '🥚'),
    I('ubi-kukus', 'Ubi Kukus', 3000, 'makanan', '🍠'),
    I('roti', 'Roti', 6000, 'makanan', '🍞'),
    I('susu', 'Susu', 7000, 'minuman', '🥛'),
    I('biskuit', 'Biskuit', 5000, 'makanan', '🍪'),
    I('pasta-gigi', 'Pasta Gigi', 8000, 'kebutuhan', '🪥'),
    I('nasi-pecel', 'Nasi Pecel', 8000, 'makanan', '🍱'),
    I('tempe-goreng', 'Tempe Goreng', 1000, 'makanan', '🥘'),
    I('teh-hangat', 'Teh Hangat', 3000, 'minuman', '🍵'),
  ].map((it) => [it.id, it]),
);

/** Ambil barang katalog berdasarkan id (urut sesuai argumen). */
export function items(...ids: string[]): ShopItem[] {
  return ids.map((id) => {
    const it = CATALOG[id];
    if (!it) throw new Error(`Barang tidak ada di katalog: ${id}`);
    return it;
  });
}

export type Bag = Record<string, number>;

export interface WalletMsg {
  saldo: number;
  tas: Bag;
}

export function formatRp(n: number) {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

export function bagCount(b: Bag) {
  return Object.values(b).reduce((a, n) => a + (n > 0 ? n : 0), 0);
}

/** Bersihkan isi tas dari data tersimpan (hanya id katalog, jumlah bulat 0..maks). */
export function sanitizeBag(raw: unknown): Bag {
  const out: Bag = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!CATALOG[k] || typeof v !== 'number' || !Number.isFinite(v)) continue;
    const n = Math.max(0, Math.min(SHOP.maksIsiTas, Math.trunc(v)));
    if (n > 0) out[k] = n;
  }
  return out;
}

export type BuyCheck = { ok: true; total: number; sisa: number } | { ok: false; error: string; kurang?: number };

/** Aturan pembelian (sama di server & Mode Demo). */
export function checkBuy(saldo: number, tas: Bag, vendorItems: ShopItem[], itemId: unknown, qty: unknown): BuyCheck {
  const it = vendorItems.find((x) => x.id === itemId);
  if (!it) return { ok: false, error: 'Barang ini tidak dijual di sini.' };
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > SHOP.maksBeliSekali) return { ok: false, error: `Beli 1–${SHOP.maksBeliSekali} barang sekali beli.` };
  if (bagCount(tas) + qty > SHOP.maksIsiTas) return { ok: false, error: 'Tasmu penuh! Pakai dulu beberapa barang.' };
  const total = it.harga * qty;
  if (saldo < total) return { ok: false, error: `Uangmu kurang ${formatRp(total - saldo)}. Jawab soal dengan benar untuk menambah uang!`, kurang: total - saldo };
  return { ok: true, total, sisa: saldo - total };
}
