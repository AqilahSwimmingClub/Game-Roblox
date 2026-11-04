/** Penanda peta Kota Hidup: lubang dimensi, stasiun jetpack, area parkir/kendaraan, pedagang, bandara. */
import { buildKota } from '@eduverse/shared';

export type LandmarkKind = 'portal' | 'jetpack' | 'parkir' | 'pesawat' | 'pedagang';
export interface Landmark {
  kind: LandmarkKind;
  x: number;
  z: number;
  label: string;
}

let cache: Landmark[] | null = null;

export function landmarks(): Landmark[] {
  if (cache) return cache;
  const L = buildKota().living;
  const out: Landmark[] = [];
  for (const r of L.rifts) if (!r.secret) out.push({ kind: 'portal', x: r.x, z: r.z, label: r.to ? r.nama : 'Gerbang Antardunia' });
  for (const j of L.jetpacks) out.push({ kind: 'jetpack', x: j.x, z: j.z, label: `Jetpack ${j.label}` });
  // satu penanda per kelompok kendaraan (area parkir)
  const groups: { x: number; z: number; n: number; plane: boolean }[] = [];
  for (const v of L.vehicles) {
    const g = groups.find((q) => Math.hypot(q.x - v.x, q.z - v.z) < 40 && q.plane === (v.kind === 'pesawat'));
    if (g) g.n++;
    else groups.push({ x: v.x, z: v.z, n: 1, plane: v.kind === 'pesawat' });
  }
  for (const g of groups) out.push({ kind: g.plane ? 'pesawat' : 'parkir', x: g.x, z: g.z, label: g.plane ? 'Pesawat' : 'Parkir' });
  for (const v of L.vendors) out.push({ kind: 'pedagang', x: v.x, z: v.z, label: v.nama });
  cache = out;
  return out;
}

const COLOR: Record<LandmarkKind, string> = { portal: '#8B5CF6', jetpack: '#FF8A3D', parkir: '#3BA7FF', pesawat: '#1FB6D9', pedagang: '#FFC93C' };
const LETTER: Record<LandmarkKind, string> = { portal: '◎', jetpack: 'J', parkir: 'P', pesawat: '✈', pedagang: '!' };

/**
 * Gambar penanda di kanvas peta. tx/tz mengubah koordinat dunia → piksel; size = jari-jari ikon.
 * upright: sudut kanvas saat ini (radian) agar huruf tetap tegak pada peta mini yang berputar.
 */
export function drawLandmarks(c: CanvasRenderingContext2D, tx: (x: number) => number, tz: (z: number) => number, size: number, opts: { upright?: number; labels?: boolean; clip?: number } = {}) {
  for (const l of landmarks()) {
    const x = tx(l.x);
    const y = tz(l.z);
    if (opts.clip !== undefined && (Math.abs(x) > opts.clip || Math.abs(y) > opts.clip)) continue;
    c.save();
    c.translate(x, y);
    if (opts.upright) c.rotate(-opts.upright);
    c.fillStyle = COLOR[l.kind];
    c.strokeStyle = '#FFFFFF';
    c.lineWidth = Math.max(1.5, size * 0.25);
    c.beginPath();
    if (l.kind === 'portal') c.arc(0, 0, size, 0, Math.PI * 2);
    else if (c.roundRect) c.roundRect(-size, -size, size * 2, size * 2, size * 0.4);
    else c.rect(-size, -size, size * 2, size * 2); // Chrome lama (< 99)
    c.fill();
    c.stroke();
    c.fillStyle = l.kind === 'pedagang' ? '#1E2A4A' : '#FFFFFF';
    c.font = `900 ${Math.round(size * 1.3)}px Nunito, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(LETTER[l.kind], 0, size * 0.06);
    if (opts.labels && l.kind !== 'pedagang') {
      c.font = `800 ${Math.round(size * 1.05)}px Nunito, sans-serif`;
      c.fillStyle = '#1E2A4A';
      c.fillText(l.label, 0, size * 2.2);
    }
    c.restore();
  }
}

export const LANDMARK_LEGEND: [string, string][] = [
  ['#8B5CF6', 'Lubang dimensi'],
  ['#FF8A3D', 'Jetpack'],
  ['#3BA7FF', 'Parkir'],
  ['#1FB6D9', 'Pesawat'],
  ['#FFC93C', 'Pedagang'],
];
