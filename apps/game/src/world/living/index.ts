/**
 * LivingCity — semua isi dinamis Dunia Kota yang dirender di klien:
 * lalu lintas NPC, pejalan kaki, lampu lalu lintas, pedagang, lubang dimensi, kendaraan parkir.
 * Dibuat oleh Stage saat Dunia Kota dimuat (mode kelas & Mode Demo memakai kode yang sama).
 */
import * as THREE from 'three';
import type { LivingLayout } from '@eduverse/shared';
import { TrafficSystem } from './traffic.js';
import { VendorSystem } from './vendors.js';
import { RiftSystem } from './rifts.js';
import { ParkedVehicles } from './vehicles.js';
import type { QualityProfile } from '../../engine/quality.js';

export class LivingCity {
  readonly traffic: TrafficSystem;
  readonly vendors: VendorSystem;
  readonly rifts: RiftSystem;
  readonly parked: ParkedVehicles;
  private jetStations: THREE.Group;

  constructor(
    scene: THREE.Scene,
    readonly layout: LivingLayout,
  ) {
    this.traffic = new TrafficSystem(scene, layout);
    this.vendors = new VendorSystem(scene, layout.vendors);
    this.rifts = new RiftSystem(scene, layout.rifts, (id) => layout.rifts.find((r) => r.id === id)?.nama ?? '');
    this.parked = new ParkedVehicles(scene);
    // Jetpack contoh berputar di atas tiap stasiun
    this.jetStations = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xff8a3d });
    const metal = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
    for (const j of layout.jetpacks) {
      const g = new THREE.Group();
      g.position.set(j.x, j.y + 1.3, j.z);
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.3), metal);
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.26), mat);
      l.position.set(-0.2, 0, -0.2);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.26), mat);
      r.position.set(0.2, 0, -0.2);
      g.add(a, l, r);
      this.jetStations.add(g);
    }
    scene.add(this.jetStations);
  }

  applyQuality(p: QualityProfile) {
    this.traffic.setQuality(p.level);
    this.vendors.viewDistance = p.level === 'rendah' ? 70 : p.level === 'sedang' ? 100 : 140;
    this.parked.viewDistance = p.level === 'rendah' ? 140 : 220;
    this.rifts.particleScale = p.particles;
  }

  update(dt: number, t: number, px: number, pz: number, serverNowMs: number) {
    this.traffic.update(dt, px, pz, serverNowMs / 1000);
    this.vendors.update(dt, px, pz, t);
    this.rifts.update(dt, px, pz);
    this.parked.update(dt, px, pz);
    for (const g of this.jetStations.children) {
      g.rotation.y += dt * 1.2;
      g.position.y += Math.sin(t * 2 + g.position.x) * 0.002;
    }
  }

  dispose() {
    this.traffic.dispose();
    this.vendors.dispose();
    this.rifts.dispose();
    this.parked.dispose();
    this.jetStations.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.jetStations.removeFromParent();
  }
}
