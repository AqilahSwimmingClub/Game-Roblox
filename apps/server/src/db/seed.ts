/**
 * Seed opsional: membuat akun guru dari variabel lingkungan dan menambahkan contoh soal.
 *   SEED_TEACHER_EMAIL, SEED_TEACHER_PASSWORD (min 8), SEED_TEACHER_NAME
 * Tidak ada kata sandi bawaan di kode.
 */
import { pool, query } from './pool.js';
import { migrate } from './migrate.js';
import { hashPassword } from '../auth.js';
import { SAMPLE_QUESTIONS } from '../data/sampleQuestions.js';
import { existingFingerprints, insertBatch } from '../questionsRepo.js';
import { questionFingerprint } from '@eduverse/shared';

async function main() {
  await migrate();
  const email = process.env.SEED_TEACHER_EMAIL?.toLowerCase();
  const password = process.env.SEED_TEACHER_PASSWORD;
  if (!email || !password || password.length < 8) {
    console.log('Lewati seed guru: isi SEED_TEACHER_EMAIL dan SEED_TEACHER_PASSWORD (min 8 karakter).');
    return;
  }
  const name = process.env.SEED_TEACHER_NAME ?? 'Guru EDUVERSE';
  await query('INSERT INTO teachers (email, name, password_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING', [email, name, await hashPassword(password)]);
  const t = (await query<{ id: string }>('SELECT id FROM teachers WHERE email = $1', [email])).rows[0]!;
  const fps = SAMPLE_QUESTIONS.map((q) => questionFingerprint(q));
  const have = await existingFingerprints(t.id, fps);
  const fresh = SAMPLE_QUESTIONS.filter((_, i) => !have.has(fps[i]!));
  if (fresh.length) await insertBatch(t.id, 'Contoh soal EDUVERSE', fresh);
  console.log(`Guru ${email} siap. Contoh soal ditambahkan: ${fresh.length}.`);
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
