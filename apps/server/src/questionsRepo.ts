import type { PoolClient } from 'pg';
import { questionFingerprint, validateQuestion, type QuestionRecord, type AnswerKey } from '@eduverse/shared';
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
  };
}

export interface ListFilter {
  search?: string;
  subject?: string;
  grade?: number;
  type?: string;
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
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25));
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

async function insertOne(c: PoolClient | null, teacherId: string, q: QuestionInput, batch: string | null): Promise<string> {
  const fp = questionFingerprint(q);
  const sql = `INSERT INTO questions (teacher_id, subject, grade, phase, topic, learning_outcome, type, prompt, options, right_items, answer_key, explanation, difficulty, points, world, fingerprint, import_batch)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`;
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
       answer_key=$12, explanation=$13, difficulty=$14, points=$15, world=$16, fingerprint=$17, updated_at=now()
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
    ],
  );
  return r.rowCount ? [] : ['Soal tidak ditemukan'];
}

export async function deleteQuestions(teacherId: string, ids: string[]): Promise<number> {
  const r = await query('DELETE FROM questions WHERE teacher_id = $1 AND id = ANY($2::uuid[])', [teacherId, ids]);
  return r.rowCount ?? 0;
}

/** Sidik jari yang sudah ada (untuk menandai kemungkinan duplikat pada pratinjau impor). */
export async function existingFingerprints(teacherId: string, fps: string[]): Promise<Set<string>> {
  if (!fps.length) return new Set();
  const r = await query<{ fingerprint: string }>('SELECT DISTINCT fingerprint FROM questions WHERE teacher_id = $1 AND fingerprint = ANY($2)', [teacherId, fps]);
  return new Set(r.rows.map((x) => x.fingerprint));
}

/** Impor berulang: selalu menambah batch baru, tidak pernah menghapus soal lama. */
export async function insertBatch(teacherId: string, filename: string, items: QuestionInput[]): Promise<{ batchId: string; inserted: number }> {
  return tx(async (c) => {
    const b = await c.query<{ id: string }>('INSERT INTO import_batches (teacher_id, filename, question_count) VALUES ($1,$2,$3) RETURNING id', [teacherId, filename, items.length]);
    const batchId = b.rows[0]!.id;
    for (const q of items) await insertOne(c, teacherId, q, batchId);
    return { batchId, inserted: items.length };
  });
}

export async function countQuestions(teacherId: string): Promise<number> {
  const r = await query<{ n: string }>('SELECT count(*)::text AS n FROM questions WHERE teacher_id = $1', [teacherId]);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Pemuatan soal bertahap untuk sesi: halaman soal teracak-deterministik per sesi.
 * Tidak memuat ribuan soal sekaligus ke memori.
 */
export async function loadQuestionPage(
  teacherId: string,
  sessionId: string,
  opts: { subjects: string[]; grade: number | null; world: string; ids: string[] | null; limit: number; offset: number },
): Promise<QuestionRecord[]> {
  const where = ['teacher_id = $1', "(world = 'semua' OR world = $2)"];
  const params: unknown[] = [teacherId, opts.world];
  if (opts.subjects.length) {
    params.push(opts.subjects);
    where.push(`subject = ANY($${params.length})`);
  }
  if (opts.grade) {
    params.push(opts.grade);
    where.push(`grade = $${params.length}`);
  }
  if (opts.ids) {
    params.push(opts.ids);
    where.push(`id = ANY($${params.length}::uuid[])`);
  }
  params.push(sessionId, opts.limit, opts.offset);
  const r = await query<Row>(
    `SELECT * FROM questions WHERE ${where.join(' AND ')}
     ORDER BY md5(id::text || $${params.length - 2}) LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return r.rows.map(rowToQuestion);
}
