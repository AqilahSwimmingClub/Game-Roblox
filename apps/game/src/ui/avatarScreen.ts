/** Layar 4 — Pilih Avatar: pratinjau 3D yang bisa diputar, tab kategori, kartu pilihan, Acak, SIAP! */
import * as THREE from 'three';
import { AVATAR_OPTIONS, type AvatarConfig } from '@eduverse/shared';
import { AvatarMesh } from '../engine/avatar.js';
import { h, btn, ui } from './dom.js';

type Cat = keyof AvatarConfig;
const TABS: { id: Cat; nama: string }[] = [
  { id: 'kulit', nama: 'Badan' },
  { id: 'rambut', nama: 'Rambut' },
  { id: 'baju', nama: 'Baju' },
  { id: 'topi', nama: 'Topi' },
  { id: 'aksesori', nama: 'Aksesori' },
  { id: 'warna', nama: 'Warna' },
];

export function pilihAvatar(current: AvatarConfig, nameTag: string, save: (cfg: AvatarConfig) => Promise<void>): Promise<AvatarConfig> {
  return new Promise((resolve) => {
    const cfg: AvatarConfig = { ...current };
    // Pratinjau: renderer kecil terpisah (dibuang saat layar ditutup)
    const canvas = h('canvas', { 'aria-label': 'Pratinjau avatar, geser untuk memutar' }) as HTMLCanvasElement;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b5cf6, 1.6), key);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    cam.position.set(0, 1.3, 6);
    cam.lookAt(0, 1.05, 0);
    const avatar = new AvatarMesh(cfg);
    scene.add(avatar.root);
    let yaw = 0.4;
    let dragging = false;
    let lastX = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      yaw += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
    });
    canvas.addEventListener('pointerup', () => (dragging = false));
    let alive = true;
    let last = performance.now();
    const loop = () => {
      if (!alive) return;
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth;
      const ht = canvas.clientHeight;
      if (w && ht && (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(ht * renderer.getPixelRatio()))) {
        renderer.setSize(w, ht, false);
        cam.aspect = w / ht;
        cam.updateProjectionMatrix();
      }
      if (!dragging) yaw += dt * 0.3;
      avatar.root.rotation.y = yaw;
      avatar.update(dt, 0, 0);
      renderer.render(scene, cam);
    };
    requestAnimationFrame(loop);

    let tab: Cat = 'kulit';
    const tabsEl = h('div', { class: 'tabs' });
    const grid = h('div', { class: 'grid' });
    const renderTabs = () =>
      tabsEl.replaceChildren(
        ...TABS.map((t) =>
          h(
            'button',
            {
              class: `tab${t.id === tab ? ' aktif' : ''}`,
              onclick: () => {
                tab = t.id;
                renderTabs();
                renderGrid();
              },
            },
            t.nama,
          ),
        ),
      );
    const pick = (cat: Cat, i: number) => {
      cfg[cat] = i;
      avatar.build(cfg);
      renderGrid();
    };
    const renderGrid = () => {
      const opts = AVATAR_OPTIONS[tab] as readonly unknown[];
      grid.replaceChildren(
        ...opts.map((o, i) => {
          const sel = cfg[tab] === i;
          let content: (Node | string)[] = [];
          if (tab === 'kulit') content = [h('span', { class: 'swatch', style: `background:${(o as { warna: string }).warna}` }), (o as { nama: string }).nama];
          else if (tab === 'warna') content = [h('span', { class: 'swatch', style: `background:${o as string};width:40px;height:40px` })];
          else if (tab === 'baju') {
            const b = o as { nama: string; atas: string; bawah: string };
            content = [h('span', { class: 'swatch', style: `background:linear-gradient(${b.atas} 55%, ${b.bawah} 55%)` }), b.nama];
          } else content = [(o as { nama: string }).nama];
          return h('button', { class: `opt${sel ? ' pilih' : ''}`, 'aria-pressed': String(sel), onclick: () => pick(tab, i) }, ...content);
        }),
      );
    };
    renderTabs();
    renderGrid();

    const rnd = (n: number) => Math.floor(Math.random() * n);
    const acak = btn('Acak', 'kuning', () => {
      cfg.kulit = rnd(AVATAR_OPTIONS.kulit.length);
      cfg.rambut = rnd(AVATAR_OPTIONS.rambut.length);
      cfg.baju = rnd(AVATAR_OPTIONS.baju.length);
      cfg.topi = rnd(AVATAR_OPTIONS.topi.length);
      cfg.aksesori = rnd(AVATAR_OPTIONS.aksesori.length);
      cfg.warna = rnd(AVATAR_OPTIONS.warna.length);
      avatar.build(cfg);
      renderGrid();
    });
    const siap = btn('SIAP!', 'hijau', async () => {
      siap.disabled = true;
      await save(cfg);
      alive = false;
      avatar.dispose();
      renderer.dispose();
      scr.remove();
      resolve(cfg);
    });
    siap.style.minWidth = '160px';
    const scr = ui.show(
      h(
        'div',
        { class: 'screen', style: 'background:linear-gradient(135deg,#8B5CF6,#3BA7FF)' },
        h(
          'div',
          { class: 'avatar-layout' },
          h('div', { class: 'avatar-preview' }, canvas, h('div', { class: 'nametag chip', style: 'background:#fff;font-size:16px' }, nameTag)),
          h('div', { class: 'panel avatar-options' }, h('h2', { style: 'font-size:26px' }, 'Pilih Avatarmu'), tabsEl, grid, h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:auto' }, acak, siap)),
        ),
      ),
    );
  });
}
