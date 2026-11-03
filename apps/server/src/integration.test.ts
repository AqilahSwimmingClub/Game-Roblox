/**
 * Uji integrasi end-to-end server: PostgreSQL sungguhan + Socket.IO sungguhan.
 * Jalankan dengan DATABASE_URL yang menunjuk ke database KOSONG khusus uji, mis.:
 *   DATABASE_URL=postgres://eduverse:eduverse@localhost:5432/eduverse_test npm test -w @eduverse/server
 * Tanpa DATABASE_URL uji ini dilewati (bukan dianggap lulus).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import ExcelJS from 'exceljs';

const DB = process.env.DATABASE_URL;
const run = DB && /test/.test(DB) ? describe : describe.skip;

type Ack = { ok: boolean; error?: string; [k: string]: unknown };

run('server EDUVERSE (Postgres + Socket.IO)', () => {
  let base = '';
  let cookie = '';
  let close: () => Promise<void>;
  let pool: import('pg').Pool;
  const sockets: Socket[] = [];

  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(base + '/api' + path, {
      ...init,
      headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) },
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0]!;
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) } as { status: number; body: any };
  };

  const emit = (s: Socket, ev: string, data?: unknown) => new Promise<Ack>((r) => s.emit(ev, data, r));
  const waitFor = <T = any>(s: Socket, ev: string, pred: (d: T) => boolean = () => true, ms = 8000) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout menunggu ${ev}`)), ms);
      const h = (d: T) => {
        if (pred(d)) {
          clearTimeout(t);
          s.off(ev, h);
          resolve(d);
        }
      };
      s.on(ev, h);
    });

  beforeAll(async () => {
    const pg = await import('pg');
    pool = new pg.default.Pool({ connectionString: DB });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const { migrate } = await import('./db/migrate.js');
    await migrate();
    const { createApp } = await import('./app.js');
    const h = await createApp();
    await new Promise<void>((r) => h.server.listen(0, r));
    base = `http://127.0.0.1:${(h.server.address() as AddressInfo).port}`;
    close = async () => {
      await h.close();
      h.server.close();
    };
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await close?.();
    await pool?.end();
    const { pool: appPool } = await import('./db/pool.js');
    await appPool.end();
  });

  let sessionId = '';
  let code = '';

  it('guru mendaftar, login wajib untuk API', async () => {
    expect((await api('/sessions')).status).toBe(401);
    const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email: 'guru@sekolah.sch.id', name: 'Bu Rina', password: 'rahasia123' }) });
    expect(r.status).toBe(200);
    // guru kedua tanpa kode pendaftaran ditolak
    const saved = cookie;
    const r2 = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email: 'lain@x.id', name: 'Lain', password: 'rahasia123' }) });
    expect(r2.status).toBe(403);
    cookie = '';
    expect((await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'guru@sekolah.sch.id', password: 'salah-sandi' }) })).status).toBe(401);
    expect((await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'guru@sekolah.sch.id', password: 'rahasia123' }) })).status).toBe(200);
    expect(cookie.startsWith('edu_token=')).toBe(true);
    expect(saved).not.toBe('');
  });

  it('bank soal: contoh soal, CRUD, pencarian, duplikat', async () => {
    const s = await api('/questions/sample', { method: 'POST' });
    expect(s.body.inserted).toBe(44);
    expect((await api('/questions/sample', { method: 'POST' })).body.inserted).toBe(0); // tidak duplikat
    const list = await api('/questions?search=pecahan&pageSize=5');
    expect(list.body.total).toBeGreaterThan(0);
    expect(list.body.items.length).toBeLessThanOrEqual(5);
    const bad = await api('/questions', { method: 'POST', body: JSON.stringify({ subject: 'Matematika', grade: 5, type: 'pg', prompt: 'x', options: ['a', 'a'], key: { type: 'pg', index: 3 }, points: 100 }) });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toContain('Ada opsi kembar');
    const ok = await api('/questions', {
      method: 'POST',
      body: JSON.stringify({ subject: 'Matematika', grade: 5, type: 'isian', prompt: 'Hasil 9 × 9 = …', key: { type: 'isian', accepted: ['81'] }, points: 100 }),
    });
    expect(ok.status).toBe(200);
    const del = await api('/questions/delete', { method: 'POST', body: JSON.stringify({ ids: [ok.body.id] }) });
    expect(del.body.deleted).toBe(1);
  });

  it('impor Excel & Word: template → pratinjau → validasi → simpan', async () => {
    const tpl = await api('/questions/template.xlsx');
    expect(tpl.status).toBe(200);
    // ubah template: tambah satu baris rusak
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    wb.worksheets[0]!.addRow([5, 'C', 'Matematika', 'x', '', 'PG', 'Soal rusak', 'a', 'b', '', '', '', 'Z', '', 'mudah', 100, 'semua']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const fd = new FormData();
    fd.append('file', new Blob([buf]), 'soal.xlsx');
    const prev = await fetch(base + '/api/questions/import/preview', { method: 'POST', body: fd, headers: { cookie } }).then((r) => r.json());
    expect(prev.total).toBe(5);
    expect(prev.valid).toBe(4);
    expect(prev.duplicates).toBe(3); // 3 soal template sudah ada di contoh soal
    const commit = await api('/questions/import/commit', {
      method: 'POST',
      body: JSON.stringify({ filename: prev.filename, questions: prev.rows.filter((r: any) => !r.errors.length).map((r: any) => r.question), skipDuplicates: true }),
    });
    expect(commit.body.inserted).toBe(1);

    const dtpl = await api('/questions/template.docx');
    expect(dtpl.status).toBe(200);
    const fd2 = new FormData();
    fd2.append('file', new Blob([dtpl.body]), 'soal.docx');
    const p2 = await fetch(base + '/api/questions/import/preview', { method: 'POST', body: fd2, headers: { cookie } }).then((r) => r.json());
    expect(p2.total).toBe(3);
    expect(p2.valid).toBe(3);
    expect(p2.rows.map((r: any) => r.question.type)).toEqual(['pg', 'bs', 'jodoh']);

    const fake = new FormData();
    fake.append('file', new Blob([Buffer.from('bukan zip')]), 'x.xlsx');
    expect((await fetch(base + '/api/questions/import/preview', { method: 'POST', body: fake, headers: { cookie } })).status).toBe(400);
  });

  it('membuat sesi dengan kode kelas & link', async () => {
    const r = await api('/sessions', { method: 'POST', body: JSON.stringify({ title: 'Petualangan Kota', className: '5A', settings: { durationMinutes: 10, subjects: ['Matematika'] } }) });
    expect(r.status).toBe(200);
    sessionId = r.body.id;
    code = r.body.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(r.body.link).toContain(`?kode=${code}`);
    const pub = await api(`/public/session/${code}`);
    expect(pub.body.title).toBe('Petualangan Kota');
  });

  it('dua siswa: identitas unik, multiplayer, soal & skor divalidasi server, podium', async () => {
    const mk = () => {
      const s = ioc(base + '/play', { transports: ['websocket'], forceNew: true });
      sockets.push(s);
      return s;
    };
    const a = mk();
    const b = mk();
    const ja = await emit(a, 'join', { code });
    expect(ja.ok).toBe(true);
    expect((await emit(b, 'join', { code: 'ZZZZZZ' })).ok).toBe(false);
    await emit(b, 'join', { code });
    const ca = await emit(a, 'identity:claim', { absen: 7, nama: 'Raka' });
    expect(ca.ok).toBe(true);
    const dup = await emit(b, 'identity:claim', { absen: 7, nama: 'Palsu' });
    expect(dup.ok).toBe(false);
    expect(await emit(b, 'identity:claim', { absen: 12, nama: 'raka' })).toMatchObject({ ok: false }); // nama kembar
    const cb = await emit(b, 'identity:claim', { absen: 12, nama: 'Sinta' });
    expect(cb.ok).toBe(true);
    await emit(a, 'avatar:set', { kulit: 1, rambut: 2, baju: 2, topi: 0, aksesori: 2, warna: 4 });

    // Dashboard guru (namespace /teacher) wajib cookie
    const bad = ioc(base + '/teacher', { transports: ['websocket'], forceNew: true });
    sockets.push(bad);
    await new Promise<void>((r) => bad.on('connect_error', () => r()));
    const t = ioc(base + '/teacher', { transports: ['websocket'], forceNew: true, extraHeaders: { cookie } });
    sockets.push(t);
    const watch = await emit(t, 'watch', { sessionId });
    expect(watch.ok).toBe(true);

    // Belum dimulai: masuk dunia ditolak; lobi boleh
    expect((await emit(a, 'world:enter', { scene: 'kota' })).ok).toBe(false);
    const la = await emit(a, 'world:enter', { scene: 'lobi' });
    const lb = await emit(b, 'world:enter', { scene: 'lobi' });
    expect(la.ok && lb.ok).toBe(true);
    // B melihat A di lobi (interest management)
    const snap = await waitFor<any>(b, 'players:snapshot', (d) => d.list.some((p: any) => p.nama === 'Raka'));
    expect(snap.list[0].avatar.warna).toBe(4);

    expect((await api(`/sessions/${sessionId}/start`, { method: 'POST' })).status).toBe(200);
    await waitFor<any>(a, 'session:state', (d) => d.status === 'berjalan', 8000);

    const ea = (await emit(a, 'world:enter', { scene: 'kota' })) as any;
    const eb = (await emit(b, 'world:enter', { scene: 'kota' })) as any;
    expect(ea.ok && eb.ok).toBe(true);
    expect(ea.points.length).toBeGreaterThan(40);

    // anti-cheat: lompatan 300 m ditolak & dikoreksi
    const tp = waitFor<any>(a, 'teleport');
    a.emit('player:state', { scene: 'kota', x: ea.spawn.x + 300, y: 0.2, z: ea.spawn.z, ry: 0, anim: 2, riding: false });
    expect((await tp).reason).toBe('koreksi');

    // berjalan wajar menuju titik soal terdekat (di permukaan tanah)
    const walk = async (s: Socket, from: any, pts: any[]) => {
      const target = pts.filter((p) => p.y < 2).sort((p, q) => Math.hypot(p.x - from.x, p.z - from.z) - Math.hypot(q.x - from.x, q.z - from.z))[0];
      let x = from.x;
      let z = from.z;
      while (Math.hypot(target.x - x, target.z - z) > 2) {
        const d = Math.hypot(target.x - x, target.z - z);
        const step = Math.min(3.5, d - 1.5);
        x += ((target.x - x) / d) * step;
        z += ((target.z - z) / d) * step;
        s.emit('player:state', { scene: 'kota', x, y: target.y, z, ry: 0, anim: 2, riding: false });
        await new Promise((r) => setTimeout(r, 260));
      }
      return target;
    };
    await new Promise((r) => setTimeout(r, 400)); // klien sungguhan menyelaraskan posisi setelah 'teleport'
    const [pa, pb] = await Promise.all([walk(a, ea.spawn, ea.points), walk(b, eb.spawn, eb.points)]);

    // titik jauh ditolak
    const far = ea.points.find((p: any) => Math.hypot(p.x - pa.x, p.z - pa.z) > 50);
    expect((await emit(a, 'point:interact', { pointId: far.id })).ok).toBe(false);

    const qa = (await emit(a, 'point:interact', { pointId: pa.id })) as any;
    expect(qa.error ?? 'ok').toBe('ok');
    expect(JSON.stringify(qa.question)).not.toContain('"key"'); // kunci tidak pernah dikirim
    // jawab benar berdasarkan kunci di DB (simulasi siswa yang tahu jawabannya)
    const row = (await pool.query('SELECT * FROM questions WHERE prompt = $1 LIMIT 1', [qa.question.prompt])).rows[0];
    const correctAnswer = (q: any, pub: any) => {
      const k = q.answer_key;
      if (k.type === 'pg') return { index: pub.options.indexOf(q.options[k.index]) };
      if (k.type === 'bs') return { value: k.value };
      if (k.type === 'isian') return { text: k.accepted[0] };
      return { pairs: k.pairs.map((orig: number) => pub.right.indexOf(q.right_items[orig])) };
    };
    const feed = waitFor<any>(t, 'teacher:answer');
    const ra = (await emit(a, 'answer:submit', { token: qa.question.token, answer: correctAnswer(row, qa.question) })) as any;
    expect(ra.ok).toBe(true);
    expect(ra.result.correct).toBe(true);
    expect(ra.result.totalScore).toBeGreaterThanOrEqual(qa.question.points);
    expect((await feed).nama).toBe('Raka');
    // titik yang sama tidak bisa dijawab ulang
    expect((await emit(a, 'point:interact', { pointId: pa.id })).ok).toBe(false);

    // B menjawab salah dua kali → kesempatan kedua, lalu kunci ditampilkan, 0 poin
    const qb = (await emit(b, 'point:interact', { pointId: pb.id })) as any;
    expect(qb.ok).toBe(true);
    const rowB = (await pool.query('SELECT * FROM questions WHERE prompt = $1 LIMIT 1', [qb.question.prompt])).rows[0];
    const wrong = (q: any, pub: any) => {
      const c = correctAnswer(q, pub) as any;
      if ('index' in c) return { index: (c.index + 1) % pub.options.length };
      if ('value' in c) return { value: !c.value };
      if ('text' in c) return { text: 'jawaban-salah' };
      return { pairs: c.pairs.map((_: number, i: number) => c.pairs[(i + 1) % c.pairs.length]) };
    };
    const w1 = (await emit(b, 'answer:submit', { token: qb.question.token, answer: wrong(rowB, qb.question) })) as any;
    expect(w1.result.correct).toBe(false);
    expect(w1.result.canRetry).toBe(true);
    const w2 = (await emit(b, 'answer:submit', { token: qb.question.token, answer: wrong(rowB, qb.question) })) as any;
    expect(w2.result.canRetry).toBe(false);
    expect(w2.result.correctAnswer).toBeTruthy();
    expect(w2.result.totalScore).toBe(0);
    // token basi ditolak
    expect((await emit(b, 'answer:submit', { token: qb.question.token, answer: wrong(rowB, qb.question) })).ok).toBe(false);

    // leaderboard pusat
    const lb2 = await waitFor<any[]>(a, 'leaderboard', (d) => d.length === 2 && d[0].poin > 0);
    expect(lb2[0].nama).toBe('Raka');

    // dashboard menampilkan data nyata
    const live = await waitFor<any>(t, 'teacher:live', (d) => d.students.some((s: any) => s.nama === 'Raka' && s.poin > 0));
    expect(live.online).toBe(2);
    expect(live.scenes.kota).toBe(2);

    // reconnect dengan token klaim memulihkan identitas & skor
    a.disconnect();
    const a2 = mk();
    const rj = (await emit(a2, 'join', { code, claimToken: ca.token })) as any;
    expect(rj.me.absen).toBe(7);
    expect(rj.me.poin).toBe(ra.result.totalScore);

    // jeda / lanjut / akhiri / podium
    expect((await api(`/sessions/${sessionId}/pause`, { method: 'POST' })).status).toBe(200);
    expect((await emit(b, 'point:interact', { pointId: eb.points[0].id })).ok).toBe(false);
    expect((await api(`/sessions/${sessionId}/resume`, { method: 'POST' })).status).toBe(200);
    const endedB = waitFor<any>(b, 'game:ended');
    expect((await api(`/sessions/${sessionId}/end`, { method: 'POST' })).status).toBe(200);
    const fin = await endedB;
    expect(fin.rank).toBe(2);
    expect(fin.top3[0].nama).toBe('Raka');
    const pod = waitFor<any>(b, 'podium:show');
    expect((await api(`/sessions/${sessionId}/podium`, { method: 'POST' })).status).toBe(200);
    expect((await pod).top3.map((x: any) => x.nama)).toEqual(['Raka', 'Sinta']);
    // setelah selesai tidak bisa klaim identitas baru
    const c = mk();
    await emit(c, 'join', { code });
    expect((await emit(c, 'identity:claim', { absen: 3, nama: 'Telat' })).ok).toBe(false);
  }, 120_000);

  it('rekap, ekspor Excel/PDF, riwayat', async () => {
    const res = await api(`/sessions/${sessionId}/results`);
    expect(res.body.rows[0]).toMatchObject({ rank: 1, nama: 'Raka', benar: 1 });
    expect(res.body.answerCount).toBe(3);
    const x = await api(`/sessions/${sessionId}/export.xlsx`);
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect(wb.getWorksheet('Rekap Nilai')!.getRow(5).getCell(3).value).toBe('Raka');
    const p = await api(`/sessions/${sessionId}/export.pdf`);
    expect(p.body.subarray(0, 4).toString()).toBe('%PDF');
    const hist = await api('/sessions');
    expect(hist.body.items[0]).toMatchObject({ code, status: 'selesai', students: 2, answers: 3 });
  });
});
