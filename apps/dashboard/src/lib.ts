/** Pembantu dashboard: DOM, panggilan API (token Bearer; server boleh di domain lain), toast. */
import { SERVER_URL } from './server.js';

const TOKEN_KEY = 'eduverse.guru.token';
let memToken = '';
/** Token login guru (12 jam). Disimpan di localStorage agar tetap masuk saat tablet memuat ulang halaman. */
export function getToken(): string {
  if (memToken) return memToken;
  try {
    memToken = localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    /* mode privat */
  }
  return memToken;
}
export function setToken(t: string) {
  memToken = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* abaikan */
  }
}
export const apiUrl = (path: string) => `${SERVER_URL}/api${path}`;
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export class ApiError extends Error {
  constructor(
    msg: string,
    readonly status: number,
    readonly data: unknown,
  ) {
    super(msg);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const tok = getToken();
  if (tok) headers.authorization = `Bearer ${tok}`;
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(`Server EDUVERSE belum bisa dihubungi (${SERVER_URL || location.origin}). Bila server baru dinyalakan, tunggu ±1 menit lalu muat ulang.`, 0, null);
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      setToken('');
      location.hash = '#/masuk';
    }
    const d = data as { error?: string; errors?: string[] } | null;
    throw new ApiError(d?.error ?? d?.errors?.join(' · ') ?? `Galat ${res.status}`, res.status, data);
  }
  return data as T;
}

/** Unduh file dari API (ekspor/templat) dengan token guru. */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(apiUrl(path), { headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {}, credentials: 'same-origin' });
  if (!res.ok) throw new Error(res.status === 401 ? 'Sesi login habis. Silakan masuk lagi.' : `Gagal mengunduh (${res.status})`);
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]!) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function toast(text: string, isErr = false) {
  const el = h('div', { class: `toast${isErr ? ' err' : ''}`, role: 'status' }, text);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function btn(label: string, cls: string, onClick: () => void | Promise<void>, attrs: Attrs = {}) {
  const b = h('button', { type: 'button', class: `btn ${cls}`, ...attrs }, label);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await onClick();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Terjadi kesalahan', true);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Pembersih saat pindah halaman (socket, timer). */
let cleanups: (() => void)[] = [];
export function onLeave(fn: () => void) {
  cleanups.push(fn);
}
export function runLeave() {
  for (const fn of cleanups) {
    try {
      fn();
    } catch {
      /* abaikan */
    }
  }
  cleanups = [];
}

export function modal(content: HTMLElement) {
  const m = h('div', { class: 'modal', onclick: (e: Event) => e.target === m && m.remove() }, content);
  document.body.appendChild(m);
  return { close: () => m.remove() };
}
