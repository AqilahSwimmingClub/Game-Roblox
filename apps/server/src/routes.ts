/** REST API: autentikasi guru, sesi, bank soal, impor/ekspor, endpoint publik. */
import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { DEFAULT_SETTINGS, SUBJECTS, WORLDS, questionFingerprint, type SessionSettings } from '@eduverse/shared';
import { query } from './db/pool.js';
import { config } from './config.js';
import { hashPassword, verifyPassword, signTeacher, setAuthCookie, requireTeacher, teacherOf, COOKIE } from './auth.js';
import * as repo from './questionsRepo.js';
import { parseXlsx, parseDocx, templateXlsx, type PreviewRow } from './importer.js';
import { templateDocx } from './wordTemplate.js';
import { resultsXlsx, resultsPdf, sessionResults } from './exporter.js';
import { SAMPLE_QUESTIONS } from './data/sampleQuestions.js';
import type { RuntimeRegistry } from './game/runtime.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const settingsSchema = z
  .object({
    durationMinutes: z.number().int().min(3).max(120),
    basePoints: z.number().int().min(10).max(1000),
    worlds: z.array(z.enum(['kota', 'hutan', 'laut', 'angkasa'])).min(1),
    subjects: z.array(z.string().max(60)).max(20),
    grade: z.number().int().min(1).max(6).nullable(),
    questionMode: z.enum(['tanpa-batas', 'jumlah']),
    questionCount: z.number().int().min(1).max(500),
    allowRepeat: z.boolean(),
    secondChance: z.boolean(),
    pointMode: z.enum(['personal', 'rebutan', 'daurulang']),
    density: z.number().min(0.2).max(1),
    requireApproval: z.boolean(),
    showLeaderboard: z.boolean(),
  })
  .partial();

const keySchema = z.union([
  z.object({ type: z.literal('pg'), index: z.number().int() }),
  z.object({ type: z.literal('bs'), value: z.boolean() }),
  z.object({ type: z.literal('isian'), accepted: z.array(z.string().max(40)).max(10) }),
  z.object({ type: z.literal('jodoh'), pairs: z.array(z.number().int()).max(5) }),
]);

const questionSchema = z.object({
  subject: z.string().min(1).max(60),
  grade: z.number().int(),
  phase: z.string().max(2).default('C'),
  topic: z.string().max(200).default(''),
  learningOutcome: z.string().max(500).default(''),
  type: z.enum(['pg', 'bs', 'isian', 'jodoh']),
  prompt: z.string().max(500),
  options: z.array(z.string().max(120)).max(5).default([]),
  right: z.array(z.string().max(120)).max(5).default([]),
  key: keySchema,
  explanation: z.string().max(1000).default(''),
  difficulty: z.enum(['mudah', 'sedang', 'sulit']).default('sedang'),
  points: z.number().int(),
  world: z.enum(['semua', 'kota', 'hutan', 'laut', 'angkasa']).default('semua'),
});

const ACTIVE_WORLDS = new Set(WORLDS.filter((w) => w.tersedia).map((w) => w.id));

export function apiRouter(registry: RuntimeRegistry) {
  const r = express.Router();
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi.' } });
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false });
  const publicLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, /\.(xlsx|docx)$/i.test(file.originalname)),
  });

  r.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

  // ───────── Publik (siswa) ─────────
  r.get(
    '/public/session/:code',
    publicLimiter,
    wrap(async (req, res) => {
      const code = String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const s = await query<{ title: string; class_name: string; status: string; settings: Partial<SessionSettings> }>(
        'SELECT title, class_name, status, settings FROM sessions WHERE code = $1',
        [code],
      );
      const row = s.rows[0];
      if (!row) return res.status(404).json({ error: 'Kode kelas tidak ditemukan.' });
      res.json({ code, title: row.title, className: row.class_name, status: row.status, worlds: { ...DEFAULT_SETTINGS, ...row.settings }.worlds });
    }),
  );

  // ───────── Autentikasi guru ─────────
  r.post(
    '/auth/register',
    authLimiter,
    wrap(async (req, res) => {
      const b = z
        .object({ email: z.string().email().max(120), name: z.string().min(2).max(80), password: z.string().min(8).max(100), school: z.string().max(120).optional(), registrationCode: z.string().max(100).optional() })
        .safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'Data pendaftaran tidak lengkap. Kata sandi minimal 8 karakter.' });
      const n = Number((await query<{ n: string }>('SELECT count(*)::text n FROM teachers')).rows[0]?.n ?? 0);
      if (n > 0) {
        if (!config.registrationCode) return res.status(403).json({ error: 'Pendaftaran guru baru ditutup. Hubungi admin sekolah.' });
        const a = Buffer.from(b.data.registrationCode ?? '');
        const e = Buffer.from(config.registrationCode);
        if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return res.status(403).json({ error: 'Kode pendaftaran guru salah.' });
      }
      const email = b.data.email.toLowerCase();
      const ins = await query<{ id: string }>('INSERT INTO teachers (email, name, school, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id', [
        email,
        b.data.name,
        b.data.school ?? null,
        await hashPassword(b.data.password),
      ]);
      if (!ins.rows[0]) return res.status(409).json({ error: 'Email sudah terdaftar.' });
      const token = signTeacher({ sub: ins.rows[0].id, email, name: b.data.name });
      setAuthCookie(res, token);
      res.json({ ok: true, teacher: { id: ins.rows[0].id, email, name: b.data.name } });
    }),
  );

  r.post(
    '/auth/login',
    authLimiter,
    wrap(async (req, res) => {
      const b = z.object({ email: z.string().max(120), password: z.string().max(100) }).safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'Isi email dan kata sandi.' });
      const t = await query<{ id: string; email: string; name: string; password_hash: string }>('SELECT * FROM teachers WHERE email = $1', [b.data.email.toLowerCase()]);
      const row = t.rows[0];
      // bandingkan dengan hash palsu bila email tidak ada (waktu respons seragam)
      const ok = await verifyPassword(b.data.password, row?.password_hash ?? '$2a$11$0000000000000000000000000000000000000000000000000000.');
      if (!row || !ok) return res.status(401).json({ error: 'Email atau kata sandi salah.' });
      const token = signTeacher({ sub: row.id, email: row.email, name: row.name });
      setAuthCookie(res, token);
      res.json({ ok: true, teacher: { id: row.id, email: row.email, name: row.name } });
    }),
  );

  r.post('/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/auth/me', requireTeacher, (_req, res) => {
    const t = teacherOf(res);
    res.json({ teacher: { id: t.sub, email: t.email, name: t.name } });
  });

  // Semua endpoint di bawah ini wajib login guru
  r.use(requireTeacher, apiLimiter);

  // ───────── Sesi ─────────
  r.get(
    '/sessions',
    wrap(async (_req, res) => {
      const t = teacherOf(res);
      const s = await query(
        `SELECT s.id, s.code, s.title, s.class_name, s.status, s.created_at, s.started_at, s.ended_at,
                (SELECT count(*) FROM session_roster r WHERE r.session_id = s.id AND r.claim_hash IS NOT NULL)::int AS students,
                (SELECT count(*) FROM answers a WHERE a.session_id = s.id)::int AS answers
           FROM sessions s WHERE s.teacher_id = $1 ORDER BY s.created_at DESC LIMIT 200`,
        [t.sub],
      );
      res.json({ items: s.rows });
    }),
  );

  r.post(
    '/sessions',
    wrap(async (req, res) => {
      const t = teacherOf(res);
      const b = z
        .object({
          title: z.string().min(2).max(100),
          className: z.string().min(1).max(40),
          settings: settingsSchema.default({}),
          questionIds: z.array(z.string().uuid()).max(5000).optional(),
          roster: z.array(z.object({ absen: z.number().int().min(1).max(99), nama: z.string().min(1).max(20) })).max(99).optional(),
        })
        .safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'Data sesi tidak valid.', detail: b.error.issues.slice(0, 5) });
      const settings: SessionSettings = { ...DEFAULT_SETTINGS, ...b.data.settings };
      settings.worlds = settings.worlds.filter((w) => ACTIVE_WORLDS.has(w));
      if (!settings.worlds.length) settings.worlds = ['kota'];
      let id: string | null = null;
      let code = '';
      for (let i = 0; i < 8 && !id; i++) {
        code = newCode();
        const ins = await query<{ id: string }>(
          'INSERT INTO sessions (teacher_id, code, title, class_name, settings, question_ids) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING RETURNING id',
          [t.sub, code, b.data.title, b.data.className, JSON.stringify(settings), b.data.questionIds?.length ? b.data.questionIds : null],
        );
        id = ins.rows[0]?.id ?? null;
      }
      if (!id) return res.status(500).json({ error: 'Gagal membuat kode kelas unik.' });
      const seen = new Set<number>();
      for (const s of b.data.roster ?? []) {
        if (seen.has(s.absen)) continue;
        seen.add(s.absen);
        await query('INSERT INTO session_roster (session_id, absen, nickname, preset, approved) VALUES ($1,$2,$3,true,true)', [id, s.absen, s.nama.trim()]);
      }
      res.json({ id, code, link: `${config.publicUrl}/?kode=${code}` });
    }),
  );

  async function ownedRuntime(req: Request, res: Response) {
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return null;
    }
    const rt = await registry.load(id);
    if (!rt || rt.teacherId !== teacherOf(res).sub) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return null;
    }
    return rt;
  }

  r.get(
    '/sessions/:id',
    wrap(async (req, res) => {
      const rt = await ownedRuntime(req, res);
      if (!rt) return;
      res.json({ id: rt.id, code: rt.code, title: rt.title, className: rt.className, settings: rt.settings, questionIds: rt.questionIds, link: `${config.publicUrl}/?kode=${rt.code}`, live: rt.liveData() });
    }),
  );

  r.patch(
    '/sessions/:id',
    wrap(async (req, res) => {
      const rt = await ownedRuntime(req, res);
      if (!rt) return;
      const b = z.object({ title: z.string().min(2).max(100).optional(), className: z.string().min(1).max(40).optional(), settings: settingsSchema.optional() }).safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'Pengaturan tidak valid.' });
      if (rt.status !== 'menunggu' && b.data.settings && Object.keys(b.data.settings).some((k) => !['showLeaderboard', 'secondChance', 'allowRepeat'].includes(k)))
        return res.status(409).json({ error: 'Sebagian pengaturan hanya bisa diubah sebelum permainan dimulai.' });
      const settings = { ...rt.settings, ...(b.data.settings ?? {}) };
      settings.worlds = settings.worlds.filter((w) => ACTIVE_WORLDS.has(w));
      if (!settings.worlds.length) settings.worlds = ['kota'];
      await query('UPDATE sessions SET settings = $2, title = COALESCE($3, title), class_name = COALESCE($4, class_name) WHERE id = $1', [rt.id, JSON.stringify(settings), b.data.title ?? null, b.data.className ?? null]);
      await rt.updateSettings(settings, b.data.title, b.data.className);
      res.json({ ok: true, settings });
    }),
  );

  r.delete(
    '/sessions/:id',
    wrap(async (req, res) => {
      const rt = await ownedRuntime(req, res);
      if (!rt) return;
      if (rt.status === 'berjalan' || rt.status === 'jeda' || rt.status === 'hitung') return res.status(409).json({ error: 'Akhiri permainan sebelum menghapus sesi.' });
      if (rt.players.size) rt.notifyAll('Sesi ditutup guru.');
      await query('DELETE FROM sessions WHERE id = $1', [rt.id]);
      registry.drop(rt.id);
      res.json({ ok: true });
    }),
  );

  for (const action of ['start', 'pause', 'resume', 'end', 'podium', 'extend'] as const) {
    r.post(
      `/sessions/:id/${action}`,
      wrap(async (req, res) => {
        const rt = await ownedRuntime(req, res);
        if (!rt) return;
        const err =
          action === 'start'
            ? await rt.start()
            : action === 'pause'
              ? await rt.pause()
              : action === 'resume'
                ? await rt.resume()
                : action === 'end'
                  ? await rt.end()
                  : action === 'podium'
                    ? await rt.showPodium()
                    : await rt.extend(Number((req.body as { minutes?: number })?.minutes ?? 5));
        if (err) return res.status(409).json({ error: err });
        res.json({ ok: true, live: rt.liveData() });
      }),
    );
  }

  for (const action of ['approve', 'reject', 'reset', 'kick'] as const) {
    r.post(
      `/sessions/:id/roster/:absen/${action}`,
      wrap(async (req, res) => {
        const rt = await ownedRuntime(req, res);
        if (!rt) return;
        const absen = Number(req.params.absen);
        const ok =
          action === 'approve' ? await rt.approve(absen, true) : action === 'reject' ? await rt.approve(absen, false) : action === 'reset' ? await rt.resetClaim(absen) : await rt.kick(absen);
        if (!ok) return res.status(404).json({ error: 'Siswa tidak ditemukan.' });
        res.json({ ok: true });
      }),
    );
  }

  r.get(
    '/sessions/:id/results',
    wrap(async (req, res) => {
      const rt = await ownedRuntime(req, res);
      if (!rt) return;
      const { info, rows, answers } = await sessionResults(rt.id);
      const perSubject = new Map<string, { benar: number; total: number }>();
      for (const a of answers) {
        const k = a.subject ?? '-';
        const v = perSubject.get(k) ?? { benar: 0, total: 0 };
        v.total++;
        if (a.correct) v.benar++;
        perSubject.set(k, v);
      }
      res.json({ info, rows, answerCount: answers.length, perSubject: Object.fromEntries(perSubject), recent: answers.slice(-50).reverse() });
    }),
  );

  r.get(
    '/sessions/:id/export.xlsx',
    wrap(async (req, res) => {
      const rt = await ownedRuntime(req, res);
      if (!rt) return;
      const buf = await resultsXlsx(rt.id);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="EDUVERSE-${rt.code}.xlsx"`);
      res.send(buf);
    }),
  );

  r.get(
    '/sessions/:id/export.pdf',
    wrap(async (req, res) => {
      const rt = await ownedRuntime(req, res);
      if (!rt) return;
      const buf = await resultsPdf(rt.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="EDUVERSE-${rt.code}.pdf"`);
      res.send(buf);
    }),
  );

  // ───────── Bank soal ─────────
  r.get(
    '/questions',
    wrap(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await repo.listQuestions(teacherOf(res).sub, {
          search: q.search?.slice(0, 100),
          subject: q.subject,
          grade: q.grade ? Number(q.grade) : undefined,
          type: q.type,
          page: q.page ? Number(q.page) : 1,
          pageSize: q.pageSize ? Number(q.pageSize) : 25,
        }),
      );
    }),
  );

  r.get(
    '/questions/stats',
    wrap(async (_req, res) => {
      const t = teacherOf(res);
      const s = await query<{ subject: string; grade: number; n: number }>('SELECT subject, grade, count(*)::int n FROM questions WHERE teacher_id = $1 GROUP BY 1,2 ORDER BY 1,2', [t.sub]);
      const b = await query('SELECT id, filename, question_count, created_at FROM import_batches WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT 20', [t.sub]);
      res.json({ total: s.rows.reduce((a, x) => a + x.n, 0), bySubject: s.rows, subjects: SUBJECTS, imports: b.rows });
    }),
  );

  r.post(
    '/questions',
    wrap(async (req, res) => {
      const b = questionSchema.safeParse(req.body);
      if (!b.success) return res.status(400).json({ errors: ['Format soal tidak valid.'] });
      const out = await repo.createQuestion(teacherOf(res).sub, b.data);
      if (out.errors.length) return res.status(400).json({ errors: out.errors });
      res.json({ id: out.id });
    }),
  );

  r.put(
    '/questions/:id',
    wrap(async (req, res) => {
      const b = questionSchema.safeParse(req.body);
      const id = String(req.params.id);
      if (!b.success || !/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ errors: ['Format soal tidak valid.'] });
      const errors = await repo.updateQuestion(teacherOf(res).sub, id, b.data);
      if (errors.length) return res.status(400).json({ errors });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/questions/delete',
    wrap(async (req, res) => {
      const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'Pilih soal yang akan dihapus.' });
      res.json({ deleted: await repo.deleteQuestions(teacherOf(res).sub, b.data.ids) });
    }),
  );

  r.post(
    '/questions/sample',
    wrap(async (_req, res) => {
      const t = teacherOf(res);
      const fps = SAMPLE_QUESTIONS.map((q) => questionFingerprint(q));
      const have = await repo.existingFingerprints(t.sub, fps);
      const fresh = SAMPLE_QUESTIONS.filter((_, i) => !have.has(fps[i]!));
      if (!fresh.length) return res.json({ inserted: 0 });
      const out = await repo.insertBatch(t.sub, 'Contoh soal EDUVERSE', fresh);
      res.json(out);
    }),
  );

  r.get(
    '/questions/template.xlsx',
    wrap(async (_req, res) => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="template-soal-eduverse.xlsx"');
      res.send(await templateXlsx());
    }),
  );

  r.get(
    '/questions/template.docx',
    wrap(async (_req, res) => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="template-soal-eduverse.docx"');
      res.send(await templateDocx());
    }),
  );

  r.get(
    '/questions/:id',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(404).json({ error: 'Soal tidak ditemukan.' });
      const q = await repo.getQuestion(teacherOf(res).sub, id);
      if (!q) return res.status(404).json({ error: 'Soal tidak ditemukan.' });
      res.json(q);
    }),
  );

  r.post(
    '/questions/import/preview',
    (req, res, next) =>
      upload.single('file')(req, res, (err: unknown) => {
        if (err) return res.status(400).json({ error: 'File terlalu besar (maks 5 MB) atau tidak valid.' });
        next();
      }),
    wrap(async (req, res) => {
      const f = req.file;
      if (!f) return res.status(400).json({ error: 'Unggah file .xlsx atau .docx.' });
      // Periksa tanda tangan ZIP (xlsx/docx adalah arsip ZIP) — bukan sekadar ekstensi
      if (f.buffer.length < 4 || f.buffer.readUInt32LE(0) !== 0x04034b50) return res.status(400).json({ error: 'Isi file bukan dokumen Excel/Word yang valid.' });
      let rows: PreviewRow[];
      try {
        rows = /\.xlsx$/i.test(f.originalname) ? await parseXlsx(f.buffer) : await parseDocx(f.buffer);
      } catch {
        return res.status(400).json({ error: 'File tidak dapat dibaca. Gunakan template EDUVERSE.' });
      }
      const fps = rows.map((x) => x.fingerprint).filter((x): x is string => !!x);
      const have = await repo.existingFingerprints(teacherOf(res).sub, fps);
      const inFile = new Set<string>();
      for (const row of rows) {
        if (!row.fingerprint) continue;
        row.duplicate = have.has(row.fingerprint) || inFile.has(row.fingerprint);
        inFile.add(row.fingerprint);
      }
      res.json({
        filename: f.originalname.replace(/[^\w.\- ]/g, '_').slice(0, 120),
        total: rows.length,
        valid: rows.filter((x) => !x.errors.length).length,
        duplicates: rows.filter((x) => x.duplicate).length,
        rows,
      });
    }),
  );

  r.post(
    '/questions/import/commit',
    wrap(async (req, res) => {
      const b = z.object({ filename: z.string().max(120), questions: z.array(questionSchema).min(1).max(2000), skipDuplicates: z.boolean().default(true) }).safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'Data impor tidak valid.' });
      const t = teacherOf(res);
      const { validateQuestion } = await import('@eduverse/shared');
      const valid = b.data.questions.filter((q) => validateQuestion(q).length === 0);
      let items = valid;
      if (b.data.skipDuplicates) {
        const have = await repo.existingFingerprints(t.sub, valid.map((q) => questionFingerprint(q)));
        const seen = new Set<string>();
        items = valid.filter((q) => {
          const fp = questionFingerprint(q);
          if (have.has(fp) || seen.has(fp)) return false;
          seen.add(fp);
          return true;
        });
      }
      if (!items.length) return res.json({ inserted: 0, skipped: b.data.questions.length });
      const out = await repo.insertBatch(t.sub, b.data.filename, items);
      res.json({ ...out, skipped: b.data.questions.length - items.length });
    }),
  );

  return r;
}
