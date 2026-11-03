/**
 * Siapkan akun guru uji + soal contoh (untuk e2e/uji beban lokal & CI).
 * Mendaftar bila belum ada (guru pertama tidak butuh kode), lalu memuat soal contoh bila bank kosong.
 * Variabel: BASE_URL, TEACHER_EMAIL, TEACHER_PASSWORD, TEACHER_REGISTRATION_CODE (bila server memintanya).
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const email = process.env.TEACHER_EMAIL ?? 'guru@sekolah.id';
const password = process.env.TEACHER_PASSWORD ?? 'rahasia123';
let cookie = '';
async function call(path, body) {
  const r = await fetch(`${BASE}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
}
let login = await call('/auth/login', { email, password });
if (!login.ok) {
  const reg = await call('/auth/register', { email, password, name: 'Bu Guru Uji', registrationCode: process.env.TEACHER_REGISTRATION_CODE || undefined });
  if (!reg.ok) throw new Error(`Gagal mendaftar guru: ${reg.data?.error ?? reg.status}`);
  login = await call('/auth/login', { email, password });
  if (!login.ok) throw new Error(`Gagal masuk: ${login.data?.error ?? login.status}`);
}
const stats = await call('/questions/stats');
if (!stats.data?.total) await call('/questions/sample', {});
const after = await call('/questions/stats');
console.log(`Guru ${email} siap · ${after.data?.total ?? 0} soal di bank`);
