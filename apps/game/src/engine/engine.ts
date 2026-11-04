/** Inti engine 3D: renderer WebGL, scene, kamera, cahaya, kabut, dan loop frame. */
import * as THREE from 'three';
import { FpsGovernor, detectLevel, loadQualitySetting, profileFor, saveQualitySetting, type QualityLevel, type QualityProfile, type QualitySetting } from './quality.js';

export type FrameFn = (dt: number, t: number) => void;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  readonly hemi = new THREE.HemisphereLight(0xcfe8ff, 0x7ccb6b, 1.25);
  quality: QualitySetting;
  profile: QualityProfile;
  private frameFns = new Set<FrameFn>();
  private qualityListeners = new Set<(p: QualityProfile) => void>();
  private governor = new FpsGovernor();
  private last = performance.now();
  private running = false;
  readonly clock = { t: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.quality = loadQualitySetting();
    this.profile = profileFor(this.quality === 'otomatis' ? detectLevel() : this.quality);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.profile.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x9fd8ff);
    this.scene.fog = new THREE.Fog(0xcfe8ff, 60, this.profile.fogFar);
    this.sun.position.set(60, 120, 40);
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 10;
    sc.far = 300;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.applyProfile();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private applyProfile() {
    const p = this.profile;
    this.renderer.setPixelRatio(p.pixelRatio);
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    (this.scene.fog as THREE.Fog).far = p.fogFar;
    (this.scene.fog as THREE.Fog).near = Math.min(60, p.fogFar * 0.3);
    this.camera.far = p.fogFar + 40;
    this.camera.updateProjectionMatrix();
    for (const l of this.qualityListeners) l(p);
  }

  setQuality(q: QualitySetting) {
    this.quality = q;
    saveQualitySetting(q);
    this.profile = profileFor(q === 'otomatis' ? detectLevel() : q);
    this.applyProfile();
    this.resize();
  }

  onQuality(fn: (p: QualityProfile) => void) {
    this.qualityListeners.add(fn);
    return () => this.qualityListeners.delete(fn);
  }

  get level(): QualityLevel {
    return this.profile.level;
  }

  get fps(): number {
    return this.governor.fps;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.fov = w < h ? 72 : 60; // potret: pandang lebih lebar
    this.camera.updateProjectionMatrix();
  }

  onFrame(fn: FrameFn) {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }

  /** Bayangan matahari mengikuti pemain agar peta bayangan kecil tetap tajam. */
  followSun(x: number, y: number, z: number) {
    this.sun.position.set(x + 40, y + 90, z + 30);
    this.sun.target.position.set(x, y, z);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const now = performance.now();
      // batas 0,2 dtk: di perangkat lemah (< 10 fps) karakter tetap berjalan dengan kecepatan nyata;
      // fisika memecah gerak per 0,3 m sehingga tidak menembus dinding
      const dt = Math.min(0.2, (now - this.last) / 1000);
      this.last = now;
      this.clock.t += dt;
      if (document.hidden) return;
      for (const fn of this.frameFns) fn(dt, this.clock.t);
      this.renderer.render(this.scene, this.camera);
      if (this.quality === 'otomatis' && this.governor.tick(dt) === 'turun' && this.profile.level !== 'rendah') {
        this.profile = profileFor(this.profile.level === 'tinggi' ? 'sedang' : 'rendah');
        this.applyProfile();
      } else if (this.quality !== 'otomatis') this.governor.tick(dt);
    };
    requestAnimationFrame(loop);
  }
}
