/**
 * Input pemain:
 * - HP/tablet: joystick virtual (muncul di titik jempol kiri), geser area kanan untuk memutar kamera,
 *   cubit untuk zoom, tombol Lompat / Lari / Aksi / Selam.
 * - Komputer: WASD/panah, Shift lari, Spasi lompat, E aksi, C selam, seret mouse (atau klik kanan) memutar kamera, roda zoom.
 */
export class Input {
  moveX = 0; // −1..1 (kanan +)
  moveY = 0; // −1..1 (maju +)
  run = false;
  runToggle = false;
  jump = false;
  dive = false;
  camYaw = 0; // radian akumulatif dari geser
  camPitch = 0;
  zoom = 0;
  enabled = true;
  private keys = new Set<string>();
  private actionCbs = new Set<() => void>();
  private joyId: number | null = null;
  private joyStart = { x: 0, y: 0 };
  private camTouches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  readonly touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  private joyBase: HTMLDivElement;
  private joyKnob: HTMLDivElement;
  readonly controls: HTMLDivElement;

  constructor(private surface: HTMLElement) {
    this.controls = document.createElement('div');
    this.controls.className = 'touch-controls';
    this.joyBase = document.createElement('div');
    this.joyBase.className = 'joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    this.controls.appendChild(this.joyBase);
    this.bindKeyboard();
    this.bindPointer();
  }

  onAction(fn: () => void) {
    this.actionCbs.add(fn);
    return () => this.actionCbs.delete(fn);
  }

  fireAction() {
    for (const fn of this.actionCbs) fn();
  }

  private bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' && !e.repeat && this.enabled) this.fireAction();
      if (e.code === 'Space' && this.enabled) e.preventDefault();
      this.syncKeys();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.syncKeys();
    });
    // Kehilangan fokus / aplikasi ke latar / layar diputar: bersihkan semua status agar tidak ada tombol/joystick "tersangkut"
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => document.hidden && this.reset());
    window.addEventListener('orientationchange', () => this.reset());
    screen.orientation?.addEventListener?.('change', () => this.reset());
  }

  private syncKeys() {
    if (this.joyId !== null) return;
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    this.moveX = x / len;
    this.moveY = y / len;
    this.run = k.has('ShiftLeft') || k.has('ShiftRight') || this.runToggle;
    this.jump = k.has('Space') || this.jumpHeld || this.jumpPendingUntil > 0;
    this.dive = k.has('KeyC') || k.has('ControlLeft');
  }

  private bindPointer() {
    const s = this.surface;
    let mouseDrag = false;
    let last = { x: 0, y: 0 };
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    s.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        mouseDrag = true;
        last = { x: e.clientX, y: e.clientY };
        s.setPointerCapture(e.pointerId);
        return;
      }
      // Sentuh: 45% kiri layar = joystick (area bebas tombol), sisanya = kamera
      if (e.clientX < window.innerWidth * 0.45 && this.joyId === null) {
        this.joyId = e.pointerId;
        this.joyStart = { x: e.clientX, y: e.clientY };
        this.joyBase.style.left = `${e.clientX}px`;
        this.joyBase.style.top = `${e.clientY}px`;
        this.joyBase.classList.add('active');
        this.joyKnob.style.transform = 'translate(-50%, -50%)';
      } else {
        this.camTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.camTouches.size === 2) this.pinchDist = this.touchDist();
      }
      s.setPointerCapture(e.pointerId);
    });
    s.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (!mouseDrag) return;
        this.camYaw -= (e.clientX - last.x) * 0.006;
        this.camPitch = clamp(this.camPitch + (e.clientY - last.y) * 0.004, -0.6, 0.9);
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.pointerId === this.joyId) {
        const R = 56;
        let dx = e.clientX - this.joyStart.x;
        let dy = e.clientY - this.joyStart.y;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          dx = (dx / d) * R;
          dy = (dy / d) * R;
        }
        this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const m = Math.min(1, d / R);
        const a = Math.atan2(dy, dx);
        this.moveX = Math.cos(a) * (m < 0.15 ? 0 : m);
        this.moveY = -Math.sin(a) * (m < 0.15 ? 0 : m);
        this.run = this.runToggle || m > 0.95;
        return;
      }
      const prev = this.camTouches.get(e.pointerId);
      if (!prev) return;
      if (this.camTouches.size >= 2) {
        this.camTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const d = this.touchDist();
        this.zoom += (this.pinchDist - d) * 0.03;
        this.pinchDist = d;
        return;
      }
      this.camYaw -= (e.clientX - prev.x) * 0.008;
      this.camPitch = clamp(this.camPitch + (e.clientY - prev.y) * 0.005, -0.6, 0.9);
      this.camTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const end = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        mouseDrag = false;
        return;
      }
      if (e.pointerId === this.joyId) {
        this.joyId = null;
        this.moveX = 0;
        this.moveY = 0;
        this.run = this.runToggle;
        this.joyBase.classList.remove('active');
        this.syncKeys();
      }
      this.camTouches.delete(e.pointerId);
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    // Pointer capture hilang (modal muncul, elemen berganti, sistem membatalkan) → akhiri sentuhan itu
    s.addEventListener('lostpointercapture', end);
    s.addEventListener(
      'wheel',
      (e) => {
        this.zoom += e.deltaY * 0.01;
      },
      { passive: true },
    );
  }

  private touchDist() {
    const p = [...this.camTouches.values()];
    return p.length >= 2 ? Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y) : 0;
  }

  // Tombol Lompat sentuh: ketukan singkat bisa dimulai & selesai di antara dua frame, atau jatuh tepat saat kaki
  // sesaat tidak menapak (turun trotoar, frame lambat). "Jump buffer" 150 ms memastikan ketukan tetap terbaca.
  private jumpHeld = false;
  private jumpPendingUntil = 0;
  /** Tekan/lepas tombol Lompat di layar. Ketukan tetap aktif ±150 ms walau jari sudah diangkat. */
  pressJump(down: boolean) {
    this.jumpHeld = down;
    if (down) this.jumpPendingUntil = performance.now() + 150;
    this.jump = this.jumpHeld || this.jumpPendingUntil > 0 || this.keys.has('Space');
  }
  /** Dipanggil sekali di akhir setiap frame (setelah fisika membaca masukan). */
  endFrame() {
    if (this.jumpPendingUntil && !this.jumpHeld && performance.now() >= this.jumpPendingUntil) {
      this.jumpPendingUntil = 0;
      this.jump = this.keys.has('Space');
    }
  }

  setRunToggle(v: boolean) {
    this.runToggle = v;
    this.run = v || this.keys.has('ShiftLeft');
  }

  /** Bersihkan SELURUH status masukan: tombol, joystick, sentuhan kamera, cubit, delta kamera/zoom. */
  reset() {
    this.moveX = 0;
    this.moveY = 0;
    this.jump = false;
    this.dive = false;
    this.run = this.runToggle;
    this.camYaw = 0;
    this.camPitch = 0;
    this.zoom = 0;
    this.keys.clear();
    if (this.joyId !== null) {
      try {
        if (this.surface.hasPointerCapture(this.joyId)) this.surface.releasePointerCapture(this.joyId);
      } catch {
        /* pointer sudah tidak ada */
      }
    }
    this.joyId = null;
    this.camTouches.clear();
    this.pinchDist = 0;
    this.jumpHeld = false;
    this.jumpPendingUntil = 0;
    this.joyBase.classList.remove('active');
    this.joyKnob.style.transform = 'translate(-50%, -50%)';
  }

  /** Aktifkan/nonaktifkan kontrol pemain. Selalu mereset status agar tidak ada sentuhan lama yang tersangkut. */
  setEnabled(on: boolean) {
    this.enabled = on;
    this.reset();
  }

  /** Status ringkas untuk uji otomatis. */
  debugState() {
    return { enabled: this.enabled, joy: this.joyId !== null, camTouches: this.camTouches.size, moveX: this.moveX, moveY: this.moveY };
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
