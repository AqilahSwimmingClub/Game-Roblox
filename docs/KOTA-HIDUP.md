# Kota Hidup EDUVERSE — Open-World Living City

Branch: `dev/eduverse-living-city` (dibangun di atas `dev/eduverse-online-avatar20`, yang sudah berisi Mode Demo dan 20 karakter).
Semua fitur lama tetap ada: Dunia Kota, Mode Demo tanpa kode, 20 karakter, Dashboard Guru, kelas & kode, persetujuan siswa,
bank soal Word/Excel, nilai, leaderboard, podium 3D, kamera third-person, multipemain.

## Apa yang baru

| Fitur | Status | Catatan |
|---|---|---|
| Lalu lintas NPC: mobil, motor, sepeda, bus mengikuti 7 lintasan jalan, **lajur kiri** | ✅ diuji otomatis | state machine: JALAN · REM_LAMPU · REM_ANTRE · REM_PEJALAN |
| Lampu lalu lintas (6 simpang) + zebra cross | ✅ diuji otomatis | jam bersama: warna sama di semua perangkat; dua arah tidak pernah hijau bersamaan (unit test) |
| Pejalan kaki di trotoar (menunggu lampu di penyeberangan, berhenti melihat toko) + warga taman (senam, duduk, mengobrol, bermain) | ✅ | 105 warga disimulasikan, hanya yang dekat dirender (InstancedMesh) |
| 14 pedagang/warga interaktif (makanan, minuman, buah, buku, alat sekolah, minimarket, warung, polisi lalu lintas, petugas bandara, turis, pemandu museum & teknologi, pak RT) | ✅ diuji otomatis | BICARA · LIHAT BARANG · TERIMA MISI |
| **Toko & Tas (inventaris)**: 9 pedagang menjual 31 barang virtual; dompet Rupiah virtual; tas; makanan/minuman/buah bisa DIPAKAI | ✅ diuji otomatis (Mode Demo & kelas/server) | lihat "Toko & Tas" |
| Misi kontekstual: kembalian, pecahan uang, menghitung barang, makanan sehat, literasi, Pancasila, IPAS, Bahasa Inggris, koding, keselamatan lalu lintas, navigasi bandara | ✅ | Mode kelas: soal **dari bank guru, dinilai server**, mapel diutamakan sesuai tempat. Mode Demo: soal latihan lokal |
| Toko, minimarket, restoran, warung (bangunan bertanda), 5 area parkir + parkir bandara & bisnis | ✅ | |
| Kendaraan yang bisa dikendarai: sepeda, motor, mobil, bus penumpang, pesawat ringan (27 unit) | ✅ diuji otomatis | naik/turun, kursi, kamera mengikuti, gas/rem/mundur/belok, batas kecepatan, tabrakan, pemulihan |
| Jetpack (5 stasiun) | ✅ diuji otomatis | terbang sungguhan, naik/turun, energi + isi ulang di tanah, api semburan, suara, mendarat di atap |
| Pesawat ringan di Bandara EDUVERSE | ✅ diuji otomatis | taksi, lepas landas ≥ 76 km/j, belok miring, naik/turun, mendarat, keluar hanya setelah berhenti |
| Bandara (timur) + Kawasan Gedung Tinggi & Pusat Teknologi (barat) + zona udara 2,36 × 2,36 km | ✅ | gerbang di pagar kota; menara 30–66 m dengan helipad |
| Lubang Dimensi (10 portal, 5 pasang) + Taman Langit rahasia | ✅ diuji otomatis | pusaran biru-ungu, partikel, suara, transisi + nama tujuan, anti-teleport berulang |
| Gerbang Antardunia (Hutan/Laut/Angkasa) | ✅ jujur | ditampilkan "segera hadir"; **tidak** memindahkan pemain ke dunia yang belum ada |
| Peta mini & peta besar menandai lubang dimensi, stasiun jetpack, area parkir, pesawat, pedagang; Mode Demo punya tombol **Peta** | ✅ diuji otomatis | peta besar otomatis meluas saat pemain di Bandara/Gedung Tinggi |
| Kontrol kontekstual HP/tablet | ✅ | jalan: joystick+lompat+lari+aksi · kendaraan: GAS/REM/TURUN + joystick belok · pesawat: GAS+/GAS−/NAIK/TURUN/KELUAR · jetpack: NAIK/TURUN/MATIKAN |
| Multipemain: pemain lain terlihat berjalan, bersepeda, naik motor/mobil/bus, terbang jetpack, menerbangkan pesawat, keluar dari portal | ✅ diuji (2 browser) | lihat "Sinkronisasi" |
| Dashboard Guru: kolom lokasi menampilkan mode (mis. "Mengemudi Mobil"), peta sebaran mencakup bandara & gedung tinggi | ✅ | |
| Supabase PostgreSQL (skema + RLS) | ✅ diterapkan ke proyek Supabase "Game-Roblox" | server game tetap Node otoritatif — lihat bawah |

## Toko & Tas

- **Uang virtual (Rupiah)**: setiap siswa mulai dengan **Rp20.000**; setiap jawaban **benar** (titik soal maupun misi pedagang) menambah **Rp5.000**.
  Uang & tas **tidak memengaruhi poin/peringkat** — penilaian tetap adil.
- **Membeli**: dekati pedagang bertanda **!** → LIHAT BARANG → atur jumlah (1–5) → BELI. Layar menampilkan hitungan
  `jumlah × harga = total` dan `uangmu − total = sisa` (latihan berhitung uang). Uang kurang → ditolak dengan selisihnya.
- **Tas** (tombol 🎒 di kiri layar, tombol **B** di keyboard): makanan, minuman & buah bisa **PAKAI** → energi jetpack penuh;
  buku & alat tulis menjadi **koleksi**. Isi maksimal 40 barang.
- **Mode kelas — dinilai server**: server memeriksa jarak ke pedagang (≤ 5 m), barang memang dijual pedagang itu, jumlah 1–5,
  saldo cukup, tas muat, batas 20 pembelian/menit. Saldo & tas disimpan per siswa per sesi (`session_roster.wallet`,
  `session_roster.inventory`, migrasi `004_inventory.sql`), setiap pembelian dicatat di tabel `purchases`, tetap utuh setelah
  sambung ulang. Status diubah di memori sebelum menulis ke database (mencegah pembelian ganda memakai saldo yang sama) dan
  dikembalikan bila penulisan gagal. Dashboard Guru menampilkan kolom **Uang · Tas** per siswa.
- **Mode Demo**: aturan sama, tetapi hanya di memori halaman (tidak menyentuh data kelas).
- Katalog & aturan ada di `packages/shared/src/kota/shop.ts` (dipakai klien & server).

## Kontrol

| Mode | HP / tablet | Komputer |
|---|---|---|
| Berjalan | joystick kiri, geser kanan = kamera, Lompat, Lari, Aksi (muncul dekat objek) | WASD, Shift, Spasi, E, seret mouse |
| Mobil / motor / sepeda / bus | joystick kiri = belok (maju/mundur juga), **GAS**, **REM**, **TURUN** | W gas · S rem/mundur · A/D belok · H klakson · E turun |
| Pesawat | joystick = belok, **GAS+ / GAS−**, **NAIK / TURUN**, **KELUAR** (aktif setelah mendarat & berhenti) | W/S gas · A/D belok · Spasi naik · C turun · E keluar |
| Jetpack | joystick = gerak, **NAIK / TURUN / MATIKAN**; tombol **JETPACK** untuk memakai lagi | WASD · Spasi naik · C turun · F nyala/mati |

Tombol jalan disembunyikan saat berkendara/terbang (tidak menumpuk). Mendukung landscape & portrait.

## Arsitektur

```
packages/shared/src/kota/living.ts   data deterministik Kota Hidup (dipakai klien & server):
                                     kendaraan, stasiun jetpack, portal, pedagang+misi, lintasan lalu lintas,
                                     lampu (lightFor), trotoar, batas per mode (MODE_LIMITS), spesifikasi kendaraan
apps/game/src/world/living/
  traffic.ts    kendaraan NPC & pejalan kaki (state machine, InstancedMesh, render terdekat saja)
  vehicles.ts   fisika kendaraan darat & pesawat (kinematik, tanpa physics engine), kendaraan parkir (lazy)
  mobility.ts   pengendali pemain: naik/turun, jetpack, portal, prompt, kontrol kontekstual, suara mesin
  vendors.ts    pedagang (rig karakter EDUVERSE + kios/gerobak), dibangun hanya bila dekat
  rifts.ts      lubang dimensi (pusaran, partikel), deteksi masuk + anti berulang
  missions.ts   dialog pedagang, misi lokal Mode Demo, Gerbang Antardunia, transisi portal
  meshes.ts     model 3D blocky kendaraan & jetpack
apps/server/src/game/runtime.ts      validasi: naik/turun kendaraan (jarak, kunci 1 pengemudi), jetpack (stasiun),
                                     portal (jarak, jeda 2,5 dtk, tujuan dari data bersama), batas kecepatan &
                                     ketinggian PER MODE yang dicatat server, kendaraan dilepas saat putus/ganti adegan
```

### Sinkronisasi multipemain

- **Posisi**: klien mengirim 10×/detik (bukan per frame); server memvalidasi kecepatan horizontal & ketinggian
  berdasarkan **mode yang dicatat server sendiri** (bukan klaim klien): jalan 8,5 m/dtk · sepeda 10 · motor 19 · mobil 21 ·
  bus 15 · jetpack 13 (≤170 m) · pesawat 62 (≤320 m). Pelanggaran → koreksi posisi.
- **Snapshot** ke tiap pemain hanya untuk pemain terdekat (radius 150 m, maks 30) — format ringkas
  `[id, x, y, z, ry, anim, emote, mode, tp, warnaKendaraan]`. Klien menginterpolasi 120 ms di belakang.
- **Teleport** (portal/lift/koreksi) menaikkan penghitung `tp` → klien lain langsung memindah avatar (tanpa
  "meluncur" melintasi kota) + efek kilau.
- **Kendaraan**: status (parkir/dikemudikan, posisi parkir) dicatat server per instance; dikirim **hanya saat berubah**
  (`vehicles:state`). Satu kendaraan = satu pengemudi. Saat pengemudi putus koneksi, kendaraan diparkir di posisi sah
  terakhir; kendaraan yang ditinggal jauh > 4 menit kembali ke tempat parkirnya.
- **Lalu lintas & warga NPC** dihitung di tiap perangkat (kosmetik, tidak membebani jaringan). Lampu memakai jam
  bersama sehingga warnanya sama; posisi mobil NPC bisa sedikit berbeda antarperangkat (tidak memengaruhi nilai).
- **Tidak ada** penulisan posisi ke PostgreSQL per frame; database hanya menyimpan sesi, roster, jawaban, skor.

### Supabase — apa yang dipakai dan mengapa

- **Supabase PostgreSQL** = basis data EDUVERSE. Skema 001–004 sudah diterapkan ke proyek Supabase `Game-Roblox`
  (paket Free, region ap-south-1). Migrasi `003_rls_supabase.sql` mengaktifkan **RLS tanpa policy** + mencabut hak
  `anon`/`authenticated`: API publik Supabase tidak bisa membaca kunci jawaban, data siswa, atau hash kata sandi.
  Server Node terhubung langsung sebagai pemilik tabel.
- **Terverifikasi** (4 Nov 2026) langsung di database Supabase: peran `anon` dan `authenticated` **ditolak** membaca ke-8 tabel (termasuk `purchases` dari migrasi 004),
  peran server (pemilik tabel) tetap bisa membaca. Skrip ulang: `supabase/verify_rls.sql` (SQL Editor) atau
  `tests/security/supabase-rls.mjs` (lewat REST, butuh `SUPABASE_URL` + kunci publik). Uji integrasi server juga lulus 6/6 dengan
  pemilik tabel **non-superuser** + peran `anon`/`authenticated` yang punya hak bawaan (meniru izin Supabase) — migrasi 003 mencabutnya.
- **Server game otoritatif tetap Node + Socket.IO** (Render atau VPS). Supabase **bukan** server game: penilaian soal,
  validasi kecepatan/teleport/kendaraan butuh proses yang memegang status permainan di memori.
- **Supabase Realtime tidak dipakai untuk posisi**. Kuota paket Free (dokumentasi Supabase, Nov 2026): 100 pesan/detik,
  200 koneksi puncak, 2 juta pesan/bulan; *pesan* dihitung saat dikirim **dan** saat diterima tiap klien.
  Hitungan untuk target 3 HP siswa pada 10 Hz: 3×10 (kirim) + 3×2×10 (terima) = **90 pesan/dtk** (90% batas);
  2 juta pesan/bulan habis setelah ±6 jam bermain. Dengan 5 siswa: 250 pesan/dtk → koneksi diputus Supabase.
  Socket.IO di server sendiri tidak punya kuota pesan, dan server sudah teruji 500 bot. Karena itu Realtime/Edge
  Functions **tidak diaktifkan** (juga agar tidak memicu biaya). Ini perhitungan dari kuota resmi, **belum** diukur di Supabase.

## Optimasi untuk HP Android

- Chunk streaming + LOD + frustum culling (sudah ada) untuk bangunan; padang luar kota memakai ubin 200 m.
- Kendaraan & pejalan NPC: **InstancedMesh** (≈13 draw call untuk semua NPC), hanya yang terdekat dirender
  (Rendah 10 kendaraan/16 warga · Sedang 18/30 · Tinggi 30/50), radius 120/170/240 m.
- Pedagang & kendaraan parkir dibangun hanya dalam radius pandang dan dibuang saat jauh (vehicle pooling sederhana).
- Fisika kinematik (lingkaran vs kotak AABB di grid spasial) — tanpa physics engine.
- Partikel portal mengikuti pengali kualitas; suara bisa dimatikan dari Menu.

## Hasil pengujian (4 Nov 2026, lingkungan pengembangan — **bukan** perangkat fisik)

| Uji | Hasil |
|---|---|
| Typecheck semua paket | lulus |
| Unit shared (termasuk 7 uji Kota Hidup + 4 uji Toko & Tas: katalog, total & sisa, tolak uang kurang/jumlah tidak sah/barang tidak dijual/tas penuh, pembersihan isi tas) | 27/27 |
| Integrasi server (PostgreSQL 16, dengan migrasi RLS) | 6/6 |
| `tests/e2e/living-city.mjs` (Mode Demo, Pixel 7 landscape): berjalan, NPC bergerak & berhenti di lampu merah, pedagang + misi, mobil/motor/sepeda naik-kemudi-turun, tidak menembus bangunan, jetpack naik → mendarat di atap 42 m → turun ke jalan, pesawat lepas landas (90 km/j) → terbang 50 m → mendarat → keluar, portal Alun-alun → Bandara, tidak teleport berulang, peta berpenanda, **beli barang + tolak uang kurang + tas + pakai makanan**, tanpa galat, tanpa menghubungi server | **16/16** |
| `tests/e2e/two-players.mjs` (guru + 2 siswa, 3 browser, topologi Vercel↔backend): alur kelas lama + server menolak kendaraan/portal/jetpack dari jauh, **B melihat A mengendarai mobil**, kendaraan terparkir di posisi baru untuk semua, **B melihat jetpack A di udara**, portal ke Bandara diterima server (skor & karakter tetap), **membeli di kios Bandara lewat server (saldo berkurang, tas bertambah; server menolak pedagang jauh, barang yang tidak dijual, uang kurang; Dashboard menampilkan Uang · Tas)**, **putus internet 30 dtk saat mengemudi → tersambung lagi, kendaraan dilepas aman, skor & tas utuh**, podium | **18/18** |
| `tests/security/abuse.mjs` | 20/20 |
| Uji beban singkat 50 bot | 0 gagal, 0 koreksi, 0 putus |
| FPS | SwiftShader (GPU perangkat lunak) 38–60 FPS di Mode Demo — **tidak mewakili HP**. Ukur di HP dengan `?debug=1`. |

## Belum / prototipe (jujur)

- **Belum diuji di HP Android/tablet fisik** dan WiFi sekolah. Angka FPS di atas bukan angka HP.
- **Backend online belum aktif**: perlu pemilik akun membuat layanan Render (atau VPS) dan mengisi `DATABASE_URL`
  Supabase (kata sandi DB tidak bisa diambil dari lingkungan pengembangan). Lihat `docs/DEPLOYMENT.md`.
- Deploy preview Vercel bergantung pada integrasi Git Vercel yang sudah ada di proyek `eduverse-web-preview`
  (tidak ada akses Vercel langsung dari lingkungan ini).
- Barang di tas belum bisa diberikan/ditukar ke teman, dan koleksi buku/alat tulis belum punya efek dalam permainan.
- Mobil NPC tidak bertabrakan fisik dengan pejalan NPC (mereka mengerem untuk pemain, bukan untuk sesama NPC di trotoar).
- Kendaraan NPC tidak berbelok di simpang secara acak — mengikuti lintasan tetap (sesuai permintaan: tidak acak menembus gedung).
- Rute pejalan kaki taman memakai trotoar; pohon acak lama bisa sesekali tampak dilewati (kosmetik).
- Pesawat & mobil pemain lain tampak miring/berbelok dari interpolasi posisi; roll pesawat tidak dikirim.
- Dunia Hutan/Laut/Angkasa belum dibangun (portal antardunia jujur "segera hadir").
