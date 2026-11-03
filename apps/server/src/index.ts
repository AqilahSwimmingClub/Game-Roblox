import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createApp } from './app.js';

async function main() {
  if (process.env.AUTO_MIGRATE !== '0') await migrate();
  const h = await createApp();
  h.server.listen(config.port, () => {
    console.log(`[eduverse] server berjalan di port ${config.port}`);
    console.log(`[eduverse] game siswa   : ${config.publicUrl}/`);
    console.log(`[eduverse] dashboard guru: ${config.publicUrl}/guru/`);
  });
  const shutdown = async () => {
    console.log('[eduverse] mematikan server…');
    await h.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
