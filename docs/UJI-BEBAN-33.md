# Uji beban kesiapan kelas — 33 siswa, 40 menit

Membuktikan EDUVERSE siap dipakai satu kelas penuh: 33 siswa bermain **bersamaan** dalam
**satu sesi**, sementara guru memantau dari Dashboard Guru.

Program: `tests/load/bots.mjs --mode kelas`. Mode lama (`--mode sweep`, dipakai CI untuk
50/100 pemain singkat) tidak berubah.

## Menjalankan

Lewat GitHub Actions (cara yang dipakai untuk bukti resmi — hasil tetap tersimpan sebagai
artefak walaupun sesi yang memicunya terputus):

> Actions → **Uji Beban 33 Siswa (manual)** → Run workflow

Tidak pernah berjalan otomatis pada setiap commit: satu kali uji memakai ~40 menit koneksi
aktif ke hosting gratis.

| Input | Bawaan |
|---|---|
| `backend_url` | `https://eduverse-aqilah-api-production.up.railway.app` |
| `players` | 33 |
| `duration_minutes` | 40 |
| `session_minutes` | 45 |
| `class_name` | `EDUVERSE-LOADTEST-33` |
| `expect_commit` | kosong (isi SHA pendek agar uji berhenti bila backend bukan versi itu) |

Job **verifikasi** tidak memerlukan secret: ia selalu melaporkan health, commit backend yang
berjalan, dan heartbeat Engine.IO yang sedang aktif. Job **beban** memerlukan dua secret
repositori:

| Secret | Isi |
|---|---|
| `LOADTEST_TEACHER_EMAIL` | email akun guru **khusus pengujian** |
| `LOADTEST_TEACHER_PASSWORD` | kata sandinya |

Gunakan akun guru khusus pengujian, bukan akun guru sungguhan. Nilai secret tidak pernah
ditulis ke workflow maupun log.

Lokal (butuh Postgres + server berjalan):

```bash
BASE_URL=http://localhost:3000 TEACHER_EMAIL=… TEACHER_PASSWORD=… OUT=hasil.json \
  node tests/load/bots.mjs --mode kelas --players 33 --duration 2400 --session-minutes 45
```

## Yang disimulasikan

1. Guru membuat sesi uji → server menghasilkan kode kelas.
2. 33 bot menyambung **bergelombang** (7 siswa tiap 1,8 dtk), memasukkan kode kelas yang sama,
   mengklaim nomor absen unik 1–33 dengan nama `Siswa Uji 01`…`Siswa Uji 33`, memilih avatar,
   masuk lobi, lalu menandai **SIAP**.
3. Guru menyetujui setiap permintaan masuk (`requireApproval: true`, seperti kelas resmi).
4. Guru menekan Mulai Permainan.
5. Siswa tersebar: **Kota 9 · Hutan 8 · Laut 8 · Angkasa 8**, semuanya aktif bersamaan.
6. Selama 40 menit setiap bot berjalan (10 paket posisi/detik, divalidasi server), mendatangi
   titik soal, menjawab, memakai portal, kendaraan, mendatangi pedagang, menyelam (Laut),
   dan melompat (Angkasa).
7. Empat siswa berpindah dunia beruntun **Kota → Hutan → Laut → Angkasa → Kota**; identitas,
   skor, dompet, dan tas diperiksa tetap utuh setelah setiap perpindahan.
8. Gangguan koneksi terjadwal: menit 10 tiga siswa diputus terkontrol, menit 20 lima siswa
   kehilangan transport sebentar, menit 30 empat identitas disambung ulang. Menit 40 seluruh
   33 siswa harus tetap terhubung.
9. Sesi diakhiri, skor akhir & peringkat dihitung server, lalu Podium Juara ditampilkan dan
   diperiksa konsisten untuk semua siswa.

## Aturan yang dipegang

- **Angka "online" diambil dari status server** (namespace `/teacher`, `teacher:live`), bukan
  dari jumlah socket atau hitungan sisi klien. `connections` dibandingkan dengan `online` untuk
  menangkap siswa yang terhitung dua kali setelah sambung ulang.
- **Tidak ada jalan pintas.** Validasi posisi server tetap menyala; bot berjalan di bawah batas
  kecepatan dan tidak memakai teleport tidak sah. Setiap koreksi posisi dari server dicatat.
- **Sesi uji memakai durasi lebih panjang** (45 menit) agar simulasi 40 menit tidak terpotong
  timer. Durasi sesi kelas sungguhan tetap 30 menit dan tidak diubah.
- **Soal.** Sesi uji memakai `questionSource: 'bawaan'` (soal contoh milik akun guru uji).
  Bank Soal guru lain tidak dibaca, diubah, maupun dihapus.
- **Cleanup.** Hanya sesi uji ini yang diakhiri dan dihapus, dijalankan di blok `finally`
  sehingga tetap berjalan ketika uji gagal di tengah jalan.

## LULUS/GAGAL

Program keluar dengan **exit code 1** bila salah satu gerbang gagal — bukan "SUCCESS" hanya
karena 40 menit sudah lewat. Gerbang yang diperiksa:

- 33 siswa bergabung, 33 identitas unik tanpa absen ganda, 33 online, 33 siap.
- `connections == online` (tidak ada siswa terhitung dua kali).
- Nama dan avatar cocok dengan identitas.
- Tombol Mulai Permainan bekerja dengan 33 siswa siap.
- Sebaran dunia tepat 9/8/8/8 dan keempat dunia terisi bersamaan.
- Durasi simulasi benar-benar mencapai target.
- Perpindahan dunia berhasil tanpa kehilangan identitas, skor, dompet, atau koneksi.
- Sambung ulang berhasil dan jumlah online kembali 33.
- Tidak ada disconnect mendadak (yang disengaja tes dicatat terpisah sebagai terencana).
- Pengiriman jawaban tanpa kegagalan tak terduga.
- Jawaban dan skor akhir tersimpan di database; peringkat final ditetapkan server.
- Podium: semua siswa menerima top-3 dan id acara yang sama, urutan 1-2-3 benar.
- Health endpoint stabil; Dashboard Guru menerima pembaruan tanpa putus.

Hasil lengkap ditulis ke JSON (`OUT`): ringkasan tiap 5 menit (menit 0,5,…,40), seluruh
gerbang, rincian perpindahan dunia, rincian tiap skenario putus–sambung, latensi p50/p95/p99,
dan daftar keterbatasan.

## Keterbatasan yang dilaporkan apa adanya

- **CPU/RAM Railway tidak terbaca dari runner GitHub Actions.** Laporan menandainya
  *tidak tersedia*; ambil angkanya dari dashboard Railway. Tidak ada angka yang dikarang.
- **33 bot dari satu runner tidak membuktikan kualitas 33 jaringan HP fisik** yang berbeda
  (WiFi sekolah, hotspot, paket data). Yang terbukti adalah kemampuan server menangani 33
  identitas aktif bersamaan lewat internet.
- **Perilaku klien** — oksigen menyelam, musik per dunia, confetti, HUD portrait/landscape —
  diuji terpisah di Chromium oleh `tests/e2e/touch-worlds.mjs`, `tests/e2e/responsive.mjs`,
  dan `tests/e2e/podium.mjs`.
- `MAX_PLAYERS_PER_NODE` hanyalah batas konfigurasi, bukan hasil uji kapasitas.
