/** Rakit Express + Socket.IO. Dipakai oleh index.ts dan uji integrasi. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import { config } from './config.js';
import { apiRouter } from './routes.js';
import { RuntimeRegistry } from './game/runtime.js';
import { attachSockets } from './game/sockets.js';
import { corsMiddleware, originAllowed } from './cors.js';

export interface AppHandle {
  server: http.Server;
  io: Server;
  registry: RuntimeRegistry;
  close: () => Promise<void>;
}

export async function createApp(): Promise<AppHandle> {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'media-src': ["'self'", 'data:', 'blob:'],
          'worker-src': ["'self'", 'blob:'],
          'upgrade-insecure-requests': config.isProd && !config.lanHttp ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // unduhan ekspor dari Dashboard di domain lain
      hsts: config.isProd && !config.lanHttp,
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '16mb' }));

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) },
    // opsi cors hanya berlaku untuk HTTP long-polling; upgrade WebSocket diperiksa di sini
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, req.headers.host)),
    maxHttpBufferSize: 64 * 1024,
    // HP sering mengalami jeda jaringan singkat (pindah menara seluler/WiFi, layar redup). Batas 10/15 dtk terlalu
    // ketat dan memutus pemain yang sebenarnya masih online; 20/25 dtk (mendekati bawaan Socket.IO) lebih toleran,
    // dan proxy hosting (Railway/Render) tetap menerima lalu lintas jauh di bawah batas idle-nya.
    pingInterval: 20_000,
    pingTimeout: 25_000,
    connectionStateRecovery: { maxDisconnectionDuration: 60_000 },
  });

  if (config.redisUrl) {
    // Multi-node: siaran antar-node lewat Redis. Sesi harus "sticky" ke satu node (lihat docs/DEPLOYMENT.md)
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const { createClient } = await import('redis');
    const pub = createClient({ url: config.redisUrl });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    console.log('[eduverse] adapter Redis aktif');
  }

  const registry = new RuntimeRegistry(io.of('/play'), io.of('/teacher'));
  registry.startLoops();
  attachSockets(io, registry, { trustProxy: config.trustProxy });

  app.use('/api', corsMiddleware, apiRouter(registry));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));

  // Frontend statis: dashboard guru di /guru, game siswa di /
  const serveSpa = (mount: string, dir: string) => {
    if (!fs.existsSync(path.join(dir, 'index.html'))) {
      app.get(mount === '/' ? '/' : `${mount}*`, (_req, res) =>
        res.status(503).type('text').send(`Build frontend belum ada di ${dir}. Jalankan "npm run build" di akar repository.`),
      );
      return;
    }
    app.use(mount, express.static(dir, { index: false, maxAge: '1h', setHeaders: (res, p) => p.endsWith('.html') && res.setHeader('Cache-Control', 'no-cache') }));
    app.get(mount === '/' ? '*' : [mount, `${mount}/*`], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dir, 'index.html'));
    });
  };
  serveSpa('/guru', config.dashboardDist);
  serveSpa('/', config.gameDist);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[http]', err);
    res.status(500).json({ error: 'Terjadi kesalahan di server.' });
  });

  return {
    server,
    io,
    registry,
    close: async () => {
      registry.stop();
      await new Promise<void>((r) => io.close(() => r()));
    },
  };
}
