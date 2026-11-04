/**
 * EDUVERSE — game siswa (Chrome HP, tablet, komputer).
 * Alur: Splash → Welcome → Masuk Sesi → Pilih Identitas → (Menunggu Guru) → Pilih Avatar → Lobi 3D
 *       → Pilih Dunia → Ruang Tunggu → hitung mundur → Dunia Kota → Hasil Akhir → Podium.
 */
import './ui/styles.css';
import * as THREE from 'three';
import { EV, LIMITS, WORLDS, SHOP, CATALOG, buildKota, buildLobby, DEFAULT_AVATAR, type WalletMsg, type VehicleStateMsg, type Vendor, type ActivePoint, type AvatarConfig, type FinalResultMsg, type LeaderboardRow, type PodiumEntry, type RosterEntry, type SceneId, type SessionPublicState, type WorldId } from '@eduverse/shared';
import { Engine } from './engine/engine.js';
import { Input } from './engine/input.js';
import { FollowCamera } from './engine/camera.js';
import { Stage, type Prompt } from './world/stage.js';
import { LocalPlayer } from './world/localPlayer.js';
import { RemotePlayers } from './world/remotePlayers.js';
import { Effects } from './world/effects.js';
import { NetClient, type Me } from './net/client.js';
import { h, ui, notify } from './ui/dom.js';
import { splash, welcome, masukSesi, pilihIdentitas, menungguGuru } from './ui/intro.js';
import { pilihAvatar } from './ui/avatarScreen.js';
import { Hud, WaitingRoom } from './ui/hud.js';
import { showQuestion, showFinal, podiumBanner, countdown, showMap, blocker } from './ui/play.js';
import { Mobility, type MobilityHost, type MobilityPrompt } from './world/living/mobility.js';
import { WalletStore } from './world/living/inventory.js';

// ───────────────────────── inisialisasi ─────────────────────────
const canvas = document.getElementById('scene') as HTMLCanvasElement;
let engine: Engine;
try {
  engine = new Engine(canvas);
} catch (e) {
  console.error(e);
  blocker('Perangkat belum didukung', 'Browser ini tidak mendukung WebGL. Buka EDUVERSE dengan Google Chrome versi terbaru.');
  throw e;
}
const input = new Input(canvas);
document.body.appendChild(input.controls);
if (input.touch) document.body.classList.add('touch');
const cam = new FollowCamera(engine.camera);
const effects = new Effects(engine.scene);
const remote = new RemotePlayers(engine.scene);
remote.onTeleport = (x, y, z) => effects.sparkle(new THREE.Vector3(x, y + 1.2, z));
const net = new NetClient();
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

let stage: Stage | null = null;
let player: LocalPlayer | null = null;
let me: Me | null = null;
let avatarCfg: AvatarConfig = { ...DEFAULT_AVATAR };
let session: SessionPublicState | null = null;
let roster: RosterEntry[] = [];
let lastScore = { poin: 0, rank: null as number | null, total: 0, dijawab: 0 };
let pendingWorld: WorldId | null = null;
let waiting: WaitingRoom | null = null;
let questionOpen = false;
let riding = false;
let busy = false;
let prompt: Prompt | MobilityPrompt | null = null;
let mobility: Mobility | null = null;
let ended = false;
let orbit = true;

const applyQuality = () => {
  stage?.applyQuality();
  remote.maxVisible = engine.profile.maxRemotePlayers;
  effects.scale = engine.profile.particles;
};
engine.onQuality(applyQuality);
applyQuality();

// ───────────────────────── HUD ─────────────────────────
const hud = new Hud({
  action: () => input.fireAction(),
  jump: (d) => (input.jump = d),
  dive: (d) => (input.dive = d),
  runToggle: (on) => input.setRunToggle(on),
  emote: (id) => {
    net.emote(id);
    if (player) {
      player.avatar.emote = id;
      setTimeout(() => player && (player.avatar.emote = -1), 3000);
    }
  },
  pilihDunia: () => openWorldPicker(),
  quality: (q) => {
    engine.setQuality(q);
    notify(`Kualitas grafis: ${q}`, 'info');
  },
  currentQuality: () => engine.quality,
  recover: () => {
    if (mobility?.driving) return void mobility.act({ kind: 'turun', id: mobility.driving.id, label: '' }).then(() => player?.recover());
    player?.recover();
    riding = false;
  },
  toLobby: () => void goScene('lobi'),
  avatar: () => void changeAvatar(),
});
hud.onMapOpen = () => {
  if (!player || !stage?.points) return;
  showMap(player.body.x, player.body.z, pointList());
};

function pointList() {
  return (stage?.points?.list() ?? []).map((e) => ({ x: e.p.x, z: e.p.z, done: e.done, surprise: e.p.surprise }));
}

// ───────────────────────── adegan ─────────────────────────
function loadStage(scene: SceneId) {
  stage?.dispose();
  remote.clear();
  effects.clear();
  stage = new Stage(engine, scene);
  mobility?.setCity(stage.living, stage.living ? stage.collision : null);
  if (session) stage.setEnabledWorlds(session.worlds);
  applyQuality();
  if (scene === 'kota') {
    engine.scene.background = new THREE.Color(0x9fd8ff);
  }
}

async function goScene(scene: SceneId): Promise<boolean> {
  if (busy) return false;
  busy = true;
  riding = false;
  try {
    const r = await net.enter(scene);
    if (!r.ok) {
      notify(r.error, 'peringatan');
      return false;
    }
    loadStage(scene);
    if (!player) {
      player = new LocalPlayer(engine.scene, avatarCfg, label());
      mobility = new Mobility(engine.scene, input, cam, player, mobilityHost, input.touch);
      mobility.setCity(stage!.living, stage!.living ? stage!.collision : null);
    }
    if (r.vehicles && stage!.living) stage!.living.parked.setStates(r.vehicles);
    if (mobility) mobility.hasJetpack = !!r.jetpack;
    wallet.set(r.dompet);
    player.frozen = false;
    player.teleport(r.spawn.x, r.spawn.y, r.spawn.z, 0);
    stage!.view?.update(r.spawn.x, r.spawn.z, engine.clock.t, true);
    if (r.points) stage!.setPoints(r.points, r.done);
    cam.snap();
    orbit = false;
    hud.setMode(scene === 'lobi' ? 'lobi' : scene === 'podium' ? 'none' : 'dunia');
    if (scene === 'kota') notify('Selamat datang di Dunia Kota! Cari tanda tanya kuning.', 'misi');
    return true;
  } finally {
    busy = false;
  }
}

function label() {
  return me ? `${me.nama} · ${String(me.absen).padStart(2, '0')}` : 'Pemain';
}

// ───────────────────────── interaksi ─────────────────────────
input.onAction(() => void doAction());

async function doAction() {
  if (!player || !stage || questionOpen || busy) return;
  if (prompt && mobility && isMobilityPrompt(prompt)) return void mobility.act(prompt);
  if (riding) {
    riding = false;
    const b = stage.bus!;
    player.teleport(b.x + Math.cos(b.heading) * 3, 0.3, b.z - Math.sin(b.heading) * 3, player.ry);
    notify('Kamu turun dari bus.', 'info');
    return;
  }
  const p = prompt;
  if (!p) return;
  if (p.kind === 'portal' && p.world) return void enterWorldFlow(p.world);
  if (p.kind === 'soal') return void openQuestion(p.id);
  if (p.kind === 'lift') {
    const r = await net.useLift(p.id);
    if (!r.ok) return notify(r.error, 'kunci');
    player.teleport(r.target.x, r.target.y, r.target.z);
    stage.view?.update(r.target.x, r.target.z, engine.clock.t, true);
    cam.snap();
    if (p.id.startsWith('L_') && !p.id.includes('TUN')) notify('Kamu menemukan Terowongan Bawah Tanah! Ada soal bonus tersembunyi.', 'misi');
    return;
  }
  if (p.kind === 'rak') {
    stage.openRak(engine.clock.t);
    notify('Rak bergeser! Ada bilik rahasia di baliknya.', 'misi');
    return;
  }
  if (p.kind === 'bus') {
    riding = true;
    notify('Kamu naik Bus Kota. Tekan Aksi (E) untuk turun.', 'info');
  }
}

function isMobilityPrompt(p: Prompt | MobilityPrompt): p is MobilityPrompt {
  return p.kind === 'kendaraan' || p.kind === 'turun' || p.kind === 'jetpack' || p.kind === 'pedagang';
}

const wallet = new WalletStore();
/** Mode kelas: semua perubahan kendaraan/jetpack/portal/jual beli divalidasi server. */
const mobilityHost: MobilityHost = {
  wallet,
  buy: async (vendorId, itemId, qty) => {
    const r = await net.buy(vendorId, itemId, qty);
    if (r.ok) wallet.set(r);
    return r;
  },
  useItem: async (itemId) => {
    const r = await net.useItem(itemId);
    if (r.ok) wallet.set(r);
    return r;
  },
  giving: {
    // jarak sedikit lebih kecil dari batas server (6 m) karena posisi pemain lain diinterpolasi
    friends: () => (player ? remote.near(player.body.x, player.body.z, SHOP.jarakBeri - 0.5) : []),
    give: async (toId, itemId, qty) => {
      const r = await net.give(toId, itemId, qty);
      if (r.ok) wallet.set(r);
      return r;
    },
  },
  enterVehicle: (id) => net.enterVehicle(id),
  exitVehicle: (p) => net.exitVehicle(p),
  setJetpack: (on, st) => net.setJetpack(on, st),
  useRift: (id) => net.useRift(id),
  startMission: (v: Vendor) => void openQuestion(v.id),
  missionDone: (id) => !!stage?.living?.vendors.done.has(id),
  toLobby: () => void goScene('lobi'),
  notify: (t, k) => notify(t, k ?? 'info'),
  setBusy: (b) => {
    input.enabled = !b;
    input.reset();
  },
};

async function openQuestion(pointId: string) {
  if (!player) return;
  questionOpen = true;
  input.enabled = false;
  input.reset();
  const r = await net.interact(pointId);
  if (!r.ok) {
    questionOpen = false;
    input.enabled = true;
    notify(r.error, 'peringatan');
    return;
  }
  showQuestion(
    r.question,
    async (a) => {
      const res = await net.answer(r.question.token, a);
      if (!res.ok) return res.error;
      if (!res.result.canRetry) {
        stage?.points?.markDone(pointId);
        if (pointId.startsWith('V')) stage?.living?.vendors.done.add(pointId);
        lastScore.dijawab++;
        hud.setProgress(lastScore.dijawab, session?.progressTarget ?? null);
        if (res.result.correct && player) effects.sparkle(new THREE.Vector3(player.body.x, player.body.y + 2, player.body.z));
        hud.setScore(res.result.totalScore, lastScore.rank, lastScore.total);
      }
      return res.result;
    },
    (finished) => {
      if (!finished) net.closeQuestion();
      questionOpen = false;
      input.enabled = true;
    },
  );
}

function openWorldPicker() {
  hud.pilihDunia(session?.worlds ?? ['kota'], (w) => void enterWorldFlow(w));
}

/** Masuk dunia: langsung bila permainan berjalan; bila belum → Ruang Tunggu. */
async function enterWorldFlow(w: WorldId) {
  const info = WORLDS.find((x) => x.id === w)!;
  if (!info.tersedia) return notify(`${info.nama} segera hadir.`, 'info');
  if (session && !session.worlds.includes(w)) return notify('Dunia ini akan dibuka gurumu.', 'kunci');
  if (session && (session.status === 'berjalan' || session.status === 'jeda')) {
    await goScene(w);
    return;
  }
  if (session?.status === 'selesai') return notify('Permainan sudah selesai.', 'info');
  pendingWorld = w;
  waiting?.close();
  waiting = new WaitingRoom(
    info.nama,
    (v) => net.setReady(v),
    () => {
      waiting?.close();
      waiting = null;
      pendingWorld = null;
      net.setReady(false);
    },
  );
  waiting.setRoster(roster);
  waiting.show();
}

async function changeAvatar() {
  input.enabled = false;
  hud.setMode('none');
  avatarCfg = await pilihAvatar(avatarCfg, label(), async (cfg) => {
    await net.setAvatar(cfg);
  });
  player?.setAvatar(avatarCfg);
  hud.setMode(stage?.scene === 'lobi' ? 'lobi' : 'dunia');
  input.enabled = true;
}

// ───────────────────────── event server ─────────────────────────
net.on<SessionPublicState>(EV.session, (s) => {
  const prev = session?.status;
  session = s;
  stage?.setEnabledWorlds(s.worlds);
  hud.setProgress(lastScore.dijawab, s.progressTarget);
  if (prev && prev !== s.status) {
    if (s.status === 'jeda') notify('Permainan dijeda guru.', 'peringatan');
    if (prev === 'jeda' && s.status === 'berjalan') notify('Permainan dilanjutkan!', 'sukses');
  }
});
net.on<RosterEntry[]>(EV.roster, (r) => {
  roster = r;
  waiting?.setRoster(r);
});
net.on<{ t: number; list: never[]; gone: string[] }>(EV.players, (m) => remote.apply(m));
net.on<{ world: WorldId; points: ActivePoint[] }>(EV.points, (m) => {
  if (stage?.scene === m.world) stage.setPoints(m.points);
});
net.on<{ poin: number; benar: number; dijawab: number; rank: number | null; total: number }>(EV.score, (s) => {
  lastScore = { poin: s.poin, rank: s.rank, total: s.total, dijawab: s.dijawab };
  hud.setScore(s.poin, s.rank, s.total);
  hud.setProgress(s.dijawab, session?.progressTarget ?? null);
});
net.on<LeaderboardRow[]>(EV.leaderboard, (rows) => hud.setLeaderboard(rows));
net.on<{ text: string; kind?: string }>(EV.notify, (m) => notify(m.text, m.kind ?? 'info'));
net.on<VehicleStateMsg[]>(EV.vehicles, (list) => stage?.living?.parked.setStates(list));
net.on<WalletMsg>(EV.wallet, (w) => wallet.set(w));
net.on<{ dari: string; itemId: string; qty: number }>(EV.gift, (g) => {
  const it = CATALOG[g.itemId];
  if (!it) return;
  giftsReceived++;
  wallet.addGift({ dari: g.dari, itemId: g.itemId, qty: g.qty });
  notify(`🎁 ${g.dari} memberimu ${it.ikon} ${it.nama} ×${g.qty}! Ucapkan terima kasih ya.`, 'sukses');
  if (player) effects.sparkle(new THREE.Vector3(player.body.x, player.body.y + 2, player.body.z));
});
let giftsReceived = 0;
net.on<{ x: number; y: number; z: number; reason: string; mode?: string }>(EV.teleport, (m) => {
  riding = false;
  if (mobility?.driving && m.mode !== 'jalan' && m.reason === 'koreksi') {
    // koreksi kecil dari server saat berkendara: geser kendaraan ke posisi sah terakhir
    Object.assign(mobility.driving.body, { x: m.x, y: m.y, z: m.z, speed: 0 });
    return;
  }
  if (mobility?.active && m.mode === 'jalan') mobility.forceWalk();
  player?.teleport(m.x, m.y, m.z);
  if (m.reason === 'pulih') notify('Hup! Kamu kembali ke tempat aman.', 'info');
});
/** Satu-satunya dunia aktif sesi ini (mis. hanya Kota) → semua siswa di lobi masuk bersama saat guru memulai. */
function soleWorld(): WorldId | null {
  const ws = (session?.worlds ?? []).filter((w) => WORLDS.find((x) => x.id === w)?.tersedia);
  return ws.length === 1 ? ws[0]! : null;
}
net.on<{ n: number }>(EV.countdown, (m) => {
  countdown(m.n);
  if (m.n <= 0 && !pendingWorld && stage?.scene === 'lobi') pendingWorld = soleWorld();
  if (m.n <= 0 && pendingWorld) {
    const w = pendingWorld;
    pendingWorld = null;
    waiting?.close();
    waiting = null;
    setTimeout(() => void goScene(w), 400);
  }
});
net.on<FinalResultMsg>(EV.ended, (r) => {
  ended = true;
  if (player) player.frozen = true;
  riding = false;
  document.querySelectorAll('.soal').forEach((n) => n.closest('.screen')?.remove());
  questionOpen = false;
  input.enabled = true;
  showFinal(r, () => {});
});
net.on<{ top3: PodiumEntry[]; total: number }>(EV.podium, (m) => void runPodium(m.top3));
net.on<{ approved: boolean }>(EV.identityApproved, (m) => {
  if (me) me.approved = m.approved;
});
net.on<{ reason: string; retry?: boolean }>(EV.kicked, (m) => {
  net.forgetClaim(net.code);
  document.querySelectorAll('.screen').forEach((n) => n.id !== 'blocker' && n.remove());
  blocker(m.retry ? 'Belum disetujui guru' : 'Sesi berakhir untuk perangkat ini', m.reason, { label: m.retry ? 'Coba Lagi' : 'Muat Ulang', fn: () => location.reload() });
});

async function runPodium(top3: PodiumEntry[]) {
  document.querySelectorAll('.screen.gelap').forEach((n) => n.remove());
  const ok = await goScene('podium');
  if (!ok || !stage) return;
  hud.setMode('none');
  if (player) player.frozen = true;
  stage.showWinners([]);
  const shown: PodiumEntry[] = [];
  // Kamera sinematik menghadap panggung
  const banner = podiumBanner(
    top3,
    (rank) => {
      const e = top3.find((t) => t.rank === rank);
      if (e) shown.push(e);
      stage?.showWinners(shown);
      effects.sparkle(new THREE.Vector3(rank === 1 ? 0 : rank === 2 ? -4.4 : 4.4, 4, -6));
    },
    () => {
      for (let i = 0; i < 4; i++)
        setTimeout(() => {
          effects.firework(new THREE.Vector3(-12 + Math.random() * 24, 12 + Math.random() * 4, -10));
          effects.confetti(new THREE.Vector3(0, 12, -4));
        }, i * 900);
    },
  );
  podiumCam = true;
  setTimeout(() => {
    banner.close();
    podiumCam = false;
    if (player) player.frozen = false;
    ui.add(h('div', { class: 'panel banner-bawah pop' }, h('h3', null, 'Terima kasih sudah bermain EDUVERSE!'), h('p', { class: 'muted', style: 'font-weight:800;margin:4px 0 0' }, 'Kamu boleh menjelajahi arena podium.')));
  }, 26_000);
}
let podiumCam = false;

// Sambung ulang otomatis: bergabung lagi dengan identitas yang sama, kembali ke adegan terakhir
net.onReconnect(async () => {
  if (!net.code || !me) return;
  const r = await net.join(net.code);
  if (!r.ok) return notify(r.error, 'peringatan');
  session = r.state;
  roster = r.roster;
  if (!r.me) return;
  me = r.me;
  notify('Tersambung kembali!', 'sukses');
  if (stage) {
    // Server melepas kendaraan saat koneksi putus (kendaraan diparkir di posisi terakhir yang sah)
    mobility?.forceWalk();
    const res = await net.enter(stage.scene);
    if (res.ok && player) {
      player.teleport(res.spawn.x, res.spawn.y, res.spawn.z);
      if (res.points) stage.setPoints(res.points, res.done);
      if (res.vehicles) stage.living?.parked.setStates(res.vehicles);
      if (mobility) mobility.hasJetpack = !!res.jetpack;
      wallet.set(res.dompet);
    }
  }
});
let offlineBanner: { close: () => void } | null = null;
net.socket.on('disconnect', () => {
  setTimeout(() => {
    if (!net.connected && me && !offlineBanner) offlineBanner = blocker('Koneksi terputus', 'Menyambung ulang otomatis… Pastikan internet HP menyala.');
  }, 2500);
});
net.socket.on('connect', () => {
  offlineBanner?.close();
  offlineBanner = null;
});

// ───────────────────────── loop frame ─────────────────────────
let sendAcc = 0;
let lastPromptKey = '';
engine.onFrame((dt, t) => {
  effects.update(dt);
  if (orbit || !player || !stage) {
    // Panorama welcome: kamera berputar pelan mengelilingi lobi
    const a = t * 0.08;
    engine.camera.position.set(Math.cos(a) * 52, 26, Math.sin(a) * 52);
    engine.camera.lookAt(0, 3, 0);
    stage?.update(dt, t, 0, 0, net.serverNow());
    return;
  }
  // Kamera: putar dari geser/seret
  cam.yaw += input.camYaw;
  cam.pitch = Math.max(-0.3, Math.min(1.1, cam.pitch + input.camPitch));
  input.camYaw = 0;
  input.camPitch = 0;
  cam.distance = Math.max(cam.minDist, Math.min(cam.maxDist, cam.distance + input.zoom));
  input.zoom = 0;

  // Autopilot khusus mode uji (?debug=1): berjalan biasa ke target lewat input yang sama — server tetap memvalidasi.
  if (debug && autopilot) {
    const dx = autopilot.x - player.body.x;
    const dz = autopilot.z - player.body.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.6) {
      autopilot = null;
      input.moveX = input.moveY = 0;
    } else {
      cam.yaw = Math.atan2(-dx, -dz);
      input.moveX = 0;
      input.moveY = 1;
      input.jump = player.body.grounded && t % 1.2 < 0.05; // lompat kecil sesekali bila tersangkut
    }
  }

  const bus = stage.bus;
  if (riding && bus) {
    const s = bus.seat();
    player.update(dt, input, cam, stage.collision, { ...s, heading: bus.heading });
    if (input.jump) {
      input.jump = false;
      void doAction();
    }
  } else if (!(mobility && mobility.update(dt, t))) player.update(dt, input, cam, stage.collision);
  player.lowGravity = false;

  const b = player.body;
  if (b.y < -30) {
    player.teleport(stage.spawn.x, stage.spawn.y + 0.5, stage.spawn.z);
    notify('Hup! Kamu kembali ke tempat aman.', 'info');
  }
  if (podiumCam) {
    engine.camera.position.set(Math.sin(t * 0.2) * 3, 4.6, 12);
    engine.camera.lookAt(0, 2.6, -6);
  } else {
    const ct = mobility?.camTarget() ?? b;
    cam.update(dt, ct.x, ct.y, ct.z, stage.collision);
  }
  engine.followSun(b.x, b.y, b.z);
  stage.update(dt, t, b.x, b.z, net.serverNow());
  remote.update(dt, engine.camera.position);

  // Tombol interaksi hanya muncul saat dekat objek
  prompt = questionOpen || ended ? null : riding ? { kind: 'bus', id: 'bus', label: 'Turun Bus' } : mobility?.driving || mobility?.prompt?.kind === 'pedagang' ? mobility.prompt : (stage.nearestPrompt(b.x, b.y, b.z) ?? mobility?.prompt ?? null);
  const key = prompt ? `${prompt.kind}:${prompt.id}` : '';
  if (key !== lastPromptKey) {
    lastPromptKey = key;
    hud.setAction(prompt ? (input.touch ? prompt.label : `${prompt.label} [E]`) : null);
  }

  // Kirim posisi 10×/detik (server memvalidasi kecepatan & batas peta)
  sendAcc += dt;
  if (sendAcc >= 1 / LIMITS.stateHz) {
    sendAcc = 0;
    net.sendState({ scene: stage.scene, x: round(b.x), y: round(b.y), z: round(b.z), ry: round(player.ry), anim: player.anim, riding, ...(mobility?.netExtras() ?? {}) });
  }
  hud.updateTimer(session, net.serverNow());
  if (stage.scene === 'kota') hud.drawMinimap(b.x, b.z, cam.yaw, player.ry, pointList(), remote.positions());
  if (debug) debugEl.textContent = `FPS ${engine.fps.toFixed(0)} · ${engine.level} · chunk ${JSON.stringify(stage.view?.stats())} · pemain lain ${remote.count()} · draw ${engine.renderer.info.render.calls}`;
  exposeState();
});
let autopilot: { x: number; z: number } | null = null;
if (debug) {
  (window as unknown as { __eduDebug: unknown }).__eduDebug = {
    goTo: (x: number, z: number) => void (autopilot = { x, z }),
    stop: () => {
      autopilot = null;
      input.moveX = input.moveY = 0;
      input.jump = false;
    },
    walking: () => autopilot !== null,
    openPoints: () => (stage?.points?.list() ?? []).filter((e) => !e.done && !e.p.hidden).map((e) => ({ id: e.p.id, x: e.p.x, y: e.p.y, z: e.p.z, object: e.p.object })),
    action: () => void doAction(),
    control: (c: Record<string, boolean>) => mobility?.setControl(c),
    /** Uji keamanan (mode ?debug=1): kirim permintaan mentah — server tetap memvalidasi semuanya. */
    raw: { enterVehicle: (id: string) => net.enterVehicle(id), useRift: (id: string) => net.useRift(id), setJetpack: (on: boolean, st?: string) => net.setJetpack(on, st), buy: (v: string, i: string, q: number) => mobilityHost.buy(v, i, q), useItem: (i: string) => mobilityHost.useItem(i), give: (to: string, i: string, q: number) => mobilityHost.giving!.give(to, i, q) },
    friends: (r = 50) => (player ? remote.near(player.body.x, player.body.z, r) : []),
    vendors: () => stage?.living?.layout.vendors.map((v) => ({ id: v.id, x: v.x, z: v.z })) ?? [],
  };
}
const round = (v: number) => Math.round(v * 100) / 100;
const debugEl = h('div', { class: 'stat' });
if (debug) document.body.appendChild(debugEl);

/** Status ringkas untuk uji otomatis (Playwright) — tidak berisi data rahasia. */
function exposeState() {
  (window as unknown as { __edu: unknown }).__edu = {
    scene: stage?.scene ?? null,
    pos: player ? { x: player.body.x, y: player.body.y, z: player.body.z } : null,
    remotes: remote.count(),
    remoteChars: remote.characters(),
    myChar: avatarCfg.karakter,
    podium: stage?.podiumShown ?? [],
    points: stage?.points?.list().length ?? 0,
    score: lastScore.poin,
    status: session?.status ?? null,
    prompt: prompt?.kind ?? null,
    fps: engine.fps,
    mobility: mobility?.snapshot() ?? null,
    traffic: stage?.living?.traffic.snapshot() ?? null,
    myId: net.socket.id ?? null,
    remoteModes: remote.modes(),
    giftsReceived,
    vehicles: stage?.living?.parked.all().map((v) => ({ id: v.id, driver: v.driver ? 'ya' : null, x: Math.round(v.x), z: Math.round(v.z) })) ?? [],
  };
}

// ───────────────────────── alur pembuka ─────────────────────────
async function boot() {
  engine.start();
  await splash(async (progress) => {
    progress(0.2);
    await new Promise((r) => setTimeout(r, 30));
    buildLobby();
    progress(0.4);
    await new Promise((r) => setTimeout(r, 30));
    loadStage('lobi');
    progress(0.7);
    await new Promise((r) => setTimeout(r, 30));
    buildKota(); // siapkan data Dunia Kota (sekali, deterministik)
    progress(1);
  });
  await welcome();

  // Masuk sesi
  let joined: Awaited<ReturnType<NetClient['join']>> | null = null;
  await masukSesi(params.get('kode') ?? '', async (code) => {
    const r = await net.join(code);
    if (!r.ok) return r.error;
    joined = r;
    return null;
  });
  const j = joined as unknown as Extract<Awaited<ReturnType<NetClient['join']>>, { ok: true }>;
  session = j.state;
  roster = j.roster;
  me = j.me;
  history.replaceState(null, '', `?kode=${net.code}`);

  // Identitas (sekali per sesi; perangkat yang sama otomatis dikenali lewat token)
  let isNew = false;
  if (!me) {
    isNew = true;
    await pilihIdentitas(roster, j.preset, async (absen, nama) => {
      const r = await net.claim(absen, nama);
      if (!r.ok) return r.error;
      me = r.me;
      return null;
    });
  }
  if (!me) return;
  if (!me.approved) {
    const w = menungguGuru();
    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        if (me?.approved) {
          clearInterval(iv);
          resolve();
        }
      }, 300);
    });
    w.close();
  }
  avatarCfg = me.avatar ?? avatarCfg;
  wallet.set(me.dompet);
  hud.setProfile(me.nama, me.absen);
  lastScore = { poin: me.poin ?? 0, rank: null, total: 0, dijawab: me.dijawab ?? 0 };
  hud.setScore(lastScore.poin, null, 0);
  if (isNew) avatarCfg = await pilihAvatar(avatarCfg, label(), async (cfg) => void (await net.setAvatar(cfg)));
  ui.clearScreens();

  // Kembali ke dunia terakhir bila permainan sedang berjalan, jika tidak ke lobi
  const last = me.lastScene;
  const running = session.status === 'berjalan' || session.status === 'jeda';
  if (running && last && last !== 'lobi' && last !== 'podium') {
    if (await goScene(last)) return;
  }
  await goScene('lobi');
  const only = soleWorld();
  if (session.status === 'selesai') notify('Permainan sesi ini sudah selesai. Tunggu podium dari gurumu.', 'info');
  else if (!running && only) {
    // Ruang tunggu langsung: begitu guru menekan Mulai, semua siswa masuk ke dunia yang sama
    void enterWorldFlow(only);
  } else if (!running) notify('Selamat datang di Lobi! Masuk portal oranye atau tekan PILIH DUNIA.', 'misi');
  else if (only) void goScene(only);
  else notify('Permainan sedang berjalan! Masuk portal oranye untuk ikut.', 'misi');
}

void boot();
