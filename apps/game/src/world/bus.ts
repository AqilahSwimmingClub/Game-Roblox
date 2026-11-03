/**
 * Bus Kota: posisinya dihitung deterministik dari waktu server (busPosition di paket shared),
 * sehingga semua siswa melihat bus yang sama tanpa lalu lintas jaringan tambahan.
 * Siswa bisa naik (tombol Aksi di dekat bus) dan turun (Aksi/Lompat).
 */
import * as THREE from 'three';
import { busPosition } from '@eduverse/shared';
import { makeLabelSprite } from '../engine/signs.js';

export class Bus {
  readonly mesh = new THREE.Group();
  x = 0;
  z = 0;
  heading = 0;
  stopped = false;

  constructor(scene: THREE.Scene) {
    const add = (w: number, h: number, d: number, c: number, y: number, z = 0, basic = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic ? new THREE.MeshBasicMaterial({ color: c }) : new THREE.MeshLambertMaterial({ color: c }));
      m.position.set(0, y, z);
      m.castShadow = true;
      this.mesh.add(m);
      return m;
    };
    add(2.8, 0.3, 9, 0x5d6678, 0.75);
    add(2.8, 2.2, 9, 0xff8a3d, 2);
    add(2.84, 0.9, 7.6, 0xbfe6ff, 2.4, -0.3);
    add(2.9, 0.3, 9.2, 0xf4f8ff, 3.25);
    add(2.4, 0.4, 0.06, 0xffc93c, 2.9, 4.53, true);
    for (const z of [-3, 3])
      for (const x of [-1.45, 1.45]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1e2a4a }));
        w.position.set(x, 0.5, z);
        this.mesh.add(w);
      }
    const label = makeLabelSprite('BUS KOTA', { bg: '#FFC93C', border: '#ffffff', scale: 0.013 });
    label.position.y = 4.2;
    this.mesh.add(label);
    scene.add(this.mesh);
  }

  update(serverNowMs: number) {
    const p = busPosition(serverNowMs);
    this.x = p.x;
    this.z = p.z;
    this.heading = p.heading;
    this.stopped = p.stopped;
    this.mesh.position.set(p.x, 0, p.z);
    this.mesh.rotation.y = p.heading;
  }

  /** Posisi kursi penumpang (dunia). */
  seat(): { x: number; y: number; z: number } {
    const back = -1.5;
    return { x: this.x + Math.sin(this.heading) * back, y: 1.0, z: this.z + Math.cos(this.heading) * back };
  }

  dispose() {
    this.mesh.removeFromParent();
  }
}
