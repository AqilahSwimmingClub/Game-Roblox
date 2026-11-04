/**
 * Hadiah & tukar barang yang perlu persetujuan (UI klien).
 * - Pemberi: BERI (1–3 barang) atau TUKAR (barangku ↔ barang teman) → KIRIM. Barang ditahan server sampai dijawab.
 * - Penerima: pop-up jelas dengan ikon avatar & barang, tombol hijau TERIMA dan merah TOLAK, hitung mundur.
 * - Status: Menunggu jawaban · Diterima · Ditolak · Dibatalkan · Kedaluwarsa. Semua keputusan dinilai server.
 */
import { CATALOG, CHARACTERS, OFFER_STATUS_LABEL, SHOP, type Bag, type ItemLine, type ItemOffer, type OfferKind, type WalletMsg } from '@eduverse/shared';
import { h, btn, ui, notify } from '../../ui/dom.js';
import { sfx } from '../audio.js';

type Fail = { ok: false; error: string };
export type OfferResult = ({ ok: true; offer: ItemOffer } & WalletMsg) | Fail;

export interface Friend {
  id: string;
  nama: string;
  d: number;
}

/** Jembatan ke server (mode kelas). null di Mode Demo (tidak ada pemain lain). */
export interface OfferApi {
  friends(): Friend[];
  create(kind: OfferKind, toId: string, give: ItemLine, want: ItemLine | null): Promise<OfferResult>;
  respond(id: string, accept: boolean): Promise<OfferResult>;
  cancel(id: string): Promise<OfferResult>;
  peek(toId: string): Promise<{ ok: true; nama: string; tas: Bag } | Fail>;
  allowGifts(): boolean;
  allowTrades(): boolean;
}

const itemText = (l: ItemLine) => `${l.qty} ${CATALOG[l.itemId]?.nama ?? l.itemId}`;
const itemIcon = (l: ItemLine) => CATALOG[l.itemId]?.ikon ?? '🎁';

/** Kalimat permintaan dari sudut pandang penerima. */
export function offerSentence(o: ItemOffer) {
  return o.kind === 'tukar' && o.want
    ? `🔁 ${o.dari.nama} ingin menukar ${itemText(o.give)} miliknya dengan ${itemText(o.want)} milikmu.`
    : `🎁 ${o.dari.nama} ingin memberikan ${itemText(o.give)} kepadamu.`;
}

const AVATAR_COLORS = ['#3BA7FF', '#FF8A3D', '#2FBF71', '#8B5CF6', '#E86FA8', '#FFC93C', '#1FB6D9'];
function avatarBadge(p: { nama: string; karakter: number }, size = 56) {
  const ch = CHARACTERS[p.karakter];
  return h(
    'div',
    { class: 'col', style: 'align-items:center;gap:2px' },
    h('div', { style: `width:${size}px;height:${size}px;border-radius:50%;background:${AVATAR_COLORS[p.karakter % AVATAR_COLORS.length]};color:#fff;display:flex;align-items:center;justify-content:center;font:700 ${Math.round(size * 0.45)}px Fredoka;border:3px solid #fff;box-shadow:0 3px 10px #1e2a4a33` }, p.nama.slice(0, 1).toUpperCase()),
    h('div', { style: 'font-size:11px;font-weight:800;color:#566079;max-width:90px;text-align:center' }, ch?.nama ?? ''),
  );
}

export class OfferStore {
  /** Permintaan yang masih menunggu (masuk & keluar). */
  readonly pending = new Map<string, ItemOffer>();
  /** Riwayat singkat (terbaru di depan) untuk ditampilkan di tas. */
  readonly recent: ItemOffer[] = [];
  myAbsen = 0;
  private fns = new Set<() => void>();
  private popup: { id: string; el: HTMLElement; timer: number } | null = null;
  private queue: string[] = [];
  /** Statistik untuk uji otomatis. */
  stats = { incoming: 0, accepted: 0, declined: 0, expired: 0, cancelled: 0 };

  constructor(private api: OfferApi | null) {}

  on(fn: () => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  private emit() {
    for (const f of this.fns) f();
  }

  /** Terapkan daftar dari server (permintaan baru, berubah status, atau daftar menunggu saat masuk). */
  apply(list: ItemOffer[] | undefined) {
    for (const o of list ?? []) {
      const mineIn = o.ke.absen === this.myAbsen;
      const mineOut = o.dari.absen === this.myAbsen;
      const known = this.pending.get(o.id);
      if (o.status === 'menunggu') {
        this.pending.set(o.id, o);
        if (mineIn && !known) {
          this.stats.incoming++;
          this.queue.push(o.id);
          this.showNext();
        }
        continue;
      }
      // selesai
      this.pending.delete(o.id);
      this.recent.unshift(o);
      this.recent.length = Math.min(this.recent.length, 8);
      if (this.popup?.id === o.id) this.closePopup();
      this.queue = this.queue.filter((x) => x !== o.id);
      if (mineOut && known) {
        const who = o.ke.nama;
        if (o.status === 'diterima') {
          this.stats.accepted++;
          notify(o.kind === 'tukar' ? `🔁 ${who} setuju bertukar! Barang baru sudah di tasmu.` : `🎉 ${who} menerima hadiahmu. Terima kasih sudah berbagi!`, 'sukses');
        } else if (o.status === 'ditolak') {
          this.stats.declined++;
          notify(`${who} belum bisa menerima ${o.kind === 'tukar' ? 'tawaran tukarmu' : 'hadiahmu'} kali ini. Barangmu sudah kembali ke tas.`, 'info');
        } else if (o.status === 'kedaluwarsa') {
          this.stats.expired++;
          notify(`${who} tidak menjawab. Barangmu sudah kembali ke tas.`, 'info');
        } else {
          this.stats.cancelled++;
          if (o.reason && o.reason !== 'Dibatalkan pemberi.') notify(`Permintaan dibatalkan: ${o.reason} Barangmu kembali ke tas.`, 'peringatan');
        }
      } else if (mineIn && o.status === 'dibatalkan' && o.reason) notify(`Permintaan dari ${o.dari.nama} dibatalkan (${o.reason})`, 'info');
      else if (mineIn && o.status === 'kedaluwarsa') notify(`Permintaan dari ${o.dari.nama} sudah kedaluwarsa.`, 'info');
    }
    this.emit();
  }

  /** Tampilkan pop-up permintaan tertentu (dari daftar di Tas). */
  focus(id: string) {
    if (this.popup?.id === id) return;
    this.queue = [id, ...this.queue.filter((x) => x !== id)];
    this.showNext();
  }

  incoming() {
    return [...this.pending.values()].filter((o) => o.ke.absen === this.myAbsen);
  }
  outgoing() {
    return [...this.pending.values()].filter((o) => o.dari.absen === this.myAbsen);
  }

  clearAll() {
    this.pending.clear();
    this.queue = [];
    this.closePopup();
    this.emit();
  }

  private closePopup() {
    if (!this.popup) return;
    clearInterval(this.popup.timer);
    this.popup.el.remove();
    this.popup = null;
    setTimeout(() => this.showNext(), 300);
  }

  /** Pop-up TERIMA/TOLAK untuk permintaan masuk berikutnya. */
  showNext() {
    if (this.popup || !this.api) return;
    let o: ItemOffer | undefined;
    while (this.queue.length && !o) o = this.pending.get(this.queue.shift()!);
    if (!o) return;
    const api = this.api;
    const offer = o;
    const msg = h('div', { style: 'font-weight:800;min-height:20px;color:#C2410C' });
    const left = h('b');
    const terima = btn('TERIMA', 'hijau besar', () => void answer(true), { 'aria-label': 'Terima' });
    const tolak = btn('TOLAK', 'merah besar', () => void answer(false), { 'aria-label': 'Tolak' });
    const answer = async (accept: boolean) => {
      terima.disabled = tolak.disabled = true;
      const r = await api.respond(offer.id, accept);
      if (!r.ok) {
        msg.textContent = r.error;
        terima.disabled = tolak.disabled = false;
        if (/sudah (dijawab|tidak berlaku|kedaluwarsa)/.test(r.error)) setTimeout(() => this.closePopup(), 1500);
        return;
      }
      if (accept) {
        sfx.correct();
        notify(offer.kind === 'tukar' ? `🔁 Pertukaran berhasil! Ucapkan terima kasih kepada ${offer.dari.nama}.` : `🎁 Terima kasih, ${offer.dari.nama}! ${itemIcon(offer.give)} ${itemText(offer.give)} masuk ke tasmu.`, 'sukses');
      } else notify(`Kamu menolak dengan sopan. Barang kembali ke ${offer.dari.nama}.`, 'info');
      this.apply([r.offer]);
    };
    const tick = () => {
      const s = Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000));
      left.textContent = `${s} detik`;
    };
    tick();
    const items = h(
      'div',
      { class: 'row', style: 'justify-content:center;gap:14px;align-items:center;font-weight:900' },
      h('div', { class: 'col', style: 'align-items:center' }, h('div', { style: 'font-size:52px;line-height:1' }, itemIcon(offer.give)), h('div', null, itemText(offer.give))),
      offer.want ? h('div', { style: 'font-size:30px' }, '⇄') : null,
      offer.want ? h('div', { class: 'col', style: 'align-items:center' }, h('div', { style: 'font-size:52px;line-height:1' }, itemIcon(offer.want)), h('div', null, `${itemText(offer.want)} (milikmu)`)) : null,
    );
    const el = h(
      'div',
      { class: 'screen gelap offer-popup', style: 'z-index:32' },
      h(
        'div',
        { class: 'panel card col pop', role: 'dialog', 'aria-label': 'Permintaan hadiah', style: 'max-width:min(460px,94vw);max-height:calc(100dvh - 20px);overflow:auto;gap:10px;padding:16px 18px;align-items:stretch' },
        h('div', { class: 'row', style: 'gap:12px;align-items:center' }, avatarBadge(offer.dari), h('div', { class: 'grow', style: 'font:700 19px Fredoka' }, offerSentence(offer))),
        items,
        h('div', { class: 'muted center', style: 'font-weight:800;font-size:13px' }, 'Jawab dalam ', left, '. Bila tidak dijawab, barang kembali ke pemberi.'),
        msg,
        h('div', { class: 'row', style: 'gap:10px' }, tolak, terima),
      ),
    );
    terima.style.flex = tolak.style.flex = '1';
    ui.add(el);
    sfx.open();
    this.popup = { id: offer.id, el, timer: window.setInterval(tick, 500) };
  }
}

/**
 * Alur kirim di dalam Tas. `area` diisi langkah-langkah; `done(text)` dipanggil setelah terkirim.
 */
export function sendFlow(kind: OfferKind, itemId: string, have: number, api: OfferApi | null, area: HTMLElement, done: (text: string, ok: boolean) => void, unavailable?: string) {
  const it = CATALOG[itemId]!;
  const info = (t: string) => area.replaceChildren(h('div', { class: 'muted', style: 'font-weight:800' }, t), btn('Oke', 'putih kecil', () => area.replaceChildren()));
  if (!api) return info(unavailable ?? 'Fitur ini tidak tersedia di sini.');
  if (kind === 'hadiah' && !api.allowGifts()) return info('Fitur memberi barang sedang dinonaktifkan guru.');
  if (kind === 'tukar' && !api.allowTrades()) return info('Fitur tukar barang sedang dinonaktifkan guru.');
  const fr = api.friends();
  if (!fr.length) return info(`Tidak ada teman di dekatmu. Dekati temanmu (paling jauh ${SHOP.jarakBeri} m).`);
  // langkah 1: pilih teman
  area.replaceChildren(
    h('div', { style: 'font-weight:900' }, kind === 'tukar' ? `Tukar ${it.ikon} ${it.nama} dengan siapa?` : `Beri ${it.ikon} ${it.nama} ke siapa?`),
    h('div', { class: 'row wrap', style: 'gap:6px' }, ...fr.map((f) => btn(`${kind === 'tukar' ? '🔁' : '🎁'} ${f.nama}`, 'ungu kecil', () => void step2(f))), btn('Batal', 'putih kecil', () => area.replaceChildren())),
  );
  const stepper = (max: number, onChange: (n: number) => void, label: string) => {
    let n = 1;
    const v = h('b', { style: 'min-width:24px;text-align:center' }, '1');
    const set = (x: number) => {
      n = Math.max(1, Math.min(max, x));
      v.textContent = String(n);
      onChange(n);
    };
    return h('div', { class: 'row', style: 'gap:6px;align-items:center;font-weight:800' }, h('span', null, label), btn('−', 'putih kecil', () => set(n - 1), { style: 'min-height:36px;width:36px;padding:0', 'aria-label': `Kurangi ${label}` }), v, btn('+', 'putih kecil', () => set(n + 1), { style: 'min-height:36px;width:36px;padding:0', 'aria-label': `Tambah ${label}` }));
  };
  const step2 = async (f: Friend) => {
    let giveQty = 1;
    let want: ItemLine | null = null;
    const maxGive = Math.min(SHOP.maksBeriSekali, have);
    const send = btn(kind === 'tukar' ? 'KIRIM TAWARAN' : 'KIRIM HADIAH', 'hijau', async () => {
      if (kind === 'tukar' && !want) return;
      send.disabled = true;
      const r = await api.create(kind, f.id, { itemId, qty: giveQty }, want);
      area.replaceChildren();
      if (!r.ok) return done(r.error, false);
      done(kind === 'tukar' ? `Tawaran tukar terkirim ke ${f.nama}. Menunggu jawaban…` : `Hadiah ${it.ikon} untuk ${f.nama} terkirim. Menunggu ${f.nama} menekan TERIMA…`, true);
    });
    const parts: HTMLElement[] = [h('div', { style: 'font-weight:900' }, `${kind === 'tukar' ? 'Tukar dengan' : 'Untuk'} ${f.nama}`), stepper(maxGive, (n) => (giveQty = n), `${it.ikon} ${it.nama}`)];
    if (kind === 'tukar') {
      const p = await api.peek(f.id);
      if (!p.ok) return info(p.error);
      const theirs = Object.entries(p.tas).filter(([id, n]) => n > 0 && id !== itemId && CATALOG[id]);
      if (!theirs.length) return info(`${p.nama} belum punya barang lain untuk ditukar.`);
      const wantArea = h('div', { class: 'col', style: 'gap:6px' });
      send.disabled = true;
      parts.push(
        h('div', { style: 'font-weight:900' }, `Pilih barang ${p.nama} yang kamu inginkan:`),
        h(
          'div',
          { class: 'row wrap', style: 'gap:6px' },
          ...theirs.map(([id, n]) =>
            btn(`${CATALOG[id]!.ikon} ${CATALOG[id]!.nama} (${n})`, 'putih kecil', () => {
              want = { itemId: id, qty: 1 };
              send.disabled = false;
              wantArea.replaceChildren(stepper(Math.min(SHOP.maksBeriSekali, n), (q) => (want = { itemId: id, qty: q }), `${CATALOG[id]!.ikon} ${CATALOG[id]!.nama} dari ${p.nama}`));
            }),
          ),
        ),
        wantArea,
      );
    }
    parts.push(h('div', { class: 'row', style: 'gap:8px' }, btn('Batal', 'putih kecil', () => area.replaceChildren()), send));
    area.replaceChildren(...parts);
  };
}

/** Daftar permintaan di Tas: masuk (bisa dijawab) & keluar (bisa dibatalkan), plus riwayat singkat. */
export function offerSection(store: OfferStore, api: OfferApi | null, refresh: () => void): HTMLElement {
  const box = h('div', { class: 'col', style: 'gap:6px' });
  const incoming = store.incoming();
  const outgoing = store.outgoing();
  if (incoming.length) {
    box.append(h('div', { style: 'font-weight:900' }, '📩 Permintaan untukmu'));
    for (const o of incoming)
      box.append(
        h('div', { class: 'row offer-in', style: 'gap:6px;align-items:center;background:#FEF3C7;border-radius:10px;padding:6px 10px;font-weight:800' }, h('span', { class: 'grow' }, offerSentence(o)), btn('Jawab', 'kuning kecil', () => store.focus(o.id))),
      );
  }
  if (outgoing.length) {
    box.append(h('div', { style: 'font-weight:900' }, '📤 Menunggu jawaban'));
    for (const o of outgoing)
      box.append(
        h(
          'div',
          { class: 'row offer-out', style: 'gap:6px;align-items:center;background:#E0F2FE;border-radius:10px;padding:6px 10px;font-weight:800' },
          h('span', { class: 'grow' }, `${o.kind === 'tukar' ? '🔁' : '🎁'} ${itemText(o.give)} → ${o.ke.nama} · ${OFFER_STATUS_LABEL[o.status]}`),
          api ? btn('BATALKAN', 'putih kecil', async () => {
            const r = await api.cancel(o.id);
            if (r.ok) store.apply([r.offer]);
            refresh();
          }) : null,
        ),
      );
  }
  const recent = store.recent.slice(0, 4);
  if (recent.length) {
    box.append(h('div', { style: 'font-weight:900' }, '🕘 Riwayat'));
    for (const o of recent) {
      const mine = o.dari.absen === store.myAbsen;
      box.append(h('div', { class: 'offer-hist', style: 'font-weight:700;font-size:13px;color:#334155' }, `${o.kind === 'tukar' ? '🔁' : '🎁'} ${mine ? `Ke ${o.ke.nama}` : `Dari ${o.dari.nama}`}: ${itemText(o.give)}${o.want ? ` ⇄ ${itemText(o.want)}` : ''} — ${OFFER_STATUS_LABEL[o.status]}`));
    }
  }
  return box;
}
