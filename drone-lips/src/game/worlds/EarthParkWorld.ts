import * as THREE from 'three';

import type { EnemySpawnBounds } from '../Enemy';
import type { LevelConfig } from '../levels';
import { randRange } from '../math';

import type { World, WorldInitArgs, WorldPlayerBounds, WorldUpdateArgs, WorldUpdateResult } from './World';

type GroundTile = {
  mesh: THREE.Mesh;
  z: number;
};

type Tree = {
  pos: THREE.Vector3; // base position (y == groundY)
  rotY: number;
  scale: number;
  radius: number;
};

type Pickup = {
  pos: THREE.Vector3;
  rot: THREE.Euler;
  spin: number;
  radius: number;
};

const GROUND_Y = -6.5;
const TILE_LENGTH = 90;
const TILE_COUNT = 3;

const WORLD_Z_SPAWN_MIN = 55;
const WORLD_Z_SPAWN_MAX = 200;
const WORLD_Z_BEHIND = -32;

function computeTreeCount(level: LevelConfig): number {
  const density = Math.max(0, Math.min(1, level.obstacleDensity));
  const base = Math.round(10 + density * 40);
  return Math.max(12, Math.min(80, base));
}

function computePickupPoolSize(level: LevelConfig): number {
  const est = Math.round(level.pickupRate * 14 + 4);
  return Math.max(6, Math.min(26, est));
}

export class EarthParkWorld implements World {
  readonly environment: World['environment'];
  readonly level: LevelConfig;

  readonly playerBounds: WorldPlayerBounds = { xMin: -7, xMax: 7, yMin: -3.5, yMax: 6 };
  readonly enemySpawnBounds: EnemySpawnBounds = { xRange: 8, yRange: 4.5, zMin: 95, zMax: 165 };
  readonly behindZ = WORLD_Z_BEHIND;

  private readonly scene: THREE.Scene;
  private readonly isIOS: boolean;

  private readonly root = new THREE.Group();

  private groundTiles: GroundTile[] = [];
  private groundGeo: THREE.BufferGeometry | null = null;
  private groundMat: THREE.Material | null = null;

  private trunkMesh: THREE.InstancedMesh | null = null;
  private foliageMesh: THREE.InstancedMesh | null = null;
  private trunkGeo: THREE.BufferGeometry | null = null;
  private trunkMat: THREE.Material | null = null;
  private foliageGeo: THREE.BufferGeometry | null = null;
  private foliageMat: THREE.Material | null = null;

  private trees: { items: Tree[]; temp: THREE.Object3D; count: number } | null = null;

  private pickupMesh: THREE.InstancedMesh | null = null;
  private pickupGeo: THREE.BufferGeometry | null = null;
  private pickupMat: THREE.Material | null = null;
  private pickups: { items: Pickup[]; temp: THREE.Object3D; count: number } | null = null;

  constructor(args: WorldInitArgs) {
    this.environment = args.level.environment;
    this.level = args.level;
    this.scene = args.scene;
    this.isIOS = args.isIOS;
  }

  create() {
    this.scene.add(this.root);

    const sky = new THREE.Color('#8fd9ff');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 18, 180);

    const groundGeo = new THREE.PlaneGeometry(60, TILE_LENGTH, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: '#2fb35a',
      metalness: 0.05,
      roughness: 0.95,
    });
    this.groundGeo = groundGeo;
    this.groundMat = groundMat;

    for (let i = 0; i < TILE_COUNT; i += 1) {
      const mesh = new THREE.Mesh(groundGeo, groundMat);
      mesh.position.y = GROUND_Y;
      mesh.position.z = i * TILE_LENGTH;
      mesh.receiveShadow = false;
      this.root.add(mesh);
      this.groundTiles.push({ mesh, z: mesh.position.z });
    }

    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.6, 6, 1, false);
    trunkGeo.translate(0, 0.8, 0);
    const foliageGeo = new THREE.ConeGeometry(0.65, 1.8, 8, 1, false);
    foliageGeo.translate(0, 2.5, 0);

    const trunkMat = new THREE.MeshStandardMaterial({
      color: '#6b4a2e',
      metalness: 0.05,
      roughness: 0.95,
    });
    const foliageMat = new THREE.MeshStandardMaterial({
      color: '#1e8f3a',
      emissive: '#0a2b12',
      emissiveIntensity: 0.25,
      metalness: 0.05,
      roughness: 0.9,
    });

    this.trunkGeo = trunkGeo;
    this.foliageGeo = foliageGeo;
    this.trunkMat = trunkMat;
    this.foliageMat = foliageMat;

    const treeCount = this.isIOS ? Math.round(computeTreeCount(this.level) * 0.82) : computeTreeCount(this.level);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    trunkMesh.frustumCulled = false;
    const foliageMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
    foliageMesh.frustumCulled = false;
    this.root.add(trunkMesh);
    this.root.add(foliageMesh);
    this.trunkMesh = trunkMesh;
    this.foliageMesh = foliageMesh;

    const temp = new THREE.Object3D();
    const trees: Tree[] = Array.from({ length: treeCount }, () => ({
      pos: new THREE.Vector3(0, GROUND_Y, randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX)),
      rotY: Math.random() * Math.PI * 2,
      scale: randRange(0.85, 1.35),
      radius: 0.8,
    }));
    for (const t of trees) {
      t.pos.x = randRange(this.playerBounds.xMin - 3, this.playerBounds.xMax + 3);
      t.radius = 0.65 * t.scale;
    }
    this.trees = { items: trees, temp, count: treeCount };

    const pickupCount = this.isIOS ? Math.round(computePickupPoolSize(this.level) * 0.9) : computePickupPoolSize(this.level);
    const pickupGeo = new THREE.OctahedronGeometry(0.55, 0);
    const pickupMat = new THREE.MeshStandardMaterial({
      color: '#ff4fb8',
      emissive: '#ff4fb8',
      emissiveIntensity: 1.4,
      metalness: 0.35,
      roughness: 0.25,
    });
    const pickupMesh = new THREE.InstancedMesh(pickupGeo, pickupMat, pickupCount);
    pickupMesh.frustumCulled = false;
    this.root.add(pickupMesh);
    this.pickupMesh = pickupMesh;
    this.pickupGeo = pickupGeo;
    this.pickupMat = pickupMat;

    const pickupTemp = new THREE.Object3D();
    const pickups: Pickup[] = Array.from({ length: pickupCount }, () => ({
      pos: new THREE.Vector3(
        randRange(this.playerBounds.xMin, this.playerBounds.xMax),
        randRange(-1.5, 4.5),
        randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX),
      ),
      rot: new THREE.Euler(0, 0, 0),
      spin: randRange(0.8, 2.0),
      radius: 0.55,
    }));
    this.pickups = { items: pickups, temp: pickupTemp, count: pickupCount };

    this.reset(new THREE.Vector3(0, 0, 0));
  }

  reset(_playerPos: THREE.Vector3) {
    for (let i = 0; i < this.groundTiles.length; i += 1) {
      const t = this.groundTiles[i];
      t.z = i * TILE_LENGTH;
      t.mesh.position.z = t.z;
    }

    if (this.trees) {
      for (const t of this.trees.items) {
        t.pos.set(
          randRange(this.playerBounds.xMin - 3, this.playerBounds.xMax + 3),
          GROUND_Y,
          randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX),
        );
        t.rotY = Math.random() * Math.PI * 2;
        t.scale = randRange(0.85, 1.35);
        t.radius = 0.65 * t.scale;
      }
    }

    if (this.pickups) {
      for (const p of this.pickups.items) {
        p.pos.set(
          randRange(this.playerBounds.xMin, this.playerBounds.xMax),
          randRange(-1.5, 4.5),
          randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX),
        );
        p.rot.set(0, 0, 0);
        p.spin = randRange(0.8, 2.0);
      }
    }

    this.renderInstances();
  }

  update(args: WorldUpdateArgs): WorldUpdateResult {
    const speed = args.speed;
    const dt = args.dt;

    // Scroll ground tiles
    if (this.groundTiles.length) {
      for (const t of this.groundTiles) {
        t.z -= speed * dt;
        if (t.z < WORLD_Z_BEHIND - TILE_LENGTH * 0.5) {
          t.z += TILE_LENGTH * TILE_COUNT;
        }
        t.mesh.position.z = t.z;
      }
    }

    if (this.trees) {
      for (const t of this.trees.items) {
        t.pos.z -= speed * dt;
        if (t.pos.z < WORLD_Z_BEHIND) {
          t.pos.x = randRange(this.playerBounds.xMin - 3, this.playerBounds.xMax + 3);
          t.pos.z = randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX);
          t.rotY = Math.random() * Math.PI * 2;
          t.scale = randRange(0.85, 1.35);
          t.radius = 0.65 * t.scale;
        }

        // Collision: approximate tree as a sphere around the trunk / lower canopy.
        const cx = t.pos.x;
        const cy = t.pos.y + 1.3 * t.scale;
        const cz = t.pos.z;
        const dx = cx - args.playerPos.x;
        const dy = cy - args.playerPos.y;
        const dz = cz - args.playerPos.z;
        const r = args.playerRadius + t.radius;
        if (dx * dx + dy * dy + dz * dz < r * r) return { hit: true };
      }
    }

    if (this.pickups) {
      for (const p of this.pickups.items) {
        p.pos.z -= speed * dt;
        p.rot.y += p.spin * dt;
        p.rot.x += p.spin * 0.35 * dt;
        if (p.pos.z < WORLD_Z_BEHIND) {
          p.pos.set(
            randRange(this.playerBounds.xMin, this.playerBounds.xMax),
            randRange(-1.5, 4.5),
            randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX),
          );
        }

        const dx = p.pos.x - args.playerPos.x;
        const dy = p.pos.y - args.playerPos.y;
        const dz = p.pos.z - args.playerPos.z;
        const r = args.playerRadius + p.radius;
        if (dx * dx + dy * dy + dz * dz < r * r) {
          args.onCollectPickup(1);
          p.pos.set(
            randRange(this.playerBounds.xMin, this.playerBounds.xMax),
            randRange(-1.5, 4.5),
            randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX),
          );
        }
      }
    }

    this.renderInstances();
    return { hit: false };
  }

  private renderInstances() {
    const temp = this.trees?.temp;
    const trunkMesh = this.trunkMesh;
    const foliageMesh = this.foliageMesh;

    if (temp && trunkMesh && foliageMesh && this.trees) {
      for (let i = 0; i < this.trees.items.length; i += 1) {
        const t = this.trees.items[i];
        temp.position.copy(t.pos);
        temp.rotation.set(0, t.rotY, 0);
        temp.scale.setScalar(t.scale);
        temp.updateMatrix();
        trunkMesh.setMatrixAt(i, temp.matrix);
        foliageMesh.setMatrixAt(i, temp.matrix);
      }
      trunkMesh.instanceMatrix.needsUpdate = true;
      foliageMesh.instanceMatrix.needsUpdate = true;
    }

    const pickups = this.pickups;
    const pickupMesh = this.pickupMesh;
    if (pickups && pickupMesh) {
      for (let i = 0; i < pickups.items.length; i += 1) {
        const p = pickups.items[i];
        pickups.temp.position.copy(p.pos);
        pickups.temp.rotation.copy(p.rot);
        pickups.temp.scale.setScalar(1);
        pickups.temp.updateMatrix();
        pickupMesh.setMatrixAt(i, pickups.temp.matrix);
      }
      pickupMesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.scene.remove(this.root);

    for (const t of this.groundTiles) this.root.remove(t.mesh);
    this.groundTiles = [];
    this.groundGeo?.dispose();
    this.groundGeo = null;
    (this.groundMat as any)?.dispose?.();
    this.groundMat = null;

    this.trunkGeo?.dispose();
    this.trunkGeo = null;
    (this.trunkMat as any)?.dispose?.();
    this.trunkMat = null;
    this.foliageGeo?.dispose();
    this.foliageGeo = null;
    (this.foliageMat as any)?.dispose?.();
    this.foliageMat = null;

    this.trunkMesh = null;
    this.foliageMesh = null;
    this.trees = null;

    this.pickupGeo?.dispose();
    this.pickupGeo = null;
    (this.pickupMat as any)?.dispose?.();
    this.pickupMat = null;
    this.pickupMesh = null;
    this.pickups = null;

    this.root.clear();

    // Reset fog/background to a sane default. The next world will override these anyway.
    this.scene.fog = null;
  }
}
