import * as THREE from 'three';

import { clamp } from './math';

export type DroneFlipAxis = 'x' | 'z';

export type DroneUpdateInput = {
  timeMs: number;
  strafeX: number; // -1..1
  strafeY: number; // -1..1
  speed: number; // world speed (for glow)
};

export class Drone {
  readonly group: THREE.Group;
  readonly position: THREE.Vector3;

  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  private readonly thrusterLights: THREE.PointLight[] = [];
  private readonly thrusterGlowMats: THREE.MeshBasicMaterial[] = [];
  private flip: { axis: DroneFlipAxis; dir: 1 | -1; t: number; duration: number } | null = null;

  constructor() {
    this.group = new THREE.Group();
    this.position = this.group.position;

    const metal = new THREE.MeshStandardMaterial({
      color: '#aeb8c6',
      metalness: 0.78,
      roughness: 0.28,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: '#14161b',
      metalness: 0.55,
      roughness: 0.62,
    });
    const panel = new THREE.MeshStandardMaterial({
      color: '#232733',
      metalness: 0.25,
      roughness: 0.8,
    });
    const core = new THREE.MeshStandardMaterial({
      color: '#e8edf5',
      emissive: '#b8c2d0',
      emissiveIntensity: 0.18,
      metalness: 0.92,
      roughness: 0.14,
    });

    this.materials.push(metal, dark, panel, core);

    const wingFrameGeo = new THREE.BoxGeometry(2.9, 4.25, 0.14);
    const wingPanelGeo = new THREE.BoxGeometry(2.55, 3.9, 0.08);
    const barGeo = new THREE.CylinderGeometry(0.11, 0.11, 6.2, 18, 1, false);
    const coreGeo = new THREE.SphereGeometry(0.55, 32, 32);
    const ringGeo = new THREE.TorusGeometry(0.66, 0.1, 12, 28);

    this.geometries.push(wingFrameGeo, wingPanelGeo, barGeo, coreGeo, ringGeo);

    const leftWingFrame = new THREE.Mesh(wingFrameGeo, metal);
    leftWingFrame.position.set(-3.05, 0, -0.1);
    this.group.add(leftWingFrame);

    const rightWingFrame = new THREE.Mesh(wingFrameGeo, metal);
    rightWingFrame.position.set(3.05, 0, -0.1);
    this.group.add(rightWingFrame);

    const leftWingPanel = new THREE.Mesh(wingPanelGeo, panel);
    leftWingPanel.position.set(-3.05, 0, 0.02);
    this.group.add(leftWingPanel);

    const rightWingPanel = new THREE.Mesh(wingPanelGeo, panel);
    rightWingPanel.position.set(3.05, 0, 0.02);
    this.group.add(rightWingPanel);

    const bar = new THREE.Mesh(barGeo, dark);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0, 0);
    this.group.add(bar);

    const center = new THREE.Mesh(coreGeo, core);
    center.position.set(0, 0, 0);
    this.group.add(center);

    const ring = new THREE.Mesh(ringGeo, dark);
    ring.rotation.y = Math.PI / 2;
    ring.position.z = 0.06;
    this.group.add(ring);

    const lightPositions: Array<[number, number, number]> = [
      [0.25, -0.18, -0.45],
      [-0.25, -0.18, -0.45],
      [0, 0.12, -0.48],
    ];

    for (const p of lightPositions) {
      const l = new THREE.PointLight('#ffff66', 2.0, 7, 2);
      l.position.set(p[0], p[1], p[2]);
      this.group.add(l);
      this.thrusterLights.push(l);

      const glowGeo = new THREE.SphereGeometry(0.09, 12, 12);
      const glowMat = new THREE.MeshBasicMaterial({
        color: '#ffe36a',
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.geometries.push(glowGeo);
      this.materials.push(glowMat);
      this.thrusterGlowMats.push(glowMat);

      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(p[0], p[1], p[2]);
      this.group.add(glow);
    }
  }

  triggerFlip(axis: DroneFlipAxis, dir: 1 | -1 = 1) {
    this.flip = { axis, dir, t: 0, duration: 0.38 };
  }

  update(dt: number, input: DroneUpdateInput) {
    const tiltX = clamp(-input.strafeY * 0.35, -0.45, 0.45);
    const tiltZ = clamp(-input.strafeX * 0.35, -0.45, 0.45);

    let flipX = 0;
    let flipZ = 0;

    if (this.flip) {
      this.flip.t += dt;
      const p = Math.min(1, this.flip.t / this.flip.duration);
      const eased = p * (2 - p);
      const a = this.flip.dir * Math.PI * 2 * eased;

      if (this.flip.axis === 'x') flipX = a;
      if (this.flip.axis === 'z') flipZ = a;

      if (p >= 1) this.flip = null;
    }

    this.group.rotation.set(tiltX + flipX, 0, tiltZ + flipZ);

    const speedT = clamp(input.speed / 18, 0, 1);
    const flicker = 0.9 + 0.1 * Math.sin(input.timeMs * 0.02);
    const intensity = (1.2 + speedT * 2.0) * flicker;
    for (const l of this.thrusterLights) l.intensity = intensity;

    const glowOpacity = 0.45 + speedT * 0.4;
    for (const m of this.thrusterGlowMats) m.opacity = glowOpacity;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
