# Bank Soal Guru

Semua soal disimpan di PostgreSQL (Supabase atau Server Sekolah) per akun guru. Perubahan berlaku pada sesi berikutnya tanpa deploy ulang.

## Sumber soal per sesi

| Pilihan di "Buat Sesi" | Soal yang dipakai |
|---|---|
| **Hanya Soal Guru** (bawaan, disarankan untuk sesi resmi) | Soal yang Anda buat/impor saja |
| Soal Bawaan EDUVERSE | Soal contoh EDUVERSE saja (harus dimuat dulu dengan tombol **Muat Soal Bawaan**) |
| Gabungan Keduanya | Keduanya |

- Soal bawaan disimpan terpisah (label **Bawaan**) dan **tidak pernah dicampur** ke sesi "Hanya Soal Guru".
- Bila soal yang cocok kosong, formulir menampilkan peringatan dan tombol buat sesi nonaktif; server juga menolak dengan pesan jelas. Tidak ada soal contoh yang diam-diam dipakai.
- **Hapus Soal Bawaan** menghapus seluruh soal bawaan dari bank Anda (soal Anda aman), jadi bank 100% berisi soal Anda.

## Memilih soal untuk sesi

Saring menurut mapel (bisa lebih dari satu), kelas, dan tingkat kesulitan, lalu pilih:
- **Semua soal yang cocok**
- **Acak N soal**: server mengundi N soal saat sesi dibuat
- **Pilih soal tertentu**: centang soal satu per satu, atau gunakan "Pilih semua yang tampil"

Formulir menampilkan jumlah soal yang akan dipakai sebelum sesi dibuat.

## Menambah soal

- **Manual**: tipe soal pilihan ganda, benar/salah, isian singkat, menjodohkan, dan lainnya. Isi kunci, pembahasan, kesulitan, poin, dan gambar opsional (PNG/JPEG/WebP; diperkecil otomatis di perangkat guru, maks ±400 KB).
- **Excel (.xlsx) / Word (.docx)**: unduh templatenya di halaman Bank Soal, lalu ikuti langkah ini:
  1. Unggah file (maks 25 MB, hingga 50.000 baris per file; untuk soal lebih banyak, bagi menjadi beberapa file).
  2. Periksa **pratinjau**. Setiap baris bermasalah ditandai nomor baris dan alasannya; baris itu tidak ikut disimpan, dan soal lama tidak tersentuh.
  3. Tentukan penanganan duplikat:
     - **Lewati** (soal lama tetap)
     - **Perbarui** (kunci, pembahasan, poin, dan lainnya diganti dari file)
     - **Tetap simpan sebagai soal baru**
  4. Simpan. Dashboard mengirim soal secara bertahap, jadi jumlah soal per file tidak dibatasi angka tetap.

## Keamanan dan riwayat

- Semua endpoint bank soal membutuhkan login guru, dan guru hanya melihat soalnya sendiri.
- Kunci jawaban tidak pernah dikirim ke perangkat siswa; penilaian dilakukan di server.
- Setiap jawaban siswa menyimpan **cuplikan soal** saat dijawab. Mengedit atau menghapus soal di bank tidak mengubah hasil maupun ekspor sesi lama.
- Soal dipakai oleh semua titik soal di dunia game (pedagang/NPC misi, objek, zona). Mode Demo tetap memakai soal latihan lokal dan tidak memakai bank guru.

Pengujian otomatis: `node tests/integration/question-bank.mjs` (dijalankan di CI).
