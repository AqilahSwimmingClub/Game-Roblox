import type { PoolClient } from 'pg';
import { questionFingerprint, validateQuestion, type QuestionRecord, type AnswerKey, type QuestionSource, type SessionQuestionSource, type Difficulty } from '@eduverse/shared';
import { query, tx } from './db/pool.js';

export type QuestionInput = Omit<QuestionRecord, 'id'>;

interface Row {
  id: string;
  subject: string;
  grade: number;
  phase: string;
  topic: string;
  learning_outcome: string;
  type: QuestionRecord['type'];
  prompt: string;
  options: string[];
  right_items: string[];
  answer_key: AnswerKey;
  explanation: string;
  difficulty: QuestionRecord['difficulty'];
  points: number;
  world: string;
  fingerprint: string;
  created_at: Date;
  source?: QuestionSource;
  image?: string | null;
}

export function rowToQuestion(r: Row): QuestionRecord {
  return {
    id: r.id,
    subject: r.subject,
    grade: r.grade,
    phase: r.phase,
    topic: r.topic,
    learningOutcome: r.learning_outcome,
    type: r.type,
    prompt: r.prompt,
    options: r.options,
    right: r.right_items,
    key: r.answer_key,
    explanation: r.explanation,
    difficulty: r.difficulty,
    points: r.points,
    world: r.world,
    image: r.image ?? null,
    source: r.source ?? 'guru',
  };
}

export interface ListFilter {
  search?: string;
  subject?: string;
  grade?: number;
  type?: string;
  source?: QuestionSource;
  difficulty?: string;
  page?: number;
  pageSize?: number;
}

export async function listQuestions(teacherId: string, f: ListFilter) {
  const where = ['teacher_id = $1'];
  const params: unknown[] = [teacherId];
  if (f.search) {
    params.push(`%${f.search}%`);
    where.push(`(prompt ILIKE $${params.length} OR topic ILIKE $${params.length})`);
  }
  if (f.subject) {
    params.push(f.subject);
    where.push(`subject = $${params.length}`);
  }
  if (f.grade) {
    params.push(f.grade);
    where.push(`grade = $${params.length}`);
  }
  if (f.type) {
    params.push(f.type);
    where.push(`type = $${params.length}`);
  }
  if (f.source) {
    params.push(f.source);
    where.push(`source = $${params.length}`);
  }
  if (f.difficulty) {
    params.push(f.difficulty);
    where.push(`difficulty = $${params.length}`);
  }
  const pageSize = Math.min(500, Math.max(1, f.pageSize ?? 25));
  const page = Math.max(1, f.page ?? 1);
  const total = Number((await query<{ n: string }>(`SELECT count(*)::text AS n FROM questions WHERE ${where.join(' AND ')}`, params)).rows[0]?.n ?? 0);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await query<Row>(
    `SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total, page, pageSize, items: rows.rows.map(rowToQuestion) };
}

export async function getQuestion(teacherId: string, id: string): Promise<QuestionRecord | null> {
  const r = await query<Row>('SELECT * FROM questions WHERE id = $1 AND teacher_id = $2', [id, teacherId]);
  return r.rows[0] ? rowToQuestion(r.rows[0]) : null;
}

async function insertOne(c: PoolClient | null, teacherId: string, q: QuestionInput, batch: string | null, source: QuestionSource = 'guru'): Promise<string> {
  const fp = questionFingerprint(q);
  const sql = `INSERT INTO questions (teacher_id, subject, grade, phase, topic, learning_outcome, type, prompt, options, right_items, answer_key, explanation, difficulty, points, world, fingerprint, import_batch, source, image)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`;
  const params = [
    teacherId,
    q.subject,
    q.grade,
    q.phase,
    q.topic,
    q.learningOutcome,
    q.type,
    q.prompt,
    JSON.stringify(q.options),
    JSON.stringify(q.right),
    JSON.stringify(q.key),
    q.explanation,
    q.difficulty,
    q.points,
    q.world,
    fp,
    batch,
    source,
    q.image ?? null,
  ];
  const r = c ? await c.query<{ id: string }>(sql, params) : await query<{ id: string }>(sql, params);
  return r.rows[0]!.id;
}

export async function createQuestion(teacherId: string, q: QuestionInput): Promise<{ id?: string; errors: string[] }> {
  const errors = validateQuestion(q);
  if (errors.length) return { errors };
  return { id: await insertOne(null, teacherId, q, null), errors: [] };
}

export async function updateQuestion(teacherId: string, id: string, q: QuestionInput): Promise<string[]> {
  const errors = validateQuestion(q);
  if (errors.length) return errors;
  const r = await query(
    `UPDATE questions SET subject=$3, grade=$4, phase=$5, topic=$6, learning_outcome=$7, type=$8, prompt=$9, options=$10, right_items=$11,
       answer_key=$12, explanation=$13, difficulty=$14, points=$15, world=$16, fingerprint=$17, image=$18, updated_at=now()
     WHERE id=$1 AND teacher_id=$2`,
    [
      id,
      teacherId,
      q.subject,
      q.grade,
      q.phase,
      q.topic,
      q.learningOutcome,
      q.type,
      q.prompt,
      JSON.stringify(q.options),
      JSON.stringify(q.right),
      JSON.stringify(q.key),
      q.explanation,
      q.difficulty,
      q.points,
      q.world,
      questionFingerprint(q),
      q.image ?? null,
    ],
  );
  return r.rowCount ? [] : ['Soal tidak ditemukan'];
}

export async function deleteQuestions(teacherId: string, ids: string[]): Promise<number> {
  const r = await query('DELETE FROM questions WHERE teacher_id = $1 AND id = ANY($2::uuid[])', [teacherId, ids]);
  return r.rowCount ?? 0;
}

/** Sidik jari yang sudah ada (untuk menandai kemungkinan duplikat pada pratinjau impor). */
/** Sidik soal yang sudah ada di bank guru untuk satu asal soal (duplikat soal guru dihitung terhadap soal guru saja). */
export async function existingFingerprints(teacherId: string, fps: string[], source: QuestionSource = 'guru'): Promise<Set<string>> {
  if (!fps.length) return new Set();
  const r = await query<{ fingerprint: string }>('SELECT DISTINCT fingerprint FROM questions WHERE teacher_id = $1 AND source = $3 AND fingerprint = ANY($2)', [teacherId, fps, source]);
  return new Set(r.rows.map((x) => x.fingerprint));
}

/** Impor berulang: selalu menambah batch baru, tidak pernah menghapus soal lama. */
/** Impor berulang: selalu menambah batch baru, tidak pernah menghapus soal lama. */
export async function insertBatch(teacherId: string, filename: string, items: QuestionInput[], source: QuestionSource = 'guru'): Promise<{ batchId: string; inserted: number }> {
  return tx(async (c) => {
    const b = await c.query<{ id: string }>('INSERT INTO import_batches (teacher_id, filename, question_count) VALUES ($1,$2,$3) RETURNING id', [teacherId, filename, items.length]);
    const batchId = b.rows[0]!.id;
    for (const q of items) await insertOne(c, teacherId, q, batchId, source);
    return { batchId, inserted: items.length };
  });
}

/**
 * Impor dengan pilihan duplikat: 'lewati' (bawaan), 'perbarui' (soal guru dengan isi sama diperbarui: kunci, pembahasan,
 * kelas, mapel, poin, …), atau 'tambah' (tetap disimpan sebagai soal baru). Satu transaksi per kiriman.
 */
export async function importQuestions(teacherId: string, filename: string, items: QuestionInput[], mode: 'lewati' | 'perbarui' | 'tambah') {
  return tx(async (c) => {
    const fps = items.map((q) => questionFingerprint(q));
    const have = new Set(
      (await c.query<{ fingerprint: string }>("SELECT DISTINCT fingerprint FROM questions WHERE teacher_id = $1 AND source = 'guru' AND fingerprint = ANY($2)", [teacherId, fps])).rows.map((r) => r.fingerprint),
    );
    const b = await c.query<{ id: string }>('INSERT INTO import_batches (teacher_id, filename, question_count) VALUES ($1,$2,0) RETURNING id', [teacherId, filename]);
    const batchId = b.rows[0]!.id;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const q = items[i]!;
      const fp = fps[i]!;
      const dup = have.has(fp) || seen.has(fp);
      const inFileDup = seen.has(fp);
      seen.add(fp);
      if (mode === 'tambah' || !dup) {
        await insertOne(c, teacherId, q, batchId, 'guru');
        inserted++;
        continue;
      }
      if (mode === 'perbarui' && !inFileDup) {
        const u = await c.query(
          `UPDATE questions SET subject=$3, grade=$4, phase=$5, topic=$6, learning_outcome=$7, right_items=$8, answer_key=$9, explanation=$10,
             difficulty=$11, points=$12, world=$13, image=COALESCE($14, image), updated_at=now()
           WHERE teacher_id=$1 AND fingerprint=$2 AND source='guru'`,
          [teacherId, fp, q.subject, q.grade, q.phase, q.topic, q.learningOutcome, JSON.stringify(q.right), JSON.stringify(q.key), q.explanation, q.difficulty, q.points, q.world, q.image ?? null],
        );
        updated += u.rowCount ?? 0;
        continue;
      }
      skipped++;
    }
    await c.query('UPDATE import_batches SET question_count = $2 WHERE id = $1', [batchId, inserted]);
    return { batchId, inserted, updated, skipped };
  });
}

/** Saringan soal untuk sebuah sesi (dipakai pemuatan soal, hitungan pratinjau, dan pemilihan acak). */
export interface PoolFilter {
  subjects: string[];
  grade: number | null;
  source: SessionQuestionSource;
  difficulties: Difficulty[];
  ids: string[] | null;
  world?: string | null;
}

export function poolWhere(teacherId: string, f: PoolFilter, params: unknown[]): string {
  params.push(teacherId);
  const where = [`teacher_id = $${params.length}`];
  if (f.source === 'guru' || f.source === 'bawaan') {
    params.push(f.source);
    where.push(`source = $${params.length}`);
  }
  if (f.world) {
    params.push(f.world);
    where.push(`(world = 'semua' OR world = $${params.length})`);
  }
  if (f.subjects.length) {
    params.push(f.subjects);
    where.push(`subject = ANY($${params.length})`);
  }
  if (f.grade) {
    params.push(f.grade);
    where.push(`grade = $${params.length}`);
  }
  if (f.difficulties.length) {
    params.push(f.difficulties);
    where.push(`difficulty = ANY($${params.length})`);
  }
  if (f.ids) {
    params.push(f.ids);
    where.push(`id = ANY($${params.length}::uuid[])`);
  }
  return where.join(' AND ');
}

/** Hitung soal yang cocok + rinciannya (pratinjau di Dashboard sebelum membuat/memulai sesi). */
export async function poolCount(teacherId: string, f: PoolFilter) {
  const params: unknown[] = [];
  const w = poolWhere(teacherId, f, params);
  const r = await query<{ subject: string; source: string; difficulty: string; n: number }>(`SELECT subject, source, difficulty, count(*)::int AS n FROM questions WHERE ${w} GROUP BY 1, 2, 3`, params);
  return { total: r.rows.reduce((a, x) => a + x.n, 0), rows: r.rows };
}

/** Pilih N soal acak dari saringan (disimpan ke sesi agar semua siswa memakai set yang sama). */
export async function randomIds(teacherId: string, f: PoolFilter, n: number): Promise<string[]> {
  const params: unknown[] = [];
  const w = poolWhere(teacherId, f, params);
  params.push(n);
  const r = await query<{ id: string }>(`SELECT id FROM questions WHERE ${w} ORDER BY random() LIMIT $${params.length}`, params);
  return r.rows.map((x) => x.id);
}

export async function countQuestions(teacherId: string): Promise<number> {
  const r = await query<{ n: string }>('SELECT count(*)::text AS n FROM questions WHERE teacher_id = $1', [teacherId]);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Pemuatan soal bertahap untuk sesi: halaman soal teracak-deterministik per sesi.
 * Tidak memuat ribuan soal sekaligus ke memori.
 */
/**
 * Pemuatan soal bertahap untuk sesi: halaman soal teracak-deterministik per sesi.
 * Tidak memuat ribuan soal sekaligus ke memori. Sumber soal mengikuti pilihan guru (bukan soal contoh tertanam).
 */
export async function loadQuestionPage(teacherId: string, sessionId: string, opts: PoolFilter & { world: string; limit: number; offset: number }): Promise<QuestionRecord[]> {
  const params: unknown[] = [];
  const w = poolWhere(teacherId, opts, params);
  params.push(sessionId, opts.limit, opts.offset);
  const r = await query<Row>(
    `SELECT * FROM questions WHERE ${w}
     ORDER BY md5(id::text || $${params.length - 2}) LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return r.rows.map(rowToQuestion);
}
