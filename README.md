# EDUVERSE — The Learning Adventure

Game edukasi **3D open-world multiplayer berbasis web** untuk siswa SD (Kurikulum Merdeka, Fase A–C).
Siswa bermain langsung dari **Chrome di HP** tanpa instalasi; guru membuat sesi dan memantau permainan
dari **Dashboard Guru** di tablet Android. Acuan desain: dokumen *EDUVERSE Tahap 1* + tab *Revisi Tahap 1 (wajib)*.

> Branch `main` adalah baseline stabil. Pengembangan berjalan di `dev/eduverse-html3d` dan digabung lewat Pull Request.

## Status saat ini (vertical slice)

| Fitur | Status |
|---|---|
| UI EDUVERSE (splash, sambutan, kode kelas, identitas absen+nama, avatar 3D, lobi, ruang tunggu, HUD) | ✅ berjalan |
| Dashboard Guru: login, buat sesi, kode + tautan + QR, mulai/jeda/+5 menit/akhiri, setujui/tolak/reset/keluarkan siswa, papan skor & peta sebaran langsung, umpan jawaban, hasil, ekspor Excel/PDF | ✅ berjalan |
| Bank soal: tambah/ubah/hapus, cari & saring, soal contoh, templat + impor Word/Excel dengan pratinjau & deteksi duplikat | ✅ berjalan |
| Lobi 3D dengan 4 portal (hanya **Kota** yang terbuka) | ✅ |
| Dunia Kota besar 1,2 × 1,2 km: 12 zona, jalan, sungai, gedung bertingkat + lift, bus berjalan, ±4.700 objek, streaming chunk + LOD | ✅ |
| Kontrol HP: joystick dinamis, geser kamera, cubit zoom, lompat/lari/selam, tombol aksi kontekstual; keyboard+mouse di laptop | ✅ |
| Titik soal interaktif (PG, B/S, isian, menjodohkan), kesempatan kedua, soal kejutan | ✅ |
| Skor & validasi **di server** (kunci tidak pernah dikirim ke klien, validasi kecepatan/posisi, batas laju) | ✅ |
| Multipemain real-time (interest management: instance 60, 30 pemain terdekat, radius 150 m) | ✅ diuji 2 browser + 500 bot |
| Podium 3D juara 1–3 | ✅ |
| Kualitas grafis Rendah / Sedang / Tinggi / Otomatis (turun otomatis bila FPS rendah) | ✅ |
| Dunia Hutan, Laut, Luar Angkasa | ⏳ tahap berikutnya (portal tampil "segera hadir") |
| Deployment publik | ⏳ belum ada platform terhubung — lihat [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |

## Struktur

```
packages/shared     Tipe & protokol bersama, tata letak dunia deterministik (Kota, lobi, podium), soal, skor
apps/server         Express + Socket.IO + PostgreSQL: API guru, impor/ekspor, runtime sesi, multipemain
  src/game/runtime.ts   status sesi, spawn titik soal, penilaian, papan skor, podium, interest management
  src/game/sockets.ts   namespace /play (siswa) & /teacher (guru)
  src/db/migrations     skema SQL
apps/game           Game siswa (Three.js, Vite)
  src/engine        renderer, kualitas grafis, streaming chunk + LOD, tabrakan, kamera, input sentuh, avatar
  src/world         pemain lokal & jarak jauh, titik soal, bus, efek, audio, panggung (lobi/kota/podium)
  src/ui            layar pembuka, avatar, HUD, panel soal, hasil
  src/net           klien Socket.IO (token identitas, sambung ulang otomatis, sinkron jam)
apps/dashboard      Dashboard Guru (TypeScript + Vite, tanpa framework)
tests/e2e           Uji ujung-ke-ujung guru + 2 siswa (Playwright)
tests/load          Bot uji beban 50/100/200/500 pemain
docs                Panduan deployment & hasil uji beban
```

## Menjalankan di komputer sendiri

Kebutuhan: **Node.js 20+** (disarankan 22) dan **PostgreSQL 14+**.

```bash
npm ci
createdb eduverse                     # atau buat database lewat pgAdmin
cp .env.example .env                  # untuk lokal cukup isi DATABASE_URL; JWT_SECRET punya nilai dev
export $(grep -v '^#' .env | xargs)   # atau set variabel dengan cara lain
export NODE_ENV=development           # .env.example berisi production

npm run build      # shared → game → dashboard → server
npm start          # migrasi database otomatis, server di http://localhost:3000
```

- Game siswa: **http://localhost:3000/** (dari HP di jaringan yang sama: `http://IP-komputer:3000/`)
- Dashboard Guru: **http://localhost:3000/guru/** → daftar guru pertama (tanpa kode) → *Bank Soal → Muat Soal Contoh* → *Buat Sesi*.

Mode pengembangan dengan hot reload: `npm run dev` (server) lalu `npm run dev -w @eduverse/game` (port 5173) dan `npm run dev -w @eduverse/dashboard` (port 5174, `/guru/`); keduanya mem-proxy `/api` dan `/socket.io` ke port 3000.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run build` | Build semua paket |
| `npm run typecheck` | Pemeriksaan TypeScript semua paket |
| `npm test` | Unit test shared + integrasi server (butuh `DATABASE_URL` ke database uji) |
| `npm run db:migrate` / `npm run db:seed` | Migrasi manual / buat akun guru dari `SEED_TEACHER_*` |
| `node tests/setup-teacher.mjs` | Siapkan guru uji + soal contoh di server yang berjalan |
| `npm run e2e` | Uji guru + 2 siswa di 3 browser terpisah (butuh `playwright` + Chromium) |
| `npm run loadtest -- --players 50,100,200,500 --duration 60` | Uji beban |

Tambahkan `?debug=1` pada alamat game untuk menampilkan FPS, jumlah chunk, draw call, dan jumlah pemain lain.

## Hasil pengujian (dijalankan 3 November 2026, lingkungan pengembangan)

- **Typecheck** semua paket: lulus. **Unit/integrasi**: shared 15/15, server 6/6 lulus. **Build**: lulus (game ±175 KB gzip, dashboard ±36 KB gzip).
- **E2E** (`tests/e2e/two-players.mjs`): 9/9 langkah lulus — guru membuat sesi dari Dashboard → 2 siswa di 2 proses Chromium terpisah masuk → Dashboard menampilkan 2 siswa online → mulai → keduanya di Kota dan saling melihat → siswa berjalan ke titik soal, menjawab, dinilai server → umpan jawaban & skor muncul di Dashboard → akhiri → hasil akhir → Podium 3D.
- **Uji beban**: 50/100/200/500 bot, 0 gagal gabung, 0 putus, semua jawaban tersimpan; balasan jawab p95 36 ms pada 500 pemain; CPU server rata-rata 50% satu inti. Rincian & batasan: [docs/LOADTEST.md](docs/LOADTEST.md).
- **Belum diuji**: HP Android fisik, WiFi sekolah sungguhan, Docker image (tidak ada Docker daemon di lingkungan ini), banyak instance dengan Redis.
- **FPS**: uji otomatis memakai GPU perangkat lunak (SwiftShader) dan hanya mencapai ±11–17 FPS — angka ini **tidak mewakili** HP sungguhan. FPS di HP siswa harus diukur langsung dengan `?debug=1`.

## Keamanan & privasi

- Kunci jawaban hanya ada di server; klien menerima soal tanpa kunci, jawaban dinilai server.
- Identitas siswa = nomor absen + nama panggilan (tanpa data pribadi lain), dikunci token per perangkat; guru bisa mereset.
- Kata sandi guru di-hash bcrypt; sesi guru berupa cookie httpOnly (`Secure` di produksi).
- Helmet CSP, pembatasan laju (login, API, gabung sesi, paket posisi), batas ukuran unggahan & pesan.
- `.env`, kunci, dan hasil build tidak masuk repository (`.gitignore`).
- `npm audit --omit=dev` (3 Nov 2026): 1 high (`zod` — kehabisan memori pada koleksi sangat besar; perbaikannya butuh zod 4 yang tidak kompatibel; dimitigasi batas body 2 MB / pesan socket 64 KB dan sebagian besar validasi hanya di endpoint guru) dan 9 moderate pada rantai `exceljs` (archiver/uuid/glob, dipakai untuk ekspor & templat Excel). Belum ada versi perbaikan yang kompatibel.

## Lisensi

Hak cipta pemilik repository. Belum ditentukan lisensi sumber terbuka.
