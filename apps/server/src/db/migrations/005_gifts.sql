-- 005: Catatan pemberian barang antarsiswa (hanya barang, bukan uang).
CREATE TABLE IF NOT EXISTS gifts (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  from_roster uuid NOT NULL REFERENCES session_roster(id) ON DELETE CASCADE,
  to_roster uuid NOT NULL REFERENCES session_roster(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  qty int NOT NULL CHECK (qty > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_roster <> to_roster)
);
CREATE INDEX IF NOT EXISTS gifts_session_idx ON gifts (session_id, created_at);

-- Tertutup untuk API publik Supabase (RLS tanpa policy + cabut hak).
ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON gifts FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE gifts_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
