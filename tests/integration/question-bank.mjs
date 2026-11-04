/**
 * Uji Bank Soal Guru terhadap server sungguhan (REST + Socket.IO + PostgreSQL):
 * sumber soal (Hanya Guru / Bawaan / Gabungan), tidak ada soal contoh diam-diam, tambah/ubah/hapus, gambar,
 * impor Excel & Word (pratinjau, galat per baris, duplikat lewati/perbarui), pilih soal tertentu / acak / kesulitan,
 * soal guru benar-benar muncul di dunia game (dinilai server, kunci tidak bocor), riwayat sesi tetap utuh setelah soal diedit.
 *   BASE_URL=http://localhost:3000 TEACHER_REGISTRATION_CODE=kode-ci node tests/integration/question-bank.mjs
 */
import { io } from 'socket.io-client';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CODE = process.env.TEACHER_REGISTRATION_CODE ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function check(name, fn) {
  try {
    const note = await fn();
    results.push({ ok: true });
    console.log(`  ✔ ${name}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    results.push({ ok: false });
    console.log(`  ✘ ${name}: ${e.message}`);
  }
}
const expect = (c, m) => {
  if (!c) throw new Error(m);
};
let token = '';
async function http(path, { method = 'GET', body, form } = {}) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(form ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const emit = (s, ev, data, t = 8000) => new Promise((res) => s.timeout(t).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'timeout' } : r)));
const upload = async (name, buf) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  return http('/questions/import/preview', { method: 'POST', form: fd });
};
// gambar PNG 1×1 (valid) sebagai gambar soal
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pg = (prompt, opts, idx, extra = {}) => ({ subject: 'Matematika', grade: 5, phase: 'C', topic: 'Pecahan', learningOutcome: '', type: 'pg', prompt, options: opts, right: [], key: { type: 'pg', index: idx }, explanation: 'Pembahasan awal', difficulty: 'sedang', points: 100, world: 'semua', ...extra });

try {
  console.log(`EDUVERSE uji Bank Soal Guru → ${BASE}`);
  const email = `guru-bank-${Date.now()}@sekolah.id`;
  const reg = await http('/auth/register', { method: 'POST', body: { email, password: 'bank-pass-123', name: 'Bu Bank', registrationCode: CODE || undefined } });
  expect(reg.status === 200, `daftar guru: ${reg.status} ${JSON.stringify(reg.body)}`);
  const login = await http('/auth/login', { method: 'POST', body: { email, password: 'bank-pass-123' } });
  token = login.body.token;

  await check('Bank kosong + sumber bawaan "Hanya Soal Guru" → sesi ditolak dengan pesan jelas (tidak diam-diam memakai soal contoh)', async () => {
    const r = await http('/sessions', { method: 'POST', body: { title: 'Kosong', className: '5A', settings: {} } });
    expect(r.status === 400 && /Bank soal untuk pilihan ini kosong/.test(r.body.error) && /Hanya Soal Guru/.test(r.body.error), JSON.stringify(r));
    return r.body.error;
  });
  await check('Muat soal bawaan → tercatat terpisah sebagai "bawaan"; sesi "Hanya Soal Guru" tetap ditolak', async () => {
    const s = await http('/questions/sample', { method: 'POST' });
    expect(s.body.inserted > 0, JSON.stringify(s.body));
    const st = await http('/questions/stats');
    expect(st.body.bySource.bawaan === s.body.inserted && st.body.bySource.guru === 0, JSON.stringify(st.body.bySource));
    const r = await http('/sessions', { method: 'POST', body: { title: 'Guru', className: '5A', settings: { questionSource: 'guru' } } });
    expect(r.status === 400, `status ${r.status}`);
    const ok = await http('/questions/pool-count', { method: 'POST', body: { settings: { questionSource: 'bawaan' } } });
    expect(ok.body.total === s.body.inserted, JSON.stringify(ok.body));
    return `bawaan ${st.body.bySource.bawaan}, guru 0`;
  });

  const ids = {};
  await check('Tambah, ubah, hapus soal manual (dengan gambar & pembahasan)', async () => {
    const a = await http('/questions', { method: 'POST', body: pg('Raka punya 3/4 kue, dimakan 1/4. Sisa kue Raka …', ['1/2', '1/4', '3/8', '1'], 0, { image: PNG }) });
    expect(a.status === 200 && a.body.id, JSON.stringify(a.body));
    ids.img = a.body.id;
    const b = await http('/questions', { method: 'POST', body: { ...pg('', [], 0), type: 'isian', prompt: 'Ibu kota Indonesia adalah …', options: [], key: { type: 'isian', accepted: ['Jakarta', 'Nusantara'] }, subject: 'IPAS', difficulty: 'mudah' } });
    expect(b.status === 200, JSON.stringify(b.body));
    ids.isian = b.body.id;
    const c = await http('/questions', { method: 'POST', body: pg('Soal yang akan dihapus', ['A', 'B'], 1) });
    const bad = await http('/questions', { method: 'POST', body: { ...pg('Gambar palsu', ['A', 'B'], 0), image: 'data:text/html;base64,PHNjcmlwdD4=' } });
    expect(bad.status === 400, `gambar palsu diterima: ${bad.status}`);
    const u = await http(`/questions/${ids.img}`, { method: 'PUT', body: pg('Raka punya 3/4 kue, dimakan 1/4. Sisa kue Raka …', ['1/2', '1/4', '3/8', '1'], 0, { image: PNG, explanation: 'Pembahasan diperbarui', difficulty: 'sulit' }) });
    expect(u.status === 200, JSON.stringify(u.body));
    const g = await http(`/questions/${ids.img}`);
    expect(g.body.explanation === 'Pembahasan diperbarui' && g.body.image === PNG && g.body.difficulty === 'sulit', JSON.stringify(g.body).slice(0, 200));
    const d = await http('/questions/delete', { method: 'POST', body: { ids: [c.body.id] } });
    expect(d.body.deleted === 1, JSON.stringify(d.body));
    return 'gambar disimpan, gambar non-gambar ditolak, edit & hapus berhasil';
  });

  await check('Impor Excel: pratinjau, galat per baris, simpan bertahap; soal lama tetap utuh', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Soal');
    ws.addRow(['kelas', 'fase', 'mapel', 'materi', 'capaian', 'tipe', 'soal', 'opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e', 'kunci', 'pembahasan', 'kesulitan', 'poin', 'dunia']);
    for (let i = 1; i <= 30; i++) ws.addRow([4, 'B', 'Matematika', 'Perkalian', '', 'pilihan ganda', `Hasil ${i} × 3 adalah …`, String(i * 3), String(i * 3 + 1), String(i * 3 + 2), String(i * 3 + 5), '', 'A', `${i} × 3 = ${i * 3}`, i % 3 === 0 ? 'sulit' : 'mudah', 100, 'semua']);
    ws.addRow([4, 'B', 'Matematika', 'Perkalian', '', 'pilihan ganda', 'Soal rusak tanpa kunci', '1', '2', '', '', '', '', '', 'mudah', 100, 'semua']);
    ws.addRow([9, 'B', 'Matematika', 'Perkalian', '', 'pilihan ganda', 'Kelas tidak valid', '1', '2', '', '', '', 'A', '', 'mudah', 100, 'semua']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const p = await upload('soal-guru.xlsx', buf);
    expect(p.status === 200 && p.body.total === 32 && p.body.valid === 30, JSON.stringify({ total: p.body?.total, valid: p.body?.valid }));
    const bad = p.body.rows.filter((r) => r.errors.length);
    expect(bad.length === 2 && bad.every((r) => r.row > 30), JSON.stringify(bad.map((r) => [r.row, r.errors])));
    const good = p.body.rows.filter((r) => !r.errors.length).map((r) => r.question);
    let inserted = 0;
    for (let i = 0; i < good.length; i += 20) inserted += (await http('/questions/import/commit', { method: 'POST', body: { filename: 'soal-guru.xlsx', questions: good.slice(i, i + 20), duplicateMode: 'lewati' } })).body.inserted;
    expect(inserted === 30, `tersimpan ${inserted}`);
    const still = await http(`/questions/${ids.isian}`);
    expect(still.status === 200, 'soal lama hilang');
    return `30 valid tersimpan (2 tahap), 2 baris bermasalah ditandai: ${bad.map((r) => `baris ${r.row + 0}: ${r.errors[0]}`).join(' · ')}`;
  });

  await check('Impor ulang: duplikat terdeteksi; "lewati" tidak mengubah, "perbarui" memperbarui pembahasan', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Soal');
    ws.addRow(['kelas', 'fase', 'mapel', 'materi', 'capaian', 'tipe', 'soal', 'opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e', 'kunci', 'pembahasan', 'kesulitan', 'poin', 'dunia']);
    for (let i = 1; i <= 3; i++) ws.addRow([4, 'B', 'Matematika', 'Perkalian', '', 'pilihan ganda', `Hasil ${i} × 3 adalah …`, String(i * 3), String(i * 3 + 1), String(i * 3 + 2), String(i * 3 + 5), '', 'A', `PEMBAHASAN BARU ${i}`, 'mudah', 150, 'semua']);
    const p = await upload('ulang.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(p.body.duplicates === 3, `duplikat ${p.body.duplicates}`);
    const qs = p.body.rows.map((r) => r.question);
    const skip = await http('/questions/import/commit', { method: 'POST', body: { filename: 'ulang.xlsx', questions: qs, duplicateMode: 'lewati' } });
    expect(skip.body.inserted === 0 && skip.body.skipped === 3, JSON.stringify(skip.body));
    const upd = await http('/questions/import/commit', { method: 'POST', body: { filename: 'ulang.xlsx', questions: qs, duplicateMode: 'perbarui' } });
    expect(upd.body.updated === 3 && upd.body.inserted === 0, JSON.stringify(upd.body));
    const l = await http(`/questions?search=${encodeURIComponent('Hasil 2 × 3')}`);
    expect(l.body.items[0]?.explanation === 'PEMBAHASAN BARU 2' && l.body.items[0]?.points === 150, JSON.stringify(l.body.items[0]));
    return 'lewati: 3 dilewati · perbarui: 3 diperbarui';
  });

  await check('Impor Word (.docx): blok "Soal:" terbaca, termasuk isian & benar/salah', async () => {
    const text = [
      'Soal: Planet terdekat dengan Matahari adalah …\nA. Bumi\nB. Merkurius\nC. Mars\nD. Venus\nKunci: B\nMapel: IPAS\nKelas: 6\nMateri: Tata Surya\nPembahasan: Merkurius paling dekat.',
      'Soal: Bumi berbentuk datar.\nTipe: Benar/Salah\nKunci: Salah\nMapel: IPAS\nKelas: 6',
      'Soal: Hewan pemakan tumbuhan disebut …\nTipe: Isian singkat\nKunci: herbivora; herbivor\nMapel: IPAS\nKelas: 5',
    ].join('\n\n');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const paras = text.split('\n').map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`);
    const p = await upload('soal-guru.docx', await zip.generateAsync({ type: 'nodebuffer' }));
    expect(p.status === 200 && p.body.valid === 3, JSON.stringify(p.body?.rows?.map((r) => r.errors)));
    const c = await http('/questions/import/commit', { method: 'POST', body: { filename: 'soal-guru.docx', questions: p.body.rows.map((r) => r.question), duplicateMode: 'lewati' } });
    expect(c.body.inserted === 3, JSON.stringify(c.body));
    return `tipe: ${p.body.rows.map((r) => r.question.type).join(', ')}`;
  });

  await check('Saringan sesi: sumber, mapel, kesulitan, soal terpilih, acak N', async () => {
    const all = (await http('/questions/pool-count', { method: 'POST', body: { settings: { questionSource: 'guru' } } })).body.total;
    const gab = (await http('/questions/pool-count', { method: 'POST', body: { settings: { questionSource: 'gabungan' } } })).body.total;
    const sulit = (await http('/questions/pool-count', { method: 'POST', body: { settings: { questionSource: 'guru', difficulties: ['sulit'] } } })).body.total;
    const ipas = (await http('/questions/pool-count', { method: 'POST', body: { settings: { questionSource: 'guru', subjects: ['IPAS'] } } })).body.total;
    expect(all === 35 && gab > all && sulit === 10 && ipas === 4, JSON.stringify({ all, gab, sulit, ipas }));
    const rnd = await http('/sessions', { method: 'POST', body: { title: 'Acak', className: '5A', settings: { questionSource: 'guru', randomCount: 5 } } });
    expect(rnd.status === 200 && rnd.body.questionCount === 5, JSON.stringify(rnd.body));
    return `guru ${all}, gabungan ${gab}, sulit ${sulit}, IPAS ${ipas}, acak 5 → ${rnd.body.questionCount}`;
  });

  await check('Sesi "Hanya Soal Guru" dengan soal terpilih: siswa mendapat soal guru (bergambar) di dunia game, kunci tidak bocor, dinilai server', async () => {
    const sess = await http('/sessions', { method: 'POST', body: { title: 'Soal Guru', className: '5A', settings: { questionSource: 'guru', requireApproval: false, secondChance: false }, questionIds: [ids.img] } });
    expect(sess.status === 200 && sess.body.questionCount === 1, JSON.stringify(sess.body));
    ids.session = sess.body.id;
    await http(`/sessions/${sess.body.id}/start`, { method: 'POST' });
    for (let i = 0; i < 40 && (await http(`/sessions/${sess.body.id}`)).body.live.state.status !== 'berjalan'; i++) await sleep(250);
    const s = io(`${BASE}/play`, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((r) => s.once('connect', r));
    expect((await emit(s, 'join', { code: sess.body.code })).ok, 'join');
    expect((await emit(s, 'identity:claim', { absen: 4, nama: 'Ani' })).ok, 'claim');
    const e = await emit(s, 'world:enter', { scene: 'kota' });
    expect(e.ok, e.error);
    // pedagang (misi) terdekat dari spawn: Mas Joko V03 → berjalan wajar ke sana
    const target = e.points.find((p) => p.id === 'V03');
    let pos = { ...e.spawn };
    for (;;) {
      const dx = target.x - pos.x;
      const dz = target.z + 1.5 - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) break;
      const st = Math.min(d, 0.5);
      pos = { ...pos, x: pos.x + (dx / d) * st, z: pos.z + (dz / d) * st };
      s.volatile.emit('player:state', { scene: 'kota', x: pos.x, y: pos.y, z: pos.z, ry: 0, anim: 1, riding: false });
      await sleep(100);
    }
    await sleep(200);
    const q = await emit(s, 'point:interact', { pointId: 'V03' });
    expect(q.ok, q.error);
    expect(q.question.prompt.startsWith('Raka punya 3/4 kue') && q.question.image === PNG, JSON.stringify(q.question).slice(0, 160));
    const leak = JSON.stringify(q.question);
    expect(!/"key"|answer_key|accepted|"index"/.test(leak), `kunci bocor: ${leak.slice(0, 200)}`);
    const correctIdx = q.question.options.indexOf('1/2');
    const a = await emit(s, 'answer:submit', { token: q.question.token, answer: { type: 'pg', index: correctIdx } });
    expect(a.ok && a.result.correct && a.result.totalScore > 0, JSON.stringify(a));
    s.disconnect();
    return `soal dari misi pedagang Mas Joko: "${q.question.prompt.slice(0, 40)}…" + gambar · skor ${a.result.totalScore}`;
  });

  await check('Guru mengedit/menghapus soal setelah dipakai → riwayat & ekspor sesi lama tetap memakai soal aslinya', async () => {
    await http(`/questions/${ids.img}`, { method: 'PUT', body: pg('TEKS SUDAH DIGANTI', ['x', 'y'], 0) });
    const r1 = await http(`/sessions/${ids.session}/results`);
    const txt = JSON.stringify(r1.body);
    expect(r1.status === 200 && txt.includes('Raka punya 3/4 kue') && !txt.includes('TEKS SUDAH DIGANTI'), txt.slice(0, 300));
    await http('/questions/delete', { method: 'POST', body: { ids: [ids.img] } });
    const r2 = JSON.stringify((await http(`/sessions/${ids.session}/results`)).body);
    expect(r2.includes('Raka punya 3/4 kue'), 'riwayat hilang setelah soal dihapus');
    return 'cuplikan soal pada jawaban dipakai';
  });

  await check('Hapus semua soal bawaan → soal guru tidak tersentuh', async () => {
    const before = (await http('/questions/stats')).body.bySource;
    const d = await http('/questions/delete-bawaan', { method: 'POST' });
    const after = (await http('/questions/stats')).body.bySource;
    expect(d.body.deleted === before.bawaan && after.bawaan === 0 && after.guru === before.guru, JSON.stringify({ before, after }));
    return `${d.body.deleted} soal bawaan dihapus · soal guru tetap ${after.guru}`;
  });

  await check('Bank soal dilindungi login: tanpa token → 401', async () => {
    const t = token;
    token = '';
    const r = await http('/questions');
    token = t;
    expect(r.status === 401, `status ${r.status}`);
  });
} catch (e) {
  results.push({ ok: false });
  console.log(`  ✘ persiapan: ${e.message}`);
} finally {
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${bad ? 'GAGAL' : 'LULUS'} ${results.length - bad}/${results.length} pemeriksaan Bank Soal Guru`);
  process.exitCode = bad ? 1 : 0;
}
