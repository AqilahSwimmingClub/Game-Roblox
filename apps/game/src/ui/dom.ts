/** Pembantu DOM kecil (tanpa framework) + notifikasi antre. */
import { sfx } from '../world/audio.js';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
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

export function btn(label: Child | Child[], cls: string, onClick: () => void, attrs: Attrs = {}): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: `btn ${cls}`,
      ...attrs,
      onclick: (e: Event) => {
        e.stopPropagation();
        sfx.click();
        onClick();
      },
    },
    ...(Array.isArray(label) ? label : [label]),
  );
}

export function edo(size = 96): HTMLElement {
  return h('span', { class: 'edo', style: `--s:${size}px`, 'aria-hidden': 'true' }, h('i'), h('i'), h('b'), h('u'));
}

export const ui = {
  root: document.getElementById('ui')!,
  /** Ganti layar utama (lapisan modal tetap). */
  show(el: HTMLElement): HTMLElement {
    this.root.querySelectorAll(':scope > .screen').forEach((n) => n.remove());
    this.root.appendChild(el);
    return el;
  },
  add(el: HTMLElement): HTMLElement {
    this.root.appendChild(el);
    return el;
  },
  clearScreens() {
    this.root.querySelectorAll(':scope > .screen').forEach((n) => n.remove());
  },
};

// ── Notifikasi (banner 3 detik, satu sekaligus, sisanya antre) ──
const KIND_COLOR: Record<string, string> = { info: '#3BA7FF', sukses: '#2FBF71', misi: '#2FBF71', peringatan: '#FF8A3D', kunci: '#FF8A3D', kejutan: '#8B5CF6' };
const queue: { text: string; kind: string }[] = [];
let showing = false;
const wrap = h('div', { class: 'notify-wrap' });
document.body.appendChild(wrap);

export function notify(text: string, kind = 'info') {
  queue.push({ text, kind });
  if (queue.length > 4) queue.shift();
  next();
}

function next() {
  if (showing || !queue.length) return;
  showing = true;
  const it = queue.shift()!;
  sfx.notify();
  const el = h('div', { class: 'panel tipis notify', role: 'status' }, h('i', { style: `background:${KIND_COLOR[it.kind] ?? '#3BA7FF'}` }), h('span', null, it.text));
  wrap.appendChild(el);
  // durasi sesuai panjang teks (2,2–4 dtk) + bisa diketuk untuk menutup; pesan antre dipercepat
  const ms = Math.min(4000, Math.max(2200, it.text.length * 45)) * (queue.length ? 0.7 : 1);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
    showing = false;
    next();
  };
  el.addEventListener('pointerdown', finish);
  setTimeout(finish, ms);
}
