-- 006: Permintaan hadiah & tukar barang yang harus DISETUJUI penerima.
-- Barang pemberi ditahan (escrow) sejak permintaan dibuat: dikurangi dari tas pemberi, lalu
--   diterima   → masuk tas penerima (tukar: barang penerima masuk tas pemberi)
--   ditolak / dibatalkan / kedaluwarsa → dikembalikan ke tas pemberi.
-- Status hanya bisa berubah dari 'menunggu' satu kali (UPDATE ... WHERE status = 'menunggu') → idempoten.
CREATE TABLE IF NOT EXISTS item_offers (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('hadiah', 'tukar')),
  status text NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'diterima', 'ditolak', 'dibatalkan', 'kedaluwarsa')),
  from_roster uuid NOT NULL REFERENCES session_roster(id) ON DELETE CASCADE,
  to_roster uuid NOT NULL REFERENCES session_roster(id) ON DELETE CASCADE,
  give_item text NOT NULL,
  give_qty int NOT NULL CHECK (give_qty > 0),
  want_item text,
  want_qty int CHECK (want_qty IS NULL OR want_qty > 0),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK (from_roster <> to_roster),
  CHECK ((kind = 'hadiah' AND want_item IS NULL) OR (kind = 'tukar' AND want_item IS NOT NULL AND want_qty IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS item_offers_session_idx ON item_offers (session_id, created_at DESC);
-- Anti-spam di tingkat basis data: paling banyak satu permintaan menunggu untuk pasangan pemberi→penerima yang sama
CREATE UNIQUE INDEX IF NOT EXISTS item_offers_one_pending_pair ON item_offers (from_roster, to_roster) WHERE status = 'menunggu';

ALTER TABLE item_offers ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON item_offers FROM %I', r);
    END IF;
  END LOOP;
END $$;
