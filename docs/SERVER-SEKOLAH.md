# Server Sekolah (jaringan lokal) — jalur cadangan tanpa hosting internet

Dipakai bila backend internet (Render) belum aktif atau internet sekolah lambat. Satu komputer menjalankan
**seluruh** EDUVERSE: game siswa, Dashboard Guru, API, multipemain (Socket.IO), dan basis data.
Penilaian & validasi tetap di server (tidak ada yang dipindah ke HP siswa).

## Perangkat

| Perangkat | Keterangan |
|---|---|
| 1 laptop/PC (server) | Windows 10/11, macOS, atau Linux · RAM ≥ 4 GB · **Node.js 22** terpasang (https://nodejs.org) · tetap menyala selama kelas |
| WiFi/hotspot | Router sekolah, atau hotspot dari HP/laptop. Server, tablet guru, dan HP siswa harus di jaringan yang **sama** |
| Tablet guru | Chrome → Dashboard Guru |
| HP siswa | Chrome → game |

Internet **tidak** dibutuhkan selama bermain (font cadangan dipakai bila Google Fonts tidak terjangkau).

## Menyalakan (sekali per kelas)

```bash
# sekali saja setelah mengunduh source code:
npm ci
# setiap kali akan dipakai:
npm run sekolah
```

Terminal menampilkan alamat, misalnya:

```
Siswa (HP)        : http://192.168.1.10:3000/
Guru (tablet)     : http://192.168.1.10:3000/guru/
```

1. Tablet guru membuka alamat **Guru** → daftar akun guru pertama → *Bank Soal → Muat Soal Contoh* (atau impor Word/Excel) → *Buat Sesi*.
2. Dashboard menampilkan kode kelas + QR (mengarah ke alamat server ini). Siswa memindai QR atau mengetik alamat **Siswa** lalu kode kelas.
3. Data (akun guru, bank soal, nilai, tas siswa) tersimpan di folder `data-sekolah/` dan tetap ada setelah laptop dimatikan.
   Cadangkan folder itu bila perlu. Folder ini tidak masuk Git.

Mematikan: tekan `Ctrl+C` di terminal.

## Catatan teknis

- Basis data: **PGlite** (PostgreSQL 17 tertanam, `@electric-sql/pglite@0.4.6`) — tidak perlu memasang PostgreSQL.
  Satu koneksi; kueri diantrekan. Cocok untuk satu sekolah; untuk banyak kelas serentak gunakan PostgreSQL/Supabase
  (`DATABASE_URL`) dengan `npm start`.
- Kunci rahasia JWT dibuat acak sekali di `data-sekolah/jwt-secret.txt`.
- Mode HTTP lokal (`LAN_HTTP=1`): tanpa HTTPS di jaringan lokal, sehingga server tidak memaksa `https`/HSTS/cookie Secure.
  Jangan membuka port server ini ke internet.
- Server menerima halaman dari alamatnya sendiri apa pun IP/nama yang dipakai (guru via `localhost`, siswa via IP WiFi).
- Firewall Windows: saat pertama dijalankan, izinkan Node.js untuk **jaringan pribadi**.

## Diuji (4 Nov 2026, lingkungan pengembangan)

`npm run sekolah` + uji E2E kelas lengkap (guru + 2 siswa di 3 browser, satu alamat seperti di sekolah): **19/19**;
uji keamanan: **20/20**. Belum diuji pada laptop Windows & HP fisik di WiFi sekolah sungguhan.
