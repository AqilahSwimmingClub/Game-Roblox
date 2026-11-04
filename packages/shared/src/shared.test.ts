import { describe, it, expect } from 'vitest';
import {
  CHARACTERS,
  buildKota,
  KOTA_ZONES,
  KOTA_WORLD_HALF,
  MODE_LIMITS,
  VEHICLE_SPEC,
  JETPACK,
  lightFor,
  riftExit,
  type Box,
  zoneAt,
  busPosition,
  computeScore,
  rankEntries,
  checkAnswer,
  parseAnswer,
  validateQuestion,
  questionFingerprint,
  sanitizeAvatar,
  buildLobby,
} from './index.js';

describe('layout Dunia Kota', () => {
  const k = buildKota();
  it('deterministik (dua kali bangun = sama)', () => {
    expect(buildKota()).toBe(k);
    expect(k.boxes.length).toBeGreaterThan(2000);
  });
  it('setiap zona memiliki minimal 8 titik soal', () => {
    for (const z of KOTA_ZONES) {
      const n = k.spawns.filter((s) => s.zone === z.id).length;
      expect(n, z.id).toBeGreaterThanOrEqual(8);
    }
  });
  it('ID titik soal unik dan titik berada di dalam dunia', () => {
    const ids = new Set(k.spawns.map((s) => s.id));
    expect(ids.size).toBe(k.spawns.length);
    for (const s of k.spawns) {
      // Dunia Kota kini mencakup Bandara (timur) & Kawasan Gedung Tinggi (barat) di luar pagar kota ±600 m
      expect(Math.abs(s.x)).toBeLessThanOrEqual(KOTA_WORLD_HALF);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(KOTA_WORLD_HALF);
      if (!['bandara', 'bisnis'].includes(s.zone)) {
        expect(Math.abs(s.x)).toBeLessThanOrEqual(600);
        expect(Math.abs(s.z)).toBeLessThanOrEqual(600);
      }
    }
  });
  it('zoneAt memetakan pusat setiap zona ke zonanya', () => {
    for (const z of KOTA_ZONES) expect(zoneAt(z.label.x, z.label.z)?.id).toBe(z.id);
  });
  it('kotak tidak berukuran negatif atau NaN', () => {
    for (const b of k.boxes) {
      expect(Number.isFinite(b.x + b.y + b.z + b.sx + b.sy + b.sz)).toBe(true);
      expect(b.sx).toBeGreaterThan(0);
      expect(b.sy).toBeGreaterThan(0);
      expect(b.sz).toBeGreaterThan(0);
    }
  });
  it('bus bergerak di jalan lingkar dan berhenti di halte', () => {
    let stops = 0;
    for (let t = 0; t < 400_000; t += 1000) {
      const p = busPosition(t);
      expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeCloseTo(213, 0);
      if (p.stopped) stops++;
    }
    expect(stops).toBeGreaterThan(30);
  });
  it('lobi punya 4 portal', () => {
    expect(buildLobby().portals.map((p) => p.world)).toEqual(['kota', 'hutan', 'laut', 'angkasa']);
  });
});

describe('skor', () => {
  it('dasar + cepat + tersembunyi + beruntun, kejutan ×2', () => {
    expect(computeScore({ basePoints: 100, attempt: 1, elapsedSeconds: 5, hidden: true, surprise: false, streakAfter: 3 }).total).toBe(200);
    expect(computeScore({ basePoints: 100, attempt: 1, elapsedSeconds: 20, hidden: false, surprise: true, streakAfter: 1 }).total).toBe(200);
  });
  it('kesempatan kedua 50% tanpa bonus cepat', () => {
    const r = computeScore({ basePoints: 100, attempt: 2, elapsedSeconds: 2, hidden: false, surprise: false, streakAfter: 1 });
    expect(r.dasar).toBe(50);
    expect(r.cepat).toBe(0);
  });
  it('peringkat: poin, benar, waktu benar terakhir', () => {
    const r = rankEntries([
      { studentId: 'a', nama: 'A', absen: 1, poin: 300, benar: 3, lastCorrectAt: 50 },
      { studentId: 'b', nama: 'B', absen: 2, poin: 300, benar: 3, lastCorrectAt: 40 },
      { studentId: 'c', nama: 'C', absen: 3, poin: 400, benar: 2, lastCorrectAt: 90 },
    ]);
    expect(r.map((e) => e.studentId)).toEqual(['c', 'b', 'a']);
    expect(r[0]?.rank).toBe(1);
  });
});

describe('soal', () => {
  it('memeriksa empat tipe jawaban', () => {
    expect(checkAnswer({ type: 'pg', index: 1 }, { type: 'pg', index: 1 })).toBe(true);
    expect(checkAnswer({ type: 'bs', value: false }, { type: 'bs', value: true })).toBe(false);
    expect(checkAnswer({ type: 'isian', accepted: ['Garuda Pancasila'] }, { type: 'isian', text: '  garuda   pancasila ' })).toBe(true);
    // kanan ditampilkan teracak: tampilan [2,0,1] → asli
    expect(checkAnswer({ type: 'jodoh', pairs: [0, 1, 2] }, { type: 'jodoh', pairs: [1, 2, 0] }, [2, 0, 1])).toBe(true);
  });
  it('menolak bentuk jawaban tidak valid', () => {
    expect(parseAnswer({ index: 9 }, 'pg', 4)).toBeNull();
    expect(parseAnswer({ value: 'ya' }, 'bs', 2)).toBeNull();
    expect(parseAnswer({ pairs: [0, 1] }, 'jodoh', 3)).toBeNull();
  });
  it('validasi soal menangkap kunci salah dan opsi kembar', () => {
    const errs = validateQuestion({
      subject: 'Matematika',
      grade: 5,
      phase: 'C',
      topic: 'x',
      learningOutcome: '',
      type: 'pg',
      prompt: 'Soal?',
      options: ['a', 'A'],
      right: [],
      key: { type: 'pg', index: 5 },
      explanation: '',
      difficulty: 'mudah',
      points: 100,
      world: 'semua',
    });
    expect(errs).toContain('Ada opsi kembar');
    expect(errs).toContain('Kunci tidak cocok dengan opsi');
  });
  it('sidik jari sama untuk soal yang hanya beda spasi/kapital', () => {
    expect(questionFingerprint({ type: 'pg', prompt: 'Hasil 2+2?', options: ['4', '5'] })).toBe(
      questionFingerprint({ type: 'pg', prompt: ' hasil  2+2? ', options: ['4', '5'] }),
    );
  });
  it('avatar disanitasi', () => {
    // nilai tidak valid → bawaan; data avatar lama (rambut/baju/topi) tetap aman dibaca
    expect(sanitizeAvatar({ kulit: 99, topi: 2 })).toEqual({ karakter: 14, kulit: 2 });
    expect(sanitizeAvatar({ karakter: 19, kulit: 0 })).toEqual({ karakter: 19, kulit: 0 });
    expect(sanitizeAvatar({ karakter: 20, kulit: 1.5 })).toEqual({ karakter: 14, kulit: 2 });
    expect(sanitizeAvatar('rusak')).toEqual({ karakter: 14, kulit: 2 });
  });
  it('20 karakter unik', () => {
    expect(CHARACTERS).toHaveLength(20);
    expect(new Set(CHARACTERS.map((c) => c.kode)).size).toBe(20);
    CHARACTERS.forEach((c, i) => expect(c.id).toBe(i));
  });
});

describe('Kota Hidup (living city)', () => {
  const k = buildKota();
  const L = k.living;
  const solid = k.boxes.filter((b: Box) => b.k === 'solid' || b.k === 'glass');
  const blocked = (x: number, y: number, z: number, r: number, h = 1.8) =>
    solid.some((b) => x + r > b.x - b.sx / 2 && x - r < b.x + b.sx / 2 && z + r > b.z - b.sz / 2 && z - r < b.z + b.sz / 2 && y + h > b.y - b.sy / 2 && y + 0.45 < b.y + b.sy / 2);

  it('memiliki kendaraan, stasiun jetpack, lubang dimensi, pedagang, lalu lintas & lampu', () => {
    for (const kind of ['sepeda', 'motor', 'mobil', 'bus', 'pesawat']) expect(L.vehicles.some((v) => v.kind === kind), kind).toBe(true);
    expect(L.jetpacks.length).toBeGreaterThanOrEqual(4);
    expect(L.vendors.length).toBeGreaterThanOrEqual(10);
    expect(L.loops.length).toBeGreaterThanOrEqual(5);
    expect(L.lights.length).toBeGreaterThanOrEqual(4);
  });
  it('kendaraan, pedagang, stasiun & portal tidak tertanam di bangunan', () => {
    for (const v of L.vehicles) expect(blocked(v.x, v.y, v.z, v.kind === 'pesawat' ? 4 : 1), v.id).toBe(false);
    for (const v of L.vendors) expect(blocked(v.x, v.y, v.z, 0.6), v.id).toBe(false);
    for (const j of L.jetpacks) expect(blocked(j.x, j.y, j.z, 0.8), j.id).toBe(false);
    for (const r of L.rifts) {
      expect(blocked(r.x, r.y, r.z, 1.2), r.id).toBe(false);
      const e = riftExit(r);
      expect(blocked(e.x, e.y, e.z, 0.5), `keluar ${r.id}`).toBe(false);
    }
  });
  it('setiap lubang dimensi berpasangan (atau gerbang antardunia tanpa tujuan)', () => {
    for (const r of L.rifts) {
      if (!r.to) continue;
      const dest = L.rifts.find((x) => x.id === r.to);
      expect(dest, r.id).toBeTruthy();
      expect(dest!.to).toBe(r.id);
    }
  });
  it('misi pedagang menjadi titik soal yang selalu aktif dengan mapel kontekstual', () => {
    for (const v of L.vendors) {
      const sp = k.spawns.find((s) => s.id === v.id);
      expect(sp?.always, v.id).toBe(true);
      expect(sp?.subject).toBeTruthy();
    }
  });
  it('batas server per mode ≥ kecepatan kendaraan di klien', () => {
    for (const [kind, spec] of Object.entries(VEHICLE_SPEC)) expect(MODE_LIMITS[kind as keyof typeof MODE_LIMITS].maxSpeed).toBeGreaterThanOrEqual(spec.maxSpeed);
    expect(MODE_LIMITS.jetpack.maxSpeed).toBeGreaterThanOrEqual(JETPACK.speed);
    expect(MODE_LIMITS.jetpack.maxY).toBeGreaterThanOrEqual(JETPACK.maxY);
  });
  it('lampu lalu lintas: dua arah tidak pernah hijau bersamaan', () => {
    for (let t = 0; t < 64; t += 0.5) {
      const x = lightFor('x', t);
      const z = lightFor('z', t);
      expect(x === 'merah' || z === 'merah', `t=${t}`).toBe(true);
    }
  });
  it('lintasan lalu lintas & pejalan kaki berada di dalam dunia', () => {
    for (const l of [...L.loops, ...L.walks]) for (const p of l.pts) expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeLessThan(KOTA_WORLD_HALF);
  });
});
