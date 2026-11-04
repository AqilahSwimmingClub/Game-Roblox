/**
 * HUD responsif untuk game 3D mobile:
 * - Bilah atas (grid, tanpa tumpang tindih): profil+poin · timer · Menu/Skor · peta mini; baris info ringkas
 *   (peringkat → papan skor, dompet → tas, progres). Portrait: 2 baris; landscape/tablet/desktop: 1 baris lebar.
 * - Kiri bawah dibiarkan KOSONG untuk joystick (lapisan HUD tidak menangkap sentuhan di luar tombolnya).
 * - Kanan bawah: Aksi (hanya saat dekat objek), Lompat, Lari, Selam (hanya saat bisa menyelam), Emote kecil.
 * Tinggi bilah atas & klaster kanan bawah diekspor sebagai --hud-top / --hud-br agar lapisan lain (notifikasi,
 * telemetri kendaraan, oksigen) diletakkan di bawah/atasnya tanpa bertabrakan.
 */
import { WORLDS, KOTA, worldZones, worldLayout, WORLD_ENV, type LeaderboardRow, type SessionPublicState, type WorldId } from '@eduverse/shared';
import { h, btn, ui } from './dom.js';
import type { QualitySetting } from '../engine/quality.js';
import { setSound, soundOn, music } from '../world/audio.js';
import { drawLandmarks } from '../world/living/landmarks.js';

export interface HudCallbacks {
  action: () => void;
  jump: (down: boolean) => void;
  dive: (down: boolean) => void;
  runToggle: (on: boolean) => void;
  emote: (id: number) => void;
  pilihDunia: () => void;
  quality: (q: QualitySetting) => void;
  currentQuality: () => QualitySetting;
  recover: () => void;
  toLobby: () => void;
  avatar: () => void;
}

const EMOTES = ['Lambai', 'Hore', 'Ke sana', 'Joget', 'Berpikir', 'Suka'];

export class Hud {
  readonly el: HTMLElement;
  private nameEl = h('div', { class: 'nama' });
  private initialEl = h('div', { class: 'foto' });
  private poinEl = h('span');
  private rankEl = h('button', { type: 'button', class: 'panel tipis pill hud-chip', 'aria-label': 'Peringkat & papan skor', onclick: () => this.toggleLeaderboard() }, 'Peringkat —');
  /** Tempat tombol dompet/tas (dipindahkan dari Mobility) di baris info. */
  readonly walletSlot = h('div', { class: 'hud-wallet' });
  private diveBtn!: HTMLButtonElement;
  private canDive = false;
  private timerEl = h('div', { class: 'panel tipis timer', role: 'timer' }, '--:--');
  private statusEl = h('div', { class: 'panel tipis pill', style: 'display:none' });
  private top3El = h('div', { class: 'panel tipis top3 desk-only' });
  private progressEl = h('div', { class: 'panel tipis progress' });
  private actionBtn: HTMLButtonElement;
  private worldBtn: HTMLButtonElement;
  private worldOnly: HTMLElement[] = [];
  private lobbyOnly: HTMLElement[] = [];
  private lbPanel: HTMLElement | null = null;
  readonly minimap = h('canvas', { width: 256, height: 256 }) as HTMLCanvasElement;
  private miniWrap: HTMLElement;
  private lb: LeaderboardRow[] = [];
  myAbsen = 0;
  private runOn = false;
  mode: 'lobi' | 'dunia' | 'none' = 'none';
  onMapOpen: (() => void) | null = null;

  constructor(private cb: HudCallbacks) {
    this.actionBtn = btn('Aksi', 'kuning action-btn', () => cb.action(), { style: 'display:none' });
    const hold = (label: string, cls: string, fn: (down: boolean) => void, extra = '') => {
      const b = h('button', { type: 'button', class: `btn ${cls}`, style: extra, 'aria-label': label }, label);
      const down = (e: Event) => {
        e.preventDefault();
        fn(true);
      };
      const up = (e: Event) => {
        e.preventDefault();
        fn(false);
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      return b;
    };
    const jumpBtn = hold('Lompat', 'biru bulat touch-only hud-lompat', cb.jump);
    this.diveBtn = hold('Selam', 'putih bulat touch-only hud-kecil', cb.dive);
    const runBtn = btn('Lari', 'putih bulat touch-only hud-kecil', () => {
      this.runOn = !this.runOn;
      runBtn.classList.toggle('oranye', this.runOn);
      runBtn.classList.toggle('putih', !this.runOn);
      runBtn.setAttribute('aria-pressed', String(this.runOn));
      cb.runToggle(this.runOn);
    });
    this.worldBtn = btn('PILIH DUNIA', 'oranye hud-dunia', () => cb.pilihDunia());
    this.miniWrap = h('button', { type: 'button', class: 'minimap', title: 'Ketuk untuk peta besar', 'aria-label': 'Peta', onclick: () => this.openMap() }, this.minimap);
    const lbBtn = btn('🏆', 'kuning hud-ikon', () => this.toggleLeaderboard(), { 'aria-label': 'Skor', title: 'Papan skor' });
    const menuBtn = btn('☰', 'putih hud-ikon', () => this.openMenu(), { 'aria-label': 'Menu', title: 'Menu' });
    const profil = h('div', { class: 'panel tipis profil' }, this.initialEl, h('div', { class: 'profil-teks' }, this.nameEl, h('div', { class: 'poin' }, h('i', { class: 'star' }), this.poinEl)));
    this.worldOnly = [this.timerEl, this.miniWrap, this.progressEl, this.top3El];
    this.lobbyOnly = [this.worldBtn];
    const top = h(
      'div',
      { class: 'hud-top' },
      h('div', { class: 'hud-prof' }, profil),
      h('div', { class: 'hud-timer' }, this.timerEl, this.statusEl),
      h('div', { class: 'hud-right' }, h('div', { class: 'hud-btns' }, menuBtn, lbBtn), h('div', { class: 'hud-mini' }, this.miniWrap)),
      h('div', { class: 'hud-chips' }, this.rankEl, this.walletSlot, this.progressEl, this.top3El),
    );
    const br = h('div', { class: 'hud-br' }, this.worldBtn, this.actionBtn, h('div', { class: 'hud-br-row' }, this.diveBtn, runBtn, jumpBtn));
    this.el = h('div', { class: 'hud', style: 'display:none' }, top, h('div', { class: 'joy-hint touch-only' }, 'Geser di sini untuk berjalan'), br, this.oxyEl);
    ui.add(this.el);
    this.setCanDive(false);
    // Ekspor ukuran nyata bilah atas & klaster kanan bawah (berubah saat rotasi, zoom, bilah alamat, keyboard)
    const root = document.documentElement.style;
    const sync = () => {
      if (this.el.style.display === 'none') return;
      root.setProperty('--hud-top', `${Math.round(top.getBoundingClientRect().bottom)}px`);
      root.setProperty('--hud-br', `${Math.round(window.innerHeight - br.getBoundingClientRect().top)}px`);
    };
    new ResizeObserver(sync).observe(top);
    new ResizeObserver(sync).observe(br);
    window.addEventListener('resize', sync);
    this.syncLayout = sync;
  }

  private syncLayout: () => void = () => undefined;

  /** Tombol Selam hanya ditampilkan bila bisa menyelam (Dunia Laut / sedang berenang). */
  setCanDive(on: boolean) {
    if (on === this.canDive && this.diveBtn.dataset.init) return;
    this.canDive = on;
    this.diveBtn.dataset.init = '1';
    this.diveBtn.classList.toggle('hud-sembunyi', !on);
  }

  /** Meteran oksigen Dunia Laut (null = sembunyikan). */
  private oxyBar = h('div', { style: 'height:100%;width:100%;border-radius:8px;background:#1FB6D9;transition:width .2s' });
  private oxyEl = h(
    'div',
    { class: 'oksigen', style: 'display:none;position:absolute;left:50%;top:calc(var(--hud-top, 64px) + 6px);transform:translateX(-50%);width:min(260px,60vw);background:#fff;border:3px solid #1E2A4A;border-radius:12px;padding:3px;z-index:5;pointer-events:none' },
    h('div', { style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 13px Nunito,sans-serif;color:#1E2A4A' }, 'OKSIGEN'),
    h('div', { style: 'height:16px' }, this.oxyBar),
  );
  oxygenShown: number | null = null;
  setOxygen(v: number | null) {
    const show = v !== null && this.mode === 'dunia';
    this.oxyEl.style.display = show ? '' : 'none';
    this.oxygenShown = show ? v : null;
    if (show) {
      this.oxyBar.style.width = `${Math.round(v * 100)}%`;
      this.oxyBar.style.background = v < 0.25 ? '#E74C3C' : v < 0.5 ? '#FFC93C' : '#1FB6D9';
    }
  }

  setMode(mode: 'lobi' | 'dunia' | 'none') {
    this.mode = mode;
    this.el.style.display = mode === 'none' ? 'none' : '';
    for (const e of this.worldOnly) e.style.display = mode === 'dunia' ? '' : 'none';
    for (const e of this.lobbyOnly) e.style.display = mode === 'lobi' ? '' : 'none';
    if (mode !== 'dunia') this.top3El.style.display = 'none';
    this.el.dataset.mode = mode;
    requestAnimationFrame(() => this.syncLayout());
  }

  setProfile(nama: string, absen: number) {
    this.myAbsen = absen;
    this.nameEl.textContent = `${nama} · ${String(absen).padStart(2, '0')}`;
    this.initialEl.textContent = nama.slice(0, 1).toUpperCase();
  }

  setScore(poin: number, rank: number | null, total: number) {
    this.poinEl.textContent = String(poin);
    this.rankEl.textContent = rank ? `#${rank} dari ${total}` : 'Peringkat —';
  }

  setProgress(dijawab: number, target: number | null) {
    const pct = target ? Math.min(100, (dijawab / target) * 100) : Math.max(4, ((dijawab % 10) / 10) * 100);
    this.progressEl.replaceChildren(h('div', { style: 'font-weight:900;font-size:14px' }, target ? `Soal ${dijawab}/${target}` : `${dijawab} soal terjawab`), h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })));
  }

  setLeaderboard(rows: LeaderboardRow[]) {
    this.lb = rows;
    if (this.mode === 'dunia') {
      this.top3El.style.display = rows.length ? '' : 'none';
      this.top3El.replaceChildren(...rows.slice(0, 3).map((r) => h('div', { class: `medali-${r.rank}` }, h('span', null, `${r.rank}. ${r.nama}`), h('span', null, String(r.poin)))));
    }
    if (this.lbPanel) this.renderLeaderboard();
  }

  /** Timer berdasarkan waktu server; < 1 menit berwarna oranye dan berdenyut. */
  updateTimer(state: SessionPublicState | null, serverNow: number) {
    if (!state) return;
    let ms: number | null = null;
    if (state.status === 'jeda') ms = state.remainingMs;
    else if (state.status === 'berjalan' && state.endsAt) ms = state.endsAt - serverNow;
    const s = ms === null ? null : Math.max(0, Math.ceil(ms / 1000));
    this.timerEl.textContent = state.status === 'jeda' ? 'Jeda' : s === null ? '--:--' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    this.timerEl.classList.toggle('rendah', state.status === 'berjalan' && s !== null && s < 60);
    const st = state.status === 'menunggu' ? 'Menunggu guru memulai' : state.status === 'jeda' ? 'Permainan dijeda guru' : state.status === 'selesai' ? 'Permainan selesai' : '';
    this.statusEl.textContent = st;
    this.statusEl.style.display = st ? '' : 'none';
  }

  setAction(label: string | null) {
    if (!label) {
      this.actionBtn.style.display = 'none';
      return;
    }
    if (this.actionBtn.textContent !== label) this.actionBtn.textContent = label;
    this.actionBtn.style.display = '';
  }

  // ── Peta mini (diputar mengikuti kamera) ──
  drawMinimap(px: number, pz: number, camYaw: number, facing: number, points: { x: number; z: number; done: boolean; surprise: boolean }[], others: { x: number; z: number }[], world: WorldId = 'kota') {
    if (this.mode !== 'dunia') return;
    const c = this.minimap.getContext('2d')!;
    const W = this.minimap.width;
    const range = 160; // meter dari tengah ke tepi
    const k = W / 2 / range;
    c.save();
    c.fillStyle = world === 'kota' ? '#9ed98f' : WORLD_ENV[world].mapBg;
    c.fillRect(0, 0, W, W);
    c.translate(W / 2, W / 2);
    c.rotate(camYaw);
    const tx = (x: number) => (x - px) * k;
    const tz = (z: number) => (z - pz) * k;
    for (const zn of worldZones(world)) {
      c.fillStyle = '#' + zn.color.toString(16).padStart(6, '0') + '40';
      for (const r of zn.rects) c.fillRect(tx(r.x - r.hx), tz(r.z - r.hz), r.hx * 2 * k, r.hz * 2 * k);
    }
    c.fillStyle = '#3fb4e8';
    if (world !== 'laut') for (const w of worldLayout(world).water) c.fillRect(tx(w.x0), tz(w.z0), (w.x1 - w.x0) * k, (w.z1 - w.z0) * k);
    else for (const zn of worldZones(world)) if (['pelabuhan', 'mercusuar', 'penyu', 'kelapa'].includes(zn.id)) (c.fillStyle = '#F3DFA2'), c.fillRect(tx(zn.label.x - 30), tz(zn.label.z - 30), 60 * k, 60 * k);
    c.fillStyle = '#5d6678';
    const road = (x: number, z: number, w: number, d: number) => c.fillRect(tx(x - w / 2), tz(z - d / 2), w * k, d * k);
    if (world === 'kota') {
    road(0, -KOTA.ring, KOTA.ring * 2, KOTA.mainRoad);
    road(0, KOTA.ring, KOTA.ring * 2, KOTA.mainRoad);
    road(-KOTA.ring, 0, KOTA.mainRoad, KOTA.ring * 2);
    road(KOTA.ring, 0, KOTA.mainRoad, KOTA.ring * 2);
    road(0, 0, KOTA.half * 2, KOTA.mainRoad);
    road(0, 0, KOTA.mainRoad, KOTA.half * 2);
    road(0, KOTA.southZ, KOTA.half * 2, KOTA.sideRoad);
    road(-KOTA.sideX, 0, KOTA.sideRoad, KOTA.half * 2);
    road(KOTA.sideX, 0, KOTA.sideRoad, KOTA.half * 2);
    c.fillStyle = '#ff8a3d';
    c.fillRect(tx(-5), tz(-5), 10 * k, 10 * k);
    }
    drawLandmarks(c, tx, tz, 7, { upright: camYaw, clip: W, world });
    for (const o of others) {
      c.fillStyle = '#3BA7FF';
      c.beginPath();
      c.arc(tx(o.x), tz(o.z), 4, 0, Math.PI * 2);
      c.fill();
    }
    for (const p of points) {
      c.fillStyle = p.done ? '#2FBF71' : p.surprise ? '#8B5CF6' : '#FFC93C';
      c.strokeStyle = '#1E2A4A';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(tx(p.x), tz(p.z), p.done ? 5 : 7, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    c.restore();
    // Panah pemain (tengah)
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(camYaw - facing + Math.PI);
    c.fillStyle = '#1E2A4A';
    c.beginPath();
    c.moveTo(0, -16);
    c.lineTo(11, 12);
    c.lineTo(0, 6);
    c.lineTo(-11, 12);
    c.closePath();
    c.fill();
    c.restore();
  }

  private openMap() {
    if (this.onMapOpen) this.onMapOpen();
  }

  // ── Papan skor (panel geser dari kanan) ──
  toggleLeaderboard() {
    if (this.lbPanel) {
      this.lbPanel.remove();
      this.lbPanel = null;
      return;
    }
    this.lbPanel = h('div', { class: 'panel papan-skor' });
    ui.add(this.lbPanel);
    this.renderLeaderboard();
  }

  private renderLeaderboard() {
    if (!this.lbPanel) return;
    const rows = this.lb;
    const mine = rows.find((r) => r.absen === this.myAbsen);
    const list = h(
      'div',
      { class: 'col scroll', style: 'gap:6px' },
      rows.length ? null : h('p', { class: 'muted center', style: 'font-weight:800' }, 'Belum ada poin. Ayo temukan soal pertama!'),
      ...rows.slice(0, 10).map((r) => this.lbRow(r)),
      mine && mine.rank > 10 ? this.lbRow(mine) : null,
    );
    this.lbPanel.replaceChildren(h('div', { class: 'row' }, h('h3', { class: 'grow', style: 'font-size:24px' }, 'Papan Skor'), h('span', { class: 'chip', style: 'background:#ddf6e6;color:#1d7a47' }, 'LIVE')), list, btn('Tutup', 'putih kecil', () => this.toggleLeaderboard()));
  }

  private lbRow(r: LeaderboardRow) {
    return h('div', { class: `lb-row${r.absen === this.myAbsen ? ' saya' : ''}` }, h('span', { class: `rk medali-${r.rank}` }, String(r.rank)), h('span', { class: 'grow' }, `${r.absen === this.myAbsen ? 'Kamu · ' : ''}${r.nama}`), h('b', { style: 'font-family:Fredoka;font-size:18px' }, String(r.poin)));
  }

  private openEmotes() {
    const layer = h('div', { class: 'screen gelap', style: 'z-index:25', onclick: () => layer.remove() });
    const wheel = h('div', { style: 'position:relative;width:300px;height:300px', class: 'pop' });
    EMOTES.forEach((nm, i) => {
      const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
      const b = btn(nm, 'putih', () => {
        this.cb.emote(i);
        layer.remove();
      });
      b.style.cssText = `position:absolute;left:${150 + Math.cos(a) * 110 - 46}px;top:${150 + Math.sin(a) * 110 - 46}px;width:92px;height:92px;border-radius:50%;font-size:15px;padding:4px`;
      wheel.appendChild(b);
    });
    const close = btn('Tutup', 'navy', () => layer.remove());
    close.style.cssText = 'position:absolute;left:105px;top:105px;width:90px;height:90px;border-radius:50%;font-size:16px;padding:0';
    wheel.appendChild(close);
    layer.appendChild(wheel);
    ui.add(layer);
  }

  private openMenu() {
    const layer = h('div', { class: 'screen gelap', style: 'z-index:25' });
    const close = () => layer.remove();
    const qBtns = (['otomatis', 'rendah', 'sedang', 'tinggi'] as QualitySetting[]).map((q) =>
      h(
        'button',
        {
          class: `opt${this.cb.currentQuality() === q ? ' pilih' : ''}`,
          'data-q': q,
          onclick: () => {
            this.cb.quality(q);
            close();
          },
        },
        q[0]!.toUpperCase() + q.slice(1),
      ),
    );
    let confirmExit = false;
    const exitBtn = btn('Keluar ke Lobi', 'merah lebar', () => {
      if (!confirmExit) {
        confirmExit = true;
        exitBtn.textContent = 'Yakin keluar? Tekan lagi';
        return;
      }
      close();
      this.cb.toLobby();
    });
    const soundBtn = btn(soundOn() ? 'Suara: Hidup' : 'Suara: Mati', 'putih', () => {
      setSound(!soundOn());
      soundBtn.textContent = soundOn() ? 'Suara: Hidup' : 'Suara: Mati';
    });
    const musicBtn = btn(music.enabled ? 'Musik: Hidup' : 'Musik: Mati', 'putih', () => {
      music.setEnabled(!music.enabled);
      musicBtn.textContent = music.enabled ? 'Musik: Hidup' : 'Musik: Mati';
    });
    const emoteBtn = btn('😀 Emote', 'ungu', () => (close(), this.openEmotes()));
    layer.appendChild(
      h(
        'div',
        { class: 'panel card col pop dialog-hud', style: 'width:min(440px,100%)' },
        h('h2', null, 'Menu'),
        btn('Lanjut Bermain', 'hijau lebar', close),
        h('div', { style: 'font-weight:900' }, 'Kualitas grafis'),
        h('div', { class: 'grid-kualitas' }, ...qBtns),
        h('div', { class: 'grid-dua' }, soundBtn, musicBtn),
        this.mode === 'dunia' ? emoteBtn : null,
        this.mode !== 'none' ? btn('Ganti Karakter', 'ungu lebar', () => (close(), this.cb.avatar())) : null,
        btn('Tidak bisa bergerak? Pulihkan', 'putih lebar', () => (close(), this.cb.recover())),
        this.mode === 'dunia' ? exitBtn : null,
      ),
    );
    ui.add(layer);
  }

  /** Layar 6 — Pilih Dunia: 4 kartu; gembok bila belum dibuka guru / belum tersedia. */
  pilihDunia(enabled: WorldId[], onPick: (w: WorldId) => void) {
    const layer = h('div', { class: 'screen gelap', style: 'z-index:20;flex-direction:column;gap:16px' });
    const COLORS: Record<string, string> = { kota: '#FF8A3D', hutan: '#2FBF71', laut: '#1FB6D9', angkasa: '#7C5CFF' };
    layer.append(
      h('h2', { style: 'color:#fff;font-size:34px;text-shadow:0 3px 0 #1E2A4A' }, 'Pilih Dunia'),
      h(
        'div',
        { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(240px,1fr));width:min(760px,100%)' },
        ...WORLDS.map((w) => {
          const open = w.tersedia && enabled.includes(w.id);
          const note = !w.tersedia ? 'Segera hadir' : open ? 'Ketuk untuk masuk' : 'Dunia ini akan dibuka gurumu';
          return h(
            'button',
            {
              class: 'opt',
              style: `flex-direction:column;align-items:flex-start;min-height:140px;border-color:${COLORS[w.id]};border-width:5px;text-align:left;${open ? '' : 'background:#e8edf5'}`,
              onclick: () => {
                if (!open) return;
                layer.remove();
                onPick(w.id);
              },
            },
            h('span', { style: 'font-family:Fredoka;font-size:26px' }, w.nama),
            h('span', { class: 'muted', style: 'font-size:15px' }, w.mapel),
            h('span', { style: `margin-top:auto;font-weight:900;color:${open ? '#1d7a47' : '#c25a12'}` }, open ? note : `Terkunci · ${note}`),
          );
        }),
      ),
      btn('Kembali', 'putih', () => layer.remove()),
    );
    ui.add(layer);
  }
}

/** Layar 7 — Ruang Tunggu: daftar teman, tombol SIAP, menunggu guru menekan Mulai. */
export class WaitingRoom {
  readonly el: HTMLElement;
  private list = h('div', { class: 'grid scroll', style: 'max-height:40vh;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))' });
  private info = h('div', { class: 'chip', style: 'background:#FFC93C;font-size:18px' });
  private ready = false;

  constructor(worldName: string, private onReady: (v: boolean) => void, onLeave: () => void) {
    const readyBtn = btn('SIAP', 'hijau besar', () => {
      this.ready = !this.ready;
      readyBtn.textContent = this.ready ? 'Siap! Menunggu guru…' : 'SIAP';
      this.onReady(this.ready);
    });
    this.el = h(
      'div',
      { class: 'screen', style: 'background:rgba(255,138,61,0.55);backdrop-filter:blur(3px);z-index:18' },
      h(
        'div',
        { class: 'panel card lebar col pop' },
        h('div', { class: 'row wrap' }, h('h2', { class: 'grow', style: 'font-size:28px' }, `${worldName} · Ruang Tunggu`), this.info),
        h('p', { class: 'muted', style: 'margin:0;font-weight:800' }, 'Mode: Lomba Kelas. Permainan dimulai saat gurumu menekan Mulai.'),
        this.list,
        h('div', { class: 'row wrap', style: 'justify-content:space-between' }, btn('Keluar', 'putih', onLeave), readyBtn),
      ),
    );
  }

  setRoster(r: { absen: number; nama: string; taken: boolean }[]) {
    const joined = r.filter((x) => x.taken);
    this.info.textContent = `${joined.length} teman bergabung`;
    this.list.replaceChildren(...joined.map((x) => h('div', { class: 'opt', style: 'min-height:52px;cursor:default' }, `${String(x.absen).padStart(2, '0')} · ${x.nama}`)));
  }

  show() {
    ui.add(this.el);
  }

  close() {
    this.el.remove();
  }
}
