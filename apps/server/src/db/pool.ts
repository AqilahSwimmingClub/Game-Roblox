import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.PG_POOL_MAX ?? 20),
  // Supabase/managed PostgreSQL: PGSSL=1. Sertifikat diverifikasi bila PGSSL_CA (isi PEM, mis. "Supabase root CA")
  // diberikan; PGSSL_STRICT=0 = terenkripsi tanpa verifikasi rantai (hanya bila CA belum dipasang).
  ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: process.env.PGSSL_STRICT !== '0', ...(process.env.PGSSL_CA ? { ca: process.env.PGSSL_CA.replace(/\\n/g, '\n') } : {}) } : undefined,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
