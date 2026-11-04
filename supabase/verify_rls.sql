-- Verifikasi RLS EDUVERSE di Supabase (jalankan di SQL Editor Supabase).
-- Hasil yang benar: semua tabel "DITOLAK" untuk peran publik anon & authenticated (yang dipakai API PostgREST/Realtime),
-- sementara server EDUVERSE (pemilik tabel) tetap bisa membaca.
create temp table if not exists _rls_check(peran text, hasil text);
do $$
declare t text; r text; res text; ok boolean;
begin
  foreach r in array array['anon', 'authenticated'] loop
    res := '';
    foreach t in array array['teachers','questions','sessions','session_roster','answers','import_batches','schema_migrations','purchases'] loop
      begin
        execute format('set local role %I', r);
        execute format('select count(*) from public.%I', t);
        ok := false;
      exception when insufficient_privilege then ok := true;
      end;
      execute 'reset role';
      res := res || t || '=' || case when ok then 'DITOLAK' else 'TERBUKA' end || ' ';
    end loop;
    insert into _rls_check values (r, res);
  end loop;
end $$;
select * from _rls_check;
