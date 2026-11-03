-- EDUVERSE: skema awal (PostgreSQL 14+)
CREATE TABLE IF NOT EXISTS teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  school text,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  filename text NOT NULL,
  question_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject text NOT NULL,
  grade int NOT NULL CHECK (grade BETWEEN 1 AND 6),
  phase text NOT NULL DEFAULT 'C',
  topic text NOT NULL DEFAULT '',
  learning_outcome text NOT NULL DEFAULT '',
  type text NOT NULL CHECK (type IN ('pg','bs','isian','jodoh')),
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]',
  right_items jsonb NOT NULL DEFAULT '[]',
  answer_key jsonb NOT NULL,
  explanation text NOT NULL DEFAULT '',
  difficulty text NOT NULL DEFAULT 'sedang' CHECK (difficulty IN ('mudah','sedang','sulit')),
  points int NOT NULL DEFAULT 100,
  world text NOT NULL DEFAULT 'semua',
  fingerprint text NOT NULL,
  import_batch uuid REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS questions_teacher_idx ON questions (teacher_id, subject, grade);
CREATE INDEX IF NOT EXISTS questions_fp_idx ON questions (teacher_id, fingerprint);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  class_name text NOT NULL,
  status text NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu','hitung','berjalan','jeda','selesai')),
  settings jsonb NOT NULL,
  question_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ends_at timestamptz,
  paused_remaining_ms int,
  ended_at timestamptz,
  podium_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_teacher_idx ON sessions (teacher_id, created_at DESC);

CREATE TABLE IF NOT EXISTS session_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  absen int NOT NULL,
  nickname text NOT NULL,
  claim_hash text,
  claimed_at timestamptz,
  approved boolean NOT NULL DEFAULT false,
  avatar jsonb,
  score int NOT NULL DEFAULT 0,
  correct int NOT NULL DEFAULT 0,
  answered int NOT NULL DEFAULT 0,
  last_correct_at timestamptz,
  UNIQUE (session_id, absen)
);

CREATE TABLE IF NOT EXISTS answers (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  roster_id uuid NOT NULL REFERENCES session_roster(id) ON DELETE CASCADE,
  question_id uuid REFERENCES questions(id) ON DELETE SET NULL,
  point_id text NOT NULL,
  world text NOT NULL,
  zone text,
  answer jsonb NOT NULL,
  correct boolean NOT NULL,
  points int NOT NULL DEFAULT 0,
  attempt int NOT NULL DEFAULT 1,
  elapsed_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS answers_session_idx ON answers (session_id, created_at);
CREATE INDEX IF NOT EXISTS answers_roster_idx ON answers (roster_id);
