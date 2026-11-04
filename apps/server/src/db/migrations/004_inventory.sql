-- 004: Dompet (Rupiah virtual) & tas siswa per sesi + catatan jual beli dengan pedagang.
-- Saldo/tas tidak memengaruhi poin; hanya untuk jual beli virtual di Kota Hidup.
ALTER TABLE session_roster ADD COLUMN IF NOT EXISTS wallet int NOT NULL DEFAULT 20000 CHECK (wallet >= 0);
ALTER TABLE session_roster ADD COLUMN IF NOT EXISTS inventory jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS purchases (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  roster_id uuid NOT NULL REFERENCES session_roster(id) ON DELETE CASCADE,
  vendor_id text NOT NULL,
  item_id text NOT NULL,
  qty int NOT NULL CHECK (qty > 0),
  unit_price int NOT NULL CHECK (unit_price >= 0),
  total int NOT NULL CHECK (total >= 0),
  wallet_after int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchases_session_idx ON purchases (session_id, created_at);

-- Sama seperti tabel lain: tertutup untuk API publik Supabase (RLS tanpa policy + cabut hak).
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON purchases FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE purchases_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
