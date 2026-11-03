/**
 * Layar Pilih Karakter: 20 karakter 3D EDUVERSE (kartu bergambar render 3D asli), tab kategori,
 * pratinjau 3D yang bisa diputar, pilihan warna kulit untuk karakter manusia, Acak, SIAP!
 */
import * as THREE from 'three';
import { AVATAR_OPTIONS, CHARACTERS, CHARACTER_CATEGORIES, type AvatarConfig, type CharacterCategory } from '@eduverse/shared';
import { AvatarMesh } from '../engine/avatar.js';
import { h, btn, ui } from './dom.js';

const noSkin = (id: number) => !!CHARACTERS[id]?.robot || CHARACTERS[id]?.kode === 'astronot';

/** Render kartu-kartu karakter sekali (gambar dari model 3D yang sama dengan di dalam game). */
let thumbCache: Map<string, string> | null = null;
function thumbnails(kulit: number): Map<string, string> {
  thumbCache ??= new Map();
  const missing = CHARACTERS.filter((c) => !thumbCache!.has(`${c.id}:${noSkin(c.id) ? 0 : kulit}`));
  if (!missing.length) return thumbCache;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setPixelRatio(1);
  r.setSize(150, 180, false);
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(2, 4, 5);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb4d8, 1.7), key);
  const cam = new THREE.PerspectiveCamera(30, 150 / 180, 0.1, 30);
  cam.position.set(1.2, 1.55, 5.2);
  cam.lookAt(0, 1.05, 0);
  for (const c of missing) {
    const sk = noSkin(c.id) ? 0 : kulit;
    const av = new AvatarMesh({ karakter: c.id, kulit: sk });
    av.root.rotation.y = 0.35;
    av.update(0.016, 0, 0);
    scene.add(av.root);
    r.render(scene, cam);
    thumbCache.set(`${c.id}:${sk}`, r.domElement.toDataURL('image/png'));
    av.dispose();
  }
  r.dispose();
  r.forceContextLoss();
  return thumbCache;
}

export function pilihAvatar(current: AvatarConfig, nameTag: string, save: (cfg: AvatarConfig) => Promise<void>): Promise<AvatarConfig> {
  return new Promise((resolve) => {
    const cfg: AvatarConfig = { karakter: current.karakter, kulit: current.kulit };
    // Pratinjau besar: renderer kecil terpisah (dibuang saat layar ditutup)
    const canvas = h('canvas', { 'aria-label': 'Pratinjau karakter, geser untuk memutar' }) as HTMLCanvasElement;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b5cf6, 1.6), key);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    cam.position.set(0, 1.35, 6.4);
    cam.lookAt(0, 1.1, 0);
    const avatar = new AvatarMesh(cfg);
    scene.add(avatar.root);
    let yaw = 0.4;
    let dragging = false;
    let lastX = 0;
    let previewAnim = 0;
    let animT = 0;
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
      // Pratinjau animasi singkat setelah memilih: lambai → jalan → diam
      animT += dt;
      if (previewAnim === 1 && animT > 1.4) previewAnim = 2;
      if (previewAnim === 2 && animT > 2.6) previewAnim = 0;
      avatar.emote = previewAnim === 1 ? 0 : -1;
      avatar.update(dt, previewAnim === 2 ? 1 : 0, 0.6);
      renderer.render(scene, cam);
    };
    requestAnimationFrame(loop);

    let cat: CharacterCategory | 'semua' = 'semua';
    const title = h('div', { class: 'char-title' });
    const tabsEl = h('div', { class: 'tabs' });
    const grid = h('div', { class: 'grid char-grid' });
    const skinRow = h('div', { class: 'row skin-row' });

    const renderTitle = () => {
      const c = CHARACTERS[cfg.karakter]!;
      title.replaceChildren(h('b', null, c.nama), h('span', null, c.deskripsi));
    };
    const renderTabs = () =>
      tabsEl.replaceChildren(
        ...CHARACTER_CATEGORIES.map((t) =>
          h('button', { class: `tab${t.id === cat ? ' aktif' : ''}`, onclick: () => ((cat = t.id), renderTabs(), renderGrid()) }, t.nama),
        ),
      );
    const renderGrid = () => {
      const thumbs = thumbnails(cfg.kulit);
      grid.replaceChildren(
        ...CHARACTERS.filter((c) => cat === 'semua' || c.kategori === cat).map((c) => {
          const sel = cfg.karakter === c.id;
          const src = thumbs.get(`${c.id}:${noSkin(c.id) ? 0 : cfg.kulit}`) ?? '';
          return h(
            'button',
            { class: `opt char-card${sel ? ' pilih' : ''}`, 'aria-pressed': String(sel), 'data-karakter': String(c.id), onclick: () => pick(c.id) },
            h('img', { src, alt: '', draggable: 'false' }),
            h('span', null, c.nama),
          );
        }),
      );
    };
    const renderSkin = () => {
      const hide = noSkin(cfg.karakter);
      skinRow.style.visibility = hide ? 'hidden' : 'visible';
      skinRow.replaceChildren(
        h('span', { style: 'font-weight:900' }, 'Warna kulit'),
        ...AVATAR_OPTIONS.kulit.map((k, i) =>
          h('button', { class: `skin${cfg.kulit === i ? ' pilih' : ''}`, 'aria-label': k.nama, title: k.nama, style: `background:${k.warna}`, onclick: () => ((cfg.kulit = i), avatar.build(cfg), renderSkin(), renderGrid()) }),
        ),
      );
    };
    const pick = (id: number) => {
      cfg.karakter = id;
      avatar.build(cfg);
      previewAnim = 1;
      animT = 0;
      renderTitle();
      renderSkin();
      renderGrid();
    };
    renderTabs();
    renderTitle();
    renderSkin();
    renderGrid();

    const acak = btn('Acak', 'kuning', () => {
      cfg.kulit = Math.floor(Math.random() * AVATAR_OPTIONS.kulit.length);
      pick(Math.floor(Math.random() * CHARACTERS.length));
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
          h('div', { class: 'avatar-preview' }, canvas, h('div', { class: 'nametag chip', style: 'background:#fff;font-size:16px' }, nameTag), title),
          h('div', { class: 'panel avatar-options' }, h('h2', { style: 'font-size:26px' }, 'Pilih Karaktermu'), tabsEl, grid, skinRow, h('div', { class: 'row', style: 'justify-content:flex-end' }, acak, siap)),
        ),
      ),
    );
  });
}
