# Empat Dunia EDUVERSE

Keempat dunia memakai format layout yang sama (`packages/shared/src/worlds/`). Server dan klien membangun dunia yang identik dari data deterministik, sehingga penilaian soal, validasi gerak, kendaraan, jetpack, lubang dimensi, pedagang/NPC misi, tas, dan uang berlaku sama di semua dunia.

| Dunia | Ukuran | Zona | Ciri khas |
|---|---|---|---|
| **Kota** | 2,4 × 2,4 km | 12 zona (Alun-alun, Sekolah, Pasar, Bandara, Gedung Tinggi, …) | Lalu lintas, bus kota, pesawat, lift, 14 pedagang |
| **Hutan** | 600 × 600 m | Perkemahan, Hutan Hujan, Desa Rumah Pohon (panggung 6 m + jembatan gantung), Sungai, Danau Teratai, Gua Kristal, Jalan Setapak | 6 NPC misi (Ranger, peneliti, petani, penjaga gua, …), sepeda & motor, 3 stasiun jetpack |
| **Laut** | 600 × 600 m | Pulau Pelabuhan, Terumbu Karang (bawah laut), Mercusuar, Pulau Penyu, Kapal Karam, Palung Biru, Pulau Kelapa | Berenang & menyelam dengan **oksigen 45 detik** (otomatis naik bila habis), **perahu** & **kapal selam** (hanya bergerak di air), 5 NPC |
| **Luar Angkasa** | 600 × 600 m | Stasiun Antariksa (2 lantai), Kawah Bulan, Landasan Roket, Sabuk Asteroid melayang, Observatorium (y 32 m), Lembah Meteor, Taman Planet (8 planet) | **Gravitasi rendah** (lompatan ±4× lebih tinggi), langit berbintang, penjelajah bulan, 4 stasiun jetpack, 6 NPC |

## Berpindah dunia

- **Lobi**: tombol *PILIH DUNIA* dan portal. Hanya dunia yang dicentang guru saat membuat sesi yang terbuka.
- **Gerbang Antardunia** (pusaran ungu di dekat titik muncul tiap dunia): memilih dunia tujuan secara langsung.
- Identitas, skor, tas, dan uang disimpan server, jadi semuanya terbawa ke dunia mana pun.

## Soal

Semua titik soal, termasuk pedagang/NPC misi, mengambil soal dari **Bank Soal Guru** sesuai sumber soal sesi. Zona memberi saran mapel (misalnya Hutan → IPAS). Bila mapel itu tidak ada di bank, soal lain yang cocok dengan pengaturan sesi tetap dipakai. Jawaban dicatat beserta dunianya, dan `/api/sessions/:id/results` mengembalikan `perWorld`.

## Dashboard

*Sebaran Siswa* punya tab per dunia yang menampilkan jumlah siswa di setiap dunia beserta posisi mereka.

## Pengujian

`node tests/e2e/worlds.mjs` menguji alur 1 guru + 3 siswa (1 browser HP + 2 klien Socket.IO) melintasi empat dunia (15 langkah, juga dijalankan di CI). Uji ini mencakup:
- portal lobi dan Gerbang Antardunia;
- jawaban per dunia;
- perahu dan oksigen menyelam;
- gravitasi rendah;
- validasi server di dunia baru;
- tab Dashboard.

Semua pengujian ini otomatis (Chromium + emulasi HP). Belum ada uji pada HP fisik.
