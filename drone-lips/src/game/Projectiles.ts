import * as THREE from 'three';

import { clamp } from './math';

export class LaserShot {
  active = false;
  ttl = 0;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, ttl: number) {
    this.active = true;
    this.ttl = ttl;
    this.pos.copy(pos);
    this.vel.copy(vel);
  }

  update(dt: number) {
    if (!this.active) return;
    this.ttl -= dt;
    if (this.ttl <= 0) {
      this.active = false;
      return;
    }
    this.pos.addScaledVector(this.vel, dt);
  }
}

export class MissileShot {
  active = false;
  ttl = 0;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();

  spawn(pos: THREE.Vector3, initialVel: THREE.Vector3, ttl: number) {
    this.active = true;
    this.ttl = ttl;
    this.pos.copy(pos);
    this.vel.copy(initialVel);
  }

  update(dt: number, targetPos: THREE.Vector3 | null, turnRate: number) {
    if (!this.active) return;
    this.ttl -= dt;
    if (this.ttl <= 0) {
      this.active = false;
      return;
    }

    if (targetPos) {
      const desiredDir = targetPos.clone().sub(this.pos);
      const len = desiredDir.length();
      if (len > 1e-6) {
        desiredDir.multiplyScalar(1 / len);
        const currentDir = this.vel.clone().normalize();
        const t = clamp(turnRate * dt, 0, 1);
        const newDir = currentDir.lerp(desiredDir, t).normalize();
        const speed = this.vel.length();
        this.vel.copy(newDir.multiplyScalar(speed));
      }
    }

    this.pos.addScaledVector(this.vel, dt);
  }
}

