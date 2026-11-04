/**
 * EDUVERSE — Mode Demo Kota 3D tanpa server dan tanpa kode kelas.
 * Hanya untuk uji kontrol dan visual di browser. Nilai tidak disimpan,
 * tidak ada pemain lain, dan hasil ini bukan asesmen resmi.
 */
import './ui/styles.css';
import { buildKota, DEFAULT_AVATAR, riftExit, VEHICLE_SPEC, type ActivePoint, type VehicleKind, type VehicleStateMsg } from '@eduverse/shared';
import { Mobility, type MobilityHost, type MobilityPrompt } from './world/living/mobility.js';
import { localMission, localMissionDialog } from './world/living/missions.js';
import { notify } from './ui/dom.js';
import { showMap } from './ui/play.js';
import { Engine } from './engine/engine.js';
import { Input } from './engine/input.js';
import { FollowCamera } from './engine/camera.js';
import { Stage, type Prompt } from './world/stage.js';
import { LocalPlayer } from './world/localPlayer.js';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const engine = new Engine(canvas);
const input = new Input(canvas);
document.body.appendChild(input.controls);
if (input.touch) document.body.classList.add('touch');
const cam = new FollowCamera(engine.camera);
const stage = new Stage(engine, 'kota');
const layout = buildKota();
const player = new LocalPlayer(engine.scene, { ...DEFAULT_AVATAR }, 'Penjelajah');
player.teleport(stage.spawn.x, stage.spawn.y + 0.5, stage.spawn.z);
cam.snap();

const nearbyDemo: ActivePoint = {
  id: 'DEMO01', x: stage.spawn.x + 3, y: 0, z: stage.spawn.z + 1,
  zone: 'alunalun', object: 'peti', hidden: false, surprise: false, done: false,
};
const markers: ActivePoint[] = [
  nearbyDemo,
  ...layout.spawns.filter((s) => !s.id.startsWith('V')).map((s) => ({
    id: s.id, x: s.x, y: s.y, z: s.z, zone: s.zone,
    object: s.object, hidden: s.hidden, surprise: false, done: false,
  })),
];
stage.setPoints(markers);

const style = document.createElement('style');
style.textContent = `
.demo-overlay {position:fixed;inset:0;z-index:10;pointer-events:none;color:#1e2a4a;font-family:'Nunito',sans-serif}
.demo-overlay button,.demo-overlay a {pointer-events:auto;touch-action:none}
.demo-head {position:absolute;top:max(10px,env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left));background:#f4f8ffed;border-radius:15px;padding:9px 14px;box-shadow:0 4px 14px #1e2a4a33;font-weight:900;max-width:63vw}
.demo-head small {display:block;font-size:11px;color:#566079}
.demo-map {position:absolute;top:58px;right:12px;background:#fff;border:2px solid #dbe7f5;border-radius:14px;padding:9px 16px;font:800 13px Nunito;color:#1e2a4a}
.demo-back {position:absolute;top:10px;right:12px;background:#fff;border:2px solid #dbe7f5;border-radius:14px;padding:9px 12px;font:800 13px Nunito;color:#1e2a4a;text-decoration:none}
.demo-bottom {position:absolute;bottom:max(10px,env(safe-area-inset-bottom));right:max(12px,env(safe-area-inset-right));display:flex;gap:10px;align-items:flex-end}
.demo-action {background:#ffcf45;border:none;border-radius:17px;padding:16px;font:900 14px Nunito;color:#1e2a4a;min-width:98px;box-shadow:0 5px 0 #be9224}
.demo-jump {width:72px;height:72px;border-radius:50%;background:#3ba7ff;border:none;color:white;font:900 15px Nunito;box-shadow:0 4px 0 #2676ae}
.demo-run {background:#2fbf71;border:none;color:white;border-radius:16px;padding:13px;font:800 13px Nunito}
.demo-hint {position:absolute;bottom:10px;left:12px;max-width:38vw;background:#f4f8ffde;border-radius:12px;padding:8px 12px;font-size:12px;font-weight:800}
.demo-modal {position:fixed;inset:0;z-index:20;background:#1e2a4aba;display:none;align-items:center;justify-content:center;padding:12px;pointer-events:auto}
.demo-card {width:min(600px,96vw);max-height:95vh;overflow:auto;background:#f4f8ff;border-radius:20px;padding:18px;box-shadow:0 14px 40px #17223b66}
.demo-card h2 {font-size:clamp(17px,3vw,26px)}
.demo-options {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:12px 0}
.demo-options button {border:2px solid #cbd5e1;border-radius:13px;min-height:48px;background:#fff;font:800 15px Nunito;color:#1e2a4a;padding:8px}
.demo-card .demo-exit {background:#3ba7ff;color:white;border:0;border-radius:14px;min-height:42px;padding:8px 20px;font:900 15px Nunito}
@media (orientation:portrait) {.demo-hint {display:none}.demo-head {max-width:52vw}.demo-options{grid-template-columns:1fr}}
`;
document.head.appendChild(style);

const overlay = document.createElement('div');
overlay.className = 'demo-overlay';
overlay.innerHTML = `
  <div class="demo-head">EDUVERSE · DEMO KOTA<small>Tanpa kode kelas · Poin uji: <span id="demo-score">0</span></small></div>
  <a class="demo-back" href="/">← Menu utama</a>
  <button id="demo-map" class="demo-map" type="button">Peta</button>
  <div class="demo-hint">Kiri: jalan · Kanan: putar kamera · Coba mobil/motor di area P, jetpack oranye, portal ungu, pedagang (!)</div>
  <div class="demo-bottom">
    <button id="demo-run" class="demo-run" type="button">Lari</button>
    <button id="demo-jump" class="demo-jump" type="button">Lompat</button>
    <button id="demo-action" class="demo-action" type="button" hidden>Aksi</button>
  </div>
`;
document.body.appendChild(overlay);

const scoreEl = document.getElementById('demo-score')!;
const actionBtn = document.getElementById('demo-action') as HTMLButtonElement;
const jumpBtn = document.getElementById('demo-jump') as HTMLButtonElement;
const runBtn = document.getElementById('demo-run') as HTMLButtonElement;
const modal = document.createElement('div');
modal.className = 'demo-modal';
document.body.appendChild(modal);

for (const ev of ['pointerdown', 'touchstart']) {
  jumpBtn.addEventListener(ev, (e) => { e.preventDefault(); input.jump = true; });
}
for (const ev of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) {
  jumpBtn.addEventListener(ev, (e) => { e.preventDefault(); input.jump = false; });
}
runBtn.onclick = () => {
  input.setRunToggle(!input.runToggle);
  runBtn.textContent = input.runToggle ? 'Jalan' : 'Lari';
};
let score = 0;
let currentPrompt: Prompt | MobilityPrompt | null = null;
let riding = false;
let answering = false;
const questions = [
  { q: 'KPK dari 12 dan 18 adalah ...', options: ['6', '24', '36', '72'], correct: 2 },
  { q: 'Contoh sikap gotong royong di sekolah adalah ...', options: ['Mengejek teman', 'Piket kelas bersama', 'Membuang sampah', 'Terlambat'], correct: 1 },
  { q: 'Planet yang paling dekat dengan Matahari adalah ...', options: ['Bumi', 'Merkurius', 'Neptunus', 'Mars'], correct: 1 },
  { q: 'Hasil dari 3/4 + 1/4 adalah ...', options: ['1/2', '1', '3/8', '2'], correct: 1 },
  { q: 'Produsen dalam rantai makanan adalah ...', options: ['Rumput', 'Elang', 'Ular', 'Kelinci'], correct: 0 },
  { q: 'Lawan kata tinggi adalah ...', options: ['Besar', 'Cepat', 'Rendah', 'Panjang'], correct: 2 },
];
let quizSeq = 0;
function closeModal() {
  answering = false;
  input.enabled = true;
  input.reset();
  modal.style.display = 'none';
  modal.replaceChildren();
}
function questionAt(id: string) {
  if (answering) return;
  answering = true;
  input.enabled = false;
  input.reset();
  const q = questions[quizSeq++ % questions.length]!;
  const card = document.createElement('div');
  card.className = 'demo-card';
  const heading = document.createElement('h2');
  heading.textContent = 'Misi Soal Demo · +100 poin';
  const ask = document.createElement('p');
  ask.style.fontWeight = '900';
  ask.textContent = q.q;
  const choices = document.createElement('div');
  choices.className = 'demo-options';
  const feedback = document.createElement('p');
  feedback.style.fontWeight = '900';
  const exit = document.createElement('button');
  exit.className = 'demo-exit';
  exit.textContent = 'Kembali Menjelajah';
  exit.onclick = closeModal;
  q.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.textContent = String.fromCharCode(65 + i) + '. ' + o;
    b.onclick = () => {
      for (const node of Array.from(choices.querySelectorAll('button'))) (node as HTMLButtonElement).disabled = true;
      const right = i === q.correct;
      b.style.background = right ? '#bbf7d0' : '#fed7aa';
      if (!right) (choices.children[q.correct] as HTMLButtonElement).style.background = '#bbf7d0';
      if (right) {
        score += 100;
        scoreEl.textContent = String(score);
      }
      feedback.textContent = right ? 'BENAR! +100 poin demo' : 'Belum tepat. Jawaban benar ditandai hijau.';
      stage.points?.markDone(id);
    };
    choices.appendChild(b);
  });
  card.append(heading, ask, choices, feedback, exit);
  modal.replaceChildren(card);
  modal.style.display = 'flex';
}
// ───── Mode Demo: kendaraan, jetpack, portal & misi berjalan LOKAL (tidak mengubah data kelas resmi) ─────
const demoVehicles = new Map<string, VehicleStateMsg>(layout.living.vehicles.map((v) => [v.id, { id: v.id, kind: v.kind, x: v.x, y: v.y, z: v.z, heading: v.heading, color: v.color, driver: null }]));
let demoDriving: string | null = null;
let demoJetpack = false;
const missionsDone = new Set<string>();
const demoHost: MobilityHost = {
  async enterVehicle(id) {
    const v = demoVehicles.get(id);
    if (!v || v.driver) return { ok: false, error: 'Kendaraan tidak tersedia.' };
    const spec = VEHICLE_SPEC[v.kind as VehicleKind];
    if (Math.hypot(player.body.x - v.x, player.body.z - v.z) > spec.interact + 2) return { ok: false, error: 'Mendekatlah ke kendaraan.' };
    v.driver = 'saya';
    demoDriving = id;
    stage.living?.parked.setStates([...demoVehicles.values()]);
    return { ok: true, vehicle: { ...v } };
  },
  async exitVehicle(p) {
    const v = demoDriving ? demoVehicles.get(demoDriving) : null;
    const d = mobility.driving;
    if (v && d) Object.assign(v, { x: d.body.x, y: Math.max(0, d.kind === 'pesawat' ? Math.min(d.body.y, 0.05) : d.body.y), z: d.body.z, heading: d.body.heading, driver: null });
    demoDriving = null;
    stage.living?.parked.setStates([...demoVehicles.values()]);
    return { ok: true, ...p };
  },
  async setJetpack(on, stationId) {
    if (on && !demoJetpack) {
      const st = layout.living.jetpacks.find((j) => j.id === stationId);
      if (!st || Math.hypot(player.body.x - st.x, player.body.z - st.z) > 5) return { ok: false, error: 'Ambil jetpack di Stasiun Jetpack.' };
      demoJetpack = true;
    }
    return { ok: true };
  },
  async useRift(id) {
    const r = layout.living.rifts.find((x) => x.id === id);
    const dest = r && layout.living.rifts.find((x) => x.id === r.to);
    if (!r || !dest) return { ok: false, error: 'Tujuan belum tersedia.' };
    return { ok: true, target: riftExit(dest), nama: dest.nama };
  },
  startMission(v) {
    const m = localMission(v);
    answering = true;
    input.enabled = false;
    input.reset();
    localMissionDialog(
      v,
      m,
      (ok) => {
        if (ok) {
          score += 100;
          scoreEl.textContent = String(score);
          missionsDone.add(v.id);
          stage.living?.vendors.done.add(v.id);
        }
      },
      () => {
        answering = false;
        input.enabled = true;
      },
    );
  },
  missionDone: (id) => missionsDone.has(id),
  toLobby: null,
  notify: (t, k) => notify(t, k ?? 'info'),
  setBusy: (b) => {
    answering = b;
    input.enabled = !b;
    input.reset();
  },
};
const mobility = new Mobility(engine.scene, input, cam, player, demoHost, input.touch);
mobility.setCity(stage.living, stage.collision);
const isMob = (p: Prompt | MobilityPrompt): p is MobilityPrompt => p.kind === 'kendaraan' || p.kind === 'turun' || p.kind === 'jetpack' || p.kind === 'pedagang';

function action() {
  const p = currentPrompt;
  if (!p || answering) return;
  if (isMob(p)) return void mobility.act(p);
  if (riding) { riding = false; player.teleport(player.body.x + 3, 0.5, player.body.z); return; }
  if (p.kind === 'soal') return questionAt(p.id);
  if (p.kind === 'rak') return stage.openRak(engine.clock.t);
  if (p.kind === 'bus') { riding = true; return; }
  if (p.kind === 'lift') {
    const lift = layout.lifts.find((l) => l.id === p.id);
    if (lift && !lift.locked) {
      player.teleport(lift.target.x, lift.target.y, lift.target.z);
      cam.snap();
    }
  }
}
actionBtn.onclick = action;
document.getElementById('demo-map')!.addEventListener('click', () =>
  showMap(player.body.x, player.body.z, (stage.points?.list() ?? []).map((e) => ({ x: e.p.x, z: e.p.z, done: e.done, surprise: e.p.surprise }))),
);
input.onAction(action);

let prevPrompt = '';
engine.onFrame((dt, t) => {
  cam.yaw += input.camYaw;
  cam.pitch = Math.max(-0.3, Math.min(1.1, cam.pitch + input.camPitch));
  cam.distance = Math.max(cam.minDist, Math.min(cam.maxDist, cam.distance + input.zoom));
  input.camYaw = input.camPitch = input.zoom = 0;
  if (riding && stage.bus) {
    const seat = stage.bus.seat();
    player.update(dt, input, cam, stage.collision, { ...seat, heading: stage.bus.heading });
  } else if (!mobility.update(dt, t)) {
    player.update(dt, input, cam, stage.collision);
  }
  if (player.body.y < -30) player.teleport(stage.spawn.x, stage.spawn.y + 0.5, stage.spawn.z);
  const b = player.body;
  const ct = mobility.camTarget();
  cam.update(dt, ct.x, ct.y, ct.z, stage.collision);
  engine.followSun(b.x, b.y, b.z);
  stage.update(dt, t, b.x, b.z, Date.now());
  currentPrompt = riding ? { kind: 'bus', id: 'bus', label: 'Turun Bus' } : mobility.driving || mobility.prompt?.kind === 'pedagang' ? mobility.prompt : (stage.nearestPrompt(b.x, b.y, b.z) ?? mobility.prompt);
  const name = currentPrompt?.label ?? '';
  if (name !== prevPrompt) {
    prevPrompt = name;
    actionBtn.hidden = !currentPrompt;
    actionBtn.textContent = name || 'Aksi';
  }
});
(window as unknown as { __eduDemo?: unknown }).__eduDemo = {
  getState: () => ({
    score,
    position: { x: player.body.x, y: player.body.y, z: player.body.z },
    prompt: currentPrompt?.kind ?? null,
    promptId: (currentPrompt as { id?: string } | null)?.id ?? null,
    mobility: mobility.snapshot(),
    traffic: stage.living?.traffic.snapshot() ?? null,
    fps: engine.fps,
    missionsDone: [...missionsDone],
  }),
  /** Uji otomatis: pindahkan pemain (Mode Demo saja — tidak ada server, tidak ada nilai resmi). */
  teleport: (x: number, y: number, z: number, ry = 0) => {
    player.teleport(x, y, z, ry);
    cam.yaw = ry + Math.PI;
    cam.snap();
  },
  action: () => action(),
  control: (c: Record<string, boolean>) => mobility.setControl(c),
  setMove: (x: number, y: number, jump = false, dive = false) => {
    input.moveX = x;
    input.moveY = y;
    input.jump = jump;
    input.dive = dive;
  },
  /** Apakah titik berada di dalam kotak padat (uji "tidak terjebak di bangunan"). */
  inside: (x: number, y: number, z: number) => stage.collision.pointBlocked(x, y, z, []),
  layout: () => ({ vehicles: layout.living.vehicles, rifts: layout.living.rifts, vendors: layout.living.vendors.map((v) => ({ id: v.id, x: v.x, y: v.y, z: v.z, nama: v.nama })), jetpacks: layout.living.jetpacks, runway: layout.living.runway }),
};
engine.start();
