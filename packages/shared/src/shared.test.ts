import { describe, it, expect } from 'vitest';
import {
  buildKota,
  KOTA_ZONES,
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
      expect(Math.abs(s.x)).toBeLessThanOrEqual(600);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(600);
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
    expect(sanitizeAvatar({ kulit: 99, topi: 2 }).kulit).toBe(2);
    expect(sanitizeAvatar({ kulit: 99, topi: 2 }).topi).toBe(2);
  });
});
