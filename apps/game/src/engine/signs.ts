/** Tekstur kanvas untuk papan nama, label, dan nametag (tanpa aset gambar eksternal). */
import * as THREE from 'three';

function hex(c: number) {
  return '#' + c.toString(16).padStart(6, '0');
}

export function makeSignTexture(text: string, bg: number, fg: number, aspect: number): THREE.CanvasTexture {
  const h = 128;
  const w = Math.max(128, Math.min(1024, Math.round(h * aspect)));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = hex(bg);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = hex(fg);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  let size = Math.floor(h / (lines.length + 0.4));
  ctx.font = `700 ${size}px Fredoka, Nunito, sans-serif`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > w * 0.9) size = Math.floor((size * w * 0.9) / widest);
  ctx.font = `700 ${size}px Fredoka, Nunito, sans-serif`;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, (h / (lines.length + 1)) * (i + 1)));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Sprite label (nama pemain, tanda tanya titik soal). */
export function makeLabelSprite(text: string, opts: { bg?: string; fg?: string; border?: string; scale?: number; round?: boolean } = {}): THREE.Sprite {
  const pad = 18;
  const fontSize = 44;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  ctx.font = `800 ${fontSize}px Nunito, sans-serif`;
  const tw = Math.ceil(ctx.measureText(text).width);
  const w = opts.round ? fontSize + pad * 2 : tw + pad * 2;
  const h = fontSize + pad * 1.4;
  cv.width = w;
  cv.height = Math.ceil(h);
  ctx.font = `800 ${fontSize}px Nunito, sans-serif`;
  ctx.fillStyle = opts.bg ?? 'rgba(244,248,255,0.92)';
  const r = opts.round ? h / 2 : h / 2;
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, h - 4, r);
  ctx.fill();
  if (opts.border) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = opts.border;
    ctx.stroke();
  }
  ctx.fillStyle = opts.fg ?? '#1E2A4A';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true });
  const s = new THREE.Sprite(mat);
  const scale = opts.scale ?? 0.011;
  s.scale.set(w * scale, h * scale, 1);
  return s;
}
