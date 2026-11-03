/** Bank soal: cari/saring/halaman, tambah/ubah/hapus, soal contoh, templat & impor Word/Excel (pratinjau → simpan). */
import { SUBJECTS, validateQuestion, type QuestionRecord, type QuestionType, type AnswerKey } from '@eduverse/shared';
import { h, api, btn, toast, modal } from '../lib.js';

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

export async function questionsView(): Promise<HTMLElement> {
  const state = { search: '', subject: '', grade: '', type: '', page: 1, pageSize: 25 };
  const selected = new Set<string>();
  const statsEl = h('div', { class: 'row' });
  const tbody = h('tbody');
  const pager = h('div', { class: 'pager' });

  async function loadStats() {
    const s = await api<{ total: number; bySubject: { subject: string; grade: number; n: number }[]; imports: { filename: string; question_count: number }[] }>('/questions/stats');
    const by = new Map<string, number>();
    for (const r of s.bySubject) by.set(r.subject, (by.get(r.subject) ?? 0) + r.n);
    statsEl.replaceChildren(h('span', { class: 'chip biru' }, `Total ${s.total} soal`), ...[...by].map(([k, n]) => h('span', { class: 'chip abu' }, `${k}: ${n}`)));
  }

  async function load() {
    const qs = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
    if (state.search) qs.set('search', state.search);
    if (state.subject) qs.set('subject', state.subject);
    if (state.grade) qs.set('grade', state.grade);
    if (state.type) qs.set('type', state.type);
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
              h('td', null, h('div', { style: 'font-weight:800' }, q.prompt), h('div', { class: 'muted', style: 'font-size:13px' }, `Kunci: ${keyText(q)}`)),
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
      return { subject: subject.value, grade: Number(grade.value), phase: Number(grade.value) <= 2 ? 'A' : Number(grade.value) <= 4 ? 'B' : 'C', topic: topic.value.trim(), learningOutcome: q?.learningOutcome ?? '', type: t, prompt: prompt.value.trim(), options, right, key, explanation: explanation.value.trim(), difficulty: difficulty.value as Q['difficulty'], points: Number(points.value), world: q?.world ?? 'semua' };
    };
    const m = modal(
      h(
        'div',
        { class: 'card col' },
        h('h2', null, q ? 'Ubah Soal' : 'Tambah Soal'),
        h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px' }, h('label', { class: 'f' }, 'Mata pelajaran', subject), h('label', { class: 'f' }, 'Kelas', grade), h('label', { class: 'f' }, 'Tipe soal', type), h('label', { class: 'f' }, 'Topik', topic), h('label', { class: 'f' }, 'Poin', points), h('label', { class: 'f' }, 'Tingkat kesulitan', difficulty)),
        h('label', { class: 'f' }, 'Pertanyaan', prompt),
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
        h('div', { class: 'row' }, h('a', { class: 'btn putih kecil', href: '/api/questions/template.xlsx' }, 'Unduh templat Excel'), h('a', { class: 'btn putih kecil', href: '/api/questions/template.docx' }, 'Unduh templat Word')),
        file,
        btn('Periksa File', 'biru', async () => {
          const f = file.files?.[0];
          if (!f) return toast('Pilih file .xlsx atau .docx dulu', true);
          const fd = new FormData();
          fd.append('file', f);
          const r = await api<{ filename: string; total: number; valid: number; duplicates: number; rows: { row: number; question: QIn; errors: string[]; duplicate: boolean }[] }>('/questions/import/preview', { method: 'POST', body: fd });
          const skip = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
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
            h('label', { class: 'check' }, skip, 'Lewati soal duplikat'),
            btn(`Simpan ${good.length} soal valid ke bank`, 'hijau', async () => {
              if (!good.length) return toast('Tidak ada soal valid untuk disimpan', true);
              const res = await api<{ inserted: number; skipped: number }>('/questions/import/commit', { method: 'POST', json: { filename: r.filename, questions: good.map((x) => x.question), skipDuplicates: skip.checked } });
              toast(`${res.inserted} soal disimpan, ${res.skipped} dilewati`);
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
  const sel = (key: 'subject' | 'grade' | 'type', first: string, opts: [string, string][]) => {
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
      btn('Muat Soal Contoh', 'kuning', async () => {
        const r = await api<{ inserted?: number }>('/questions/sample', { method: 'POST' });
        toast(`Soal contoh dimuat${r.inserted !== undefined ? ` (${r.inserted})` : ''}`);
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
