/**
 * CORS untuk frontend yang di-host terpisah (mis. game & Dashboard di Vercel, server di Render).
 * Autentikasi guru memakai header Authorization (bukan cookie lintas situs), jadi tidak perlu credentials.
 */
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

function toRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+');
  return new RegExp(`^${esc}$`, 'i');
}

const allowed = [...config.corsOrigins, config.publicUrl].filter(Boolean).map(toRegex);

/**
 * Origin diizinkan? (tanpa Origin = permintaan dari halaman yang sama / non-browser → diizinkan)
 * `host` = header Host permintaan: halaman yang disajikan server ini sendiri (origin == host) selalu boleh.
 * Penting untuk Server Sekolah: guru bisa membuka lewat localhost, siswa lewat IP WiFi/hotspot yang berbeda-beda.
 */
export function originAllowed(origin: string | undefined, host?: string | string[]): boolean {
  if (!origin) return true;
  if (typeof host === 'string' && host) {
    try {
      if (new URL(origin).host.toLowerCase() === host.toLowerCase()) return true;
    } catch {
      return false;
    }
  }
  return allowed.some((r) => r.test(origin));
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin, req.headers.host)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(origin && originAllowed(origin, req.headers.host) ? 204 : 403).end();
    return;
  }
  next();
}
