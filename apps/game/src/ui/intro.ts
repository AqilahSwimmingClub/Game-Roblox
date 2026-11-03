/** Layar 1–3: Splash, Welcome (+Cara Bermain), Masuk Sesi, Pilih Identitas, Menunggu Guru. */
import type { RosterEntry } from '@eduverse/shared';
import { h, btn, edo, ui } from './dom.js';
import { setSound, soundOn } from '../world/audio.js';

const TIPS = [
  'Tahukah kamu? Paus biru adalah hewan terbesar di Bumi.',
  'Tahukah kamu? Sila ke-3 Pancasila berbunyi Persatuan Indonesia.',
  'Tahukah kamu? 1/2 sama dengan 0,5 dan 50%.',
  'Tahukah kamu? Perpustakaan Raksasa punya tiga lantai untuk dijelajahi!',
  'Tahukah kamu? Menara Jam Kota memunculkan Soal Kejutan.',
];

function logo() {
  return h('div', { class: 'center' }, h('div', { class: 'logo' }, 'EDUVERSE'), h('div', { class: 'tagline' }, 'The Learning Adventure'));
}

function floating() {
  const colors = ['#FFC93C', '#2FBF71', '#FF8A3D', '#8B5CF6', '#F4F8FF'];
  return h(
    'div',
    { class: 'floating-blocks', 'aria-hidden': 'true' },
    ...Array.from({ length: 10 }, (_, i) => h('span', { style: `left:${(i * 37) % 95}%;top:${(i * 53) % 85}%;background:${colors[i % colors.length]};animation-delay:${i * 0.4}s` })),
  );
}

/** Splash: memuat aset (dunia dibangun dari data, tidak ada unduhan besar) sambil menampilkan tips. */
export async function splash(work: (progress: (p: number) => void) => Promise<void>) {
  const blocks = h('div', { class: 'blocks' }, ...Array.from({ length: 10 }, () => h('span')));
  const tip = h('div', { class: 'tagline', style: 'font-weight:800;max-width:560px' }, TIPS[0]!);
  const scr = ui.show(h('div', { class: 'screen langit' }, floating(), h('div', { class: 'col center', style: 'align-items:center;gap:18px' }, logo(), edo(90), blocks, tip)));
  const colors = ['#2FBF71', '#FFC93C', '#FF8A3D', '#8B5CF6', '#3BA7FF'];
  let i = 0;
  const tipTimer = setInterval(() => (tip.textContent = TIPS[++i % TIPS.length]!), 2200);
  const slow = setTimeout(() => (tip.textContent = 'Sebentar lagi, dunianya sedang disiapkan!'), 8000);
  const start = performance.now();
  await work((p) => {
    const n = Math.round(Math.max(0, Math.min(1, p)) * 10);
    [...blocks.children].forEach((b, k) => ((b as HTMLElement).style.background = k < n ? colors[k % colors.length]! : ''));
  });
  const rest = 1600 - (performance.now() - start);
  if (rest > 0) await new Promise((r) => setTimeout(r, rest));
  clearInterval(tipTimer);
  clearTimeout(slow);
  scr.remove();
}

const CARDS = [
  { judul: '1. Jelajahi dunia', isi: 'HP: geser jempol kiri untuk berjalan, tombol Lompat di kanan. Komputer: WASD / panah, Spasi lompat, Shift lari.', warna: '#3BA7FF' },
  { judul: '2. Cari tanda tanya kuning', isi: 'Dekati peti, papan, buku, atau warga bertanda ?. Tekan tombol Aksi (komputer: E).', warna: '#FFC93C' },
  { judul: '3. Jawab & kumpulkan poin', isi: 'Jawaban benar memberi poin. Belum tepat? Coba lagi! Di akhir, tiga juara naik podium.', warna: '#2FBF71' },
];

function howTo(onClose: () => void) {
  let idx = 0;
  const strip = h('div', { style: 'height:12px;border-radius:12px' });
  const title = h('h2', { style: 'font-size:28px' });
  const body = h('p', { style: 'font-size:20px;font-weight:800;min-height:96px' });
  const dots = h('div', { class: 'row', style: 'justify-content:center' });
  const nextBtn = btn('Lanjut', 'hijau', () => {
    if (idx < CARDS.length - 1) {
      idx++;
      render();
    } else {
      layer.remove();
      onClose();
    }
  });
  const render = () => {
    const c = CARDS[idx]!;
    strip.style.background = c.warna;
    title.textContent = c.judul;
    body.textContent = c.isi;
    dots.replaceChildren(...CARDS.map((_, i) => h('span', { style: `width:14px;height:14px;border-radius:50%;background:${i === idx ? '#1E2A4A' : '#DCE6F5'}` })));
    nextBtn.textContent = idx === CARDS.length - 1 ? 'Mengerti!' : 'Lanjut';
  };
  const card = h('div', { class: 'panel card col pop' }, strip, title, body, dots, h('div', { class: 'row', style: 'justify-content:space-between' }, btn('Sebelumnya', 'putih', () => ((idx = Math.max(0, idx - 1)), render())), nextBtn));
  let sx = 0;
  card.addEventListener('pointerdown', (e) => (sx = e.clientX));
  card.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 60) {
      idx = Math.max(0, Math.min(CARDS.length - 1, idx + (dx < 0 ? 1 : -1)));
      render();
    }
  });
  const layer = ui.add(h('div', { class: 'screen gelap', style: 'z-index:20' }, card));
  render();
}

/** Welcome: MAIN, Cara Bermain, Suara. Latar = panorama 3D lobi yang berputar. */
export function welcome(): Promise<void> {
  return new Promise((resolve) => {
    const soundBtn = btn(soundOn() ? 'Suara: Hidup' : 'Suara: Mati', 'putih kecil', () => {
      setSound(!soundOn());
      soundBtn.textContent = soundOn() ? 'Suara: Hidup' : 'Suara: Mati';
    });
    const main = btn('MAIN', 'hijau besar pulse', () => {
      scr.remove();
      resolve();
    });
    main.style.minWidth = '260px';
    const scr = ui.show(
      h(
        'div',
        { class: 'screen', style: 'flex-direction:column;justify-content:space-between;background:linear-gradient(180deg,rgba(59,167,255,0.15),rgba(30,42,74,0.55))' },
        h('div', { class: 'row', style: 'align-self:flex-end' }, soundBtn),
        logo(),
        h('div', { class: 'col', style: 'align-items:center' }, main, btn('Cara Bermain', 'putih', () => howTo(() => {}))),
      ),
    );
  });
}

/** Masuk Sesi: 6 kotak kode kelas. `submit` memanggil server dan mengembalikan pesan galat bila gagal. */
export function masukSesi(prefill: string, submit: (code: string) => Promise<string | null>): Promise<void> {
  return new Promise((resolve) => {
    const input = h('input', { inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', maxlength: 8, 'aria-label': 'Kode kelas' }) as HTMLInputElement;
    const boxes = h('div', { class: 'code-boxes' }, ...Array.from({ length: 6 }, () => h('span')), input);
    const err = h('div', { class: 'error center', role: 'alert' });
    const go = btn('MASUK', 'hijau besar', () => void doSubmit(), { disabled: true });
    const clean = () => input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const render = () => {
      const v = clean();
      if (input.value !== v) input.value = v;
      [...boxes.querySelectorAll('span')].forEach((s, i) => {
        s.textContent = v[i] ?? '';
        s.classList.toggle('isi', i < v.length);
        s.classList.toggle('aktif', i === v.length && document.activeElement === input);
      });
      go.disabled = v.length < 6;
    };
    let busy = false;
    const doSubmit = async () => {
      if (busy || clean().length < 6) return;
      busy = true;
      go.disabled = true;
      err.textContent = '';
      const e = await submit(clean());
      busy = false;
      render();
      if (e) {
        err.textContent = e;
        boxes.classList.remove('shake');
        void boxes.offsetWidth;
        boxes.classList.add('shake');
        return;
      }
      scr.remove();
      resolve();
    };
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', render);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && void doSubmit());
    input.value = prefill;
    const scr = ui.show(
      h(
        'div',
        { class: 'screen langit' },
        h(
          'div',
          { class: 'row', style: 'gap:18px;align-items:center;flex-wrap:wrap;justify-content:center' },
          h('div', { class: 'col desk-only', style: 'align-items:center' }, edo(96), h('div', { class: 'bubble' }, 'Minta kode dari gurumu, ya!')),
          h('div', { class: 'panel card col pop', style: 'align-items:stretch' }, h('h2', { class: 'center', style: 'font-size:32px' }, 'Masuk ke Kelas'), h('p', { class: 'muted center', style: 'margin:0;font-weight:800' }, 'Ketik kode kelas dari gurumu'), boxes, err, go),
        ),
      ),
    );
    render();
    if (prefill.length >= 6) void doSubmit();
    else setTimeout(() => input.focus(), 50);
  });
}

/** Pilih identitas: daftar kelas dari guru (preset) atau ketik nomor absen + nama panggilan. */
export function pilihIdentitas(roster: RosterEntry[], preset: boolean, claim: (absen: number, nama?: string) => Promise<string | null>): Promise<void> {
  return new Promise((resolve) => {
    const err = h('div', { class: 'error center', role: 'alert' });
    const done = () => {
      scr.remove();
      resolve();
    };
    let content: HTMLElement;
    if (preset) {
      content = h(
        'div',
        { class: 'grid scroll', style: 'max-height:52vh' },
        ...roster.map((r) =>
          h(
            'button',
            {
              class: 'opt',
              disabled: r.taken,
              onclick: async () => {
                err.textContent = '';
                const e = await claim(r.absen);
                if (e) err.textContent = e;
                else done();
              },
            },
            `${String(r.absen).padStart(2, '0')} · ${r.nama}`,
          ),
        ),
      );
    } else {
      const absen = h('input', { class: 'field', inputmode: 'numeric', placeholder: 'mis. 7', maxlength: 2 }) as HTMLInputElement;
      const nama = h('input', { class: 'field', placeholder: 'mis. Raka', maxlength: 16, autocomplete: 'off' }) as HTMLInputElement;
      const taken = roster.filter((r) => r.taken).map((r) => r.absen);
      content = h(
        'div',
        { class: 'col' },
        h('label', { class: 'col', style: 'gap:6px;font-weight:800' }, 'Nomor absen', absen),
        h('label', { class: 'col', style: 'gap:6px;font-weight:800' }, 'Nama panggilan', nama),
        taken.length ? h('div', { class: 'muted', style: 'font-weight:700' }, `Nomor yang sudah dipakai: ${taken.join(', ')}`) : null,
        btn('Simpan', 'hijau', async () => {
          err.textContent = '';
          const n = Number(absen.value);
          if (!Number.isInteger(n) || n < 1 || n > 99) return void (err.textContent = 'Nomor absen harus 1–99.');
          const e = await claim(n, nama.value.trim());
          if (e) err.textContent = e;
          else done();
        }),
      );
    }
    const scr = ui.show(
      h(
        'div',
        { class: 'screen langit' },
        h('div', { class: 'panel card col pop', style: 'width:min(680px,100%)' }, h('h2', { class: 'center', style: 'font-size:30px' }, 'Kamu yang mana?'), h('p', { class: 'muted center', style: 'margin:0;font-weight:800' }, preset ? 'Pilih nomor absen dan namamu. Cukup sekali!' : 'Isi nomor absen dan nama panggilanmu. Cukup sekali!'), content, err),
      ),
    );
  });
}

/** Menunggu persetujuan guru (bila guru mewajibkan). */
export function menungguGuru(): { close: () => void } {
  const scr = ui.show(h('div', { class: 'screen langit' }, h('div', { class: 'panel card col center pop', style: 'align-items:center' }, edo(96), h('h2', null, 'Menunggu persetujuan guru…'), h('p', { class: 'muted', style: 'font-weight:800' }, 'Gurumu akan menyetujui identitasmu. Ini hanya sekali.'))));
  return { close: () => scr.remove() };
}
