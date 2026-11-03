import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

export const COOKIE = 'edu_token';

export interface TeacherClaims {
  sub: string;
  email: string;
  name: string;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 11);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function signTeacher(c: TeacherClaims): string {
  return jwt.sign(c, config.jwtSecret, { expiresIn: '12h', algorithm: 'HS256' });
}

/** Token yang sudah dikeluarkan (logout) → ditolak sampai kedaluwarsa. Disimpan di memori instance. */
const revoked = new Map<string, number>();
export function revokeToken(token: string | undefined) {
  if (!token) return;
  const d = jwt.decode(token) as { exp?: number } | null;
  revoked.set(token, (d?.exp ?? Date.now() / 1000 + 12 * 3600) * 1000);
  const now = Date.now();
  for (const [t, exp] of revoked) if (exp < now) revoked.delete(t);
}

export function verifyTeacherToken(token: string | undefined): TeacherClaims | null {
  if (!token || revoked.has(token)) return null;
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as TeacherClaims;
  } catch {
    return null;
  }
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 12 * 3600 * 1000,
    path: '/',
  });
}

/** Ambil token dari cookie httpOnly atau header Authorization (untuk uji/integrasi). */
export function tokenFrom(req: Request): string | undefined {
  const c = (req.cookies as Record<string, string> | undefined)?.[COOKIE];
  if (c) return c;
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export function requireTeacher(req: Request, res: Response, next: NextFunction) {
  const claims = verifyTeacherToken(tokenFrom(req));
  if (!claims) {
    res.status(401).json({ error: 'Silakan masuk sebagai guru.' });
    return;
  }
  res.locals.teacher = claims;
  next();
}

export function teacherOf(res: Response): TeacherClaims {
  return res.locals.teacher as TeacherClaims;
}

/** Parse cookie mentah (untuk handshake Socket.IO). */
export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
