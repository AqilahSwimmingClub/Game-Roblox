/** Konfigurasi dari environment. Lihat .env.example di akar repository. */
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Variabel lingkungan ${name} wajib diisi`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: req('DATABASE_URL', isProd ? undefined : 'postgres://eduverse:eduverse@localhost:5432/eduverse'),
  jwtSecret: req('JWT_SECRET', isProd ? undefined : 'dev-only-secret-ganti-di-produksi'),
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, ''),
  /** Kode untuk mendaftarkan guru tambahan (guru pertama boleh mendaftar tanpa kode). */
  registrationCode: process.env.TEACHER_REGISTRATION_CODE ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  /** Folder build frontend (game di "/", dashboard di "/guru/"). */
  gameDist: process.env.GAME_DIST ?? new URL('../../game/dist', import.meta.url).pathname,
  dashboardDist: process.env.DASHBOARD_DIST ?? new URL('../../dashboard/dist', import.meta.url).pathname,
  /** Jumlah proxy tepercaya di depan server (Render/Nginx = 1). 0 = tidak percaya X-Forwarded-For. */
  trustProxy: Math.max(0, Math.min(5, Number(process.env.TRUST_PROXY ?? 0) || 0)),
  /**
   * Origin frontend yang boleh memanggil API & Socket.IO (frontend di domain lain, mis. Vercel).
   * Pisahkan dengan koma; '*' boleh dipakai sebagai wildcard satu label, mis.
   * https://eduverse-web-preview.vercel.app,https://eduverse-web-preview-*.vercel.app
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  maxPlayersPerNode: Number(process.env.MAX_PLAYERS_PER_NODE ?? 600),
  /** Batas gabung per IP per menit. Satu kelas biasanya berbagi satu IP publik (NAT sekolah), jadi jangan terlalu kecil. */
  joinRatePerMin: Number(process.env.JOIN_RATE_PER_MIN ?? 600),
};
