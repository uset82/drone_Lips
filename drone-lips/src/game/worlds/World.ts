import type * as THREE from 'three';

import type { EnemySpawnBounds } from '../Enemy';
import type { Environment, LevelConfig } from '../levels';

export type WorldPlayerBounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export type WorldUpdateArgs = {
  dt: number;
  nowMs: number;
  speed: number;
  playerPos: THREE.Vector3;
  playerRadius: number;
  onCollectPickup: (count: number) => void;
};

export type WorldUpdateResult = {
  hit: boolean;
};

export type WorldInitArgs = {
  scene: THREE.Scene;
  isIOS: boolean;
  level: LevelConfig;
};

export interface World {
  readonly environment: Environment;
  readonly level: LevelConfig;
  readonly playerBounds: WorldPlayerBounds;
  readonly enemySpawnBounds: EnemySpawnBounds;
  readonly behindZ: number;

  create(): void;
  reset(playerPos: THREE.Vector3): void;
  update(args: WorldUpdateArgs): WorldUpdateResult;
  dispose(): void;
}

