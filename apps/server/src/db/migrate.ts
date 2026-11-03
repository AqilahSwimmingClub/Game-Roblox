import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.js';

/** Menjalankan migrasi SQL yang belum diterapkan (berurutan menurut nama file). */
export async function migrate(): Promise<string[]> {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  // Saat dijalankan dari dist/, file .sql tetap dibaca dari src/ bila tidak tersalin
  const candidates = [dir, dir.replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`)];
  let files: string[] = [];
  let used = dir;
  for (const d of candidates) {
    try {
      files = (await readdir(d)).filter((f) => f.endsWith('.sql')).sort();
      used = d;
      if (files.length) break;
    } catch {
      /* coba kandidat berikutnya */
    }
  }
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(used, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
      await c.query('COMMIT');
      applied.push(f);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then((a) => {
      console.log(a.length ? `Migrasi diterapkan: ${a.join(', ')}` : 'Skema sudah terbaru.');
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
