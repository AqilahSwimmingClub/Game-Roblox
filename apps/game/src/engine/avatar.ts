/**
 * Avatar EDUVERSE — 20 karakter preset orisinal di atas SATU rig yang sama:
 *   root → body → { legL, legR (poros pinggul), armL, armR (poros bahu), head (poros leher) }
 * Semua karakter berbagi animasi prosedural (idle, jalan, lari, lompat, renang, duduk, emote), sehingga
 * animasi baru cukup ditambahkan sekali di update().
 *
 * Optimasi HP: kotak-kotak tiap bagian digabung menjadi SATU mesh berwarna-verteks dengan SATU material
 * bersama → ±6–8 draw call per avatar (hiasan bertekstur seperti batik/nomor/lambang menambah 1–2).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AVATAR_OPTIONS, CHARACTERS, type AvatarConfig } from '@eduverse/shared';

export const ANIM = { idle: 0, walk: 1, run: 2, air: 3, swim: 4, sit: 5 } as const;

type Part = 'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR';
type Piece = { g: THREE.BufferGeometry; c: THREE.Color };

/** Material bersama semua avatar (warna dari atribut verteks). */
const SHARED = new THREE.MeshLambertMaterial({ vertexColors: true });
SHARED.userData.shared = true;

// ───────────────── tekstur hiasan (dibuat sekali, dipakai bersama) ─────────────────
const texCache = new Map<string, THREE.MeshLambertMaterial>();
function decal(key: string, size: [number, number], draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, transparent = false) {
  let m = texCache.get(key);
  if (m) return m;
  const cv = document.createElement('canvas');
  cv.width = size[0];
  cv.height = size[1];
  const g = cv.getContext('2d')!;
  draw(g, cv.width, cv.height);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  m = new THREE.MeshLambertMaterial({ map: t, transparent, alphaTest: transparent ? 0.3 : 0 });
  m.userData.shared = true;
  texCache.set(key, m);
  return m;
}
/** Motif batik kawung sederhana (pola geometris tradisional). */
const batik = (base: string, ink: string, dot: string) =>
  decal(`batik-${base}-${ink}`, [64, 64], (g, w) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, w);
    const s = 16;
    for (let y = 0; y < w; y += s)
      for (let x = 0; x < w; x += s) {
        g.fillStyle = ink;
        for (const [dx, dy] of [
          [0.5, 0.18],
          [0.5, 0.82],
          [0.18, 0.5],
          [0.82, 0.5],
        ]) {
          g.beginPath();
          g.ellipse(x + dx! * s, y + dy! * s, s * 0.17, s * 0.17, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = dot;
        g.fillRect(x + s * 0.44, y + s * 0.44, s * 0.12, s * 0.12);
      }
  });
/** Lambang bintang-buku EDUVERSE (orisinal) untuk karakter pahlawan. */
const emblem = (bg: string, fg: string) =>
  decal(`emblem-${bg}-${fg}`, [64, 64], (g, w) => {
    g.fillStyle = bg;
    g.beginPath();
    g.arc(w / 2, w / 2, w * 0.46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = fg;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? w * 0.15 : w * 0.34;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(w / 2 + Math.cos(a) * r, w * 0.46 + Math.sin(a) * r);
    }
    g.fill();
    g.fillRect(w * 0.28, w * 0.7, w * 0.44, w * 0.06); // "buku" di bawah bintang
  }, true);
const jerseyNo = (n: string) =>
  decal(`no-${n}`, [64, 64], (g, w) => {
    g.fillStyle = '#FFFFFF';
    g.font = 'bold 46px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(n, w / 2, w / 2 + 3);
  }, true);

// ───────────────── pembangun bagian ─────────────────
class Kit {
  parts: Record<Part, Piece[]> = { body: [], head: [], armL: [], armR: [], legL: [], legR: [] };
  decals: { part: Part; mesh: THREE.Mesh }[] = [];
  /** Kotak w×h×d berwarna c, titik pusat (x,y,z) relatif terhadap poros bagian. */
  box(part: Part, w: number, h: number, d: number, c: string, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx || rz) g.rotateX(rx).rotateZ(rz);
    g.translate(x, y, z);
    this.parts[part].push({ g, c: new THREE.Color(c) });
  }
  /** Sama untuk kedua sisi (lengan/kaki kiri-kanan, atau hiasan simetris di badan/kepala). */
  pair(part: 'arm' | 'leg', w: number, h: number, d: number, c: string, x = 0, y = 0, z = 0) {
    this.box(part === 'arm' ? 'armL' : 'legL', w, h, d, c, x, y, z);
    this.box(part === 'arm' ? 'armR' : 'legR', w, h, d, c, -x, y, z);
  }
  sym(part: Part, w: number, h: number, d: number, c: string, x: number, y = 0, z = 0) {
    this.box(part, w, h, d, c, x, y, z);
    this.box(part, w, h, d, c, -x, y, z);
  }
  /** Bidang bertekstur di depan/samping sebuah bagian. */
  plane(part: Part, mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, ry = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    this.decals.push({ part, mesh: m });
  }
  texturedBox(part: Part, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    this.decals.push({ part, mesh: m });
  }
}

interface Look {
  skin: string;
  top: string;
  bottom: string;
  shoe: string;
  sleeve: 'pendek' | 'panjang';
  sleeveColor?: string;
  skirt?: string;
  sock?: string;
  shorts?: boolean;
}

/** Badan manusia standar (rig yang sama untuk semua karakter manusia). */
function human(k: Kit, l: Look) {
  // Kaki: poros pinggul y=0.78; panjang 0.62
  if (l.skirt) {
    k.pair('leg', 0.28, 0.3, 0.3, l.skin, 0, -0.17);
    k.pair('leg', 0.3, 0.32, 0.32, l.sock ?? l.skin, 0, -0.46);
  } else if (l.shorts) {
    k.pair('leg', 0.3, 0.3, 0.32, l.bottom, 0, -0.15);
    k.pair('leg', 0.27, 0.32, 0.29, l.sock ?? l.skin, 0, -0.46);
  } else k.pair('leg', 0.3, 0.62, 0.32, l.bottom, 0, -0.31);
  k.pair('leg', 0.32, 0.16, 0.4, l.shoe, 0, -0.7, 0.02);
  // Badan (pusat 1.14, tinggi 0.72) — rok di pinggul
  k.box('body', 0.72, 0.72, 0.4, l.top, 0, 1.14);
  if (l.skirt) k.box('body', 0.8, 0.34, 0.46, l.skirt, 0, 0.72);
  else k.box('body', 0.74, 0.12, 0.42, l.bottom, 0, 0.82); // pinggang celana
  // Lengan: poros bahu y=1.46 (x ±0.48)
  const sc = l.sleeveColor ?? l.top;
  if (l.sleeve === 'panjang') {
    k.pair('arm', 0.24, 0.6, 0.28, sc, 0, -0.3);
    k.pair('arm', 0.22, 0.14, 0.24, l.skin, 0, -0.66);
  } else {
    k.pair('arm', 0.25, 0.3, 0.29, sc, 0, -0.15);
    k.pair('arm', 0.22, 0.42, 0.25, l.skin, 0, -0.5);
  }
  // Kepala: poros leher y=1.5; kotak 0.62
  k.box('head', 0.62, 0.62, 0.6, l.skin, 0, 0.31);
  face(k, '#1E2A4A');
}
function face(k: Kit, eye: string, blush = true) {
  k.sym('head', 0.09, 0.12, 0.02, eye, 0.13, 0.36, 0.305);
  k.sym('head', 0.035, 0.035, 0.02, '#FFFFFF', 0.115, 0.39, 0.317);
  k.box('head', 0.16, 0.04, 0.02, '#9B3B3B', 0, 0.19, 0.305);
  if (blush) k.sym('head', 0.08, 0.04, 0.02, '#F28C8C', 0.22, 0.25, 0.303);
}

type Hair = 'pendek' | 'cepak' | 'panjang' | 'kuncir' | 'sanggul' | 'ikal' | 'poni';
function hair(k: Kit, style: Hair, c: string, accent = '#FFC93C') {
  const top = () => k.box('head', 0.66, 0.14, 0.64, c, 0, 0.67);
  switch (style) {
    case 'cepak':
      k.box('head', 0.64, 0.08, 0.62, c, 0, 0.65);
      k.box('head', 0.64, 0.2, 0.08, c, 0, 0.55, -0.28);
      break;
    case 'pendek':
      top();
      k.box('head', 0.66, 0.32, 0.1, c, 0, 0.5, -0.28);
      k.sym('head', 0.06, 0.2, 0.36, c, 0.33, 0.55, -0.1);
      k.box('head', 0.5, 0.08, 0.06, c, 0.04, 0.57, 0.3); // poni samping
      break;
    case 'poni':
      top();
      k.box('head', 0.66, 0.36, 0.1, c, 0, 0.48, -0.28);
      k.box('head', 0.6, 0.12, 0.06, c, 0, 0.56, 0.3);
      k.sym('head', 0.06, 0.32, 0.4, c, 0.33, 0.47, -0.08);
      break;
    case 'panjang':
      top();
      k.box('head', 0.7, 0.86, 0.12, c, 0, 0.24, -0.3);
      k.sym('head', 0.08, 0.66, 0.46, c, 0.34, 0.34, -0.06);
      k.box('head', 0.62, 0.1, 0.06, c, 0, 0.58, 0.3);
      break;
    case 'kuncir':
      top();
      k.box('head', 0.66, 0.3, 0.1, c, 0, 0.5, -0.28);
      k.sym('head', 0.16, 0.36, 0.16, c, 0.38, 0.4, -0.12); // kuncir dua
      k.sym('head', 0.18, 0.08, 0.18, accent, 0.38, 0.6, -0.12);
      k.box('head', 0.6, 0.1, 0.06, c, 0, 0.58, 0.3);
      break;
    case 'sanggul':
      top();
      k.box('head', 0.66, 0.34, 0.1, c, 0, 0.5, -0.28);
      k.box('head', 0.34, 0.3, 0.24, c, 0, 0.58, -0.42);
      k.box('head', 0.1, 0.1, 0.06, accent, 0.18, 0.66, -0.36); // bunga
      k.box('head', 0.06, 0.06, 0.04, '#FFFFFF', 0.18, 0.66, -0.32);
      break;
    case 'ikal':
      top();
      for (let i = -2; i <= 2; i++) k.box('head', 0.15, 0.15, 0.15, c, i * 0.14, 0.74, (i % 2) * 0.05);
      k.box('head', 0.66, 0.34, 0.12, c, 0, 0.5, -0.28);
      break;
  }
}
function jilbab(k: Kit, c: string) {
  k.box('head', 0.7, 0.18, 0.66, c, 0, 0.68);
  k.sym('head', 0.08, 0.74, 0.66, c, 0.35, 0.3);
  k.box('head', 0.72, 0.76, 0.12, c, 0, 0.32, -0.31);
  k.box('head', 0.66, 0.08, 0.06, c, 0, 0.6, 0.31);
  k.box('body', 0.78, 0.3, 0.46, c, 0, 1.38); // kain menutup bahu & dada atas
}
function tie(k: Kit, c: string, collar = '#FFFFFF') {
  k.sym('body', 0.16, 0.08, 0.04, collar, 0.1, 1.46, 0.2);
  k.box('body', 0.1, 0.36, 0.03, c, 0, 1.26, 0.215);
  k.box('body', 0.13, 0.08, 0.03, c, 0, 1.43, 0.215);
}
function badge(k: Kit, c = '#FFC93C') {
  k.box('body', 0.1, 0.08, 0.02, c, -0.2, 1.34, 0.21);
}
function backpack(k: Kit, c: string, strap = '#1E2A4A') {
  k.box('body', 0.54, 0.6, 0.22, c, 0, 1.12, -0.31);
  k.box('body', 0.4, 0.18, 0.06, strap, 0, 0.98, -0.44);
  k.sym('body', 0.08, 0.66, 0.04, strap, 0.22, 1.16, 0.215);
}
function cape(k: Kit, c: string) {
  k.box('body', 0.76, 1.0, 0.06, c, 0, 1.0, -0.25, 0.08);
  k.box('body', 0.84, 0.12, 0.5, c, 0, 1.5, -0.02);
}
/** Benda di tangan kanan (ujung lengan ±0.7 di bawah bahu). */
function holdR(k: Kit, fn: (k: Kit) => void) {
  fn(k);
}

// ───────────────── definisi 20 karakter ─────────────────
const HAIR_DARK = '#2D1B10';
const HAIR_BROWN = '#5A3418';
type Builder = (k: Kit, skin: string) => void;

const BUILDERS: Builder[] = [
  // 0 Astronot Bintang
  (k) => {
    const suit = '#F4F7FB';
    human(k, { skin: suit, top: suit, bottom: suit, shoe: '#8C96A8', sleeve: 'panjang' });
    k.pair('arm', 0.26, 0.16, 0.3, '#8C96A8', 0, -0.66); // sarung tangan
    k.pair('leg', 0.32, 0.08, 0.34, '#FF8A3D', 0, -0.4); // gelang lutut
    k.box('body', 0.4, 0.24, 0.04, '#3BA7FF', 0, 1.24, 0.21); // panel kontrol
    k.sym('body', 0.06, 0.06, 0.03, '#FFC93C', 0.1, 1.27, 0.23);
    k.box('body', 0.06, 0.06, 0.03, '#E53935', 0, 1.2, 0.23);
    k.box('body', 0.56, 0.62, 0.26, '#DCE3EE', 0, 1.14, -0.33); // tabung oksigen
    k.sym('body', 0.16, 0.5, 0.16, '#FF8A3D', 0.15, 1.16, -0.48);
    // helm (wajah tertutup visor)
    k.box('head', 0.8, 0.76, 0.76, suit, 0, 0.34);
    k.box('head', 0.6, 0.42, 0.04, '#1B3A6B', 0, 0.36, 0.38);
    k.box('head', 0.16, 0.1, 0.02, '#8FD0FF', -0.15, 0.48, 0.405);
    k.box('head', 0.06, 0.22, 0.06, '#8C96A8', 0.3, 0.84); // antena helm
    k.box('head', 0.1, 0.1, 0.1, '#FF8A3D', 0.3, 0.98);
  },
  // 1 Robo Neon (robot siber)
  (k) => {
    const m = '#243B6B';
    const glow = '#38E1FF';
    k.pair('leg', 0.3, 0.62, 0.32, m, 0, -0.31);
    k.pair('leg', 0.32, 0.04, 0.34, glow, 0, -0.32);
    k.pair('leg', 0.34, 0.16, 0.42, '#15233F', 0, -0.7, 0.03);
    k.box('body', 0.76, 0.74, 0.42, m, 0, 1.14);
    k.box('body', 0.3, 0.3, 0.03, glow, 0, 1.2, 0.215);
    k.box('body', 0.18, 0.18, 0.03, '#FFFFFF', 0, 1.2, 0.225);
    k.sym('body', 0.04, 0.6, 0.03, glow, 0.3, 1.14, 0.215);
    k.pair('arm', 0.26, 0.62, 0.28, m, 0, -0.3);
    k.pair('arm', 0.28, 0.04, 0.3, glow, 0, -0.32);
    k.pair('arm', 0.24, 0.14, 0.26, '#15233F', 0, -0.68);
    k.box('head', 0.66, 0.6, 0.6, m, 0, 0.32);
    k.box('head', 0.54, 0.26, 0.03, '#0B1430', 0, 0.36, 0.31); // layar wajah
    k.sym('head', 0.12, 0.08, 0.02, glow, 0.12, 0.38, 0.33);
    k.box('head', 0.2, 0.03, 0.02, glow, 0, 0.27, 0.33);
    k.sym('head', 0.06, 0.24, 0.24, '#15233F', 0.35, 0.34);
    k.box('head', 0.04, 0.28, 0.04, '#8C96A8', 0.2, 0.76, 0);
    k.box('head', 0.09, 0.09, 0.09, glow, 0.2, 0.92, 0);
  },
  // 2 Robo Klasik (robot retro)
  (k) => {
    const red = '#D9483B';
    const steel = '#C9D3E0';
    k.pair('leg', 0.26, 0.6, 0.28, steel, 0, -0.32);
    for (const y of [-0.18, -0.36]) k.pair('leg', 0.3, 0.04, 0.32, '#8C96A8', 0, y);
    k.pair('leg', 0.36, 0.16, 0.44, red, 0, -0.7, 0.03);
    k.box('body', 0.8, 0.76, 0.46, red, 0, 1.14);
    k.box('body', 0.44, 0.34, 0.03, steel, 0, 1.18, 0.24);
    k.sym('body', 0.1, 0.1, 0.04, '#FFC93C', 0.11, 1.24, 0.26);
    k.box('body', 0.3, 0.05, 0.04, '#2FBF71', 0, 1.08, 0.26);
    k.sym('body', 0.08, 0.08, 0.08, '#8C96A8', 0.33, 1.45, 0.2); // baut
    k.pair('arm', 0.2, 0.56, 0.22, steel, 0, -0.3);
    k.pair('arm', 0.3, 0.16, 0.3, red, 0, -0.66);
    k.box('head', 0.66, 0.54, 0.58, steel, 0, 0.29);
    k.sym('head', 0.16, 0.16, 0.03, '#1E2A4A', 0.14, 0.34, 0.3);
    k.sym('head', 0.07, 0.07, 0.03, '#FFC93C', 0.14, 0.34, 0.315);
    k.box('head', 0.3, 0.06, 0.03, '#1E2A4A', 0, 0.16, 0.3);
    k.sym('head', 0.08, 0.2, 0.2, red, 0.36, 0.3);
    k.box('head', 0.05, 0.26, 0.05, '#8C96A8', 0, 0.68);
    k.box('head', 0.14, 0.14, 0.14, '#FFC93C', 0, 0.86);
  },
  // 3 Kapten Cakrawala (pahlawan putra, orisinal)
  (k, skin) => {
    human(k, { skin, top: '#1FA39A', bottom: '#1FA39A', shoe: '#FF8A3D', sleeve: 'panjang' });
    k.pair('arm', 0.26, 0.2, 0.3, '#FF8A3D', 0, -0.62); // sarung tangan
    k.pair('leg', 0.33, 0.24, 0.35, '#FF8A3D', 0, -0.56); // sepatu bot
    k.box('body', 0.76, 0.1, 0.44, '#FFC93C', 0, 0.86); // sabuk
    cape(k, '#FF8A3D');
    k.plane('body', emblem('#FFC93C', '#1E2A4A'), 0.34, 0.34, 0, 1.24, 0.205);
    hair(k, 'cepak', HAIR_DARK);
    k.box('head', 0.64, 0.12, 0.04, '#1E2A4A', 0, 0.38, 0.31); // topeng mata
    k.sym('head', 0.09, 0.07, 0.02, '#FFFFFF', 0.13, 0.38, 0.33);
  },
  // 4 Srikandi Cahaya (pahlawan putri, orisinal)
  (k, skin) => {
    human(k, { skin, top: '#8B5CF6', bottom: '#8B5CF6', shoe: '#FFC93C', sleeve: 'panjang', skirt: '#6D3FD6', sock: '#8B5CF6' });
    k.pair('arm', 0.26, 0.2, 0.3, '#FFC93C', 0, -0.62);
    k.pair('leg', 0.33, 0.26, 0.35, '#FFC93C', 0, -0.55);
    cape(k, '#E86FA8');
    k.plane('body', emblem('#FFFFFF', '#E86FA8'), 0.34, 0.34, 0, 1.24, 0.205);
    hair(k, 'panjang', HAIR_DARK);
    k.box('head', 0.64, 0.12, 0.04, '#E86FA8', 0, 0.38, 0.31);
    k.sym('head', 0.09, 0.07, 0.02, '#FFFFFF', 0.13, 0.38, 0.33);
    k.box('head', 0.5, 0.08, 0.5, '#FFC93C', 0, 0.78); // mahkota
    k.box('head', 0.12, 0.16, 0.06, '#FFC93C', 0, 0.86, 0.22);
  },
  // 5 Penjelajah Rimba
  (k, skin) => {
    human(k, { skin, top: '#C98A4B', bottom: '#6B5B45', shoe: '#5A3418', sleeve: 'pendek', shorts: true, sock: '#E8DCC8' });
    k.sym('body', 0.16, 0.14, 0.03, '#A86F38', 0.17, 1.24, 0.21); // saku
    backpack(k, '#2F7D4F', '#5A3418');
    k.box('body', 0.22, 0.12, 0.12, '#1E2A4A', 0.12, 1.02, 0.26); // teropong
    hair(k, 'pendek', HAIR_BROWN);
    k.box('head', 1.0, 0.05, 1.0, '#B8864E', 0, 0.68); // topi lebar
    k.box('head', 0.66, 0.24, 0.66, '#B8864E', 0, 0.8);
    k.box('head', 0.68, 0.07, 0.68, '#5A3418', 0, 0.72);
  },
  // 6 Detektif Cilik
  (k, skin) => {
    human(k, { skin, top: '#8A6A47', bottom: '#4A3B2C', shoe: '#2D1B10', sleeve: 'panjang' });
    k.box('body', 0.76, 0.4, 0.44, '#8A6A47', 0, 0.68); // mantel panjang
    k.box('body', 0.06, 0.66, 0.03, '#5A4330', 0, 1.0, 0.225);
    k.sym('body', 0.06, 0.06, 0.03, '#FFC93C', 0.1, 1.1, 0.23);
    k.box('body', 0.8, 0.22, 0.46, '#7A5C3C', 0, 1.42); // kerah/kapelet
    hair(k, 'pendek', HAIR_DARK);
    k.box('head', 0.68, 0.24, 0.68, '#6B5B45', 0, 0.76); // topi detektif
    k.box('head', 0.68, 0.05, 0.3, '#6B5B45', 0, 0.66, 0.44);
    k.box('head', 0.68, 0.05, 0.3, '#6B5B45', 0, 0.66, -0.44);
    k.box('head', 0.7, 0.06, 0.7, '#3E3226', 0, 0.68);
    holdR(k, (kk) => {
      kk.box('armR', 0.04, 0.26, 0.04, '#5A3418', 0, -0.82, 0.12);
      kk.box('armR', 0.22, 0.22, 0.04, '#C9D3E0', 0, -1.02, 0.12);
      kk.box('armR', 0.15, 0.15, 0.05, '#8FD0FF', 0, -1.02, 0.12);
    });
  },
  // 7 Pelajar SMA Putra
  (k, skin) => {
    human(k, { skin, top: '#FFFFFF', bottom: '#8C96A8', shoe: '#1E2A4A', sleeve: 'pendek' });
    tie(k, '#6B7385');
    badge(k);
    k.box('body', 0.74, 0.08, 0.42, '#1E2A4A', 0, 0.86);
    hair(k, 'pendek', HAIR_DARK);
  },
  // 8 Pelajar SMA Putri
  (k, skin) => {
    human(k, { skin, top: '#FFFFFF', bottom: '#8C96A8', shoe: '#1E2A4A', sleeve: 'pendek', skirt: '#8C96A8', sock: '#FFFFFF' });
    tie(k, '#6B7385');
    badge(k);
    hair(k, 'panjang', HAIR_BROWN);
  },
  // 9 Pelajar SMP Putra
  (k, skin) => {
    human(k, { skin, top: '#FFFFFF', bottom: '#2C4A8C', shoe: '#1E2A4A', sleeve: 'pendek' });
    tie(k, '#2C4A8C');
    badge(k, '#3BA7FF');
    hair(k, 'poni', HAIR_DARK);
  },
  // 10 Pelajar SMP Putri (berjilbab)
  (k, skin) => {
    human(k, { skin, top: '#FFFFFF', bottom: '#2C4A8C', shoe: '#1E2A4A', sleeve: 'panjang', skirt: '#2C4A8C', sock: '#2C4A8C' });
    k.box('body', 0.8, 0.5, 0.46, '#2C4A8C', 0, 0.62); // rok panjang
    k.pair('leg', 0.3, 0.2, 0.32, '#2C4A8C', 0, -0.4);
    jilbab(k, '#FFFFFF');
    badge(k, '#3BA7FF');
  },
  // 11 Dokter Cilik
  (k, skin) => {
    human(k, { skin, top: '#8FD8F2', bottom: '#5EC4E8', shoe: '#FFFFFF', sleeve: 'panjang', sleeveColor: '#FFFFFF' });
    k.box('body', 0.78, 0.74, 0.44, '#FFFFFF', 0, 1.1); // jas
    k.box('body', 0.22, 0.74, 0.03, '#8FD8F2', 0, 1.12, 0.225); // baju dalam terlihat
    k.box('body', 0.78, 0.36, 0.44, '#FFFFFF', 0, 0.7);
    k.box('body', 0.03, 0.34, 0.03, '#1E2A4A', -0.16, 1.24, 0.235); // stetoskop
    k.box('body', 0.03, 0.34, 0.03, '#1E2A4A', 0.16, 1.24, 0.235);
    k.box('body', 0.12, 0.12, 0.04, '#C9D3E0', 0.12, 1.04, 0.24);
    k.box('body', 0.14, 0.1, 0.03, '#E53935', -0.22, 1.3, 0.235); // tanda palang
    k.box('body', 0.05, 0.16, 0.03, '#FFFFFF', -0.22, 1.3, 0.25);
    hair(k, 'ikal', HAIR_DARK);
  },
  // 12 Pemadam Kebakaran
  (k, skin) => {
    const red = '#E53935';
    human(k, { skin, top: red, bottom: '#2D2F38', shoe: '#1E2A4A', sleeve: 'panjang' });
    for (const y of [1.0, 1.3]) k.box('body', 0.74, 0.06, 0.42, '#FFE14D', 0, y);
    k.pair('arm', 0.26, 0.06, 0.3, '#FFE14D', 0, -0.4);
    k.pair('leg', 0.32, 0.06, 0.34, '#FFE14D', 0, -0.42);
    k.pair('arm', 0.26, 0.16, 0.3, '#1E2A4A', 0, -0.66);
    k.box('body', 0.06, 0.66, 0.03, '#B71C1C', 0, 1.14, 0.215);
    hair(k, 'cepak', HAIR_DARK);
    k.box('head', 0.72, 0.3, 0.7, '#FFC93C', 0, 0.76); // helm
    k.box('head', 0.72, 0.06, 0.4, '#FFC93C', 0, 0.64, -0.46);
    k.box('head', 0.2, 0.22, 0.06, red, 0, 0.78, 0.37);
    k.box('head', 0.08, 0.36, 0.7, '#E5A82E', 0, 0.9);
  },
  // 13 Atlet Sekolah
  (k, skin) => {
    human(k, { skin, top: '#2FBF71', bottom: '#1E2A4A', shoe: '#FF8A3D', sleeve: 'pendek', shorts: true, sock: '#FFFFFF' });
    k.sym('body', 0.06, 0.72, 0.42, '#FFFFFF', 0.33, 1.14);
    k.plane('body', jerseyNo('7'), 0.36, 0.36, 0, 1.2, 0.205);
    k.plane('body', jerseyNo('7'), 0.36, 0.36, 0, 1.2, -0.205, Math.PI);
    hair(k, 'pendek', HAIR_DARK);
    k.box('head', 0.66, 0.08, 0.64, '#E53935', 0, 0.56); // ikat kepala
    k.pair('arm', 0.24, 0.08, 0.28, '#E53935', 0, -0.62); // gelang tangan
  },
  // 14 Pelajar SD Putra
  (k, skin) => {
    human(k, { skin, top: '#FFFFFF', bottom: '#D32F2F', shoe: '#1E2A4A', sleeve: 'pendek', shorts: true, sock: '#FFFFFF' });
    tie(k, '#D32F2F');
    badge(k, '#D32F2F');
    hair(k, 'pendek', HAIR_DARK);
    k.box('head', 0.68, 0.2, 0.66, '#D32F2F', 0, 0.74); // topi SD
    k.box('head', 0.68, 0.05, 0.3, '#D32F2F', 0, 0.66, 0.44);
    k.box('head', 0.12, 0.08, 0.02, '#FFC93C', 0, 0.76, 0.335);
    backpack(k, '#3BA7FF');
  },
  // 15 Pelajar SD Putri
  (k, skin) => {
    human(k, { skin, top: '#FFFFFF', bottom: '#D32F2F', shoe: '#1E2A4A', sleeve: 'pendek', skirt: '#D32F2F', sock: '#FFFFFF' });
    tie(k, '#D32F2F');
    badge(k, '#D32F2F');
    hair(k, 'kuncir', HAIR_DARK, '#E86FA8');
    backpack(k, '#E86FA8');
  },
  // 16 Pelajar Batik Putra
  (k, skin) => {
    human(k, { skin, top: '#9A5B22', bottom: '#1E2A4A', shoe: '#2D1B10', sleeve: 'pendek' });
    k.texturedBox('body', batik('#9A5B22', '#3E2410', '#F2C14E'), 0.735, 0.6, 0.415, 0, 1.2, 0);
    k.pair('arm', 0.26, 0.04, 0.3, '#3E2410', 0, -0.28);
    hair(k, 'cepak', HAIR_DARK);
    k.box('head', 0.64, 0.22, 0.62, '#1A1A1A', 0, 0.74); // peci
  },
  // 17 Pelajar Batik Putri
  (k, skin) => {
    human(k, { skin, top: '#B5476B', bottom: '#4A2A3A', shoe: '#2D1B10', sleeve: 'panjang', skirt: '#4A2A3A', sock: '#4A2A3A' });
    k.texturedBox('body', batik('#B5476B', '#4A1830', '#FFC93C'), 0.735, 0.6, 0.415, 0, 1.2, 0);
    k.texturedBox('body', batik('#4A2A3A', '#2A141F', '#E86FA8'), 0.82, 0.5, 0.48, 0, 0.62, 0); // kain panjang
    k.pair('leg', 0.3, 0.2, 0.32, '#4A2A3A', 0, -0.4);
    hair(k, 'sanggul', HAIR_DARK, '#FFFFFF');
  },
  // 18 Chef Cilik
  (k, skin) => {
    human(k, { skin, top: '#FFFFFF', bottom: '#3E4A61', shoe: '#1E2A4A', sleeve: 'panjang' });
    k.sym('body', 0.07, 0.07, 0.03, '#1E2A4A', 0.12, 1.3, 0.215);
    k.sym('body', 0.07, 0.07, 0.03, '#1E2A4A', 0.12, 1.12, 0.215);
    k.box('body', 0.6, 0.62, 0.03, '#FF8A3D', 0, 0.9, 0.22); // celemek
    k.box('body', 0.4, 0.1, 0.46, '#E53935', 0, 1.47); // syal leher
    hair(k, 'pendek', HAIR_BROWN);
    k.box('head', 0.66, 0.12, 0.64, '#FFFFFF', 0, 0.66); // topi koki
    k.box('head', 0.6, 0.42, 0.58, '#FFFFFF', 0, 0.92);
    k.box('head', 0.72, 0.16, 0.7, '#F1F4F9', 0, 1.16);
    holdR(k, (kk) => {
      kk.box('armR', 0.05, 0.4, 0.05, '#B8864E', 0, -0.9, 0.12);
      kk.box('armR', 0.13, 0.13, 0.06, '#B8864E', 0, -1.12, 0.12);
    });
  },
  // 19 Seniman Cilik
  (k, skin) => {
    human(k, { skin, top: '#FFFFFF', bottom: '#2C4A8C', shoe: '#E86FA8', sleeve: 'pendek' });
    for (const y of [0.92, 1.12, 1.32]) k.box('body', 0.74, 0.07, 0.42, '#1E2A4A', 0, y); // kaus belang
    k.box('body', 0.56, 0.5, 0.03, '#F1E4C8', 0, 0.98, 0.22); // celemek bernoda cat
    for (const [x, y, c] of [
      [-0.12, 1.04, '#E53935'],
      [0.14, 0.9, '#3BA7FF'],
      [0.06, 1.12, '#FFC93C'],
    ] as const)
      k.box('body', 0.07, 0.07, 0.02, c, x, y, 0.24);
    hair(k, 'ikal', HAIR_BROWN);
    k.box('head', 0.72, 0.14, 0.7, '#E53935', -0.04, 0.72, 0, 0, 0.14); // baret
    k.box('head', 0.06, 0.08, 0.06, '#E53935', -0.06, 0.82);
    holdR(k, (kk) => {
      kk.box('armR', 0.04, 0.34, 0.04, '#B8864E', 0, -0.86, 0.12);
      kk.box('armR', 0.06, 0.08, 0.06, '#3BA7FF', 0, -1.04, 0.12);
    });
    k.box('armL', 0.34, 0.04, 0.26, '#E6C998', 0, -0.74, 0.14); // palet
    for (const [x, c] of [
      [-0.1, '#E53935'],
      [0, '#2FBF71'],
      [0.1, '#FFC93C'],
    ] as const)
      k.box('armL', 0.06, 0.03, 0.06, c, x, -0.71, 0.18);
  },
];

if (BUILDERS.length !== CHARACTERS.length) console.warn('[avatar] jumlah pembangun karakter tidak sama dengan CHARACTERS');

export class AvatarMesh {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private phase = 0;
  emote = -1;
  private emoteT = 0;
  /** Karakter yang sedang dipakai (untuk menghindari bangun ulang yang sama). */
  key = '';

  constructor(cfg: AvatarConfig) {
    this.build(cfg);
    this.root.add(this.body);
  }

  build(cfg: AvatarConfig) {
    const key = `${cfg.karakter}:${cfg.kulit}`;
    if (key === this.key) return;
    this.key = key;
    for (const g of [this.body, this.head, this.armL, this.armR, this.legL, this.legR]) {
      for (const o of [...g.children]) {
        if (o instanceof THREE.Group) continue;
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mat = m.material as THREE.Material;
          if (!mat.userData.shared) mat.dispose();
        }
        g.remove(o);
      }
    }
    this.body.clear();
    const skin = AVATAR_OPTIONS.kulit[cfg.kulit]?.warna ?? '#C68A5B';
    const k = new Kit();
    (BUILDERS[cfg.karakter] ?? BUILDERS[14]!)(k, skin);

    // Poros rig (sama untuk semua karakter)
    this.legL.position.set(-0.17, 0.78, 0);
    this.legR.position.set(0.17, 0.78, 0);
    this.armL.position.set(-0.48, 1.46, 0);
    this.armR.position.set(0.48, 1.46, 0);
    this.head.position.set(0, 1.5, 0);
    const groups: Record<Part, THREE.Group> = { body: this.body, head: this.head, armL: this.armL, armR: this.armR, legL: this.legL, legR: this.legR };
    for (const part of Object.keys(groups) as Part[]) {
      const pieces = k.parts[part];
      if (!pieces.length) continue;
      const geos = pieces.map(({ g, c }) => {
        const n = g.attributes.position!.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.deleteAttribute('uv');
        return g;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, SHARED);
      mesh.castShadow = true;
      groups[part].add(mesh);
    }
    for (const d of k.decals) groups[d.part].add(d.mesh);
    this.body.add(this.legL, this.legR, this.armL, this.armR, this.head);
  }

  /** Perbarui pose. anim: kode ANIM; speed 0..1 relatif terhadap lari. */
  update(dt: number, anim: number, speed01: number) {
    const b = this.body;
    let swing = 0;
    let armSwing = 0;
    b.rotation.x = 0;
    b.position.y = 0;
    this.head.rotation.set(0, 0, 0);
    this.armL.rotation.z = 0;
    this.armR.rotation.z = 0;
    if (anim === ANIM.walk || anim === ANIM.run) {
      this.phase += dt * (anim === ANIM.run ? 13 : 8.5) * Math.max(0.4, speed01);
      swing = Math.sin(this.phase) * (anim === ANIM.run ? 0.95 : 0.6);
      armSwing = -swing * 0.9;
      b.position.y = Math.abs(Math.cos(this.phase)) * (anim === ANIM.run ? 0.09 : 0.05);
      if (anim === ANIM.run) b.rotation.x = 0.14;
      this.head.rotation.x = anim === ANIM.run ? -0.1 : 0;
    } else if (anim === ANIM.air) {
      // lompat: kaki menekuk, lengan terangkat ke samping
      swing = 0.5;
      armSwing = -2.5;
      this.legL.rotation.x = -0.5;
      this.legR.rotation.x = 0.25;
      this.armL.rotation.set(armSwing, 0, -0.35);
      this.armR.rotation.set(armSwing, 0, 0.35);
      return;
    } else if (anim === ANIM.swim) {
      this.phase += dt * 6;
      b.rotation.x = 1.25;
      b.position.y = 0.6;
      swing = Math.sin(this.phase) * 0.5;
      armSwing = Math.sin(this.phase) * 2.2;
    } else if (anim === ANIM.sit) {
      this.legL.rotation.x = -1.5;
      this.legR.rotation.x = -1.5;
      b.position.y = -0.35;
      this.armL.rotation.x = -0.3;
      this.armR.rotation.x = -0.3;
      return;
    } else {
      // idle: napas pelan + lengan berayun kecil
      this.phase += dt * 2;
      b.position.y = Math.sin(this.phase) * 0.012;
      armSwing = Math.sin(this.phase) * 0.04;
      this.head.rotation.y = Math.sin(this.phase * 0.35) * 0.12;
    }
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.set(armSwing, 0, 0);
    this.armR.rotation.set(-armSwing, 0, 0);

    // Emote (dari roda emote): 0 lambai, 1 hore, 2 tunjuk, 3 joget, 4 berpikir, 5 hati
    if (this.emote >= 0) {
      this.emoteT += dt;
      const t = this.emoteT;
      switch (this.emote) {
        case 0:
          this.armR.rotation.set(-2.8, 0, Math.sin(t * 10) * 0.4);
          break;
        case 1:
          this.armL.rotation.set(-2.9, 0, 0);
          this.armR.rotation.set(-2.9, 0, 0);
          b.position.y = Math.abs(Math.sin(t * 8)) * 0.3;
          break;
        case 2:
          this.armR.rotation.set(-1.6, 0, 0);
          break;
        case 3:
          b.rotation.y = Math.sin(t * 6) * 0.5;
          this.armL.rotation.set(-1.4 + Math.sin(t * 12) * 0.6, 0, 0);
          this.armR.rotation.set(-1.4 - Math.sin(t * 12) * 0.6, 0, 0);
          break;
        case 4:
          this.armR.rotation.set(-2.2, 0, -0.6);
          this.head.rotation.z = 0.2;
          break;
        default:
          this.armL.rotation.set(-2.4, 0, 0.6);
          this.armR.rotation.set(-2.4, 0, -0.6);
      }
    } else {
      this.emoteT = 0;
      b.rotation.y = 0;
    }
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) if (!mat.userData.shared) mat.dispose();
      }
    });
    this.root.removeFromParent();
  }
}
