-- 003: Row Level Security untuk dipakai di Supabase PostgreSQL.
-- Semua data EDUVERSE hanya diakses server Node tepercaya (koneksi langsung sebagai pemilik tabel,
-- yang tidak terkena RLS). RLS diaktifkan TANPA policy → akses lewat API publik Supabase
-- (PostgREST/Realtime dengan kunci anon/authenticated) DITOLAK semuanya: kunci jawaban, data siswa,
-- dan hash kata sandi guru tidak pernah bisa dibaca dari browser.
-- Aman juga di PostgreSQL biasa (Render/Docker/lokal): pemilik tabel tetap bisa membaca/menulis.
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- Di Supabase: cabut hak tabel dari peran API publik (berlapis dengan RLS). Di PostgreSQL biasa peran ini tidak ada.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
    END IF;
  END LOOP;
END $$;
