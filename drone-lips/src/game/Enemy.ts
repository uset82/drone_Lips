import * as THREE from 'three';

import { clamp, randRange } from './math';

export type EnemyKind = 'ship' | 'spike';

export type EnemySpawnBounds = {
  xRange: number;
  yRange: number;
  zMin: number;
  zMax: number;
};

export type EnemyConfig = {
  kind: EnemyKind;
  hp: number;
  radius: number;
  approachSpeed: number;
  reward: number;
};

export class Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly mesh: THREE.Object3D;

  readonly radius: number;
  readonly reward: number;
  readonly approachSpeed: number;

  private readonly maxHp: number;
  hp: number;
  alive = true;

  constructor(id: number, kind: EnemyKind, mesh: THREE.Object3D, cfg: EnemyConfig) {
    this.id = id;
    this.kind = kind;
    this.mesh = mesh;
    this.maxHp = Math.max(1, Math.floor(cfg.hp));
    this.hp = this.maxHp;
    this.radius = Math.max(0.2, cfg.radius);
    this.approachSpeed = Math.max(1, cfg.approachSpeed);
    this.reward = Math.max(1, Math.floor(cfg.reward));
  }

  spawn(bounds: EnemySpawnBounds, playerY: number) {
    this.alive = true;
    this.hp = this.maxHp;

    this.mesh.position.set(
      randRange(-bounds.xRange, bounds.xRange),
      randRange(-bounds.yRange, bounds.yRange) + playerY * 0.25,
      randRange(bounds.zMin, bounds.zMax),
    );

    this.mesh.rotation.set(0, 0, 0);
    this.mesh.scale.setScalar(1);
    this.mesh.visible = true;
  }

  update(dt: number, worldSpeed: number, playerPos: THREE.Vector3, timeMs: number) {
    if (!this.alive) return;

    // Move towards player along Z (player at z=0). World speed pulls everything towards the player.
    this.mesh.position.z -= (worldSpeed + this.approachSpeed) * dt;

    // Slight steering towards player (feels like it's attacking).
    this.mesh.position.x = THREE.MathUtils.lerp(this.mesh.position.x, playerPos.x, 1 - Math.exp(-0.8 * dt));
    this.mesh.position.y = THREE.MathUtils.lerp(this.mesh.position.y, playerPos.y, 1 - Math.exp(-0.8 * dt));

    // Subtle wobble for life
    const wobble = Math.sin(timeMs * 0.0015 + this.id) * 0.15;
    this.mesh.rotation.z = wobble;
  }

  isOutOfRange(zBehind: number) {
    return this.mesh.position.z < zBehind;
  }

  takeDamage(amount: number) {
    if (!this.alive) return;
    this.hp = clamp(this.hp - Math.max(1, Math.floor(amount)), 0, this.maxHp);
    if (this.hp <= 0) {
      this.alive = false;
      this.mesh.visible = false;
    }
  }
}

