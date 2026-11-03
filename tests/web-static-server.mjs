/**
 * Server statis untuk menguji topologi produksi secara lokal: melayani build web (apps/game/dist berisi game "/",
 * Demo "/demo.html", Dashboard "/guru/") dengan header dari vercel.json — seperti Vercel — di origin yang
 * BERBEDA dari backend. Pemakaian: node tests/web-static-server.mjs [port] [dir]
 * EXTRA_CONNECT_SRC menambah sumber connect-src CSP (mis. http://localhost:3000 ws://localhost:3000 untuk uji tanpa HTTPS).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] ?? 4173);
const root = path.resolve(process.argv[3] ?? new URL('../apps/game/dist', import.meta.url).pathname);
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const extra = process.env.EXTRA_CONNECT_SRC ?? '';

function headersFor(p) {
  const out = {};
  for (const rule of vercel.headers) {
    const re = new RegExp('^' + rule.source.replace(/\(\.\*\)/g, '.*') + '$');
    if (re.test(p)) for (const h of rule.headers) out[h.key] = h.value;
  }
  if (extra && out['Content-Security-Policy']) out['Content-Security-Policy'] = out['Content-Security-Policy'].replace("connect-src 'self' https: wss:", `connect-src 'self' https: wss: ${extra}`);
  return out;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    for (const r of vercel.redirects ?? []) if (p === r.source) return res.writeHead(307, { location: r.destination }).end();
    let file = path.join(root, p);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', ...headersFor(p) });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`[web] ${root} → http://localhost:${port}`));
