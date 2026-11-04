/**
 * Interaksi warga & pedagang (BICARA · LIHAT BARANG · TERIMA MISI) dan misi edukasi kontekstual.
 * - Mode kelas: TERIMA MISI membuka soal dari bank soal guru (dinilai server; mapel diutamakan sesuai tempat).
 * - Mode Demo: soal latihan dibuat lokal secara acak dari konteks pedagang (tidak disimpan, bukan nilai resmi).
 */
import type { MissionKind, Vendor, WorldId } from '@eduverse/shared';
import { h, btn, ui } from '../../ui/dom.js';
import { sfx } from '../audio.js';
import { sfxLiving } from '../audio.js';
import { shopPanel, type WalletStore, type BuyResult } from './inventory.js';

export interface LocalMission {
  judul: string;
  prompt: string;
  options: string[];
  correct: number;
  explain: string;
}

const rp = (n: number) => 'Rp' + n.toLocaleString('id-ID');
const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
function shuffleOpts(correct: string, wrong: string[]): { options: string[]; correct: number } {
  const set = [...new Set([correct, ...wrong.filter((w) => w !== correct)])].slice(0, 4);
  while (set.length < 4) set.push(String(Number(correct.replace(/\D/g, '')) + set.length * 1000));
  for (let i = set.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [set[i], set[j]] = [set[j]!, set[i]!];
  }
  return { options: set, correct: set.indexOf(correct) };
}

/** Soal latihan lokal (Mode Demo) berdasarkan konteks pedagang. */
export function localMission(v: Vendor): LocalMission {
  const k: MissionKind = v.mission;
  const items = v.items.length ? v.items : [{ nama: 'Roti', harga: 5000 }];
  const it = items[ri(0, items.length - 1)]!;
  switch (k) {
    case 'kembalian': {
      const qty = ri(1, 3);
      const total = it.harga * qty;
      const bayar = [10000, 20000, 50000].find((b) => b > total) ?? 100000;
      const ans = bayar - total;
      const o = shuffleOpts(rp(ans), [rp(ans + 1000), rp(Math.max(500, ans - 1000)), rp(ans + 2000)]);
      return { judul: 'Bantu menghitung kembalian', prompt: `Pembeli membeli ${qty} ${it.nama} seharga ${rp(it.harga)} per buah dan membayar ${rp(bayar)}. Berapa uang kembaliannya?`, ...o, explain: `${qty} × ${rp(it.harga)} = ${rp(total)}. Kembalian = ${rp(bayar)} − ${rp(total)} = ${rp(ans)}.` };
    }
    case 'pecahan': {
      const harga = [3000, 5000, 7000, 8000][ri(0, 3)]!;
      const ans = harga === 3000 ? '1 lembar Rp2.000 + 1 lembar Rp1.000' : harga === 5000 ? '1 lembar Rp5.000' : harga === 7000 ? '1 lembar Rp5.000 + 1 lembar Rp2.000' : '1 lembar Rp5.000 + 1 lembar Rp2.000 + 1 lembar Rp1.000';
      const wrong = ['2 lembar Rp2.000', '1 lembar Rp10.000 + 1 lembar Rp1.000', '3 lembar Rp2.000', '1 lembar Rp5.000 + 2 lembar Rp2.000'];
      const o = shuffleOpts(ans, wrong);
      return { judul: 'Pecahan uang', prompt: `Harga minuman ${rp(harga)}. Uang pas manakah yang jumlahnya tepat ${rp(harga)}?`, ...o, explain: `Jumlahkan nilai tiap lembar: ${ans} = ${rp(harga)}.` };
    }
    case 'jumlah': {
      const a = ri(3, 9);
      const b = ri(2, 8);
      const per = ri(2, 4);
      const ans = (a + b) * per;
      const o = shuffleOpts(String(ans), [String(ans + per), String(a + b), String(ans - per)]);
      return { judul: 'Menghitung barang', prompt: `Pagi ini datang ${a} keranjang ${it.nama}, siang datang lagi ${b} keranjang. Setiap keranjang berisi ${per} kilogram. Berapa kilogram ${it.nama} seluruhnya?`, ...o, explain: `(${a} + ${b}) × ${per} = ${a + b} × ${per} = ${ans} kg.` };
    }
    case 'sehat': {
      const sets = [
        { q: 'Manakah bekal yang paling sehat untuk sarapan?', a: 'Nasi, telur, sayur, dan buah', w: ['Permen dan soda', 'Keripik saja', 'Es krim dan cokelat'] },
        { q: 'Setelah berolahraga di taman, minuman terbaik adalah …', a: 'Air putih', w: ['Minuman bersoda', 'Kopi', 'Sirup sangat manis'] },
        { q: 'Makanan yang banyak mengandung vitamin C adalah …', a: 'Jeruk', w: ['Roti tawar', 'Nasi putih', 'Minyak goreng'] },
      ];
      const s = sets[ri(0, sets.length - 1)]!;
      const o = shuffleOpts(s.a, s.w);
      return { judul: 'Makanan sehat', prompt: s.q, ...o, explain: `${s.a} adalah pilihan yang sehat dan bergizi seimbang.` };
    }
    case 'inggris': {
      const sets = [
        { q: 'Tom bertanya: "Where is the library?" Artinya …', a: 'Di mana perpustakaan?', w: ['Kapan perpustakaan buka?', 'Siapa penjaga perpustakaan?', 'Berapa harga buku?'] },
        { q: 'Bahasa Inggris dari "pasar" adalah …', a: 'Market', w: ['School', 'Hospital', 'Airport'] },
        { q: 'Tom berkata "Thank you!". Jawaban yang sopan adalah …', a: "You're welcome!", w: ['Good night!', 'See you yesterday!', 'I am hungry!'] },
        { q: '"Turn left" artinya …', a: 'Belok kiri', w: ['Belok kanan', 'Jalan lurus', 'Berhenti'] },
      ];
      const s = sets[ri(0, sets.length - 1)]!;
      const o = shuffleOpts(s.a, s.w);
      return { judul: 'Bantu turis', prompt: s.q, ...o, explain: `Jawaban yang tepat: ${s.a}.` };
    }
    case 'koding': {
      const n = ri(2, 4);
      const ans = `Maju ${n} langkah, belok kanan, maju 1 langkah`;
      const o = shuffleOpts(ans, [`Maju ${n + 1} langkah, belok kiri`, `Belok kanan, maju ${n} langkah`, `Mundur ${n} langkah, belok kanan`]);
      return { judul: 'Algoritma robot', prompt: `Robot menghadap utara. Bintang berada ${n} kotak di depannya, lalu 1 kotak ke kanan (timur). Urutan perintah yang benar adalah …`, ...o, explain: 'Algoritma = langkah-langkah berurutan. Maju dulu sampai sejajar bintang, lalu belok kanan dan maju 1 kotak.' };
    }
    case 'lalulintas': {
      const sets = [
        { q: 'Saat lampu lalu lintas berwarna merah, kendaraan harus …', a: 'Berhenti di belakang garis', w: ['Melaju lebih cepat', 'Membunyikan klakson terus', 'Belok tanpa melihat'] },
        { q: 'Tempat yang aman untuk menyeberang jalan adalah …', a: 'Zebra cross', w: ['Di tikungan', 'Di antara mobil parkir', 'Di tengah jalan tol'] },
        { q: 'Di Indonesia, kendaraan berjalan di lajur sebelah …', a: 'Kiri', w: ['Kanan', 'Tengah', 'Mana saja'] },
        { q: 'Saat naik sepeda motor, kita wajib memakai …', a: 'Helm', w: ['Topi pantai', 'Kacamata hitam saja', 'Sandal jepit'] },
      ];
      const s = sets[ri(0, sets.length - 1)]!;
      const o = shuffleOpts(s.a, s.w);
      return { judul: 'Keselamatan berlalu lintas', prompt: s.q, ...o, explain: `${s.a}. Patuhi rambu dan lampu lalu lintas agar semua selamat.` };
    }
    case 'navigasi': {
      const sets = [
        { q: 'Landasan bandara membentang dari barat ke timur. Pesawat yang lepas landas ke arah matahari terbit menuju arah …', a: 'Timur', w: ['Barat', 'Utara', 'Selatan'] },
        { q: 'Kompas menunjuk utara. Jika kamu menghadap utara lalu berputar ke kanan, kamu menghadap …', a: 'Timur', w: ['Barat', 'Selatan', 'Utara'] },
        { q: 'Kota EDUVERSE berada di sebelah barat bandara. Untuk kembali ke kota, pesawat terbang ke arah …', a: 'Barat', w: ['Timur', 'Utara', 'Selatan'] },
      ];
      const s = sets[ri(0, sets.length - 1)]!;
      const o = shuffleOpts(s.a, s.w);
      return { judul: 'Tantangan navigasi', prompt: s.q, ...o, explain: `Jawaban: ${s.a}. Mata angin: utara, timur, selatan, barat (searah jarum jam).` };
    }
    case 'bacaan': {
      const sets = [
        { q: '"Dina membaca buku di perpustakaan setiap hari Sabtu." Kapan Dina membaca buku?', a: 'Setiap hari Sabtu', w: ['Setiap hari Senin', 'Setiap malam', 'Tidak pernah'] },
        { q: 'Kata baku yang benar adalah …', a: 'Nasihat', w: ['Nasehat', 'Nashat', 'Nasehatt'] },
        { q: 'Huruf kapital digunakan pada …', a: 'Awal kalimat', w: ['Tengah kata', 'Akhir kalimat saja', 'Setiap huruf vokal'] },
      ];
      const s = sets[ri(0, sets.length - 1)]!;
      const o = shuffleOpts(s.a, s.w);
      return { judul: 'Literasi', prompt: s.q, ...o, explain: `Jawaban: ${s.a}.` };
    }
    case 'pancasila': {
      const sets = [
        { q: 'Warga bekerja bersama membersihkan selokan. Sikap ini disebut …', a: 'Gotong royong', w: ['Egois', 'Malas', 'Sombong'] },
        { q: 'Mengambil keputusan bersama dengan cara berdiskusi disebut …', a: 'Musyawarah', w: ['Bertengkar', 'Memaksa', 'Diam saja'] },
        { q: 'Lambang sila pertama Pancasila adalah …', a: 'Bintang', w: ['Rantai', 'Pohon beringin', 'Padi dan kapas'] },
      ];
      const s = sets[ri(0, sets.length - 1)]!;
      const o = shuffleOpts(s.a, s.w);
      return { judul: 'Hidup rukun', prompt: s.q, ...o, explain: `Jawaban: ${s.a}.` };
    }
    case 'ipas':
    default: {
      const sets = [
        { q: 'Bagian tumbuhan yang menyerap air dari tanah adalah …', a: 'Akar', w: ['Daun', 'Bunga', 'Buah'] },
        { q: 'Batu dan fosil di museum termasuk benda …', a: 'Padat', w: ['Cair', 'Gas', 'Plasma'] },
        { q: 'Tumbuhan membuat makanan sendiri melalui proses …', a: 'Fotosintesis', w: ['Penguapan', 'Pembekuan', 'Pengembunan'] },
      ];
      const s = sets[ri(0, sets.length - 1)]!;
      const o = shuffleOpts(s.a, s.w);
      return { judul: 'Jelajah sains', prompt: s.q, ...o, explain: `Jawaban: ${s.a}.` };
    }
  }
}

export interface VendorActions {
  startMission: (v: Vendor) => void;
  missionDone: (id: string) => boolean;
  onClose: () => void;
  /** Toko: dompet pemain + beli (server/Mode Demo). */
  wallet: WalletStore;
  buy: (vendorId: string, itemId: string, qty: number) => Promise<BuyResult>;
}

let open: HTMLElement | null = null;
let cleanup: (() => void) | null = null;
export function dialogOpen() {
  return !!open;
}
export function closeDialog() {
  cleanup?.();
  cleanup = null;
  open?.remove();
  open = null;
  document.body.classList.remove('mv-dialog');
}
function mount(el: HTMLElement) {
  open = el;
  document.body.classList.add('mv-dialog');
  ui.add(el);
}

/** Panel percakapan dengan pedagang/warga. */
export function vendorDialog(v: Vendor, act: VendorActions) {
  closeDialog();
  let line = 0;
  const say = h('p', { style: 'font-weight:800;font-size:18px;margin:6px 0 10px;min-height:48px' }, `“${v.lines[0] ?? 'Halo!'}”`);
  const body = h('div', { class: 'col', style: 'gap:8px' });
  const close = () => {
    closeDialog();
    act.onClose();
  };
  const doneMission = act.missionDone(v.id);
  const buttons = h(
    'div',
    { class: 'row wrap', style: 'gap:8px;justify-content:center' },
    btn('BICARA', 'biru kecil', () => {
      line = (line + 1) % Math.max(1, v.lines.length);
      say.textContent = `“${v.lines[line] ?? 'Halo!'}”`;
      sfx.notify();
    }),
    v.items.length
      ? btn('LIHAT BARANG', 'kuning kecil', () => {
          cleanup?.();
          const shop = shopPanel(v.items, act.wallet, (itemId, qty) => act.buy(v.id, itemId, qty));
          cleanup = shop.dispose;
          body.replaceChildren(shop.el);
          sfxLiving.coin();
        })
      : null,
    btn(doneMission ? 'MISI SELESAI ✓' : 'TERIMA MISI', 'hijau kecil', () => {
      if (act.missionDone(v.id)) return;
      closeDialog();
      act.startMission(v);
    }, doneMission ? { disabled: true } : {}),
    btn('Tutup', 'putih kecil', close),
  );
  const panel = h(
    'div',
    { class: 'panel card col pop', style: 'max-width:min(560px,94vw);max-height:calc(100dvh - 24px);overflow:auto;gap:6px;padding:14px 18px' },
    h('div', { class: 'row', style: 'gap:10px;align-items:center' }, h('div', { style: 'width:46px;height:46px;border-radius:50%;background:#FFC93C;display:flex;align-items:center;justify-content:center;font:900 22px Fredoka' }, v.nama.slice(0, 1)), h('div', null, h('div', { style: 'font:700 20px Fredoka' }, v.nama), h('div', { class: 'muted', style: 'font-weight:800' }, v.peran))),
    say,
    body,
    buttons,
  );
  mount(h('div', { class: 'screen gelap', style: 'z-index:21' }, panel));
}

/** Soal misi lokal (Mode Demo). Memanggil onAnswer(benar). */
export function localMissionDialog(v: Vendor, m: LocalMission, onAnswer: (correct: boolean) => void, onClose: () => void) {
  closeDialog();
  const fb = h('p', { style: 'font-weight:900;min-height:24px' });
  const grid = h('div', { class: 'opsi' });
  const optBtns: HTMLButtonElement[] = [];
  m.options.forEach((o, i) => {
    const b = h('button', { type: 'button' }, h('b', null, 'ABCD'[i]!), h('span', null, o)) as HTMLButtonElement;
    b.onclick = () => {
      optBtns.forEach((x) => (x.disabled = true));
      const ok = i === m.correct;
      b.classList.add(ok ? 'benar' : 'salah');
      optBtns[m.correct]?.classList.add('benar');
      fb.textContent = (ok ? 'BENAR! ' : 'Belum tepat. ') + m.explain;
      if (ok) sfx.correct();
      else sfx.retry();
      onAnswer(ok);
    };
    optBtns.push(b);
    grid.appendChild(b);
  });
  const panel = h(
    'div',
    { class: 'panel soal col pop', style: 'gap:12px' },
    h('header', { style: 'background:#FF8A3D' }, h('div', { class: 'grow' }, h('div', { style: 'font-family:Fredoka;font-size:20px' }, `Misi ${v.nama} · ${m.judul}`), h('div', { style: 'font-weight:800;font-size:14px' }, 'Latihan Mode Demo · tidak disimpan'))),
    h('div', { class: 'isi' }, h('div', { class: 'teks' }, m.prompt), grid),
    h('div', { class: 'col', style: 'padding:0 18px 12px' }, fb, btn('LANJUT JELAJAH', 'biru', () => (closeDialog(), onClose()))),
  );
  mount(h('div', { class: 'screen gelap', style: 'z-index:22' }, panel));
  sfx.open();
}

/** Gerbang Antardunia: menampilkan dunia lain dengan jujur (belum tersedia) + kembali ke Lobi bila ada. */
export interface GateWorld {
  id: WorldId;
  nama: string;
  ket: string;
  color: string;
  /** null = tidak bisa dipilih (alasan di `ket`). */
  go: (() => void) | null;
}

/** Gerbang Antardunia: pindah ke dunia lain dengan identitas, skor, tas, dan uang yang sama (disimpan server). */
export function worldGateDialog(opts: { toLobby: (() => void) | null; worlds?: GateWorld[]; onClose: () => void }) {
  closeDialog();
  const card = (nama: string, ket: string, on: (() => void) | null, color: string, id = '') =>
    h(
      'button',
      { type: 'button', class: 'panel tipis', 'data-gate': id, disabled: !on, style: `padding:12px;text-align:left;border:3px solid ${color};cursor:${on ? 'pointer' : 'not-allowed'};opacity:${on ? 1 : 0.65}`, onclick: () => on?.() },
      h('div', { style: 'font:700 18px Fredoka' }, nama),
      h('div', { style: 'font-weight:800;font-size:13px' }, ket),
    );
  const worlds = opts.worlds ?? [];
  const panel = h(
    'div',
    { class: 'panel card col pop', style: 'max-width:min(560px,94vw);gap:10px;padding:16px' },
    h('h2', { style: 'margin:0' }, 'Gerbang Antardunia'),
    h('p', { style: 'margin:0;font-weight:800' }, worlds.length ? 'Pilih dunia tujuan. Poin, tas, dan uangmu ikut terbawa.' : 'Mode Demo hanya memuat Dunia Kota. Masuk kelas untuk menjelajah dunia lain.'),
    h(
      'div',
      { style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px' },
      card('Lobi Dunia', opts.toLobby ? 'Kembali ke lobi portal' : 'Hanya di mode kelas', opts.toLobby ? () => (closeDialog(), opts.onClose(), opts.toLobby!()) : null, '#3BA7FF', 'lobi'),
      ...worlds.map((w) => card(w.nama, w.ket, w.go ? () => (closeDialog(), opts.onClose(), w.go!()) : null, w.color, w.id)),
    ),
    btn('Tutup', 'putih', () => (closeDialog(), opts.onClose())),
  );
  mount(h('div', { class: 'screen gelap', style: 'z-index:21' }, panel));
}

/** Transisi lubang dimensi: layar berpusar ungu lalu nama tujuan. */
export function riftTransition(nama: string, midpoint: () => void | Promise<void>) {
  const el = h('div', { class: 'rift-fx' }, h('div', { class: 'rift-name' }, nama));
  document.body.appendChild(el);
  sfxLiving.portal();
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(async () => {
    await midpoint();
    el.classList.add('show-name');
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 600);
    }, 900);
  }, 450);
}
