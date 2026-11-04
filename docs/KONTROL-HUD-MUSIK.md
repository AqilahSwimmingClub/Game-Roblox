# Kontrol, HUD Responsif, Koneksi, dan Musik

## Kontrol HP/tablet

- **Joystick**: sentuh dan geser di separuh kiri layar (area kiri bawah dibiarkan kosong). Tombol HUD tidak menangkap sentuhan di luar dirinya sendiri.
- **Kamera**: geser di separuh kanan layar; cubit untuk zoom.
- **Kanan bawah**:
  - **Lompat**: paling besar; ketukan singkat pun selalu terbaca.
  - **Lari**: tombol kecil, menyala/mati.
  - **Selam**: hanya muncul di Dunia Laut atau saat berenang.
  - **Aksi**: hanya muncul saat dekat objek.
- **Emote** ada di **Menu**.
- **Komputer**:
  - Gerak dan lompat: WASD/panah, Shift untuk lari, Spasi untuk lompat.
  - Aksi: E, C untuk selam, F untuk jetpack, B untuk tas.
  - Kamera: seret mouse; zoom dengan roda mouse.

### Akar masalah "karakter tidak bisa bergerak" (diperbaiki)

Aturan CSS `#ui > * { pointer-events: auto }` memakai spesifisitas ID, sehingga menimpa `.hud { pointer-events: none }`. Akibatnya, lapisan HUD transparan selebar layar menelan **semua** sentuhan, dan joystick serta kamera tidak pernah menerimanya. Masalah ini terjadi di semua dunia, termasuk lobi, dan hanya di perangkat sentuh (keyboard tidak terdampak).

Perbaikannya: `:where(#ui) > *`, dengan spesifisitas 0. Selain itu:
- `Input.reset()` kini membersihkan joystick, sentuhan kamera, cubit, dan pointer capture.
- Input direset juga pada `lostpointercapture`, saat jendela kehilangan fokus, saat aplikasi ke latar belakang, dan saat layar diputar.
- Kontrol dikunci per alasan (soal, dialog kendaraan, ganti avatar, pindah dunia, koneksi) memakai `try/finally`, sehingga satu jalur yang gagal atau dibatalkan tidak bisa meninggalkan joystick terkunci.

## HUD responsif

- **Portrait**:
  - Baris 1: profil dan poin, timer, ☰ Menu, 🏆 Skor, peta mini.
  - Baris 2 (info ringkas): peringkat (ketuk untuk papan skor), dompet/tas, progres.
- **Landscape, tablet, desktop**: satu bilah atas yang lebar, sehingga tengah layar tetap terbuka.
- **Ukuran dan tata letak**:
  - Ukuran memakai `clamp()`/`vmin`, area aman memakai `env(safe-area-inset-*)`, tinggi layar memakai `100dvh`.
  - Tinggi bilah atas dan klaster kanan bawah diekspor sebagai `--hud-top`/`--hud-br`, agar notifikasi dan kontrol kendaraan tidak bertabrakan.
- **Menu**: pilihan kualitas grafis tampil 2×2 di HP portrait dan 4 kolom di landscape.
- **Dialog**: semua dialog memakai `max-height` dengan area gulir di dalamnya.
- **Mode debug**: informasi FPS/chunk hanya tampil dalam mode debug (`?debug=1`).

## Koneksi

Bukti dari GitHub Actions terhadap backend Railway:
- `/api/health` merespons 200 dalam ±155 ms.
- CORS diterima dari ketiga alamat Vercel.
- WebSocket ditahan 3 menit **tanpa putus**, dengan RTT median ±330 ms.

Jadi tidak ditemukan penyebab dari sisi server. Perubahan yang dibuat:
- **Heartbeat lebih toleran**: 20/25 detik (sebelumnya 10/15 detik terlalu ketat untuk jaringan HP).
- **Sambung ulang**: langsung saat aplikasi kembali dari latar belakang atau saat internet kembali. Setelah tersambung, pemain bergabung ulang dengan coba ulang otomatis dan dikembalikan ke dunia serta posisi terakhir yang tervalidasi server, beserta skor, tas, dan penawaran; kontrol aktif kembali.
- **Dialog**: hanya tampil bila putus lebih dari 2,5 detik dan hilang otomatis setelah pulih.

## Musik latar

Semua musik disintesis langsung dengan Web Audio dari komposisi sendiri (tanpa file atau aset berlisensi):

| Dunia | Suasana |
|---|---|
| Kota | Pop petualangan ceria (drum, bass hangat, pluck, melodi riang) + dengung kota halus |
| Hutan | Flute, petikan akustik, shaker lembut + kicau burung dan angin; nuansa misteri ringan di Gua Kristal |
| Laut | Pad mengalun, lonceng bergema, bass panjang + ombak dan gelembung. Saat menyelam suara meredam; lonceng lembut berbunyi bila oksigen hampir habis |
| Luar Angkasa | Pad luas, kerlip arpeggio bergema, drone dalam, desir kosmik |
| Lobi / Podium | Lonceng ringan / fanfare perayaan |

Musik berganti dengan crossfade dan bisa dimatikan di Menu (**Musik: Hidup/Mati**, tersimpan). Sesuai aturan browser, musik baru mulai setelah sentuhan atau klik pertama.

## Uji otomatis

- **`tests/e2e/responsive.mjs`** (9 resolusi, 360×800 sampai 1920×1080): HUD tidak tumpang tindih dan tidak keluar layar, area joystick meneruskan sentuhan, joystick sentuh dan WASD menggerakkan karakter, menu 2×2, serta rotasi portrait → landscape → portrait.
- **`tests/e2e/touch-worlds.mjs`** (sentuhan nyata lewat CDP):
  - 20 avatar dan joystick di 4 dunia (≥ 20 m), kamera mengikuti.
  - Buka/tutup Peta, Tas, Soal, Pedagang, Menu, dan Gerbang.
  - Berenang dan lompat gravitasi rendah.
  - Pindah dunia beruntun.
  - Putus dan sambung koneksi.
  - Perangkat lain melihat gerakan.
  - Musik berbeda di tiap dunia.

Semua uji ini otomatis (Chromium + emulasi sentuhan). Belum ada uji di HP fisik.
