/** Bank soal: cari/saring/halaman, tambah/ubah/hapus, soal contoh, templat & impor Word/Excel (pratinjau → simpan). */
import { SUBJECTS, validateQuestion, QUESTION_IMAGE_MAX, type QuestionRecord, type QuestionType, type AnswerKey } from '@eduverse/shared';
import { h, api, btn, toast, modal, download } from '../lib.js';

type Q = QuestionRecord;
type QIn = Omit<Q, 'id'>;
const TYPE_LABEL: Record<QuestionType, string> = { pg: 'Pilihan ganda', bs: 'Benar/Salah', isian: 'Isian singkat', jodoh: 'Menjodohkan' };

function keyText(q: QIn): string {
  const k = q.key;
  if (k.type === 'pg') return q.options[k.index] ?? '?';
  if (k.type === 'bs') return k.value ? 'Benar' : 'Salah';
  if (k.type === 'isian') return k.accepted.join(' / ');
  return k.pairs.map((r, i) => `${q.options[i]}→${q.right[r]}`).join(', ');
}

/** Perkecil gambar di perangkat guru (maks 800 px, JPEG) agar ringan di HP siswa. */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, 800 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const d = c.toDataURL('image/jpeg', q);
      if (d.length <= QUESTION_IMAGE_MAX) return d;
    }
    throw new Error('Gambar terlalu besar');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function questionsView(): Promise<HTMLElement> {
  const state = { search: '', subject: '', grade: '', type: '', source: '', difficulty: '', page: 1, pageSize: 25 };
  const selected = new Set<string>();
  const statsEl = h('div', { class: 'row' });
  const tbody = h('tbody');
  const pager = h('div', { class: 'pager' });

  async function loadStats() {
    const s = await api<{ total: number; bySubject: { subject: string; grade: number; n: number }[]; bySource?: { guru: number; bawaan: number }; imports: { filename: string; question_count: number }[] }>('/questions/stats');
    const by = new Map<string, number>();
    for (const r of s.bySubject) by.set(r.subject, (by.get(r.subject) ?? 0) + r.n);
    statsEl.replaceChildren(
      h('span', { class: 'chip biru' }, `Total ${s.total} soal`),
      h('span', { class: 'chip hijau', 'data-stat': 'guru' }, `Soal guru: ${s.bySource?.guru ?? 0}`),
      h('span', { class: 'chip kuning', 'data-stat': 'bawaan' }, `Soal bawaan: ${s.bySource?.bawaan ?? 0}`),
      ...[...by].map(([k, n]) => h('span', { class: 'chip abu' }, `${k}: ${n}`)),
    );
  }

  async function load() {
    const qs = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
    if (state.search) qs.set('search', state.search);
    if (state.subject) qs.set('subject', state.subject);
    if (state.grade) qs.set('grade', state.grade);
    if (state.type) qs.set('type', state.type);
    if (state.source) qs.set('source', state.source);
    if (state.difficulty) qs.set('difficulty', state.difficulty);
    const r = await api<{ total: number; page: number; pageSize: number; items: Q[] }>(`/questions?${qs}`);
    tbody.replaceChildren(
      ...(r.items.length
        ? r.items.map((q) => {
            const cb = h('input', { type: 'checkbox', checked: selected.has(q.id), style: 'width:22px;height:22px' }) as HTMLInputElement;
            cb.addEventListener('change', () => (cb.checked ? selected.add(q.id) : selected.delete(q.id)));
            return h(
              'tr',
              null,
              h('td', null, cb),
              h(
                'td',
                null,
                h('div', { style: 'font-weight:800' }, q.image ? '🖼️ ' : '', q.prompt, q.source === 'bawaan' ? h('span', { class: 'chip kuning', style: 'margin-left:6px;font-size:11px' }, 'Bawaan') : null),
                h('div', { class: 'muted', style: 'font-size:13px' }, `Kunci: ${keyText(q)} · ${q.difficulty}`),
              ),
              h('td', null, q.subject, h('div', { class: 'muted', style: 'font-size:13px' }, q.topic)),
              h('td', null, `Kls ${q.grade}`),
              h('td', null, h('span', { class: 'chip ungu' }, TYPE_LABEL[q.type])),
              h('td', null, String(q.points)),
              h('td', null, btn('Ubah', 'kecil putih', () => editor(q))),
            );
          })
        : [h('tr', null, h('td', { colspan: 7, class: 'muted' }, 'Tidak ada soal yang cocok.'))]),
    );
    const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
    pager.replaceChildren(
      h('span', { class: 'muted', style: 'font-weight:800' }, `${r.total} soal · halaman ${r.page}/${pages}`),
      btn('‹ Sebelumnya', 'kecil putih', async () => {
        state.page = Math.max(1, state.page - 1);
        await load();
      }, { disabled: r.page <= 1 }),
      btn('Berikutnya ›', 'kecil putih', async () => {
        state.page = Math.min(pages, state.page + 1);
        await load();
      }, { disabled: r.page >= pages }),
    );
  }

  const refresh = async () => {
    await Promise.all([load(), loadStats()]);
  };

  // ---------- editor soal ----------
  function editor(q?: Q) {
    const err = h('div', { class: 'err' });
    const subject = h('select', { class: 'in' }, ...SUBJECTS.map((s) => h('option', { value: s, selected: q?.subject === s }, s))) as HTMLSelectElement;
    const grade = h('select', { class: 'in' }, ...[1, 2, 3, 4, 5, 6].map((g) => h('option', { value: String(g), selected: (q?.grade ?? 5) === g }, `Kelas ${g}`))) as HTMLSelectElement;
    const type = h('select', { class: 'in' }, ...(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => h('option', { value: t, selected: q?.type === t }, TYPE_LABEL[t]))) as HTMLSelectElement;
    const topic = h('input', { class: 'in', value: q?.topic ?? '', maxlength: 200 }) as HTMLInputElement;
    const prompt = h('textarea', { class: 'in', maxlength: 500 }, q?.prompt ?? '') as HTMLTextAreaElement;
    const points = h('input', { class: 'in', type: 'number', min: '10', max: '1000', step: '10', value: String(q?.points ?? 100) }) as HTMLInputElement;
    const difficulty = h('select', { class: 'in' }, ...['mudah', 'sedang', 'sulit'].map((d) => h('option', { value: d, selected: (q?.difficulty ?? 'sedang') === d }, d))) as HTMLSelectElement;
    const explanation = h('textarea', { class: 'in', maxlength: 1000, style: 'min-height:70px' }, q?.explanation ?? '') as HTMLTextAreaElement;
    let image: string | null = q?.image ?? null;
    const imgPrev = h('div', { class: 'row', style: 'gap:8px;align-items:center' });
    const imgFile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'in', 'data-field': 'image' }) as HTMLInputElement;
    const showImg = (): void =>
      imgPrev.replaceChildren(
        ...(image
          ? [h('img', { src: image, alt: 'Gambar soal', style: 'max-height:120px;max-width:220px;border-radius:10px;border:1px solid #dbe7f5' }), btn('Hapus gambar', 'putih kecil', () => {
              image = null;
              showImg();
            })]
          : [h('span', { class: 'muted' }, 'Tanpa gambar')]),
      );
    imgFile.addEventListener('change', async () => {
      const f = imgFile.files?.[0];
      if (!f) return;
      try {
        image = await shrinkImage(f);
        showImg();
      } catch {
        toast('Gambar tidak dapat dipakai (terlalu besar atau rusak)', true);
      }
    });
    showImg();
    // isian per tipe
    const opts = h('textarea', { class: 'in', placeholder: 'Satu opsi per baris (2–5 opsi)' }, q?.type === 'pg' ? q.options.join('\n') : '') as HTMLTextAreaElement;
    const pgKey = h('input', { class: 'in', type: 'number', min: '1', max: '5', value: q?.key.type === 'pg' ? String(q.key.index + 1) : '1' }) as HTMLInputElement;
    const bsKey = h('select', { class: 'in' }, h('option', { value: '1', selected: q?.key.type === 'bs' && q.key.value }, 'Benar'), h('option', { value: '0', selected: q?.key.type === 'bs' && !q.key.value }, 'Salah')) as HTMLSelectElement;
    const isianKey = h('input', { class: 'in', placeholder: 'Jawaban diterima, pisahkan dengan ;  mis. 12; dua belas', value: q?.key.type === 'isian' ? q.key.accepted.join('; ') : '' }) as HTMLInputElement;
    const pairs = h('textarea', { class: 'in', placeholder: 'Satu pasangan per baris: kiri = kanan (2–5 pasangan)' }, q?.type === 'jodoh' && q.key.type === 'jodoh' ? q.options.map((l, i) => `${l} = ${q.right[(q.key as { pairs: number[] }).pairs[i]!] ?? ''}`).join('\n') : '') as HTMLTextAreaElement;
    const per = {
      pg: h('div', { class: 'col' }, h('label', { class: 'f' }, 'Opsi jawaban', opts), h('label', { class: 'f' }, 'Nomor opsi yang benar', pgKey)),
      bs: h('label', { class: 'f' }, 'Kunci', bsKey),
      isian: h('label', { class: 'f' }, 'Jawaban yang diterima', isianKey),
      jodoh: h('label', { class: 'f' }, 'Pasangan', pairs),
    };
    const perWrap = h('div');
    const showPer = () => perWrap.replaceChildren(per[type.value as QuestionType]);
    type.addEventListener('change', showPer);
    showPer();

    const collect = (): QIn => {
      const t = type.value as QuestionType;
      let options: string[] = [];
      let right: string[] = [];
      let key: AnswerKey;
      if (t === 'pg') {
        options = opts.value.split('\n').map((s) => s.trim()).filter(Boolean);
        key = { type: 'pg', index: Number(pgKey.value) - 1 };
      } else if (t === 'bs') key = { type: 'bs', value: bsKey.value === '1' };
      else if (t === 'isian') key = { type: 'isian', accepted: isianKey.value.split(';').map((s) => s.trim()).filter(Boolean) };
      else {
        const rows = pairs.value.split('\n').map((s) => s.split('=').map((x) => x.trim())).filter((r) => r.length === 2 && r[0] && r[1]);
        options = rows.map((r) => r[0]!);
        right = rows.map((r) => r[1]!);
        key = { type: 'jodoh', pairs: rows.map((_, i) => i) };
      }
      return { subject: subject.value, grade: Number(grade.value), phase: Number(grade.value) <= 2 ? 'A' : Number(grade.value) <= 4 ? 'B' : 'C', topic: topic.value.trim(), learningOutcome: q?.learningOutcome ?? '', type: t, prompt: prompt.value.trim(), options, right, key, explanation: explanation.value.trim(), difficulty: difficulty.value as Q['difficulty'], points: Number(points.value), world: q?.world ?? 'semua', image };
    };
    const m = modal(
      h(
        'div',
        { class: 'card col' },
        h('h2', null, q ? 'Ubah Soal' : 'Tambah Soal'),
        h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px' }, h('label', { class: 'f' }, 'Mata pelajaran', subject), h('label', { class: 'f' }, 'Kelas', grade), h('label', { class: 'f' }, 'Tipe soal', type), h('label', { class: 'f' }, 'Topik', topic), h('label', { class: 'f' }, 'Poin', points), h('label', { class: 'f' }, 'Tingkat kesulitan', difficulty)),
        h('label', { class: 'f' }, 'Pertanyaan', prompt),
        h('label', { class: 'f' }, 'Gambar (opsional, otomatis diperkecil)', imgFile, imgPrev),
        perWrap,
        h('label', { class: 'f' }, 'Pembahasan (ditampilkan setelah menjawab)', explanation),
        err,
        h(
          'div',
          { class: 'row' },
          q
            ? btn('Hapus', 'merah', async () => {
                if (!confirm('Hapus soal ini?')) return;
                await api('/questions/delete', { method: 'POST', json: { ids: [q.id] } });
                m.close();
                toast('Soal dihapus');
                await refresh();
              })
            : null,
          h('div', { class: 'grow' }),
          btn('Batal', 'putih', () => m.close()),
          btn('Simpan', 'hijau', async () => {
            const body = collect();
            const errors = validateQuestion(body);
            if (errors.length) return void (err.textContent = errors.join(' · '));
            await api(q ? `/questions/${q.id}` : '/questions', { method: q ? 'PUT' : 'POST', json: body });
            m.close();
            toast('Soal disimpan');
            await refresh();
          }),
        ),
      ),
    );
  }

  // ---------- impor Word/Excel ----------
  function importer() {
    const file = h('input', { type: 'file', accept: '.xlsx,.docx', class: 'in' }) as HTMLInputElement;
    const out = h('div', { class: 'col' });
    const m = modal(
      h(
        'div',
        { class: 'card col' },
        h('h2', null, 'Impor Soal dari Word / Excel'),
        h('p', { class: 'muted', style: 'margin:0' }, 'Gunakan templat resmi agar kolom terbaca benar. Server memeriksa setiap baris (kunci, opsi, poin, duplikat) sebelum disimpan.'),
        h('div', { class: 'row' }, btn('Unduh templat Excel', 'putih kecil', () => download('/questions/template.xlsx', 'templat-soal-eduverse.xlsx')), btn('Unduh templat Word', 'putih kecil', () => download('/questions/template.docx', 'templat-soal-eduverse.docx'))),
        file,
        btn('Periksa File', 'biru', async () => {
          const f = file.files?.[0];
          if (!f) return toast('Pilih file .xlsx atau .docx dulu', true);
          const fd = new FormData();
          fd.append('file', f);
          const r = await api<{ filename: string; total: number; valid: number; duplicates: number; rows: { row: number; question: QIn; errors: string[]; duplicate: boolean }[] }>('/questions/import/preview', { method: 'POST', body: fd });
          const dupMode = h(
            'select',
            { class: 'in', style: 'max-width:420px', 'data-field': 'duplicateMode' },
            h('option', { value: 'lewati' }, 'Lewati soal duplikat (soal lama tidak berubah)'),
            h('option', { value: 'perbarui' }, 'Perbarui soal lama dengan isi dari file (kunci, pembahasan, poin, …)'),
            h('option', { value: 'tambah' }, 'Tetap simpan sebagai soal baru'),
          ) as HTMLSelectElement;
          const progress = h('div', { class: 'muted', style: 'font-weight:800' });
          const good = r.rows.filter((x) => !x.errors.length);
          out.replaceChildren(
            h('div', { class: 'row' }, h('span', { class: 'chip biru' }, `${r.total} baris`), h('span', { class: 'chip hijau' }, `${r.valid} valid`), h('span', { class: 'chip oranye' }, `${r.duplicates} duplikat`), h('span', { class: 'chip abu' }, `${r.total - r.valid} bermasalah`)),
            h(
              'div',
              { class: 'tablewrap', style: 'max-height:340px;overflow:auto' },
              h(
                'table',
                null,
                h('thead', null, h('tr', null, ...['Baris', 'Soal', 'Tipe', 'Kunci', 'Catatan'].map((t) => h('th', null, t)))),
                h('tbody', null, ...r.rows.map((x) => h('tr', { class: `preview-row${x.errors.length ? ' bad' : x.duplicate ? ' dup' : ''}` }, h('td', null, String(x.row)), h('td', null, x.question.prompt), h('td', null, TYPE_LABEL[x.question.type] ?? x.question.type), h('td', null, x.errors.length ? '—' : keyText(x.question)), h('td', null, x.errors.length ? h('span', { class: 'err' }, x.errors.join(' · ')) : x.duplicate ? 'Duplikat' : 'OK')))),
              ),
            ),
            h('label', { class: 'f' }, 'Soal duplikat', dupMode),
            progress,
            btn(`Simpan ${good.length} soal valid ke bank`, 'hijau', async () => {
              if (!good.length) return toast('Tidak ada soal valid untuk disimpan', true);
              // dikirim per 500 soal: jumlah soal dalam satu file tidak dibatasi; baris bermasalah tidak ikut & soal lama aman
              const total = { inserted: 0, updated: 0, skipped: 0 };
              const qs = good.map((x) => x.question);
              for (let i = 0; i < qs.length; ) {
                // maks 500 soal atau ±8 MB per kiriman (soal bergambar lebih besar)
                let j = i;
                let bytes = 0;
                while (j < qs.length && j - i < 500 && (j === i || bytes + JSON.stringify(qs[j]).length < 8_000_000)) bytes += JSON.stringify(qs[j++]).length;
                progress.textContent = `Menyimpan ${j}/${qs.length}…`;
                const res = await api<{ inserted: number; updated?: number; skipped: number }>('/questions/import/commit', { method: 'POST', json: { filename: r.filename, questions: qs.slice(i, j), duplicateMode: dupMode.value } });
                i = j;
                total.inserted += res.inserted;
                total.updated += res.updated ?? 0;
                total.skipped += res.skipped;
              }
              toast(`${total.inserted} soal baru, ${total.updated} diperbarui, ${total.skipped} dilewati · ${r.total - good.length} baris bermasalah tidak diimpor`);
              m.close();
              await refresh();
            }),
          );
        }),
        out,
        btn('Tutup', 'putih', () => m.close()),
      ),
    );
  }

  // ---------- filter ----------
  const search = h('input', { class: 'in', placeholder: 'Cari pertanyaan atau topik…', style: 'max-width:320px' }) as HTMLInputElement;
  let deb = 0;
  search.addEventListener('input', () => {
    clearTimeout(deb);
    deb = window.setTimeout(() => {
      state.search = search.value.trim();
      state.page = 1;
      void load();
    }, 300);
  });
  const sel = (key: 'subject' | 'grade' | 'type' | 'source' | 'difficulty', first: string, opts: [string, string][]) => {
    const s = h('select', { class: 'in', style: 'max-width:220px' }, h('option', { value: '' }, first), ...opts.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
    s.addEventListener('change', () => {
      state[key] = s.value;
      state.page = 1;
      void load();
    });
    return s;
  };

  await refresh();
  return h(
    'main',
    null,
    h(
      'div',
      { class: 'row' },
      h('h1', { class: 'grow' }, 'Bank Soal'),
      btn('+ Tambah Soal', 'hijau', () => editor()),
      btn('Impor Word/Excel', 'biru', () => importer()),
      btn('Muat Soal Bawaan', 'kuning', async () => {
        const r = await api<{ inserted?: number }>('/questions/sample', { method: 'POST' });
        toast(`Soal bawaan EDUVERSE dimuat${r.inserted !== undefined ? ` (${r.inserted})` : ''} — hanya dipakai bila sesi memilih sumber "Soal Bawaan" atau "Gabungan"`);
        await refresh();
      }),
      btn('Hapus Soal Bawaan', 'putih', async () => {
        if (!confirm('Hapus semua soal bawaan EDUVERSE dari bank Anda? Soal buatan Anda tidak terhapus, dan hasil sesi lama tetap utuh.')) return;
        const r = await api<{ deleted: number }>('/questions/delete-bawaan', { method: 'POST' });
        toast(`${r.deleted} soal bawaan dihapus`);
        await refresh();
      }),
    ),
    statsEl,
    h(
      'div',
      { class: 'card col' },
      h(
        'div',
        { class: 'row' },
        search,
        sel('subject', 'Semua mapel', SUBJECTS.map((s) => [s, s])),
        sel('grade', 'Semua kelas', [1, 2, 3, 4, 5, 6].map((g) => [String(g), `Kelas ${g}`])),
        sel('type', 'Semua tipe', Object.entries(TYPE_LABEL)),
        sel('source', 'Semua asal', [['guru', 'Soal guru'], ['bawaan', 'Soal bawaan']]),
        sel('difficulty', 'Semua kesulitan', [['mudah', 'Mudah'], ['sedang', 'Sedang'], ['sulit', 'Sulit']]),
        h('div', { class: 'grow' }),
        btn('Hapus Terpilih', 'merah kecil', async () => {
          if (!selected.size) return toast('Belum ada soal terpilih', true);
          if (!confirm(`Hapus ${selected.size} soal?`)) return;
          await api('/questions/delete', { method: 'POST', json: { ids: [...selected] } });
          selected.clear();
          toast('Soal dihapus');
          await refresh();
        }),
      ),
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ...['', 'Pertanyaan', 'Mapel / Topik', 'Kelas', 'Tipe', 'Poin', ''].map((t) => h('th', null, t)))), tbody)),
      pager,
    ),
  );
}
