-- Daftar siswa yang disiapkan guru (preset) vs. siswa yang mendaftar sendiri dengan nomor absen.
ALTER TABLE session_roster ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE session_roster ADD COLUMN IF NOT EXISTS kicked boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS roster_session_idx ON session_roster (session_id, score DESC);
