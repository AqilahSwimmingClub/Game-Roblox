# Panduan Deployment EDUVERSE (Vercel + Render)

> **Status jujur:** frontend sudah ada di Vercel (`eduverse-web-preview.vercel.app`). Backend persisten (API + Socket.IO
> + PostgreSQL) **belum aktif di internet** karena belum ada akun hosting backend yang terhubung ke proyek ini.
> Itulah penyebab pesan *"Koneksi terputus. Menyambung ulang…"*: Vercel hanya menyajikan file statis,
> sehingga `/socket.io` dan `/api` tidak punya server. Langkah di bawah menyalakannya.

## Arsitektur

```
HP siswa (Chrome) ─┐                         ┌─ Render: eduverse-aqilah-api (Node 22)
Tablet guru ───────┼─ HTTPS ─► Vercel ───────┤    REST API /api/*  +  Socket.IO (WSS)
                   │   game "/", Dashboard   │    skor & validasi jawaban di server
                   │   "/guru/", demo.html   │
                   └──── WSS/HTTPS langsung ─┘─► Render PostgreSQL: eduverse-db
```

- **Vercel** (proyek yang sudah ada) — hanya file statis: game, Dashboard Guru, Mode Demo. Dibangun dengan `npm run build:web`
  (`vercel.json` di akar repo, plus `apps/game/vercel.json` bila *Root Directory* proyek diatur ke `apps/game`).
- **Render** — server Node.js yang selalu hidup (WebSocket butuh proses persisten; Vercel Functions tidak cocok) + PostgreSQL.
- Frontend tahu alamat backend dari `/eduverse-config.js`, ditulis saat build dari variabel `EDUVERSE_SERVER_URL`
  (bawaan: `https://eduverse-aqilah-api.onrender.com`).
- Login guru memakai token **Bearer** (bukan cookie lintas situs yang sering diblokir Chrome HP). Server hanya menerima
  origin dari `CORS_ORIGINS` (HTTP & WebSocket).

## Langkah 0 — Basis data Supabase (sudah disiapkan)

Proyek Supabase **Game-Roblox** (paket Free) sudah berisi skema EDUVERSE (migrasi 001–003) dengan **RLS aktif tanpa policy**
dan hak `anon`/`authenticated` dicabut — API publik Supabase tidak bisa membaca data apa pun; hanya server EDUVERSE yang
terhubung langsung. Yang perlu Anda lakukan:

1. Supabase Dashboard → proyek **Game-Roblox** → **Connect** → *Session pooler* → salin string koneksi
   (`postgresql://postgres.fyketyvfskzirnfayqnx:[KATA-SANDI]@…pooler.supabase.com:5432/postgres`) dan isi kata sandi database.
2. Isi string itu sebagai `DATABASE_URL` di Render (Langkah 1). `PGSSL=1` sudah diatur di `render.yaml`.
   Untuk verifikasi sertifikat penuh: unduh *SSL certificate* dari Supabase (Settings → Database), isi `PGSSL_CA` dengan isinya,
   lalu hapus `PGSSL_STRICT=0`.
3. Server menjalankan migrasi otomatis; karena 001–003 sudah tercatat di `schema_migrations`, tidak ada yang diulang.

Mengapa server game tidak dipindah ke Supabase Realtime/Edge Functions: lihat [KOTA-HIDUP.md → Supabase](KOTA-HIDUP.md#supabase--apa-yang-dipakai-dan-mengapa)
(kuota Free 100 pesan/detik sudah 90% terpakai oleh 3 siswa pada 10 Hz; penilaian & validasi butuh proses otoritatif).

## Langkah 1 — Nyalakan backend di Render (±10 menit, sekali saja)

1. Masuk ke <https://dashboard.render.com> (bisa daftar dengan akun GitHub yang memiliki repo ini).
2. **New → Blueprint** → pilih repo `AqilahSwimmingClub/Game-Roblox` → pilih branch **`dev/eduverse-online-avatar20`**
   (atau `main` setelah PR digabung). Render membaca `render.yaml` dan membuat:
   - layanan web `eduverse-aqilah-api` (region Singapura, Node 22, `npm ci --include=dev && npm run build`, `npm start`)
   - `JWT_SECRET` dibuat acak otomatis; **`DATABASE_URL` diisi manual** dengan string koneksi Supabase (Langkah 0) —
     Render tidak lagi membuat database (PostgreSQL gratis Render kedaluwarsa).
3. Saat diminta, isi **`TEACHER_REGISTRATION_CODE`** dengan kode rahasia pilihan Anda (untuk mendaftarkan guru kedua dst.).
4. Tunggu status **Live**. Catat alamatnya, mis. `https://eduverse-aqilah-api.onrender.com`.
   Uji: buka `https://<alamat>/api/health` → harus `{"ok":true,...}`.
5. Bila Render memberi alamat lain (nama sudah dipakai orang), lanjutkan Langkah 2 poin 2.

Migrasi database berjalan otomatis saat server mulai.

## Langkah 2 — Sambungkan Vercel ke backend

1. Vercel Dashboard → proyek **eduverse-web-preview** → *Settings → Git*: pastikan *Production Branch* = branch yang
   ingin diterbitkan (saat ini `test/eduverse-offline-demo`; ganti ke `dev/eduverse-online-avatar20` untuk menguji tahap ini,
   atau `main` setelah PR digabung). Setiap push ke branch lain otomatis membuat *Preview Deployment*.
2. *Settings → Environment Variables* (opsional bila alamat Render = bawaan):
   `EDUVERSE_SERVER_URL = https://<alamat-render-anda>` → *Redeploy*.
3. *Settings → Build & Development*: biarkan *Build/Install Command* default — `vercel.json` sudah mengaturnya
   (`npm run build:web`, output `apps/game/dist`). Jika *Root Directory* diisi `apps/game`, `apps/game/vercel.json` yang dipakai.
4. Bila alamat Vercel berbeda dari `eduverse-web-preview.vercel.app`, ubah `PUBLIC_URL` dan `CORS_ORIGINS` di Render.

## Langkah 3 — Verifikasi (urutan yang disarankan)

| # | Cek | Hasil yang benar |
|---|---|---|
| 1 | `https://<render>/api/health` | `{"ok":true}` |
| 2 | `https://eduverse-web-preview.vercel.app/eduverse-config.js` | berisi alamat Render |
| 3 | `https://eduverse-web-preview.vercel.app/guru/` | halaman Masuk Dashboard Guru |
| 4 | Daftar guru pertama → *Bank Soal → Muat Soal Contoh* | 44 soal |
| 5 | *Buat Sesi* | kode 6 karakter, tautan, QR |
| 6 | HP buka tautan → absen + nama | Dashboard: "1 menunggu persetujuan" |
| 7 | Setujui → HP pilih karakter → ruang tunggu → SIAP | kolom Karakter terisi |
| 8 | HP kedua ikut → Mulai | keduanya di Dunia Kota, saling terlihat |
| 9 | Jawab soal | umpan jawaban & skor muncul langsung di Dashboard |
| 10 | Akhiri → Tampilkan Podium | podium 3D di HP dengan karakter juara |
| 11 | `https://eduverse-web-preview.vercel.app/demo.html` | Mode Demo tetap jalan tanpa kode |

## Catatan paket gratis (penting untuk kelas sungguhan)

- **Render Web Service Free tertidur** setelah ±15 menit tanpa lalu lintas; permintaan pertama membangunkannya (±1 menit).
  Game & Dashboard menampilkan pesan *"Server EDUVERSE belum bisa dihubungi … tunggu ±1 menit"* lalu tersambung sendiri.
  **Buka Dashboard Guru 2–3 menit sebelum kelas.** Untuk pemakaian rutin, gunakan paket **Starter** (tidak tertidur).
- **Basis data = Supabase Free**: proyek gratis Supabase dijeda bila tidak aktif ±1 minggu (bisa diaktifkan lagi dari Dashboard),
  batas 500 MB — cukup untuk ribuan jawaban. Tidak ada layanan berbayar yang diaktifkan.
- Satu instance teruji menampung 500 pemain bot (lihat [LOADTEST.md](LOADTEST.md)); paket Free punya CPU/RAM lebih kecil
  dari mesin uji, jadi untuk >100 siswa serentak gunakan paket berbayar.

## Alternatif tanpa Render

Backend yang sama dapat dijalankan di VPS/server sekolah dengan Docker (`docker compose up -d --build`, lihat `docker-compose.yml`)
di belakang reverse proxy HTTPS (Caddy/Nginx, WebSocket wajib diteruskan). Isi `EDUVERSE_SERVER_URL` di Vercel dengan alamat HTTPS server tersebut,
dan isi `CORS_ORIGINS`/`PUBLIC_URL` di server dengan alamat Vercel. Server juga bisa melayani game & Dashboard sendiri (satu domain) —
cukup buka alamat server itu langsung.

## Variabel lingkungan backend

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ✔ | PostgreSQL 14+ |
| `JWT_SECRET` | ✔ | acak ≥ 32 karakter |
| `PUBLIC_URL` | ✔ | alamat game untuk tautan & QR undangan (Vercel) |
| `CORS_ORIGINS` | ✔ bila frontend di domain lain | dipisah koma; `*` = satu label, mis. preview Vercel |
| `TRUST_PROXY` | disarankan | jumlah proxy di depan server (Render = 1) |
| `TEACHER_REGISTRATION_CODE` | disarankan | kode pendaftaran guru ke-2 dst. |
| `REDIS_URL` | opsional | banyak instance (perlu sticky session) |
| `JOIN_RATE_PER_MIN`, `MAX_PLAYERS_PER_NODE`, `AUTO_MIGRATE` | opsional | lihat `.env.example` |

Rahasia **tidak pernah** di-commit: `.env` ada di `.gitignore`; di Render `JWT_SECRET` dibuat otomatis dan kode pendaftaran diisi manual.
