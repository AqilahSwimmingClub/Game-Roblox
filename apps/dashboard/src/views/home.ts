/** Beranda: ringkasan bank soal + riwayat semua sesi permainan (dari database). */
import { h, api, btn, fmtDate } from '../lib.js';

interface SessionItem {
  id: string;
  code: string;
  title: string;
  class_name: string;
  status: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  students: number;
  answers: number;
}

const STATUS: Record<string, string> = { menunggu: 'Menunggu', hitung: 'Hitung mundur', berjalan: 'Berjalan', jeda: 'Dijeda', selesai: 'Selesai' };

export async function homeView(): Promise<HTMLElement> {
  const [stats, sessions] = await Promise.all([api<{ total: number; bySubject: { subject: string; n: number }[] }>('/questions/stats'), api<{ items: SessionItem[] }>('/sessions')]);
  const active = sessions.items.filter((s) => s.status === 'berjalan' || s.status === 'jeda' || s.status === 'hitung');
  const stat = (label: string, value: string | number, color: string, ic: string) =>
    h('div', { class: 'card stat' }, h('div', { class: 'ic', style: `background:${color}22;color:${color}` }, ic), h('div', null, h('div', { class: 'muted', style: 'font-weight:800' }, label), h('div', { class: 'v' }, String(value))));
  const subjects = new Set(stats.bySubject.map((x) => x.subject));
  return h(
    'main',
    null,
    h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Beranda'), btn('+ Buat Sesi Permainan', 'hijau besar', () => void (location.hash = '#/sesi/baru')), btn('Bank Soal', 'putih besar', () => void (location.hash = '#/soal'))),
    h(
      'div',
      { class: 'grid g4' },
      stat('Total soal di bank', stats.total, '#8B5CF6', 'S'),
      stat('Mata pelajaran', subjects.size, '#3BA7FF', 'M'),
      stat('Sesi sedang aktif', active.length, '#2FBF71', 'A'),
      stat('Total sesi', sessions.items.length, '#FF8A3D', 'R'),
    ),
    stats.total === 0
      ? h(
          'div',
          { class: 'card row' },
          h('div', { class: 'grow' }, h('h3', null, 'Bank soal masih kosong'), h('p', { class: 'muted', style: 'margin:4px 0 0' }, 'Impor soal dari Word/Excel, tulis soal sendiri, atau muat soal contoh Kelas 5 untuk mencoba.')),
          btn('Muat Soal Contoh', 'kuning', async () => {
            await api('/questions/sample', { method: 'POST' });
            location.reload();
          }),
        )
      : null,
    h(
      'div',
      { class: 'card col' },
      h('h2', null, 'Riwayat Permainan'),
      sessions.items.length
        ? h(
            'div',
            { class: 'tablewrap' },
            h(
              'table',
              null,
              h('thead', null, h('tr', null, h('th', null, 'Sesi'), h('th', null, 'Kelas'), h('th', null, 'Kode'), h('th', null, 'Status'), h('th', null, 'Siswa'), h('th', null, 'Jawaban'), h('th', null, 'Dibuat'), h('th', null, ''))),
              h(
                'tbody',
                null,
                ...sessions.items.map((s) =>
                  h(
                    'tr',
                    null,
                    h('td', { style: 'font-weight:900' }, s.title),
                    h('td', null, s.class_name),
                    h('td', { style: 'font-family:Fredoka;letter-spacing:.08em' }, s.code),
                    h('td', null, h('span', { class: `status ${s.status}`, style: 'font-size:14px' }, STATUS[s.status] ?? s.status)),
                    h('td', null, String(s.students)),
                    h('td', null, String(s.answers)),
                    h('td', null, fmtDate(s.created_at)),
                    h('td', null, h('a', { class: 'btn kecil', href: `#/sesi/${s.id}` }, s.status === 'selesai' ? 'Lihat Hasil' : 'Buka')),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Belum ada sesi. Tekan "Buat Sesi Permainan" untuk memulai.'),
    ),
  );
}
