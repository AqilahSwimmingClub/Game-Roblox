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

/** Origin diizinkan? (tanpa Origin = permintaan dari halaman yang sama / non-browser → diizinkan) */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return allowed.some((r) => r.test(origin));
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(origin && originAllowed(origin) ? 204 : 403).end();
    return;
  }
  next();
}
