/**
 * Model soal EDUVERSE (Revisi bagian 8). Kunci jawaban hanya ada di server/database;
 * klien hanya pernah menerima `PublicQuestion`.
 */
export type QuestionType = 'pg' | 'bs' | 'isian' | 'jodoh';

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  pg: 'Pilihan Ganda',
  bs: 'Benar/Salah',
  isian: 'Isian Singkat',
  jodoh: 'Menjodohkan',
};

export const SUBJECTS = [
  'Matematika',
  'Bahasa Indonesia',
  'Pendidikan Pancasila',
  'IPAS',
  'Bahasa Inggris',
  'Seni Budaya',
  'PJOK',
  'Pendidikan Agama',
  'Pendidikan Agama Islam dan Budi Pekerti',
  'Koding dan Kecerdasan Artifisial',
  'Muatan Lokal',
] as const;

/** Asal soal: dibuat/diimpor guru, atau soal bawaan EDUVERSE (contoh). */
export type QuestionSource = 'guru' | 'bawaan';
/** Sumber soal sebuah sesi. Bawaan sesi resmi: hanya soal guru (soal bawaan tidak tercampur tanpa izin). */
export type SessionQuestionSource = 'guru' | 'bawaan' | 'gabungan';
export const QUESTION_SOURCE_LABEL: Record<SessionQuestionSource, string> = {
  guru: 'Hanya Soal Guru',
  bawaan: 'Soal Bawaan EDUVERSE',
  gabungan: 'Gabungan Keduanya',
};
/** Gambar soal: data URL png/jpeg/webp yang sudah diperkecil di Dashboard (maks ±300 KB). */
export const QUESTION_IMAGE_MAX = 400_000;
export const QUESTION_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export type Difficulty = 'mudah' | 'sedang' | 'sulit';

/** Kunci jawaban per tipe. */
export type AnswerKey =
  | { type: 'pg'; index: number }
  | { type: 'bs'; value: boolean }
  | { type: 'isian'; accepted: string[] }
  | { type: 'jodoh'; pairs: number[] }; // pairs[i] = indeks kanan yang benar untuk kiri ke-i

export interface QuestionRecord {
  id: string;
  subject: string;
  grade: number;
  phase: string; // A, B, C (Kurikulum Merdeka)
  topic: string;
  learningOutcome: string;
  type: QuestionType;
  prompt: string;
  options: string[]; // pg: opsi; jodoh: kiri; isian/bs: []
  right: string[]; // jodoh: kolom kanan
  key: AnswerKey;
  explanation: string;
  difficulty: Difficulty;
  points: number;
  world: string; // 'semua' | WorldId
  /** Gambar pendukung (opsional). */
  image?: string | null;
  /** Asal soal (diisi server). */
  source?: QuestionSource;
}

/** Yang dikirim ke siswa (tanpa kunci). Kolom kanan menjodohkan sudah diacak. */
export interface PublicQuestion {
  token: string;
  type: QuestionType;
  typeLabel: string;
  subject: string;
  topic: string;
  prompt: string;
  options: string[];
  right: string[];
  points: number;
  attempt: number;
  location: string;
  object: string;
  surprise: boolean;
  /** Gambar pendukung soal (data URL), bila ada. */
  image?: string;
}

/** Jawaban dari klien. */
export type AnswerPayload =
  | { type: 'pg'; index: number }
  | { type: 'bs'; value: boolean }
  | { type: 'isian'; text: string }
  | { type: 'jodoh'; pairs: number[] };

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9,./ -]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Validasi bentuk jawaban klien (tidak percaya data klien). */
export function parseAnswer(raw: unknown, type: QuestionType, optionCount: number): AnswerPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (type) {
    case 'pg':
      return typeof r.index === 'number' && Number.isInteger(r.index) && r.index >= 0 && r.index < optionCount
        ? { type: 'pg', index: r.index }
        : null;
    case 'bs':
      return typeof r.value === 'boolean' ? { type: 'bs', value: r.value } : null;
    case 'isian':
      return typeof r.text === 'string' && r.text.length <= 120 ? { type: 'isian', text: r.text } : null;
    case 'jodoh': {
      if (!Array.isArray(r.pairs) || r.pairs.length !== optionCount) return null;
      if (!r.pairs.every((p) => typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < optionCount)) return null;
      return { type: 'jodoh', pairs: r.pairs as number[] };
    }
  }
}

/**
 * Periksa jawaban. Untuk menjodohkan, `rightOrder` adalah urutan acak kolom kanan yang
 * ditampilkan ke siswa (indeks tampilan → indeks asli).
 */
export function checkAnswer(key: AnswerKey, answer: AnswerPayload, rightOrder?: number[]): boolean {
  if (key.type !== answer.type) return false;
  switch (key.type) {
    case 'pg':
      return (answer as { index: number }).index === key.index;
    case 'bs':
      return (answer as { value: boolean }).value === key.value;
    case 'isian': {
      const t = normalizeText((answer as { text: string }).text);
      return t.length > 0 && key.accepted.some((a) => normalizeText(a) === t);
    }
    case 'jodoh': {
      const shown = (answer as { pairs: number[] }).pairs;
      return key.pairs.every((correctRight, left) => {
        const chosenShown = shown[left];
        const original = rightOrder ? rightOrder[chosenShown ?? -1] : chosenShown;
        return original === correctRight;
      });
    }
  }
}

/** Validasi soal sebelum terbit (Revisi bagian 9). Mengembalikan daftar pesan galat. */
export function validateQuestion(q: Omit<QuestionRecord, 'id'>): string[] {
  const errors: string[] = [];
  if (!q.prompt || q.prompt.trim().length === 0) errors.push('Teks soal kosong');
  if (q.prompt && q.prompt.length > 500) errors.push('Teks soal lebih dari 500 karakter');
  if (!q.subject) errors.push('Mata pelajaran wajib diisi');
  if (!Number.isInteger(q.grade) || q.grade < 1 || q.grade > 6) errors.push('Kelas harus 1–6');
  if (q.points < 10 || q.points > 1000) errors.push('Poin harus 10–1000');
  if (q.image) {
    if (q.image.length > QUESTION_IMAGE_MAX) errors.push('Gambar terlalu besar (maks ±300 KB)');
    else if (!QUESTION_IMAGE_RE.test(q.image)) errors.push('Gambar harus PNG/JPEG/WEBP');
  }
  switch (q.type) {
    case 'pg': {
      if (q.options.length < 2 || q.options.length > 5) errors.push('Pilihan ganda butuh 2–5 opsi');
      if (q.options.some((o) => !o.trim())) errors.push('Ada opsi kosong');
      // peka huruf besar-kecil: soal ejaan/huruf kapital sah memakai opsi yang hanya berbeda kapitalnya
      if (new Set(q.options.map((o) => o.trim().replace(/\s+/g, ' '))).size !== q.options.length) errors.push('Ada opsi kembar');
      if (q.options.some((o) => o.length > 120)) errors.push('Opsi lebih dari 120 karakter');
      if (q.key.type !== 'pg' || q.key.index < 0 || q.key.index >= q.options.length) errors.push('Kunci tidak cocok dengan opsi');
      break;
    }
    case 'bs':
      if (q.key.type !== 'bs') errors.push('Kunci Benar/Salah tidak valid');
      break;
    case 'isian':
      if (q.key.type !== 'isian' || q.key.accepted.length === 0) errors.push('Isian butuh minimal satu jawaban yang diterima');
      else if (q.key.accepted.some((a) => a.length > 40)) errors.push('Jawaban isian maksimal 40 karakter');
      break;
    case 'jodoh':
      if (q.options.length < 2 || q.options.length > 5) errors.push('Menjodohkan butuh 2–5 pasangan');
      if (q.right.length !== q.options.length) errors.push('Jumlah kolom kiri dan kanan harus sama');
      if (q.key.type !== 'jodoh' || q.key.pairs.length !== q.options.length) errors.push('Kunci pasangan tidak valid');
      break;
  }
  return errors;
}

/** Sidik jari isi soal untuk deteksi duplikat. */
export function questionFingerprint(q: Pick<QuestionRecord, 'type' | 'prompt' | 'options'>): string {
  const base = `${q.type}|${normalizeText(q.prompt)}|${q.options.map(normalizeText).join('|')}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
