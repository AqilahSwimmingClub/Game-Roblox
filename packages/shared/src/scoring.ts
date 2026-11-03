/** Aturan poin (Revisi bagian 7). Fungsi murni: dipakai server, diuji dengan unit test. */
export interface ScoringRules {
  speedBonus: number;
  speedBonusSeconds: number;
  hiddenBonus: number;
  streakBonus: number;
  streakSize: number;
  secondChance: boolean;
  secondChanceMultiplier: number;
}

export const DEFAULT_RULES: ScoringRules = {
  speedBonus: 20,
  speedBonusSeconds: 10,
  hiddenBonus: 30,
  streakBonus: 50,
  streakSize: 3,
  secondChance: true,
  secondChanceMultiplier: 0.5,
};

export interface ScoreInput {
  basePoints: number;
  attempt: number; // 1 atau 2
  elapsedSeconds: number;
  hidden: boolean;
  surprise: boolean;
  streakAfter: number; // panjang beruntun SETELAH jawaban benar ini
}

export interface ScoreBreakdown {
  dasar: number;
  cepat: number;
  tersembunyi: number;
  beruntun: number;
  kejutan: number;
  total: number;
}

export function computeScore(input: ScoreInput, rules: ScoringRules = DEFAULT_RULES): ScoreBreakdown {
  const dasar = input.attempt === 1 ? input.basePoints : Math.floor(input.basePoints * rules.secondChanceMultiplier);
  const cepat = input.attempt === 1 && input.elapsedSeconds < rules.speedBonusSeconds ? rules.speedBonus : 0;
  const tersembunyi = input.hidden ? rules.hiddenBonus : 0;
  const beruntun = input.streakAfter > 0 && input.streakAfter % rules.streakSize === 0 ? rules.streakBonus : 0;
  const sub = dasar + cepat + tersembunyi + beruntun;
  const kejutan = input.surprise ? sub : 0;
  return { dasar, cepat, tersembunyi, beruntun, kejutan, total: sub + kejutan };
}

export interface RankEntry {
  studentId: string;
  nama: string;
  absen: number;
  poin: number;
  benar: number;
  lastCorrectAt: number | null;
}

/** Peringkat: poin ↓, benar ↓, benar terakhir lebih awal ↑, absen ↑. */
export function rankEntries<T extends RankEntry>(list: T[]): (T & { rank: number })[] {
  const sorted = [...list].sort((a, b) => {
    if (a.poin !== b.poin) return b.poin - a.poin;
    if (a.benar !== b.benar) return b.benar - a.benar;
    const ta = a.lastCorrectAt ?? Number.MAX_SAFE_INTEGER;
    const tb = b.lastCorrectAt ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.absen - b.absen;
  });
  return sorted.map((e, i) => ({ ...e, rank: i + 1 }));
}
