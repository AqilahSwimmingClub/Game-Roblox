/**
 * Uji RLS Supabase dari luar: kunci publik (anon/publishable) TIDAK boleh membaca atau menulis tabel EDUVERSE.
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<kunci publik> node tests/security/supabase-rls.mjs
 * Kunci publik memang boleh berada di browser; yang diuji adalah bahwa ia tidak memberi akses ke data.
 * Alternatif tanpa akses jaringan ke supabase.co: jalankan supabase/verify_rls.sql di SQL Editor.
 */
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) {
  console.log('Lewati: SUPABASE_URL / SUPABASE_ANON_KEY tidak diisi.');
  process.exit(0);
}
const TABLES = ['teachers', 'questions', 'sessions', 'session_roster', 'answers', 'import_batches', 'schema_migrations'];
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
let bad = 0;
for (const t of TABLES) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, { headers: h });
  const body = await r.text();
  void body;
  const readBlocked = !r.ok; // hak dicabut: PostgREST menjawab 401/403 (permission denied)
  const w = await fetch(`${URL}/rest/v1/${t}`, { method: 'POST', headers: h, body: JSON.stringify({}) });
  const writeBlocked = !w.ok;
  const ok = readBlocked && writeBlocked;
  if (!ok) bad++;
  console.log(`  ${ok ? '✔' : '✘'} ${t}: baca ${r.status}${readBlocked ? ' ditolak' : ' TERBUKA'} · tulis ${w.status}${writeBlocked ? ' ditolak' : ' TERBUKA'}`);
}
console.log(bad ? `\nGAGAL: ${bad} tabel terbuka` : `\nLULUS: ${TABLES.length}/${TABLES.length} tabel tertutup untuk API publik`);
process.exitCode = bad ? 1 : 0;
