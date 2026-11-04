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
  jarakBeri: 6, // meter dari teman
  maksBeriSekali: 3,
  beriPerMenit: 10,
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

export type GiveCheck = { ok: true; item: ShopItem } | { ok: false; error: string };

/**
 * Aturan memberi barang ke teman (sama di server & klien). Hanya BARANG yang bisa diberikan — uang tidak,
 * agar tidak ada tekanan meminta uang antarsiswa.
 */
export function checkGive(fromBag: Bag, toBag: Bag, itemId: unknown, qty: unknown, toName = 'temanmu'): GiveCheck {
  const item = typeof itemId === 'string' ? CATALOG[itemId] : undefined;
  if (!item) return { ok: false, error: 'Barang tidak dikenal.' };
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > SHOP.maksBeriSekali) return { ok: false, error: `Beri 1–${SHOP.maksBeriSekali} barang sekali beri.` };
  if ((fromBag[item.id] ?? 0) < qty) return { ok: false, error: `${item.nama} di tasmu tidak cukup.` };
  if (bagCount(toBag) + qty > SHOP.maksIsiTas) return { ok: false, error: `Tas ${toName} sudah penuh.` };
  return { ok: true, item };
}

// ───────────── Permintaan hadiah & tukar barang (perlu persetujuan) ─────────────

export type OfferKind = 'hadiah' | 'tukar';
/** menunggu → diterima | ditolak | dibatalkan | kedaluwarsa (status akhir tidak bisa berubah lagi). */
export type OfferStatus = 'menunggu' | 'diterima' | 'ditolak' | 'dibatalkan' | 'kedaluwarsa';

export interface ItemLine {
  itemId: string;
  qty: number;
}

export interface ItemOffer {
  id: string;
  kind: OfferKind;
  status: OfferStatus;
  dari: { absen: number; nama: string; karakter: number };
  ke: { absen: number; nama: string; karakter: number };
  give: ItemLine; // barang pemberi (sudah DITAHAN/dipisahkan dari tas pemberi sejak permintaan dibuat)
  want: ItemLine | null; // tukar: barang yang diminta dari penerima
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  reason: string | null; // alasan dibatalkan/ditolak (mis. "Fitur dinonaktifkan guru")
}

export const OFFER = {
  ttlMs: 60_000, // permintaan kedaluwarsa setelah 60 detik bila tidak dijawab
  maxPendingFromGiver: 2, // permintaan menunggu dari satu siswa sekaligus
  pairCooldownMs: 20_000, // setelah ditolak/kedaluwarsa, jeda sebelum mengirim lagi ke teman yang sama
} as const;

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  menunggu: 'Menunggu jawaban',
  diterima: 'Diterima',
  ditolak: 'Ditolak',
  dibatalkan: 'Dibatalkan',
  kedaluwarsa: 'Kedaluwarsa',
};

function line(raw: unknown, max: number): ItemLine | string {
  const r = (raw ?? {}) as { itemId?: unknown; qty?: unknown };
  const it = typeof r.itemId === 'string' ? CATALOG[r.itemId] : undefined;
  if (!it) return 'Barang tidak dikenal.';
  if (typeof r.qty !== 'number' || !Number.isInteger(r.qty) || r.qty < 1 || r.qty > max) return `Jumlah barang 1–${max}.`;
  return { itemId: it.id, qty: r.qty };
}

/** Periksa isi permintaan (bukan izin/jarak — itu di server). Uang tidak pernah bisa menjadi bagian permintaan. */
export function parseOffer(raw: unknown, fromBag: Bag): { ok: true; kind: OfferKind; give: ItemLine; want: ItemLine | null } | { ok: false; error: string } {
  const r = (raw ?? {}) as { kind?: unknown; give?: unknown; want?: unknown };
  const kind = r.kind === 'tukar' ? 'tukar' : r.kind === 'hadiah' || r.kind === undefined ? 'hadiah' : null;
  if (!kind) return { ok: false, error: 'Jenis permintaan tidak dikenal.' };
  const give = line(r.give, SHOP.maksBeriSekali);
  if (typeof give === 'string') return { ok: false, error: give };
  if ((fromBag[give.itemId] ?? 0) < give.qty) return { ok: false, error: `${CATALOG[give.itemId]!.nama} di tasmu tidak cukup.` };
  let want: ItemLine | null = null;
  if (kind === 'tukar') {
    const w = line(r.want, SHOP.maksBeriSekali);
    if (typeof w === 'string') return { ok: false, error: `Barang yang diminta: ${w}` };
    if (w.itemId === give.itemId) return { ok: false, error: 'Tukar dengan barang yang berbeda.' };
    want = w;
  }
  return { ok: true, kind, give, want };
}

/** Bisakah penerima MENERIMA permintaan ini? (stok barang yang diminta + kapasitas tas setelah tukar) */
export function canAccept(offer: Pick<ItemOffer, 'give' | 'want'>, toBag: Bag): { ok: true } | { ok: false; error: string } {
  const wantQty = offer.want?.qty ?? 0;
  if (offer.want && (toBag[offer.want.itemId] ?? 0) < offer.want.qty) return { ok: false, error: `Kamu tidak punya ${offer.want.qty} ${CATALOG[offer.want.itemId]?.nama ?? offer.want.itemId} untuk ditukar.` };
  if (bagCount(toBag) - wantQty + offer.give.qty > SHOP.maksIsiTas) return { ok: false, error: 'Tasmu penuh. Pakai atau beri dulu beberapa barang.' };
  return { ok: true };
}
