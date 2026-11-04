/** Buat sesi: kelas, mapel/paket soal, dunia aktif, durasi, poin, aturan, daftar siswa (opsional). */
import { DEFAULT_SETTINGS, SUBJECTS, WORLDS, type SessionSettings } from '@eduverse/shared';
import { h, api, btn } from '../lib.js';

export function sessionFormView(): HTMLElement {
  const s: SessionSettings = { ...DEFAULT_SETTINGS };
  const err = h('div', { class: 'err' });
  const title = h('input', { class: 'in', value: 'Petualangan Dunia Kota', maxlength: 100 }) as HTMLInputElement;
  const cls = h('input', { class: 'in', placeholder: 'mis. 5B', maxlength: 40 }) as HTMLInputElement;
  const num = (v: number, min: number, max: number, step = 1) => h('input', { class: 'in', type: 'number', value: String(v), min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  const duration = num(s.durationMinutes, 3, 120);
  const base = num(s.basePoints, 10, 1000, 10);
  const count = num(s.questionCount, 1, 500);
  const grade = h('select', { class: 'in' }, h('option', { value: '' }, 'Semua kelas'), ...[1, 2, 3, 4, 5, 6].map((g) => h('option', { value: String(g) }, `Kelas ${g}`))) as HTMLSelectElement;
  const mode = h('select', { class: 'in' }, h('option', { value: 'tanpa-batas' }, 'Tanpa batas (semua soal yang cocok)'), h('option', { value: 'jumlah' }, 'Jumlah soal tertentu per siswa')) as HTMLSelectElement;
  const pointMode = h('select', { class: 'in' }, h('option', { value: 'personal' }, 'Personal — setiap siswa punya titiknya sendiri'), h('option', { value: 'rebutan' }, 'Rebutan — titik hilang setelah dijawab benar'), h('option', { value: 'daurulang' }, 'Daur ulang — titik bisa dibuka lagi setelah jeda')) as HTMLSelectElement;
  const density = h('select', { class: 'in' }, h('option', { value: '0.3' }, 'Rendah (30%)'), h('option', { value: '0.5', selected: true }, 'Sedang (50%)'), h('option', { value: '0.8' }, 'Tinggi (80%)')) as HTMLSelectElement;
  const check = (label: string, on: boolean) => {
    const i = h('input', { type: 'checkbox', checked: on }) as HTMLInputElement;
    return { el: h('label', { class: 'check' }, i, label), i };
  };
  const subjectChecks = SUBJECTS.map((sub) => ({ sub, ...check(sub, false) }));
  const worldChecks = WORLDS.map((w) => {
    const c = check(w.tersedia ? w.nama : `${w.nama} (segera hadir)`, w.id === 'kota');
    c.i.disabled = !w.tersedia;
    return { w, ...c };
  });
  const allowRepeat = check('Izinkan pengulangan soal untuk siswa yang sama', s.allowRepeat);
  const secondChance = check('Kesempatan kedua (poin 50%) bila jawaban belum tepat', s.secondChance);
  const approval = check('Guru menyetujui identitas siswa sebelum bermain', s.requireApproval);
  const showLb = check('Tampilkan papan skor ke siswa selama bermain', s.showLeaderboard);
  const allowGifts = check('Izinkan siswa memberi barang (penerima harus menekan TERIMA)', s.allowGifts);
  const allowTrades = check('Izinkan siswa tukar barang (kedua siswa harus setuju)', s.allowTrades);
  const roster = h('textarea', { class: 'in', placeholder: '1 Adit\n2 Bima\n3 Citra\n… (satu siswa per baris: nomor absen lalu nama panggilan)' }) as HTMLTextAreaElement;
  mode.addEventListener('change', () => (count.parentElement!.style.display = mode.value === 'jumlah' ? '' : 'none'));

  const submit = btn('Buat Sesi & Kode Kelas', 'hijau besar', async () => {
    err.textContent = '';
    const rosterRows = roster.value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = /^(\d{1,2})[\s.,:;-]+(.{1,20})$/.exec(l);
        return m ? { absen: Number(m[1]), nama: m[2]!.trim() } : null;
      });
    if (rosterRows.some((r) => r === null)) return void (err.textContent = 'Format daftar siswa: "nomor nama" per baris, mis. "7 Raka".');
    if (!cls.value.trim()) return void (err.textContent = 'Isi nama kelas.');
    const settings: Partial<SessionSettings> = {
      durationMinutes: Number(duration.value),
      basePoints: Number(base.value),
      worlds: worldChecks.filter((w) => w.i.checked).map((w) => w.w.id),
      subjects: subjectChecks.filter((c) => c.i.checked).map((c) => c.sub),
      grade: grade.value ? Number(grade.value) : null,
      questionMode: mode.value as SessionSettings['questionMode'],
      questionCount: Number(count.value),
      allowRepeat: allowRepeat.i.checked,
      secondChance: secondChance.i.checked,
      pointMode: pointMode.value as SessionSettings['pointMode'],
      density: Number(density.value),
      requireApproval: approval.i.checked,
      showLeaderboard: showLb.i.checked,
      allowGifts: allowGifts.i.checked,
      allowTrades: allowTrades.i.checked,
    };
    if (!settings.worlds!.length) return void (err.textContent = 'Aktifkan minimal satu dunia.');
    try {
      const r = await api<{ id: string }>('/sessions', { method: 'POST', json: { title: title.value.trim(), className: cls.value.trim(), settings, roster: rosterRows.length ? rosterRows : undefined } });
      location.hash = `#/sesi/${r.id}`;
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  });

  const countWrap = h('label', { class: 'f', style: 'display:none' }, 'Jumlah soal per siswa', count);
  const sec = (t: string, ...c: (HTMLElement | null)[]) => h('div', { class: 'card col' }, h('h3', null, t), ...c);
  return h(
    'main',
    null,
    h('h1', null, 'Buat Sesi Permainan'),
    h(
      'div',
      { class: 'grid g2' },
      sec('Identitas sesi', h('label', { class: 'f' }, 'Judul sesi', title), h('label', { class: 'f' }, 'Kelas', cls), h('label', { class: 'f' }, 'Daftar siswa (opsional)', roster), h('p', { class: 'muted', style: 'margin:0' }, 'Bila diisi, siswa cukup memilih namanya. Bila kosong, siswa mengetik nomor absen dan nama panggilan sendiri.')),
      sec('Paket soal', h('div', { style: 'font-weight:800' }, 'Mata pelajaran (kosongkan = semua)'), h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px' }, ...subjectChecks.map((c) => c.el)), h('label', { class: 'f' }, 'Tingkat kelas soal', grade), h('label', { class: 'f' }, 'Mode soal', mode), countWrap),
      sec('Dunia & durasi', ...worldChecks.map((w) => w.el), h('label', { class: 'f' }, 'Durasi (menit)', duration), h('label', { class: 'f' }, 'Kepadatan titik soal', density)),
      sec('Poin & aturan', h('label', { class: 'f' }, 'Poin dasar per soal', base), h('label', { class: 'f' }, 'Mode titik soal', pointMode), allowRepeat.el, secondChance.el, approval.el, showLb.el),
      sec('Interaksi siswa', allowGifts.el, allowTrades.el, h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Bisa diubah kapan saja dari halaman sesi. Uang virtual tidak pernah bisa dipindahkan antarsiswa.')),
    ),
    h('div', { class: 'card row' }, err, h('div', { class: 'grow' }), btn('Batal', 'putih', () => void (location.hash = '#/')), submit),
  );
}
