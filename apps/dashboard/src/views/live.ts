/**
 * Sesi langsung: kode kelas besar + tautan + QR, kontrol permainan, daftar siswa (setujui/tolak/reset/keluarkan),
 * sebaran pemain per area (peta panas Kota), papan skor real-time, umpan jawaban, ekspor & hasil.
 * Data real-time datang dari namespace Socket.IO /teacher (cookie guru), bukan simulasi.
 */
import { io, type Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { EV, KOTA_WORLD_HALF, KOTA_ZONES, WORLDS, CHARACTERS, CATALOG, OFFER_STATUS_LABEL, type OfferStatus, type SessionPublicState, type AvatarConfig } from '@eduverse/shared';
import { h, api, btn, toast, onLeave, fmtDate, modal, download, getToken } from '../lib.js';
import { SERVER_URL } from '../server.js';

interface LiveStudent {
  absen: number;
  nama: string;
  claimed: boolean;
  approved: boolean;
  online: boolean;
  ready: boolean;
  scene: string | null;
  zone: string | null;
  zoneName: string | null;
  mode?: string | null;
  saldo?: number;
  barang?: number;
  x: number | null;
  z: number | null;
  poin: number;
  benar: number;
  dijawab: number;
  rank: number | null;
  avatar: AvatarConfig | null;
}
interface LiveData {
  state: SessionPublicState;
  students: LiveStudent[];
  scenes: Record<string, number>;
  zones: Record<string, number>;
  online: number;
  connections: number;
  podiumShown: boolean;
}
interface FeedItem {
  at: number;
  absen: number;
  nama: string;
  subject: string | null;
  topic: string | null;
  prompt: string;
  correct: boolean;
  points: number;
  attempt: number;
  zone: string | null;
}
interface SessionDetail {
  id: string;
  code: string;
  title: string;
  className: string;
  link: string;
  live: LiveData;
}
interface Results {
  rows: { rank: number; absen: number; nama: string; poin: number; benar: number; dijawab: number; ketepatan: number }[];
  answerCount: number;
  perSubject: Record<string, { benar: number; total: number }>;
  recent: { created_at: string; absen: number; nickname: string; subject: string | null; prompt: string; correct: boolean; points: number; attempt: number }[];
}

const nn = (...xs: (Node | null)[]) => xs.filter((x): x is Node => x !== null);
/** Lencana karakter pilihan siswa (warna + nama karakter). */
function charBadge(a: AvatarConfig | null | undefined) {
  const c = a ? CHARACTERS[a.karakter] : undefined;
  if (!c) return h('span', { class: 'muted' }, '—');
  return h('span', { class: 'chip', style: `background:${c.warna}22;border:2px solid ${c.warna};color:#1E2A4A` }, h('span', { class: 'dot', style: `background:${c.warna}` }), c.nama);
}
const STATUS: Record<string, string> = { menunggu: 'Menunggu siswa', hitung: 'Hitung mundur', berjalan: 'Permainan berjalan', jeda: 'Dijeda', selesai: 'Selesai' };
const SCENE: Record<string, string> = { lobi: 'Lobi', kota: 'Dunia Kota', hutan: 'Dunia Hutan', laut: 'Dunia Laut', angkasa: 'Luar Angkasa', podium: 'Podium' };

export async function liveView(id: string): Promise<HTMLElement> {
  const d = await api<SessionDetail>(`/sessions/${id}`);
  let live = d.live;
  let offset = live.state.serverNow - Date.now();
  const feed: FeedItem[] = [];

  // ---------- kepala: kode + tautan + QR ----------
  const qr = h('canvas', { style: 'width:150px;height:150px;border-radius:12px;background:#fff' }) as HTMLCanvasElement;
  void QRCode.toCanvas(qr, d.link, { width: 150, margin: 1, color: { dark: '#1E2A4A', light: '#FFFFFF' } }).catch(() => undefined);
  const statusEl = h('span', { class: 'status' });
  const timerEl = h('div', { class: 'kode', style: 'font-size:clamp(32px,5vw,48px);letter-spacing:.04em' }, '--:--');
  const countsEl = h('div', { class: 'row' });
  const controls = h('div', { class: 'row' });

  const act = (path: string, body?: unknown) => async () => {
    const r = await api<{ live: LiveData }>(`/sessions/${id}/${path}`, { method: 'POST', json: body ?? {} });
    apply(r.live);
  };
  const confirmAct = (q: string, fn: () => Promise<void>) => async () => {
    if (!confirm(q)) return;
    await fn();
  };

  const studentsBody = h('tbody');
  const lbEl = h('div', { class: 'col', style: 'gap:6px' });
  const feedEl = h('div', { class: 'feed' });
  const heat = h('canvas', { class: 'heat', width: 600, height: 600 }) as HTMLCanvasElement;
  const zoneList = h('div', { class: 'col', style: 'gap:4px' });
  const resultsEl = h('div', { class: 'col' });

  function renderControls() {
    const st = live.state.status;
    controls.replaceChildren(...nn(
      st === 'menunggu' ? btn('▶ Mulai Permainan', 'hijau besar', act('start')) : null,
      st === 'berjalan' ? btn('⏸ Jeda', 'kuning besar', act('pause')) : null,
      st === 'jeda' ? btn('▶ Lanjutkan', 'hijau besar', act('resume')) : null,
      st === 'berjalan' || st === 'jeda' ? btn('+5 menit', 'putih besar', act('extend', { minutes: 5 })) : null,
      st !== 'selesai' && st !== 'menunggu' ? btn('■ Akhiri Permainan', 'merah besar', confirmAct('Akhiri permainan sekarang? Skor akhir akan dikunci.', act('end'))) : null,
      st === 'selesai' ? btn(live.podiumShown ? '🏆 Tampilkan Podium Lagi' : '🏆 Tampilkan Podium 3D', 'ungu besar', act('podium')) : null,
      btn('Ekspor Excel', 'putih besar', () => download(`/sessions/${id}/export.xlsx`, `hasil-${d.code}.xlsx`)),
      btn('Ekspor PDF', 'putih besar', () => download(`/sessions/${id}/export.pdf`, `hasil-${d.code}.pdf`)),
      st === 'menunggu' ? btn('Hapus Sesi', 'putih besar', confirmAct('Hapus sesi ini beserta datanya?', async () => {
        await api(`/sessions/${id}`, { method: 'DELETE' });
        location.hash = '#/';
      })) : null,
    ));
  }

  function renderHeader() {
    statusEl.className = `status ${live.state.status}`;
    statusEl.textContent = STATUS[live.state.status] ?? live.state.status;
    const ready = live.students.filter((s) => s.ready && s.online).length;
    const claimed = live.students.filter((s) => s.claimed).length;
    const waitingList = live.students.filter((s) => s.claimed && !s.approved);
    const waiting = waitingList.length;
    countsEl.replaceChildren(...nn(
      h('span', { class: 'chip hijau' }, `${live.online} siswa online`),
      h('span', { class: 'chip biru' }, `${claimed} identitas terdaftar`),
      h('span', { class: 'chip ungu' }, `${ready} siap`),
      waiting ? h('span', { class: 'chip oranye' }, `${waiting} menunggu persetujuan`) : null,
      waiting
        ? btn(`Setujui Semua (${waiting})`, 'hijau kecil', async () => {
            for (const s of waitingList) await api(`/sessions/${id}/roster/${s.absen}/approve`, { method: 'POST' });
            toast(`${waiting} siswa disetujui`);
          })
        : null,
      ...Object.entries(live.scenes).map(([k, n]) => h('span', { class: 'chip abu' }, `${SCENE[k] ?? k}: ${n}`)),
    ));
  }

  function tick() {
    const st = live.state;
    let ms: number | null = null;
    if (st.status === 'berjalan' && st.endsAt) ms = st.endsAt - (Date.now() + offset);
    else if (st.status === 'jeda') ms = st.remainingMs;
    if (ms === null) timerEl.textContent = st.status === 'selesai' ? 'Selesai' : '--:--';
    else {
      const s = Math.max(0, Math.ceil(ms / 1000));
      timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
  }

  function renderStudents() {
    const rowAct = (absen: number, a: string, label: string, cls: string, q?: string) =>
      btn(label, `kecil ${cls}`, async () => {
        if (q && !confirm(q)) return;
        await api(`/sessions/${id}/roster/${absen}/${a}`, { method: 'POST' });
        toast(`${label}: absen ${absen}`);
      });
    studentsBody.replaceChildren(
      ...(live.students.length
        ? live.students.map((s) =>
            h(
              'tr',
              null,
              h('td', null, String(s.absen)),
              h('td', { style: 'font-weight:900' }, s.nama),
              h(
                'td',
                null,
                h('span', { class: 'dot', style: `background:${s.online ? '#2FBF71' : '#C3CCDB'};margin-right:6px` }),
                !s.claimed ? 'Belum masuk' : !s.approved ? h('span', { class: 'chip oranye' }, 'Perlu disetujui') : s.online ? 'Online' : 'Terputus',
              ),
              h('td', null, s.online ? `${SCENE[s.scene ?? ''] ?? '—'}${s.zoneName ? ' · ' + s.zoneName : ''}${s.mode && s.mode !== 'Berjalan' ? ' · ' + s.mode : ''}` : '—'),
              h('td', { style: 'font-family:Fredoka;font-size:18px' }, String(s.poin)),
              h('td', { title: 'Uang virtual untuk jual beli di Kota Hidup (tidak memengaruhi poin)' }, s.saldo === undefined ? '—' : `Rp${s.saldo.toLocaleString('id-ID')} · ${s.barang ?? 0} barang`),
              h('td', null, charBadge(s.avatar)),
              h('td', null, `${s.benar} benar / ${s.dijawab - s.benar} salah`),
              h('td', null, live.state.progressTarget ? `${s.dijawab}/${live.state.progressTarget}` : String(s.dijawab)),
              h('td', null, s.rank ? `#${s.rank}` : '—'),
              h(
                'td',
                null,
                h(
                  'div',
                  { class: 'row', style: 'gap:6px;flex-wrap:nowrap' },
                  s.claimed && !s.approved ? rowAct(s.absen, 'approve', 'Setujui', 'hijau') : null,
                  s.claimed && !s.approved ? rowAct(s.absen, 'reject', 'Tolak', 'putih') : null,
                  s.claimed ? rowAct(s.absen, 'reset', 'Reset', 'putih', `Lepas identitas absen ${s.absen} agar siswa bisa masuk ulang dari perangkat lain?`) : null,
                  rowAct(s.absen, 'kick', 'Keluarkan', 'merah', `Keluarkan ${s.nama} dari sesi?`),
                ),
              ),
            ),
          )
        : [h('tr', null, h('td', { colspan: 10, class: 'muted' }, 'Belum ada siswa. Bagikan kode kelas atau tautan di atas.'))]),
    );
  }

  function renderLeaderboard() {
    const rows = live.students.filter((s) => s.rank !== null).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 10);
    const medal = ['#FFC93C', '#C9D3E3', '#E7A36B'];
    lbEl.replaceChildren(
      ...(rows.length
        ? rows.map((s) =>
            h(
              'div',
              { class: 'row', style: 'padding:8px 10px;border-radius:12px;background:#F5F8FD;flex-wrap:nowrap' },
              h('div', { style: `width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-family:Fredoka;font-weight:700;background:${medal[(s.rank ?? 9) - 1] ?? '#E4EAF4'}` }, String(s.rank)),
              h('div', { class: 'grow', style: 'font-weight:900' }, `${s.nama} `, h('span', { class: 'muted' }, `(${s.absen})`)),
              h('div', { style: 'font-family:Fredoka;font-size:20px' }, String(s.poin)),
            ),
          )
        : [h('p', { class: 'muted' }, 'Papan skor muncul setelah ada jawaban.')]),
    );
  }

  /** Peta panas Kota: zona berwarna + titik posisi tiap siswa (posisi dari server, diperbarui ±2,5×/detik). */
  function renderHeat() {
    const ctx = heat.getContext('2d');
    if (!ctx) return;
    const W = heat.width;
    // Peta mencakup kota + Bandara (timur) + Kawasan Gedung Tinggi (barat)
    const HALF = KOTA_WORLD_HALF;
    const sc = W / (HALF * 2);
    const px = (x: number) => (x + HALF) * sc;
    const pz = (z: number) => (z + HALF) * sc;
    ctx.fillStyle = '#9ED98F';
    ctx.fillRect(0, 0, W, W);
    for (const zn of KOTA_ZONES) {
      const n = live.zones[zn.id] ?? 0;
      ctx.fillStyle = `#${zn.color.toString(16).padStart(6, '0')}${n ? 'AA' : '44'}`;
      for (const r of zn.rects) ctx.fillRect(px(r.x - r.hx), pz(r.z - r.hz), r.hx * 2 * sc, r.hz * 2 * sc);
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 13px Nunito, sans-serif';
    ctx.textAlign = 'center';
    for (const zn of KOTA_ZONES) {
      const n = live.zones[zn.id] ?? 0;
      if (n) ctx.fillText(`${n}`, px(zn.label.x), pz(zn.label.z) - 8);
    }
    for (const s of live.students) {
      if (!s.online || s.scene !== 'kota' || s.x === null || s.z === null) continue;
      ctx.beginPath();
      ctx.arc(px(s.x), pz(s.z), 6, 0, Math.PI * 2);
      ctx.fillStyle = '#1E2A4A';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    zoneList.replaceChildren(
      ...KOTA_ZONES.map((zn) =>
        h('div', { class: 'row', style: 'gap:8px' }, h('span', { class: 'dot', style: `background:#${zn.color.toString(16).padStart(6, '0')}` }), h('span', { class: 'grow' }, zn.nama), h('b', null, String(live.zones[zn.id] ?? 0))),
      ),
    );
  }

  function renderFeed() {
    feedEl.replaceChildren(
      ...(feed.length
        ? feed.map((f) =>
            h(
              'div',
              { style: `border-left:5px solid ${f.correct ? '#2FBF71' : '#FF8A3D'}` },
              h('b', null, `${f.nama} (${f.absen})`),
              ` ${f.correct ? `benar +${f.points}` : 'belum tepat'}${f.attempt > 1 ? ' · kesempatan kedua' : ''} · `,
              h('span', { class: 'muted' }, `${f.subject ?? ''}${f.zone ? ' · ' + f.zone : ''} — ${f.prompt.slice(0, 80)}`),
            ),
          )
        : [h('div', { class: 'muted' }, 'Jawaban siswa akan muncul di sini secara langsung.')]),
    );
  }

  async function renderResults() {
    if (live.state.status !== 'selesai') {
      resultsEl.replaceChildren();
      return;
    }
    const r = await api<Results>(`/sessions/${id}/results`);
    resultsEl.replaceChildren(...nn(
      h('h2', null, 'Hasil Akhir'),
      h(
        'div',
        { class: 'row', style: 'align-items:flex-end;gap:12px' },
        ...[2, 1, 3]
          .map((rk) => ({ rk, s: live.students.find((x) => x.rank === rk) }))
          .filter((x) => x.s)
          .map(({ rk, s }) =>
            h(
              'div',
              { class: 'card col', style: `align-items:center;min-width:160px;padding:12px;background:${rk === 1 ? '#FFF6D6' : rk === 2 ? '#F1F4F9' : '#FBEBDD'}` },
              h('div', { style: 'font-family:Fredoka;font-size:28px' }, `Juara ${rk}`),
              h('div', { style: 'font-weight:900;font-size:18px' }, `${s!.nama} (${s!.absen})`),
              charBadge(s!.avatar),
              h('div', { style: 'font-family:Fredoka;font-size:22px' }, `${s!.poin} poin`),
            ),
          ),
      ),
      h('div', { class: 'row' }, h('span', { class: 'chip biru' }, `${r.answerCount} jawaban tercatat`), ...Object.entries(r.perSubject).map(([k, v]) => h('span', { class: 'chip ungu' }, `${k}: ${v.benar}/${v.total} benar`))),
      h(
        'div',
        { class: 'tablewrap' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, ...['Peringkat', 'Absen', 'Nama', 'Poin', 'Benar', 'Dijawab', 'Ketepatan'].map((t) => h('th', null, t)))),
          h('tbody', null, ...r.rows.map((x) => h('tr', null, h('td', null, `#${x.rank}`), h('td', null, String(x.absen)), h('td', { style: 'font-weight:900' }, x.nama), h('td', null, String(x.poin)), h('td', null, String(x.benar)), h('td', null, String(x.dijawab)), h('td', null, `${x.ketepatan}%`)))),
        ),
      ),
      r.recent.length
        ? h('details', null, h('summary', { style: 'font-weight:800;cursor:pointer' }, 'Jawaban terakhir (50)'), h('div', { class: 'feed', style: 'margin-top:8px' }, ...r.recent.map((a) => h('div', null, `${fmtDate(a.created_at)} · ${a.nickname} (${a.absen}) · ${a.subject ?? ''} · ${a.correct ? 'benar +' + a.points : 'belum tepat'} — ${a.prompt.slice(0, 90)}`))))
        : null,
    ));
  }

  // ---------- interaksi siswa: hadiah & tukar barang (ON/OFF kapan saja) + riwayat ----------
  const switchEl = (key: 'allowGifts' | 'allowTrades', label: string, desc: string) => {
    const i = h('input', { type: 'checkbox', role: 'switch', 'data-setting': key }) as HTMLInputElement;
    i.onchange = async () => {
      i.disabled = true;
      try {
        await api(`/sessions/${id}`, { method: 'PATCH', json: { settings: { [key]: i.checked } } });
        live = { ...live, state: { ...live.state, [key]: i.checked } };
        toast(`${label}: ${i.checked ? 'AKTIF' : 'NONAKTIF'}`);
        void loadHistory();
      } catch (e) {
        i.checked = !i.checked;
        toast((e as Error).message, true);
      } finally {
        i.disabled = false;
      }
    };
    return { el: h('label', { class: 'check', style: 'align-items:flex-start' }, i, h('span', null, h('b', null, label), h('div', { class: 'muted', style: 'font-size:13px' }, desc))), i };
  };
  const giftSw = switchEl('allowGifts', 'Izinkan siswa memberi barang', 'Penerima harus menekan TERIMA. Bila dimatikan, permintaan yang menunggu dibatalkan dan barang kembali ke pemberi.');
  const tradeSw = switchEl('allowTrades', 'Izinkan siswa tukar barang', 'Kedua siswa harus setuju. Uang virtual tidak pernah bisa dipindahkan antarsiswa.');
  const histEl = h('div', { class: 'tablewrap', style: 'max-height:340px;overflow:auto' });
  function renderInteraksi() {
    if (document.activeElement !== giftSw.i) giftSw.i.checked = live.state.allowGifts !== false;
    if (document.activeElement !== tradeSw.i) tradeSw.i.checked = live.state.allowTrades !== false;
  }
  interface OfferRow {
    kind: string;
    status: OfferStatus;
    dari: string;
    dari_absen: number;
    ke: string;
    ke_absen: number;
    give_item: string;
    give_qty: number;
    want_item: string | null;
    want_qty: number | null;
    reason: string | null;
    created_at: string;
  }
  const itemTxt = (id: string | null, q: number | null) => (id ? `${CATALOG[id]?.ikon ?? ''} ${CATALOG[id]?.nama ?? id} ×${q ?? 1}` : '');
  async function loadHistory() {
    try {
      const r = await api<{ offers: OfferRow[] }>(`/sessions/${id}/offers`);
      histEl.replaceChildren(
        r.offers.length
          ? h(
              'table',
              { class: 'riwayat-hadiah' },
              h('thead', null, h('tr', null, ...['Waktu', 'Jenis', 'Pemberi', 'Penerima', 'Barang', 'Status'].map((t) => h('th', null, t)))),
              h(
                'tbody',
                null,
                ...r.offers.map((o) =>
                  h(
                    'tr',
                    null,
                    h('td', null, new Date(o.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
                    h('td', null, o.kind === 'tukar' ? '🔁 Tukar' : '🎁 Hadiah'),
                    h('td', null, `${o.dari} (${o.dari_absen})`),
                    h('td', null, `${o.ke} (${o.ke_absen})`),
                    h('td', null, itemTxt(o.give_item, o.give_qty) + (o.want_item ? ` ⇄ ${itemTxt(o.want_item, o.want_qty)}` : '')),
                    h('td', null, h('span', { class: `chip ${o.status === 'diterima' ? 'hijau' : o.status === 'menunggu' ? 'abu' : 'oranye'}` }, OFFER_STATUS_LABEL[o.status] ?? o.status), o.reason ? h('div', { class: 'muted', style: 'font-size:12px' }, o.reason) : null),
                  ),
                ),
              ),
            )
          : h('p', { class: 'muted' }, 'Belum ada hadiah atau tukar barang di sesi ini.'),
      );
    } catch {
      /* dicoba lagi pada siklus berikutnya */
    }
  }
  void loadHistory();
  const histTimer = setInterval(() => void loadHistory(), 5000);
  onLeave(() => clearInterval(histTimer));

  let lastStatus = live.state.status;
  function apply(next: LiveData) {
    live = next;
    offset = live.state.serverNow - Date.now();
    renderHeader();
    renderControls();
    renderStudents();
    renderLeaderboard();
    renderHeat();
    renderInteraksi();
    tick();
    if (live.state.status !== lastStatus || (live.state.status === 'selesai' && !resultsEl.childElementCount)) void renderResults().catch(() => undefined);
    lastStatus = live.state.status;
  }

  // ---------- socket real-time ----------
  // Server bisa di domain lain → token dikirim lewat auth handshake (bukan cookie lintas situs)
  const socket: Socket = io(`${SERVER_URL}/teacher`, { transports: ['websocket', 'polling'], auth: (cb) => cb({ token: getToken() }) });
  const connEl = h('span', { class: 'chip abu' }, 'Menghubungkan…');
  const watch = () =>
    socket.emit('watch', { sessionId: id }, (r: { ok: boolean; live?: LiveData; error?: string }) => {
      if (r.ok && r.live) apply(r.live);
      else toast(r.error ?? 'Gagal memantau sesi', true);
    });
  socket.on('connect', () => {
    connEl.className = 'chip hijau';
    connEl.textContent = 'Terhubung langsung';
    watch();
  });
  socket.on('disconnect', () => {
    connEl.className = 'chip oranye';
    connEl.textContent = 'Terputus — menyambung ulang…';
  });
  socket.on('connect_error', () => {
    connEl.className = 'chip oranye';
    connEl.textContent = 'Gagal terhubung — mencoba lagi…';
  });
  socket.on(EV.live, (l: LiveData) => apply(l));
  socket.on(EV.session, (st: SessionPublicState) => apply({ ...live, state: st }));
  socket.on(EV.answerFeed, (f: FeedItem) => {
    feed.unshift(f);
    if (feed.length > 60) feed.length = 60;
    renderFeed();
  });
  socket.on(EV.podium, () => toast('Podium 3D sedang ditampilkan di layar siswa'));
  const timer = setInterval(tick, 500);
  onLeave(() => {
    clearInterval(timer);
    socket.disconnect();
  });

  const showQr = () => {
    const big = h('canvas') as HTMLCanvasElement;
    void QRCode.toCanvas(big, d.link, { width: 480, margin: 2 });
    const m = modal(h('div', { class: 'card col', style: 'align-items:center;text-align:center' }, h('h2', null, `Kode kelas: ${d.code}`), big, h('div', { style: 'font-weight:800;word-break:break-all' }, d.link), btn('Tutup', 'putih', () => m.close())));
  };

  const worlds = live.state.worlds.map((w) => WORLDS.find((x) => x.id === w)?.nama ?? w).join(', ');
  apply(live);
  renderFeed();

  return h(
    'main',
    null,
    h(
      'div',
      { class: 'card row', style: 'align-items:stretch' },
      h(
        'div',
        { class: 'col grow', style: 'min-width:260px' },
        h('div', { class: 'row' }, h('h1', { class: 'grow' }, d.title), statusEl, connEl),
        h('div', { class: 'muted', style: 'font-weight:800' }, `Kelas ${d.className} · ${worlds}`),
        h('div', { class: 'row', style: 'align-items:flex-end;gap:24px' }, h('div', null, h('div', { class: 'muted', style: 'font-weight:800' }, 'KODE KELAS'), h('div', { class: 'kode' }, d.code)), h('div', null, h('div', { class: 'muted', style: 'font-weight:800' }, 'SISA WAKTU'), timerEl)),
        h(
          'div',
          { class: 'row' },
          h('input', { class: 'in', readonly: true, value: d.link, style: 'max-width:440px', onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
          btn('Salin Tautan', 'putih', async () => {
            await navigator.clipboard.writeText(d.link).catch(() => undefined);
            toast('Tautan disalin');
          }),
        ),
        countsEl,
      ),
      h('button', { type: 'button', class: 'btn putih', style: 'height:auto;padding:10px;flex-direction:column', onclick: showQr, title: 'Perbesar QR' }, qr, 'Perbesar QR'),
    ),
    h('div', { class: 'card' }, controls),
    resultsEl,
    h(
      'div',
      { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(340px,1fr))' },
      h('div', { class: 'card col' }, h('h2', null, 'Papan Skor Langsung'), lbEl),
      h('div', { class: 'card col' }, h('h2', null, 'Sebaran Siswa — Dunia Kota'), h('div', { class: 'row', style: 'align-items:flex-start;flex-wrap:nowrap' }, h('div', { style: 'flex:1.3;min-width:0' }, heat), h('div', { style: 'flex:1;min-width:0;font-size:14px' }, zoneList))),
    ),
    h('div', { class: 'card col' }, h('h2', null, 'Siswa'), h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ...['Absen', 'Nama', 'Status', 'Lokasi', 'Poin', 'Uang · Tas', 'Karakter', 'Jawaban', 'Progres', 'Peringkat', 'Aksi'].map((t) => h('th', null, t)))), studentsBody))),
    h('div', { class: 'card col' }, h('h2', null, 'Umpan Jawaban Langsung'), feedEl),
    h('div', { class: 'card col' }, h('h2', null, 'Interaksi Siswa — Hadiah & Tukar Barang'), h('div', { class: 'row wrap', style: 'gap:18px' }, giftSw.el, tradeSw.el), h('h3', { style: 'margin:6px 0 0' }, 'Riwayat'), histEl),
  );
}
