/** Dashboard Guru EDUVERSE — router hash sederhana: #/masuk, #/, #/sesi/baru, #/sesi/:id, #/soal. */
import './style.css';
import { h, api, runLeave, ApiError } from './lib.js';
import { loginView } from './views/auth.js';
import { homeView } from './views/home.js';
import { sessionFormView } from './views/sessionForm.js';
import { liveView } from './views/live.js';
import { questionsView } from './views/questions.js';

const app = document.getElementById('app')!;
let me: { name: string; email: string } | null = null;

function topbar(active: string) {
  const link = (href: string, label: string, key: string) => h('a', { href, class: active === key ? 'aktif' : '' }, label);
  return h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'logo' }, 'EDUVERSE', h('small', null, 'Dashboard Guru')),
    h('nav', null, link('#/', 'Beranda', 'home'), link('#/sesi/baru', 'Buat Sesi', 'baru'), link('#/soal', 'Bank Soal', 'soal')),
    h('span', { style: 'font-weight:800' }, me?.name ?? ''),
    h(
      'a',
      {
        href: '#',
        style: 'color:#fff;font-weight:800',
        onclick: async (e: Event) => {
          e.preventDefault();
          await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
          me = null;
          location.hash = '#/masuk';
        },
      },
      'Keluar',
    ),
  );
}

let seq = 0;
async function route() {
  runLeave();
  const my = ++seq;
  const hash = location.hash || '#/';
  if (hash === '#/masuk') {
    app.replaceChildren(loginView(() => (location.hash = '#/')));
    return;
  }
  if (!me) {
    try {
      const r = await api<{ teacher: { name: string; email: string } } | { name: string; email: string }>('/auth/me');
      me = 'teacher' in r ? r.teacher : r;
    } catch {
      location.hash = '#/masuk';
      return;
    }
  }
  let active = 'home';
  let view: Promise<HTMLElement> | HTMLElement;
  const m = /^#\/sesi\/([0-9a-f-]{36})$/.exec(hash);
  if (hash === '#/sesi/baru') {
    active = 'baru';
    view = sessionFormView();
  } else if (m) {
    active = '';
    view = liveView(m[1]!);
  } else if (hash === '#/soal') {
    active = 'soal';
    view = questionsView();
  } else view = homeView();
  app.replaceChildren(topbar(active), h('main', null, h('p', { class: 'muted' }, 'Memuat…')));
  try {
    const el = await view;
    if (my !== seq) return;
    app.replaceChildren(topbar(active), el);
  } catch (e) {
    if (my !== seq) return;
    if (e instanceof ApiError && e.status === 401) return;
    app.replaceChildren(topbar(active), h('main', null, h('div', { class: 'card' }, h('h2', null, 'Gagal memuat'), h('p', { class: 'err' }, (e as Error).message))));
  }
}

window.addEventListener('hashchange', () => void route());
void route();
