# Panduan Deployment EDUVERSE

> **Status:** belum ada platform hosting yang terhubung ke proyek ini, jadi **belum ada alamat website publik**.
> Panduan ini menjelaskan cara memasangnya sendiri. Alamat seperti `eduverse.contoh-sekolah.sch.id` di bawah hanya contoh.

EDUVERSE adalah **satu aplikasi Node.js** yang melayani:

| Alamat | Isi |
|---|---|
| `/` | Game siswa (Three.js) — dibuka di Chrome HP |
| `/guru/` | Dashboard Guru — dibuka di tablet Android |
| `/api/*` | REST API (login guru, sesi, soal, impor, ekspor) |
| `/socket.io/` | Multipemain real-time (WebSocket) |

Kebutuhan: Node.js 20+ (disarankan 22), PostgreSQL 14+, **HTTPS wajib** di produksi (cookie login guru bertanda `Secure`, dan Chrome HP butuh konteks aman untuk fitur layar penuh/audio). Redis hanya bila menjalankan lebih dari satu instance.

## Pilihan A — Docker Compose (VPS / server sekolah)

```bash
git clone https://github.com/AqilahSwimmingClub/game-roblox.git eduverse && cd eduverse
cp .env.example .env
# Edit .env: JWT_SECRET (openssl rand -hex 32), POSTGRES_PASSWORD, PUBLIC_URL=https://domain-anda
docker compose up -d --build
docker compose logs -f app        # migrasi database berjalan otomatis saat start
```

Port 3000 hanya dibuka ke `127.0.0.1`. Pasang reverse proxy HTTPS di depannya, misalnya **Caddy** (sertifikat Let's Encrypt otomatis):

```caddyfile
eduverse.contoh-sekolah.sch.id {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

atau **Nginx** (WebSocket wajib diteruskan):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}
```

Setelah aktif, buka `https://domain-anda/guru/`, daftarkan **guru pertama** (tanpa kode). Guru berikutnya butuh `TEACHER_REGISTRATION_CODE`.

> Catatan: `Dockerfile` dan `docker-compose.yml` sudah ditulis tetapi **belum dibangun/diuji** di lingkungan pengembangan ini (tidak ada Docker daemon). Uji sekali di server Anda sebelum dipakai kelas.

## Pilihan B — Tanpa Docker

```bash
npm ci
npm run build
export NODE_ENV=production DATABASE_URL=postgres://... JWT_SECRET=... PUBLIC_URL=https://... TRUST_PROXY=1
npm start            # = node apps/server/dist/index.js, migrasi otomatis
```

Jalankan dengan pengelola proses (systemd/pm2) dan reverse proxy HTTPS seperti di atas.

## Pilihan C — PaaS (Render, Railway, Fly.io, dsb.)

- Build command: `npm ci && npm run build` · Start command: `npm start`
- Tambahkan PostgreSQL terkelola, isi variabel dari `.env.example`, set `TRUST_PROXY=1`.
- Pastikan platform mendukung **WebSocket** dan sesi tidak dimatikan saat idle selama jam pelajaran.

## Banyak instance (lebih dari ±500 pemain serentak)

1. Siapkan Redis, isi `REDIS_URL` di semua instance (Socket.IO Redis adapter aktif otomatis).
2. Load balancer **wajib sticky session** (mis. `ip_hash` di Nginx, atau cookie affinity), karena status permainan satu sesi disimpan di memori instance yang memuatnya.
3. Hasil uji beban satu instance ada di [LOADTEST.md](LOADTEST.md).

## Keamanan

- Jangan pernah commit `.env`. Rahasia hanya di environment server.
- Ganti `JWT_SECRET` dan sandi database dengan nilai acak panjang.
- Cadangkan database harian (`pg_dump`). Data siswa hanya nomor absen + nama panggilan; jangan isi nama lengkap/NIK.
- Pembatasan laju sudah aktif (login, API, gabung sesi, paket posisi). Sesuaikan `JOIN_RATE_PER_MIN` bila seluruh sekolah berbagi satu IP publik.
