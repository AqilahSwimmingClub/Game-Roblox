/** Buat sesi: kelas, mapel/paket soal, dunia aktif, durasi, poin, aturan, daftar siswa (opsional). */
import { DEFAULT_SETTINGS, SUBJECTS, WORLDS, QUESTION_SOURCE_LABEL, type SessionSettings, type QuestionRecord } from '@eduverse/shared';
import { h, api, btn, modal } from '../lib.js';

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
  // ── Sumber & pemilihan soal ──
  const sourceSel = h(
    'select',
    { class: 'in', 'data-field': 'questionSource' },
    ...(['guru', 'bawaan', 'gabungan'] as const).map((v) => h('option', { value: v, selected: v === 'guru' }, QUESTION_SOURCE_LABEL[v])),
  ) as HTMLSelectElement;
  const diffChecks = (['mudah', 'sedang', 'sulit'] as const).map((d) => ({ d, ...check(d[0]!.toUpperCase() + d.slice(1), false) }));
  const pickMode = h('select', { class: 'in', 'data-field': 'pickMode' }, h('option', { value: 'semua' }, 'Semua soal yang cocok'), h('option', { value: 'acak' }, 'Acak sejumlah soal'), h('option', { value: 'pilih' }, 'Pilih soal tertentu')) as HTMLSelectElement;
  const randomN = num(20, 1, 10000);
  const chosen = new Set<string>();
  const chosenInfo = h('span', { class: 'muted', style: 'font-weight:800' }, 'Belum ada soal dipilih');
  const poolInfo = h('div', { class: 'pool-info', style: 'font-weight:800' }, 'Menghitung soal…');
  const randomWrap = h('label', { class: 'f', style: 'display:none' }, 'Jumlah soal acak untuk sesi ini', randomN);
  const pickWrap = h('div', { class: 'row', style: 'display:none;gap:8px;align-items:center' }, btn('Pilih Soal…', 'putih kecil', () => void openPicker()), chosenInfo);
  let poolTotal = -1;
  const currentPool = () => ({
    settings: { subjects: subjectChecks.filter((c) => c.i.checked).map((c) => c.sub), grade: grade.value ? Number(grade.value) : null, questionSource: sourceSel.value as SessionSettings['questionSource'], difficulties: diffChecks.filter((x) => x.i.checked).map((x) => x.d) },
    questionIds: pickMode.value === 'pilih' ? [...chosen] : undefined,
  });
  let countTimer = 0;
  const updateCount = () => {
    randomWrap.style.display = pickMode.value === 'acak' ? '' : 'none';
    pickWrap.style.display = pickMode.value === 'pilih' ? 'flex' : 'none';
    chosenInfo.textContent = chosen.size ? `${chosen.size} soal dipilih` : 'Belum ada soal dipilih';
    clearTimeout(countTimer);
    countTimer = window.setTimeout(async () => {
      if (pickMode.value === 'pilih' && !chosen.size) {
        poolTotal = 0;
        poolInfo.style.color = '#C2410C';
        poolInfo.textContent = 'Pilih minimal satu soal.';
        submit.disabled = true;
        return;
      }
      try {
        const r = await api<{ total: number }>('/questions/pool-count', { method: 'POST', json: currentPool() });
        poolTotal = r.total;
        const n = pickMode.value === 'acak' ? Math.min(Number(randomN.value) || 0, r.total) : r.total;
        poolInfo.style.color = r.total ? '#15803D' : '#C2410C';
        poolInfo.textContent = r.total
          ? `✓ ${pickMode.value === 'acak' ? `${n} soal acak dari ${r.total} soal yang cocok` : `${r.total} soal akan dipakai`} (${QUESTION_SOURCE_LABEL[sourceSel.value as 'guru']})`
          : `Bank soal untuk pilihan ini kosong (${QUESTION_SOURCE_LABEL[sourceSel.value as 'guru']}). Tambahkan/impor soal di Bank Soal, atau ubah sumber, mapel, kelas, atau tingkat kesulitan.`;
        submit.disabled = !r.total;
      } catch {
        poolInfo.textContent = 'Jumlah soal belum bisa dihitung.';
      }
    }, 250);
  };
  async function openPicker() {
    const search = h('input', { class: 'in', placeholder: 'Cari soal…' }) as HTMLInputElement;
    const list = h('div', { class: 'col', style: 'gap:4px;max-height:55vh;overflow:auto' });
    let items: QuestionRecord[] = [];
    const src = sourceSel.value;
    for (let page = 1; page < 200; page++) {
      const qs = new URLSearchParams({ page: String(page), pageSize: '500' });
      if (src !== 'gabungan') qs.set('source', src);
      const r = await api<{ items: QuestionRecord[]; total: number }>(`/questions?${qs}`);
      items = items.concat(r.items);
      if (items.length >= r.total || !r.items.length) break;
    }
    const render = () => {
      const t = search.value.trim().toLowerCase();
      list.replaceChildren(
        ...items
          .filter((q) => !t || q.prompt.toLowerCase().includes(t) || q.topic.toLowerCase().includes(t) || q.subject.toLowerCase().includes(t))
          .slice(0, 1000)
          .map((q) => {
            const cb = h('input', { type: 'checkbox', checked: chosen.has(q.id), 'data-qid': q.id }) as HTMLInputElement;
            cb.onchange = () => (cb.checked ? chosen.add(q.id) : chosen.delete(q.id));
            return h('label', { class: 'check', style: 'align-items:flex-start' }, cb, h('span', null, h('b', null, q.prompt), h('div', { class: 'muted', style: 'font-size:12px' }, `${q.subject} · Kls ${q.grade} · ${q.difficulty}${q.source === 'bawaan' ? ' · bawaan' : ''}`)));
          }),
      );
    };
    search.oninput = render;
    render();
    const m = modal(
      h(
        'div',
        { class: 'card col', style: 'max-width:760px' },
        h('h2', null, `Pilih Soal (${items.length} di bank)`),
        search,
        h('div', { class: 'row' }, btn('Pilih semua yang tampil', 'putih kecil', () => {
          list.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => {
            c.checked = true;
            chosen.add(c.dataset.qid!);
          });
        }), btn('Kosongkan', 'putih kecil', () => {
          chosen.clear();
          render();
        })),
        list,
        btn('Selesai', 'hijau', () => {
          m.close();
          updateCount();
        }),
      ),
    );
  }
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
      questionSource: sourceSel.value as SessionSettings['questionSource'],
      difficulties: diffChecks.filter((x) => x.i.checked).map((x) => x.d),
      randomCount: pickMode.value === 'acak' ? Math.max(1, Number(randomN.value) || 1) : null,
      allowGifts: allowGifts.i.checked,
      allowTrades: allowTrades.i.checked,
    };
    if (!settings.worlds!.length) return void (err.textContent = 'Aktifkan minimal satu dunia.');
    try {
      if (poolTotal === 0) return void (err.textContent = 'Bank soal untuk pilihan ini kosong. Tambahkan soal Anda dulu.');
      const r = await api<{ id: string }>('/sessions', { method: 'POST', json: { title: title.value.trim(), className: cls.value.trim(), settings, questionIds: pickMode.value === 'pilih' ? [...chosen] : undefined, roster: rosterRows.length ? rosterRows : undefined } });
      location.hash = `#/sesi/${r.id}`;
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  });

  const countWrap = h('label', { class: 'f', style: 'display:none' }, 'Jumlah soal per siswa', count);
  const sec = (t: string, ...c: (HTMLElement | null)[]) => h('div', { class: 'card col' }, h('h3', null, t), ...c);
  for (const el of [sourceSel, pickMode, randomN, grade, ...diffChecks.map((x) => x.i), ...subjectChecks.map((c) => c.i)]) el.addEventListener('change', updateCount);
  randomN.addEventListener('input', updateCount);
  updateCount();
  return h(
    'main',
    null,
    h('h1', null, 'Buat Sesi Permainan'),
    h(
      'div',
      { class: 'grid g2' },
      sec('Identitas sesi', h('label', { class: 'f' }, 'Judul sesi', title), h('label', { class: 'f' }, 'Kelas', cls), h('label', { class: 'f' }, 'Daftar siswa (opsional)', roster), h('p', { class: 'muted', style: 'margin:0' }, 'Bila diisi, siswa cukup memilih namanya. Bila kosong, siswa mengetik nomor absen dan nama panggilan sendiri.')),
      sec(
        'Sumber & pilihan soal',
        h('label', { class: 'f' }, 'Sumber soal', sourceSel),
        h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Hanya Soal Guru = memakai soal buatan/impor Anda saja (disarankan untuk pembelajaran resmi). Soal bawaan EDUVERSE tidak dicampur tanpa izin Anda.'),
        h('div', { style: 'font-weight:800' }, 'Tingkat kesulitan (kosongkan = semua)'),
        h('div', { class: 'row', style: 'gap:12px' }, ...diffChecks.map((x) => x.el)),
        h('label', { class: 'f' }, 'Soal yang dimainkan', pickMode),
        randomWrap,
        pickWrap,
        poolInfo,
      ),
      sec('Paket soal', h('div', { style: 'font-weight:800' }, 'Mata pelajaran (kosongkan = semua)'), h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px' }, ...subjectChecks.map((c) => c.el)), h('label', { class: 'f' }, 'Tingkat kelas soal', grade), h('label', { class: 'f' }, 'Mode soal', mode), countWrap),
      sec('Dunia & durasi', ...worldChecks.map((w) => w.el), h('label', { class: 'f' }, 'Durasi (menit)', duration), h('label', { class: 'f' }, 'Kepadatan titik soal', density)),
      sec('Poin & aturan', h('label', { class: 'f' }, 'Poin dasar per soal', base), h('label', { class: 'f' }, 'Mode titik soal', pointMode), allowRepeat.el, secondChance.el, approval.el, showLb.el),
      sec('Interaksi siswa', allowGifts.el, allowTrades.el, h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Bisa diubah kapan saja dari halaman sesi. Uang virtual tidak pernah bisa dipindahkan antarsiswa.')),
    ),
    h('div', { class: 'card row' }, err, h('div', { class: 'grow' }), btn('Batal', 'putih', () => void (location.hash = '#/')), submit),
  );
}
