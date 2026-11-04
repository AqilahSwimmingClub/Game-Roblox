/** Ekspor hasil pembelajaran ke Excel dan PDF. */
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query } from './db/pool.js';

export interface ResultRow {
  rank: number;
  absen: number;
  nama: string;
  poin: number;
  benar: number;
  dijawab: number;
  ketepatan: number;
}

export interface SessionInfo {
  title: string;
  class_name: string;
  code: string;
  started_at: Date | null;
  ended_at: Date | null;
}

export async function sessionResults(sessionId: string): Promise<{ info: SessionInfo | null; rows: ResultRow[]; answers: AnswerDetail[] }> {
  const s = await query<SessionInfo>('SELECT title, class_name, code, started_at, ended_at FROM sessions WHERE id = $1', [sessionId]);
  const r = await query<{ absen: number; nickname: string; score: number; correct: number; answered: number; last_correct_at: Date | null }>(
    'SELECT absen, nickname, score, correct, answered, last_correct_at FROM session_roster WHERE session_id = $1',
    [sessionId],
  );
  const sorted = [...r.rows].sort(
    (a, b) => b.score - a.score || b.correct - a.correct || (a.last_correct_at?.getTime() ?? 9e15) - (b.last_correct_at?.getTime() ?? 9e15) || a.absen - b.absen,
  );
  const rows = sorted.map((x, i) => ({
    rank: i + 1,
    absen: x.absen,
    nama: x.nickname,
    poin: x.score,
    benar: x.correct,
    dijawab: x.answered,
    ketepatan: x.answered ? Math.round((x.correct / x.answered) * 100) : 0,
  }));
  const a = await query<AnswerDetail>(
    // cuplikan soal saat dijawab (migrasi 007) diutamakan: hasil sesi lama tidak berubah walau soal diedit/dihapus
    `SELECT a.created_at, r.absen, r.nickname,
            COALESCE(a.question_snapshot->>'subject', q.subject) AS subject,
            COALESCE(a.question_snapshot->>'topic', q.topic) AS topic,
            COALESCE(a.question_snapshot->>'prompt', q.prompt) AS prompt,
            a.correct, a.points, a.attempt, a.zone, a.world
       FROM answers a JOIN session_roster r ON r.id = a.roster_id LEFT JOIN questions q ON q.id = a.question_id
      WHERE a.session_id = $1 ORDER BY a.created_at`,
    [sessionId],
  );
  return { info: s.rows[0] ?? null, rows, answers: a.rows };
}

export interface AnswerDetail {
  created_at: Date;
  absen: number;
  nickname: string;
  world?: string | null;
  subject: string | null;
  topic: string | null;
  prompt: string | null;
  correct: boolean;
  points: number;
  attempt: number;
  zone: string | null;
}

export async function resultsXlsx(sessionId: string): Promise<Buffer> {
  const { info, rows, answers } = await sessionResults(sessionId);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EDUVERSE';
  const ws = wb.addWorksheet('Rekap Nilai');
  ws.addRow([`EDUVERSE — ${info?.title ?? ''}`]);
  ws.addRow([`Kelas ${info?.class_name ?? ''} · Kode ${info?.code ?? ''} · ${info?.ended_at ? new Date(info.ended_at).toLocaleString('id-ID') : 'belum selesai'}`]);
  ws.addRow([]);
  const head = ws.addRow(['Peringkat', 'No Absen', 'Nama', 'Poin', 'Benar', 'Dijawab', 'Ketepatan (%)']);
  head.font = { bold: true };
  for (const r of rows) ws.addRow([r.rank, r.absen, r.nama, r.poin, r.benar, r.dijawab, r.ketepatan]);
  ws.columns.forEach((c, i) => (c.width = i === 2 ? 22 : 14));
  const wa = wb.addWorksheet('Detail Jawaban');
  const h2 = wa.addRow(['Waktu', 'No Absen', 'Nama', 'Mapel', 'Materi', 'Soal', 'Benar', 'Poin', 'Percobaan', 'Zona']);
  h2.font = { bold: true };
  for (const a of answers) {
    wa.addRow([new Date(a.created_at).toLocaleString('id-ID'), a.absen, a.nickname, a.subject ?? '', a.topic ?? '', a.prompt ?? '', a.correct ? 'Ya' : 'Tidak', a.points, a.attempt, a.zone ?? '']);
  }
  wa.columns.forEach((c, i) => (c.width = i === 5 ? 60 : 14));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function resultsPdf(sessionId: string): Promise<Buffer> {
  const { info, rows } = await sessionResults(sessionId);
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(18).fillColor('#1E2A4A').text('EDUVERSE — Rekap Nilai', { align: 'left' });
  doc.moveDown(0.3).fontSize(11).fillColor('#55607A').text(`${info?.title ?? ''} · Kelas ${info?.class_name ?? ''} · Kode ${info?.code ?? ''}`);
  doc.text(info?.ended_at ? `Selesai: ${new Date(info.ended_at).toLocaleString('id-ID')}` : 'Sesi belum selesai');
  doc.moveDown();
  const cols = [
    { t: 'Rank', w: 45 },
    { t: 'Absen', w: 50 },
    { t: 'Nama', w: 170 },
    { t: 'Poin', w: 60 },
    { t: 'Benar', w: 55 },
    { t: 'Dijawab', w: 60 },
    { t: 'Ketepatan', w: 70 },
  ];
  const drawRow = (vals: string[], bold: boolean) => {
    const y = doc.y;
    let x = 40;
    doc.fontSize(10).fillColor('#1E2A4A').font(bold ? 'Helvetica-Bold' : 'Helvetica');
    vals.forEach((v, i) => {
      doc.text(v, x, y, { width: cols[i]!.w, continued: false });
      x += cols[i]!.w;
    });
    doc.moveDown(0.4);
    if (doc.y > 780) doc.addPage();
  };
  drawRow(
    cols.map((c) => c.t),
    true,
  );
  for (const r of rows) drawRow([String(r.rank), String(r.absen), r.nama, String(r.poin), String(r.benar), String(r.dijawab), `${r.ketepatan}%`], false);
  doc.end();
  return done;
}
