/**
 * Dompet & Tas pemain (UI). Status sebenarnya dipegang server (mode kelas) atau registri lokal (Mode Demo);
 * WalletStore hanya menampilkan salinan terakhir.
 */
import { CATALOG, SHOP, bagCount, formatRp, isConsumable, type Bag, type ShopItem, type WalletMsg } from '@eduverse/shared';
import { h, btn, ui } from '../../ui/dom.js';
import { sfx, sfxLiving } from '../audio.js';
import { offerSection, sendFlow, type OfferApi, type OfferStore } from './offers.js';

type Fail = { ok: false; error: string; kurang?: number };
export type BuyResult = ({ ok: true; total: number; sisa: number } & WalletMsg) | Fail;
export type UseResult = ({ ok: true; itemId: string } & WalletMsg) | Fail;
/** Konteks hadiah/tukar untuk Tas (null = tidak tersedia). */
export interface OfferCtx {
  store: OfferStore;
  api: OfferApi | null;
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

  /** Hadiah yang diterima dari teman (terbaru di depan); `unseen` = belum dilihat di tas. */
  gifts: { dari: string; itemId: string; qty: number }[] = [];
  unseen = 0;

  addGift(g: { dari: string; itemId: string; qty: number }) {
    this.gifts.unshift(g);
    this.gifts.length = Math.min(this.gifts.length, 5);
    this.unseen++;
    for (const f of this.fns) f();
  }

  markSeen() {
    if (!this.unseen) return;
    this.unseen = 0;
    for (const f of this.fns) f();
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
export function openBag(store: WalletStore, use: (itemId: string) => Promise<UseResult>, onUsed: (itemId: string) => void, onClose: () => void, offer: OfferCtx | null = null) {
  bagEl?.remove();
  const list = h('div', { class: 'col', style: 'gap:6px' });
  const saldoEl = h('b');
  const msg = h('div', { style: 'font-weight:800;min-height:20px' });
  const picker = h('div', { class: 'col', style: 'gap:6px' });
  const flowDone = (text: string, ok: boolean) => {
    msg.style.color = ok ? '#15803D' : '#C2410C';
    msg.textContent = text;
    if (ok) sfx.correct();
    else sfx.retry();
    render();
  };
  const offersEl = h('div', { class: 'col', style: 'gap:6px' });
  const giftsEl = h('div', { class: 'col', style: 'gap:4px' });
  const render = () => {
    saldoEl.textContent = formatRp(store.saldo);
    offersEl.replaceChildren(offer ? offerSection(offer.store, offer.api, render) : '');
    giftsEl.replaceChildren(
      ...(store.gifts.length
        ? [
            h('div', { style: 'font-weight:900' }, '🎁 Hadiah terbaru'),
            ...store.gifts.map((g) => {
              const it = CATALOG[g.itemId];
              return h('div', { class: 'gift-row', style: 'font-weight:800;background:#F3E8FF;border-radius:10px;padding:4px 10px' }, `${it?.ikon ?? '🎁'} ${it?.nama ?? g.itemId} ×${g.qty} dari ${g.dari}`);
            }),
          ]
        : []),
    );
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
          btn('BERI', 'ungu kecil', () => sendFlow('hadiah', id, store.tas[id] ?? 0, offer?.api ?? null, picker, flowDone, offer?.unavailable), { style: 'min-height:40px', 'aria-label': `Beri ${it.nama}` }),
          btn('TUKAR', 'biru kecil', () => sendFlow('tukar', id, store.tas[id] ?? 0, offer?.api ?? null, picker, flowDone, offer?.unavailable), { style: 'min-height:40px', 'aria-label': `Tukar ${it.nama}` }),
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
  const offOffers = offer?.store.on(render);
  const close = () => {
    off();
    offOffers?.();
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
      offersEl,
      giftsEl,
      list,
      picker,
      msg,
      h('div', { class: 'muted', style: 'font-weight:700;font-size:12px' }, `Isi tas ${store.count()}/${SHOP.maksIsiTas}. Makanan, minuman & buah mengisi energi jetpack; buku & alat tulis jadi koleksi. BERI/TUKAR: kirim ke teman di dekatmu — teman harus menekan TERIMA (uang tidak bisa diberikan).`),
      btn('Tutup', 'putih', close),
    ),
  );
  document.body.classList.add('mv-dialog');
  ui.add(bagEl);
  store.markSeen();
}
