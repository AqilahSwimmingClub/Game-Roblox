# Acara Podium Juara 3D

Guru menekan **🏆 Tampilkan Podium 3D** di Dashboard (setelah permainan diakhiri). Semua siswa melihat
acara penghargaan yang sama.

## Urutan acara (±48 detik)

| Detik | Adegan | Yang terjadi |
|---|---|---|
| 0 | Pembukaan | Musik dunia memudar → drum roll + gumam penonton, kamera mengitari panggung, judul **PODIUM JUARA EDUVERSE**, lampu sorot menyapu |
| 5,5 | Juara 3 | Avatar muncul di depan panggung, melambai, melompat naik ke podium 3; lampu sorot, tepuk tangan, kartu besar nama + poin |
| 12 | Juara 2 | Sama untuk podium 2; musik makin ramai (perkusi, string, brass), confetti, sorakan lebih meriah |
| 18,5 | Crescendo | "Dan juara pertama adalah…", drum roll memuncak, timpani makin rapat, lampu berkedip cepat |
| 22,3 | Juara 1 | Crash + fanfare, avatar naik ke podium tertinggi, kembang api, confetti, lampu kemenangan, lingkaran cahaya emas, sorak & tepuk tangan |
| 29,8 | Puncak | Kamera lebar ketiga juara, **SELAMAT PARA JUARA!**, lagu kemenangan lengkap, kembang api berkala, juara bergembira (hore, joget, melambai) |
| 47,8 | Selesai | Kontrol kembali; siswa boleh menjelajahi arena (juara tetap di podium, musik versi lembut) |

Bila pemain kurang dari 3, adegan juara yang tidak ada dilewati.

## Sinkronisasi & keamanan hasil

- Peringkat dihitung **server** dari skor resmi (poin → jawaban benar → waktu benar terakhir → absen).
- Server mengirim `podium:show` berisi `id`, `startAt` (jam server), dan top 3. Setiap HP menghitung adegan dari
  `jam server − startAt`, sehingga semua perangkat menampilkan adegan yang sama pada detik yang sama.
- **Sambung ulang / muat ulang halaman tidak memutar ulang acara**: id yang sama → acara dilanjutkan dari detik yang
  sedang berjalan; adegan yang sudah lewat dipasang tanpa suara/efek. Siswa yang baru bergabung juga melanjutkan.
- **Lewati ⏭** (melompat ke puncak) dan **Tutup ✕** hanya memengaruhi perangkat itu; juara tidak berubah.
- "Tampilkan Podium Lagi" membuat acara baru (id baru) → diputar dari awal untuk semua.

## Musik

Musik podium **disintesis langsung (Web Audio), komposisi orisinal EDUVERSE**: drum roll, timpani, string, brass
fanfare, lagu kemenangan 8 birama, perkusi; sorak & tepuk tangan juga sintetis. Tidak memakai/menirukan melodi
atau rekaman lagu mana pun. Tema podium berbeda dari musik Kota, Hutan, Laut, dan Luar Angkasa.

Lagu berlisensi (mis. "We Are the Champions") **tidak disertakan**. Rekaman resmi hanya dapat dipakai bila pemilik
menyediakan file resmi beserta izin penggunaan untuk game ini.

- Tombol **Musik** di Menu mematikan musik & suara penonton; tombol **Suara** mematikan semua bunyi.
- Pergantian musik memakai crossfade; satu acara hanya memicu satu set sorak/tepuk per adegan (diuji).

## Responsif & performa

- Kamera menghitung jarak dari sudut pandang layar → panggung muat di HP potret, lanskap, tablet, laptop.
- Judul/kartu memakai `clamp()`, safe-area, versi ringkas untuk lanskap pendek.
- HP lemah (FPS < 24 atau kualitas grafis Rendah): partikel dikurangi ±60 %, lampu sapu dikurangi — acara tetap lengkap.

## Uji

`tests/e2e/podium.mjs` (juga di CI): guru + 3 siswa browser (HP potret, HP lanskap, tablet) + 3 siswa bot yang
mengumpulkan poin lewat protokol siswa. Memeriksa juara = peringkat resmi server di semua perangkat, karakter asli,
urutan adegan, sinkron jam server, kartu nama & poin, overlay muat layar, suara tidak dobel, sambung ulang & muat ulang
tanpa mengulang, Lewati/Tutup per perangkat, tangkapan layar tiap adegan.

## Backend Railway

Fitur sinkron (`startAt`, lanjut setelah muat ulang) dan heartbeat 20/25 dtk membutuhkan backend versi PR #4.
Klien tetap berfungsi dengan backend lama (acara dimulai saat pesan diterima; tidak bisa dilanjutkan setelah muat ulang).

Cek versi yang berjalan: `GET /api/health` → `build.commit`, dan workflow **Uji Deployment Publik** (job *Ketahanan
koneksi backend*) melaporkan heartbeat yang sedang berjalan.

Deploy terkontrol: **Actions → Deploy Backend Railway (manual) → Run workflow** (butuh secret `RAILWAY_TOKEN`).
Workflow menolak commit yang CI-nya belum hijau, mencatat versi lama, memverifikasi commit + heartbeat baru, lalu uji
koneksi 60 dtk. Database Supabase dan variabel Railway tidak diubah. Rollback: Railway → Deployments → deployment
sebelumnya → Redeploy, atau jalankan workflow dengan `ref` commit sebelumnya.
