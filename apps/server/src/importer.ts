/**
 * Impor soal dari Excel (.xlsx) dan Word (.docx) — diproses di server, bukan di game.
 * Menghasilkan pratinjau per baris (soal + daftar galat) sebelum disimpan.
 */
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { questionFingerprint, validateQuestion, SUBJECTS, type AnswerKey, type QuestionType, type Difficulty } from '@eduverse/shared';
import type { QuestionInput } from './questionsRepo.js';

export interface PreviewRow {
  row: number;
  question: QuestionInput | null;
  errors: string[];
  fingerprint: string | null;
  duplicate: boolean;
}

const TYPE_MAP: Record<string, QuestionType> = {
  pg: 'pg',
  'pilihan ganda': 'pg',
  bs: 'bs',
  'benar/salah': 'bs',
  'benar salah': 'bs',
  isian: 'isian',
  'isian singkat': 'isian',
  jodoh: 'jodoh',
  menjodohkan: 'jodoh',
};

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const MAX_ROWS = 2000;

function clean(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v && 'text' in (v as Record<string, unknown>)) return String((v as { text: unknown }).text).trim();
  if (typeof v === 'object' && v && 'richText' in (v as Record<string, unknown>)) {
    return ((v as { richText: { text: string }[] }).richText ?? []).map((t) => t.text).join('').trim();
  }
  if (typeof v === 'object' && v && 'result' in (v as Record<string, unknown>)) return String((v as { result: unknown }).result).trim();
  // Hapus karakter kontrol (sanitasi input file)
  return String(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}

function normSubject(s: string): string {
  const found = SUBJECTS.find((x) => x.toLowerCase() === s.toLowerCase());
  if (found) return found;
  if (/pancasila|ppkn|pkn/i.test(s)) return 'Pendidikan Pancasila';
  if (/^b(ahasa)?\.?\s*indo/i.test(s)) return 'Bahasa Indonesia';
  if (/^mat/i.test(s)) return 'Matematika';
  if (/ipa|ips|ipas/i.test(s)) return 'IPAS';
  return s;
}

function normDifficulty(s: string): Difficulty {
  const t = s.toLowerCase();
  if (t.startsWith('mud')) return 'mudah';
  if (t.startsWith('sul') || t.startsWith('suk')) return 'sulit';
  return 'sedang';
}

function phaseForGrade(g: number): string {
  return g <= 2 ? 'A' : g <= 4 ? 'B' : 'C';
}

export interface RawFields {
  kelas: string;
  fase: string;
  mapel: string;
  materi: string;
  capaian: string;
  tipe: string;
  soal: string;
  opsi: string[]; // PG: opsi; JODOH: "kiri = kanan"
  kunci: string;
  pembahasan: string;
  kesulitan: string;
  poin: string;
  dunia: string;
}

/** Ubah satu baris mentah menjadi soal + galat. Dipakai Excel dan Word. */
export function buildQuestion(f: RawFields): { question: QuestionInput | null; errors: string[] } {
  const errors: string[] = [];
  const type = TYPE_MAP[f.tipe.toLowerCase().trim()] ?? (f.tipe ? null : 'pg');
  if (!type) return { question: null, errors: [`Tipe "${f.tipe}" tidak dikenal (PG, BS, ISIAN, JODOH)`] };
  const grade = Number.parseInt(f.kelas, 10);
  const opsi = f.opsi.map((o) => o.trim()).filter((o) => o.length > 0);
  let key: AnswerKey;
  let options: string[] = [];
  let right: string[] = [];
  switch (type) {
    case 'pg': {
      options = opsi;
      const k = f.kunci.trim().toUpperCase();
      const idx = LETTERS.indexOf(k.replace(/[^A-E]/g, '').slice(0, 1));
      const byText = opsi.findIndex((o) => o.toLowerCase() === f.kunci.trim().toLowerCase());
      key = { type: 'pg', index: idx >= 0 ? idx : byText };
      if (key.index < 0) errors.push('Kunci PG harus huruf A–E sesuai opsi');
      break;
    }
    case 'bs': {
      const k = f.kunci.trim().toLowerCase();
      if (!['benar', 'salah', 'b', 's', 'true', 'false'].includes(k)) errors.push('Kunci BS harus "Benar" atau "Salah"');
      key = { type: 'bs', value: ['benar', 'b', 'true'].includes(k) };
      break;
    }
    case 'isian': {
      const accepted = f.kunci
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      key = { type: 'isian', accepted };
      break;
    }
    case 'jodoh': {
      for (const o of opsi) {
        const m = o.split(/\s*(?:=|=>|->|\|)\s*/);
        if (m.length !== 2 || !m[0] || !m[1]) {
          errors.push(`Pasangan "${o}" harus berformat "kiri = kanan"`);
          continue;
        }
        options.push(m[0]);
        right.push(m[1]);
      }
      key = { type: 'jodoh', pairs: options.map((_, i) => i) };
      break;
    }
  }
  const q: QuestionInput = {
    subject: normSubject(f.mapel),
    grade: Number.isFinite(grade) ? grade : 0,
    phase: (f.fase || (Number.isFinite(grade) ? phaseForGrade(grade) : 'C')).toUpperCase().slice(0, 1),
    topic: f.materi.slice(0, 200),
    learningOutcome: f.capaian.slice(0, 500),
    type,
    prompt: f.soal,
    options,
    right,
    key,
    explanation: f.pembahasan.slice(0, 1000),
    difficulty: normDifficulty(f.kesulitan),
    points: f.poin ? Number.parseInt(f.poin, 10) || 100 : 100,
    world: ['kota', 'hutan', 'laut', 'angkasa'].includes(f.dunia.toLowerCase()) ? f.dunia.toLowerCase() : 'semua',
  };
  errors.push(...validateQuestion(q));
  return { question: errors.length ? q : q, errors };
}

const XLSX_HEADERS = ['kelas', 'fase', 'mapel', 'materi', 'capaian', 'tipe', 'soal', 'opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e', 'kunci', 'pembahasan', 'kesulitan', 'poin', 'dunia'];

export async function parseXlsx(buf: Buffer): Promise<PreviewRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [{ row: 0, question: null, errors: ['File Excel tidak memiliki sheet'], fingerprint: null, duplicate: false }];
  const header = (ws.getRow(1).values as unknown[]).map((v) => clean(v).toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col('soal') < 0) return [{ row: 1, question: null, errors: ['Kolom "soal" tidak ditemukan. Gunakan template EDUVERSE.'], fingerprint: null, duplicate: false }];
  const out: PreviewRow[] = [];
  ws.eachRow((row, n) => {
    if (n === 1 || out.length >= MAX_ROWS) return;
    const v = row.values as unknown[];
    const get = (name: string) => (col(name) >= 0 ? clean(v[col(name)]) : '');
    if (!get('soal')) return;
    const f: RawFields = {
      kelas: get('kelas'),
      fase: get('fase'),
      mapel: get('mapel'),
      materi: get('materi'),
      capaian: get('capaian'),
      tipe: get('tipe'),
      soal: get('soal'),
      opsi: ['opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e'].map(get),
      kunci: get('kunci'),
      pembahasan: get('pembahasan'),
      kesulitan: get('kesulitan'),
      poin: get('poin'),
      dunia: get('dunia'),
    };
    const { question, errors } = buildQuestion(f);
    out.push({ row: n, question, errors, fingerprint: question ? questionFingerprint(question) : null, duplicate: false });
  });
  return out;
}

/**
 * Format Word: blok soal dipisah baris kosong. Baris berlabel:
 * Soal:, Tipe:, A./B./C./D./E. (opsi), 1./2./… "kiri = kanan" (menjodohkan),
 * Kunci:, Pembahasan:, Mapel:, Kelas:, Materi:, Capaian:, Kesulitan:, Poin:, Dunia:
 */
export async function parseDocx(buf: Buffer): Promise<PreviewRow[]> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return parseWordText(value);
}

export function parseWordText(text: string): PreviewRow[] {
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n\s*\n(?=\s*(?:\d+\s*[.)]\s*)?soal\s*:)/i)
    .map((b) => b.trim())
    .filter((b) => /^(?:\d+\s*[.)]\s*)?soal\s*:/i.test(b));
  const out: PreviewRow[] = [];
  blocks.slice(0, MAX_ROWS).forEach((block, i) => {
    const f: RawFields = { kelas: '', fase: '', mapel: '', materi: '', capaian: '', tipe: '', soal: '', opsi: [], kunci: '', pembahasan: '', kesulitan: '', poin: '', dunia: '' };
    let last: keyof RawFields | null = null;
    for (const raw of block.split('\n')) {
      const line = clean(raw);
      if (!line) continue;
      const label = line.match(/^(?:\d+\s*[.)]\s*)?(soal|tipe|kunci|pembahasan|mapel|kelas|materi|capaian|kesulitan|poin|dunia|fase)\s*:\s*(.*)$/i);
      const opt = line.match(/^([A-Ea-e])\s*[.)]\s+(.+)$/);
      const pair = line.match(/^(\d+)\s*[.)]\s+(.+?(?:=|=>|->).+)$/);
      if (label) {
        const k = label[1]!.toLowerCase() as keyof RawFields;
        (f as unknown as Record<string, string>)[k] = label[2] ?? '';
        last = k;
      } else if (opt && f.soal) {
        f.opsi.push(opt[2]!);
        last = null;
      } else if (pair && f.soal) {
        f.opsi.push(pair[2]!);
        last = null;
      } else if (last === 'soal' || last === 'pembahasan') {
        (f as unknown as Record<string, string>)[last] += ` ${line}`;
      }
    }
    if (!f.tipe) f.tipe = f.opsi.some((o) => /=|->/.test(o)) ? 'jodoh' : f.opsi.length ? 'pg' : /^(benar|salah)$/i.test(f.kunci.trim()) ? 'bs' : 'isian';
    const { question, errors } = buildQuestion(f);
    out.push({ row: i + 1, question, errors, fingerprint: question ? questionFingerprint(question) : null, duplicate: false });
  });
  if (!out.length) out.push({ row: 0, question: null, errors: ['Tidak ditemukan blok soal. Setiap soal harus diawali "Soal:".'], fingerprint: null, duplicate: false });
  return out;
}

export async function templateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Soal');
  ws.addRow(XLSX_HEADERS);
  ws.getRow(1).font = { bold: true };
  ws.addRow([5, 'C', 'Matematika', 'Pecahan', '', 'PG', 'Hasil dari 1/2 + 1/4 adalah …', '2/6', '3/4', '1/6', '2/4', '', 'B', '1/2 = 2/4, jadi 2/4 + 1/4 = 3/4.', 'mudah', 100, 'semua']);
  ws.addRow([5, 'C', 'Pendidikan Pancasila', 'Sejarah', '', 'BS', 'Hari Lahir Pancasila diperingati setiap 1 Juni.', '', '', '', '', '', 'Benar', '', 'sedang', 100, 'semua']);
  ws.addRow([5, 'C', 'Matematika', 'Perkalian', '', 'ISIAN', 'Hasil dari 12 × 5 adalah …', '', '', '', '', '', '60|enam puluh', '', 'mudah', 100, 'kota']);
  ws.addRow([5, 'C', 'Bahasa Indonesia', 'Sinonim', '', 'JODOH', 'Jodohkan kata dengan sinonimnya.', 'gembira = senang', 'pandai = pintar', 'besar = raksasa', '', '', '', '', 'sedang', 120, 'semua']);
  ws.columns.forEach((c) => (c.width = 18));
  const info = wb.addWorksheet('Petunjuk');
  [
    'Satu baris = satu soal. Jangan mengubah judul kolom di baris 1.',
    'tipe: PG (pilihan ganda), BS (benar/salah), ISIAN (isian singkat), JODOH (menjodohkan).',
    'PG: isi opsi_a..opsi_e, kunci = huruf (A–E).',
    'BS: kunci = Benar atau Salah.',
    'ISIAN: kunci = jawaban yang diterima, pisahkan dengan | (contoh 60|enam puluh).',
    'JODOH: isi opsi_a..opsi_e dengan "kiri = kanan" (pasangan yang benar).',
    'kesulitan: mudah | sedang | sulit · poin: 10–1000 · dunia: semua | kota | hutan | laut | angkasa.',
  ].forEach((t) => info.addRow([t]));
  info.getColumn(1).width = 110;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const WORD_TEMPLATE = `Soal: Hasil dari 1/2 + 1/4 adalah …
A. 2/6
B. 3/4
C. 1/6
D. 2/4
Kunci: B
Pembahasan: 1/2 = 2/4, jadi 2/4 + 1/4 = 3/4.
Mapel: Matematika
Kelas: 5
Materi: Pecahan
Kesulitan: mudah
Poin: 100

Soal: Hari Lahir Pancasila diperingati setiap 1 Juni.
Tipe: BS
Kunci: Benar
Mapel: Pendidikan Pancasila
Kelas: 5

Soal: Jodohkan kata dengan sinonimnya.
Tipe: JODOH
1. gembira = senang
2. pandai = pintar
3. besar = raksasa
Mapel: Bahasa Indonesia
Kelas: 5
`;
