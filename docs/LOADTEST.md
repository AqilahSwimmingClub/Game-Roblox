# Hasil Uji Beban EDUVERSE

Diukur dengan `tests/load/bots.mjs` pada **3 November 2026** (data mentah: [`loadtest-results.json`](loadtest-results.json)).

## Cara uji

- Setiap bot adalah klien Socket.IO yang mengikuti **protokol siswa sungguhan**: gabung dengan kode kelas → klaim nomor absen → pilih avatar → lobi → siap → (guru memulai lewat API) → masuk Dunia Kota → kirim posisi 10×/detik sambil **berjalan 5 m/detik** (divalidasi server: kecepatan, batas peta) ke titik soal → buka soal → menunggu 1,5–4,5 detik → menjawab → server menilai dan **menyimpan setiap jawaban ke PostgreSQL** → lanjut ke titik berikutnya.
- Satu sesi maksimal 99 siswa (absen 1–99), jadi N bot dibagi ke ⌈N/90⌉ sesi — setara beberapa kelas bermain bersamaan di **satu instance server**.
- Durasi 60 detik per tingkat setelah semua bot masuk dunia.
- Lingkungan: **server, PostgreSQL 16, dan seluruh bot berjalan di mesin yang sama** (2 vCPU Intel Xeon 2,1 GHz, RAM 8 GB, kontainer Linux). Bot ikut memakan CPU yang sama, sehingga angka ini cenderung *lebih buruk* daripada server terpisah. Latensi jaringan internet sungguhan **tidak** termasuk (semua lewat localhost).
- CPU = pemakaian proses server Node.js, % dari **satu** inti, diambil tiap detik dari `/proc/<pid>/stat`.

## Hasil (Socket.IO 4.8.4, express 4.22.3)

| Pemain | Sesi | Berhasil main | Gagal gabung | Jawaban tersimpan | Balasan jawab p95 / p99 | Balasan buka soal p95 | Snapshot pemain lain / dtk | Koreksi posisi | Putus | CPU server rata / puncak | RAM server puncak |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 1 | 50 | 0 | 417 | 6 / 8 ms | 4 ms | 10 | 0 | 0 | 6% / 13% | 155 MB |
| 100 | 2 | 100 | 0 | 877 | 5 / 9 ms | 7 ms | 10 | 0 | 0 | 10% / 18% | 167 MB |
| 200 | 3 | 200 | 0 | 1.679 | 11 / 17 ms | 5 ms | 10 | 0 | 0 | 20% / 27% | 176 MB |
| 500 | 6 | 500 | 0 | 4.006 | 36 / 54 ms | 21 ms | 10 | 0 | 0 | 50% / 65% | 254 MB |

Waktu respons HTTP `/api/health` selama 500 pemain: p50 2 ms, p95 25 ms, maks 45 ms (event loop tetap responsif).

## Kesimpulan jujur

- **Satu instance** menangani 500 pemain serentak dengan seluruh jawaban tervalidasi & tersimpan, tanpa gagal gabung, tanpa koneksi putus, dan setiap pemain tetap menerima 10 pembaruan posisi per detik.
- CPU tumbuh kira-kira linear (≈ 10% inti per 100 pemain). Ruang tersisa pada 500 pemain ±35–50% satu inti.
- **Belum diuji**: koneksi lewat internet/WiFi sekolah sungguhan, HP siswa asli, banyak instance dengan Redis adapter, dan sesi berdurasi penuh (20+ menit). FPS di HP **tidak** diukur oleh uji ini (lihat README — FPS dari uji Playwright memakai GPU perangkat lunak dan tidak mewakili HP).
- Pemain dalam satu dunia dibagi ke instance berkapasitas 60 dan hanya menerima maksimal 30 pemain terdekat (radius 150 m), sehingga beban per klien tidak naik walau total pemain bertambah.

## Menjalankan ulang

```bash
npm run build && npm start              # terminal 1
node tests/setup-teacher.mjs            # akun guru uji + soal contoh
SERVER_PID=$(pgrep -f "node dist/index.js") OUT=docs/loadtest-results.json \
  node tests/load/bots.mjs --players 50,100,200,500 --duration 60
```
