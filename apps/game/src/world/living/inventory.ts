/**
 * Dompet & Tas pemain (UI). Status sebenarnya dipegang server (mode kelas) atau registri lokal (Mode Demo);
 * WalletStore hanya menampilkan salinan terakhir.
 */
import { CATALOG, SHOP, bagCount, formatRp, isConsumable, type Bag, type ShopItem, type WalletMsg } from '@eduverse/shared';
import { h, btn, ui } from '../../ui/dom.js';
import { sfx, sfxLiving } from '../audio.js';

type Fail = { ok: false; error: string; kurang?: number };
export type BuyResult = ({ ok: true; total: number; sisa: number } & WalletMsg) | Fail;
export type UseResult = ({ ok: true; itemId: string } & WalletMsg) | Fail;
export type GiveResult = ({ ok: true; ke: string; itemId: string; qty: number } & WalletMsg) | Fail;
export interface Friend {
  id: string;
  nama: string;
  d: number;
}
/** Memberi barang ke teman (null = tidak tersedia, mis. Mode Demo tanpa pemain lain). */
export interface GiveOptions {
  friends: () => Friend[];
  give: (toId: string, itemId: string, qty: number) => Promise<GiveResult>;
  unavailable?: string;
}

export class WalletStore {
  saldo: number = SHOP.saldoAwal;
  tas: Bag = {};
  private fns = new Set<() => void>();

  set(w: WalletMsg | null | undefined) {
    if (!w) return;
    this.saldo = w.saldo;
    this.tas = { ...w.tas };
    for (const f of this.fns) f();
  }

  on(fn: () => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  count() {
    return bagCount(this.tas);
  }
}

/** Bagian toko di dialog pedagang: daftar barang, jumlah (1–5), total, tombol BELI, hitungan kembalian. */
export function shopPanel(items: ShopItem[], store: WalletStore, buy: (itemId: string, qty: number) => Promise<BuyResult>): { el: HTMLElement; dispose: () => void } {
  const saldoEl = h('b');
  const info = h('div', { style: 'font-weight:800;min-height:22px;font-size:14px' });
  const refresh = () => (saldoEl.textContent = formatRp(store.saldo));
  refresh();
  const rows = items.map((it) => {
    let qty = 1;
    const qEl = h('b', { style: 'min-width:22px;text-align:center' }, '1');
    const buyBtn = btn(`BELI ${formatRp(it.harga)}`, 'hijau kecil', () => void doBuy(), { style: 'min-height:40px;padding:4px 10px;font-size:15px' });
    const setQty = (n: number) => {
      qty = Math.max(1, Math.min(SHOP.maksBeliSekali, n));
      qEl.textContent = String(qty);
      buyBtn.textContent = `BELI ${formatRp(it.harga * qty)}`;
    };
    const doBuy = async () => {
      buyBtn.disabled = true;
      const before = store.saldo;
      const r = await buy(it.id, qty);
      buyBtn.disabled = false;
      if (!r.ok) {
        info.style.color = '#C2410C';
        info.textContent = r.error;
        sfx.retry();
        return;
      }
      sfxLiving.coin();
      info.style.color = '#15803D';
      // latihan berhitung: total = harga × jumlah; sisa = uang − total
      info.textContent = `${qty} × ${formatRp(it.harga)} = ${formatRp(r.total)} · Uangmu ${formatRp(before)} − ${formatRp(r.total)} = ${formatRp(r.sisa)}. ${it.ikon} masuk ke tas!`;
      refresh();
    };
    return h(
      'div',
      { class: 'row', style: 'justify-content:space-between;align-items:center;gap:6px;font-weight:800;background:#fff;border-radius:12px;padding:6px 10px' },
      h('span', { style: 'font-size:22px' }, it.ikon),
      h('span', { class: 'grow' }, it.nama, h('div', { class: 'muted', style: 'font-size:12px' }, `${formatRp(it.harga)} · ${isConsumable(it.kategori) ? 'bisa dipakai' : 'koleksi'}`)),
      btn('−', 'putih kecil', () => setQty(qty - 1), { style: 'min-height:36px;width:36px;padding:0', 'aria-label': `Kurangi ${it.nama}` }),
      qEl,
      btn('+', 'putih kecil', () => setQty(qty + 1), { style: 'min-height:36px;width:36px;padding:0', 'aria-label': `Tambah ${it.nama}` }),
      buyBtn,
    );
  });
  const off = store.on(refresh);
  const el = h(
    'div',
    { class: 'col', style: 'gap:6px' },
    h('div', { class: 'row', style: 'justify-content:space-between;font-weight:900' }, h('span', null, 'Barang dagangan'), h('span', null, '👛 Uangmu: ', saldoEl)),
    ...rows,
    info,
    h('div', { class: 'muted', style: 'font-weight:700;font-size:12px' }, `Uang virtual bertambah ${formatRp(SHOP.hadiahBenar)} setiap jawaban benar. Belanja tidak mengubah poin.`),
  );
  return { el, dispose: () => void off() };
}

let bagEl: HTMLElement | null = null;

/** Panel Tas: isi tas, PAKAI untuk makanan/minuman/buah (energi jetpack penuh). */
export function openBag(store: WalletStore, use: (itemId: string) => Promise<UseResult>, onUsed: (itemId: string) => void, onClose: () => void, giveOpt: GiveOptions | null = null) {
  bagEl?.remove();
  const list = h('div', { class: 'col', style: 'gap:6px' });
  const saldoEl = h('b');
  const msg = h('div', { style: 'font-weight:800;min-height:20px' });
  const picker = h('div', { class: 'col', style: 'gap:6px' });
  /** Pilih teman di dekatmu untuk menerima 1 barang. */
  const showPicker = (id: string) => {
    const it = CATALOG[id]!;
    if (!giveOpt || giveOpt.unavailable) {
      picker.replaceChildren(h('div', { class: 'muted', style: 'font-weight:800' }, giveOpt?.unavailable ?? 'Memberi barang tidak tersedia di sini.'));
      return;
    }
    const fr = giveOpt.friends();
    if (!fr.length) {
      picker.replaceChildren(h('div', { class: 'muted', style: 'font-weight:800' }, `Tidak ada teman di dekatmu. Dekati temanmu (paling jauh ${SHOP.jarakBeri} m) untuk memberi ${it.ikon} ${it.nama}.`));
      return;
    }
    picker.replaceChildren(
      h('div', { style: 'font-weight:900' }, `Beri ${it.ikon} ${it.nama} ke siapa?`),
      h(
        'div',
        { class: 'row wrap', style: 'gap:6px' },
        ...fr.map((f) =>
          btn(`🎁 ${f.nama}`, 'ungu kecil', async () => {
            const r = await giveOpt.give(f.id, id, 1);
            picker.replaceChildren();
            if (!r.ok) {
              msg.style.color = '#C2410C';
              msg.textContent = r.error;
              sfx.retry();
              return;
            }
            msg.style.color = '#15803D';
            msg.textContent = `${it.ikon} ${it.nama} sudah diberikan ke ${r.ke}. Baik sekali kamu berbagi!`;
            sfx.correct();
            render();
          }),
        ),
        btn('Batal', 'putih kecil', () => picker.replaceChildren()),
      ),
    );
  };
  const render = () => {
    saldoEl.textContent = formatRp(store.saldo);
    const ids = Object.keys(store.tas).filter((k) => store.tas[k]! > 0 && CATALOG[k]);
    if (!ids.length) {
      list.replaceChildren(h('div', { class: 'muted', style: 'font-weight:800;padding:8px' }, 'Tasmu masih kosong. Kunjungi pedagang bertanda ! dan pilih LIHAT BARANG.'));
      return;
    }
    list.replaceChildren(
      ...ids.map((id) => {
        const it = CATALOG[id]!;
        const usable = isConsumable(it.kategori);
        return h(
          'div',
          { class: 'row', style: 'align-items:center;gap:8px;background:#fff;border-radius:12px;padding:6px 10px;font-weight:800' },
          h('span', { style: 'font-size:24px' }, it.ikon),
          h('span', { class: 'grow' }, `${it.nama} ×${store.tas[id]}`),
          btn('BERI', 'ungu kecil', () => showPicker(id), { style: 'min-height:40px', 'aria-label': `Beri ${it.nama}` }),
          usable
            ? btn('PAKAI', 'oranye kecil', async () => {
                const r = await use(id);
                if (!r.ok) {
                  msg.textContent = r.error;
                  return;
                }
                sfx.correct();
                msg.textContent = `${it.ikon} Nyam! Energi jetpack terisi penuh.`;
                onUsed(id);
                render();
              }, { style: 'min-height:40px' })
            : h('span', { class: 'chip' }, 'Koleksi'),
        );
      }),
    );
  };
  render();
  const off = store.on(render);
  const close = () => {
    off();
    bagEl?.remove();
    bagEl = null;
    document.body.classList.remove('mv-dialog');
    onClose();
  };
  bagEl = h(
    'div',
    { class: 'screen gelap', style: 'z-index:21' },
    h(
      'div',
      { class: 'panel card col pop', style: 'max-width:min(520px,94vw);max-height:calc(100dvh - 24px);overflow:auto;gap:8px;padding:14px 18px' },
      h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('h2', { style: 'margin:0' }, '🎒 Tas'), h('span', { style: 'font-weight:900' }, '👛 ', saldoEl)),
      list,
      picker,
      msg,
      h('div', { class: 'muted', style: 'font-weight:700;font-size:12px' }, `Isi tas ${store.count()}/${SHOP.maksIsiTas}. Makanan, minuman & buah mengisi energi jetpack; buku & alat tulis jadi koleksi. BERI: bagikan barang ke teman di dekatmu (uang tidak bisa diberikan).`),
      btn('Tutup', 'putih', close),
    ),
  );
  document.body.classList.add('mv-dialog');
  ui.add(bagEl);
}
