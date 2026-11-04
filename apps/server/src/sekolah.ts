/**
 * EDUVERSE "Server Sekolah" — satu perintah di laptop/PC guru, tanpa memasang PostgreSQL:
 *   npm run sekolah
 * - Basis data PostgreSQL tertanam (PGlite) disimpan di folder data-sekolah/ (tetap ada setelah laptop dimatikan).
 * - Game siswa, Dashboard Guru, API, dan Socket.IO disajikan dari satu alamat di jaringan sekolah (WiFi/hotspot),
 *   mis. http://192.168.1.10:3000 → siswa membuka alamat itu di Chrome HP, guru membuka /guru/ di tablet.
 * - Kunci rahasia JWT dibuat acak sekali dan disimpan di data-sekolah/ (tidak pernah masuk repository).
 * Jalur cadangan bila backend internet (Render) belum/tidak bisa dipakai. Validasi skor tetap di server ini.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = path.resolve(process.env.SEKOLAH_DATA ?? path.join(process.cwd(), 'data-sekolah'));
const port = Number(process.env.PORT ?? 3000);
const dbPort = Number(process.env.SEKOLAH_DB_PORT ?? 5439);

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  const secretFile = path.join(dataDir, 'jwt-secret.txt');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });

  let PGlite: typeof import('@electric-sql/pglite').PGlite;
  let PGLiteSocketServer: typeof import('@electric-sql/pglite-socket').PGLiteSocketServer;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
    ({ PGLiteSocketServer } = await import('@electric-sql/pglite-socket'));
  } catch {
    console.error('[sekolah] Paket basis data tertanam belum terpasang. Jalankan: npm ci');
    process.exit(1);
  }
  const db = await PGlite.create(path.join(dataDir, 'db'));
  const dbServer = new PGLiteSocketServer({ db, port: dbPort, host: '127.0.0.1' });
  await dbServer.start();

  const ips = lanAddresses();
  const publicUrl = process.env.PUBLIC_URL ?? `http://${ips[0] ?? 'localhost'}:${port}`;
  Object.assign(process.env, {
    DATABASE_URL: `postgres://postgres@127.0.0.1:${dbPort}/postgres`,
    PG_POOL_MAX: '1', // PGlite = satu koneksi; kueri diantrekan (cukup untuk satu sekolah)
    JWT_SECRET: fs.readFileSync(secretFile, 'utf8').trim(),
    NODE_ENV: 'production',
    LAN_HTTP: '1', // jaringan lokal tanpa HTTPS: jangan paksa https/Secure cookie
    PUBLIC_URL: publicUrl,
    PORT: String(port),
  });
  await import('./index.js');
  console.log('\n================ EDUVERSE SERVER SEKOLAH ================');
  console.log(`Data tersimpan di : ${dataDir}`);
  for (const ip of ips.length ? ips : ['localhost']) {
    console.log(`Siswa (HP)        : http://${ip}:${port}/`);
    console.log(`Guru (tablet)     : http://${ip}:${port}/guru/`);
  }
  console.log('Pastikan HP siswa & tablet guru tersambung ke WiFi/hotspot yang sama dengan komputer ini.');
  console.log('Tekan Ctrl+C untuk mematikan server.');
  console.log('==========================================================\n');
  const stop = async () => {
    await dbServer.stop().catch(() => undefined);
    await db.close().catch(() => undefined);
  };
  process.on('exit', () => void stop());
}

main().catch((e) => {
  console.error('[sekolah]', e);
  process.exit(1);
});
