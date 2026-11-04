-- 007: Bank soal guru yang fleksibel.
-- 1) Asal soal: 'guru' (dibuat/diimpor guru) atau 'bawaan' (soal contoh EDUVERSE). Sesi memilih sumbernya sendiri,
--    sehingga soal bawaan tidak pernah tercampur dengan soal guru tanpa izin.
-- 2) Gambar soal opsional (data URL kecil, diperiksa server).
-- 3) Cuplikan soal pada setiap jawaban: riwayat & ekspor sesi lama tidak berubah walau soal di bank diedit/dihapus.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'guru';
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_source_check;
ALTER TABLE questions ADD CONSTRAINT questions_source_check CHECK (source IN ('guru', 'bawaan'));
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_image_check;
ALTER TABLE questions ADD CONSTRAINT questions_image_check CHECK (image IS NULL OR (length(image) <= 400000 AND image ~ '^data:image/(png|jpeg|webp);base64,'));
-- Soal yang dulu dimuat lewat tombol "Muat Soal Contoh" adalah soal bawaan
UPDATE questions SET source = 'bawaan'
 WHERE source = 'guru' AND import_batch IN (SELECT id FROM import_batches WHERE filename = 'Contoh soal EDUVERSE');
CREATE INDEX IF NOT EXISTS questions_source_idx ON questions (teacher_id, source);
ALTER TABLE answers ADD COLUMN IF NOT EXISTS question_snapshot jsonb;
-- Sesi yang dibuat sebelum ada pilihan sumber soal tetap berperilaku seperti dulu (soal guru + contoh).
-- Sesi baru memakai bawaan 'guru' (Hanya Soal Guru).
UPDATE sessions SET settings = settings || '{"questionSource":"gabungan"}'::jsonb WHERE NOT (settings ? 'questionSource');
