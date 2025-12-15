import * as THREE from 'three';

import type { EnemySpawnBounds } from '../Enemy';
import type { LevelConfig } from '../levels';
import { randRange } from '../math';

import type { World, WorldInitArgs, WorldPlayerBounds, WorldUpdateArgs, WorldUpdateResult } from './World';

type Asteroid = {
  pos: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  scale: number;
  radius: number;
};

type Pickup = {
  pos: THREE.Vector3;
  rot: THREE.Euler;
  spin: number;
  radius: number;
};

const WORLD_Z_SPAWN_MIN = 70;
const WORLD_Z_SPAWN_MAX = 220;
const WORLD_Z_BEHIND = -28;

const ASTEROID_FIELD_X = 18;
const ASTEROID_FIELD_Y = 10;
const SAFE_LANE_X = 3.4;
const SAFE_LANE_Y = 2.4;

function randomLanePos(rangeX: number, rangeY: number) {
  // Keep a readable center lane by biasing spawns away from the middle.
  for (let i = 0; i < 6; i += 1) {
    const x = randRange(-rangeX, rangeX);
    const y = randRange(-rangeY, rangeY);
    if (Math.abs(x) > SAFE_LANE_X || Math.abs(y) > SAFE_LANE_Y) return { x, y };
  }
  // Fallback: shove out of the lane.
  const x = (Math.random() < 0.5 ? -1 : 1) * randRange(SAFE_LANE_X, rangeX);
  const y = (Math.random() < 0.5 ? -1 : 1) * randRange(SAFE_LANE_Y, rangeY);
  return { x, y };
}

function createStarfield(isIOS: boolean) {
  const count = isIOS ? 6500 : 10_000;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    // Keep stars far enough so they don't appear as huge "snow" blobs on mobile.
    const r = randRange(180, 260);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    const idx = i * 3;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: isIOS ? 0.82 : 1.0 },
      uMaxSize: { value: isIOS ? 2.2 : 3.2 },
    },
    vertexShader: `
      attribute float aPhase;
      uniform float uTime;
      uniform float uSize;
      uniform float uMaxSize;
      varying float vTwinkle;
      void main() {
        vTwinkle = 0.55 + 0.45 * sin(uTime * 1.6 + aPhase);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float size = uSize * (260.0 / -mvPosition.z);
        gl_PointSize = clamp(size, 0.0, uMaxSize);
      }
    `,
    fragmentShader: `
      varying float vTwinkle;
      void main() {
        vec2 uv = gl_PointCoord.xy - 0.5;
        float d = length(uv);
        float alpha = smoothstep(0.5, 0.0, d) * (0.65 + 0.35 * vTwinkle);
        gl_FragColor = vec4(vec3(1.0), alpha);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -10;

  return {
    points,
    material: mat,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

function computePickupPoolSize(level: LevelConfig): number {
  // Roughly: pool ~ rate * time-in-front. Keeps density consistent across speeds.
  const est = Math.round(level.pickupRate * 16 + 4);
  return Math.max(6, Math.min(28, est));
}

function computeAsteroidCount(level: LevelConfig): number {
  const n = Math.round(level.asteroidCount);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(220, n));
}

export class OrbitWorld implements World {
  readonly environment: World['environment'];
  readonly level: LevelConfig;

  readonly playerBounds: WorldPlayerBounds = { xMin: -11, xMax: 11, yMin: -7, yMax: 7 };
  readonly enemySpawnBounds: EnemySpawnBounds = { xRange: 12, yRange: 7, zMin: 110, zMax: 190 };
  readonly behindZ = WORLD_Z_BEHIND;

  private readonly scene: THREE.Scene;
  private readonly isIOS: boolean;

  private readonly root = new THREE.Group();

  private star: ReturnType<typeof createStarfield> | null = null;

  private asteroidGeo: THREE.BufferGeometry | null = null;
  private asteroidMat: THREE.Material | null = null;
  private asteroids:
    | { mesh: THREE.InstancedMesh; items: Asteroid[]; temp: THREE.Object3D; count: number }
    | null = null;

  private pickupGeo: THREE.BufferGeometry | null = null;
  private pickupMat: THREE.Material | null = null;
  private pickups: { mesh: THREE.InstancedMesh; items: Pickup[]; temp: THREE.Object3D; count: number } | null = null;

  constructor(args: WorldInitArgs) {
    this.environment = args.level.environment;
    this.level = args.level;
    this.scene = args.scene;
    this.isIOS = args.isIOS;
  }

  create() {
    this.scene.add(this.root);
    this.scene.background = new THREE.Color('#000000');
    this.scene.fog = null;

    const star = createStarfield(this.isIOS);
    this.root.add(star.points);
    this.star = star;

    const asteroidCount = computeAsteroidCount(this.level);
    if (asteroidCount > 0) {
      const asteroidGeo = new THREE.IcosahedronGeometry(1, 0);
      const asteroidMat = new THREE.MeshStandardMaterial({
        color: '#9aa3ad',
        metalness: 0.25,
        roughness: 0.9,
      });
      this.asteroidGeo = asteroidGeo;
      this.asteroidMat = asteroidMat;

      const astMesh = new THREE.InstancedMesh(asteroidGeo, asteroidMat, asteroidCount);
      astMesh.frustumCulled = false;
      this.root.add(astMesh);

      const astTemp = new THREE.Object3D();
      const asteroids: Asteroid[] = Array.from({ length: asteroidCount }, () => ({
        pos: new THREE.Vector3(0, 0, randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX)),
        rot: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
        spin: new THREE.Vector3(randRange(-1.2, 1.2), randRange(-1.2, 1.2), randRange(-1.2, 1.2)),
        scale: randRange(0.45, 1.45),
        radius: 1,
      }));
      for (const a of asteroids) {
        const p = randomLanePos(ASTEROID_FIELD_X, ASTEROID_FIELD_Y);
        a.pos.x = p.x;
        a.pos.y = p.y;
        a.radius = a.scale * 0.82;
      }
      this.asteroids = { mesh: astMesh, items: asteroids, temp: astTemp, count: asteroidCount };
    }

    const pickupCount = computePickupPoolSize(this.level);
    const pickupGeo = new THREE.OctahedronGeometry(0.55, 0);
    const pickupMat = new THREE.MeshStandardMaterial({
      color: '#ff4fb8',
      emissive: '#ff4fb8',
      emissiveIntensity: 1.4,
      metalness: 0.35,
      roughness: 0.25,
    });
    this.pickupGeo = pickupGeo;
    this.pickupMat = pickupMat;

    const pickupMesh = new THREE.InstancedMesh(pickupGeo, pickupMat, pickupCount);
    pickupMesh.frustumCulled = false;
    this.root.add(pickupMesh);

    const pickupTemp = new THREE.Object3D();
    const pickups: Pickup[] = Array.from({ length: pickupCount }, () => ({
      pos: new THREE.Vector3(randRange(-10, 10), randRange(-6, 6), randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX)),
      rot: new THREE.Euler(0, 0, 0),
      spin: randRange(0.8, 2.0),
      radius: 0.55,
    }));
    this.pickups = { mesh: pickupMesh, items: pickups, temp: pickupTemp, count: pickupCount };

    this.reset(new THREE.Vector3(0, 0, 0));
  }

  reset(_playerPos: THREE.Vector3) {
    const asteroids = this.asteroids?.items;
    if (asteroids) {
      for (const a of asteroids) {
        const p = randomLanePos(ASTEROID_FIELD_X, ASTEROID_FIELD_Y);
        a.pos.set(p.x, p.y, randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX));
        a.scale = randRange(0.45, 1.45);
        a.radius = a.scale * 0.82;
        a.rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        a.spin.set(randRange(-1.2, 1.2), randRange(-1.2, 1.2), randRange(-1.2, 1.2));
      }
    }

    const pickups = this.pickups?.items;
    if (pickups) {
      for (const p of pickups) {
        p.pos.set(randRange(-10, 10), randRange(-6, 6), randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX));
        p.rot.set(0, 0, 0);
        p.spin = randRange(0.8, 2.0);
      }
    }
  }

  update(args: WorldUpdateArgs): WorldUpdateResult {
    if (this.star) this.star.material.uniforms.uTime.value = args.nowMs * 0.001;

    const speed = args.speed;
    const dt = args.dt;

    const ast = this.asteroids;
    if (ast) {
      for (const a of ast.items) {
        a.pos.z -= speed * dt;
        a.rot.x += a.spin.x * dt;
        a.rot.y += a.spin.y * dt;
        a.rot.z += a.spin.z * dt;
        if (a.pos.z < WORLD_Z_BEHIND) {
          const p = randomLanePos(ASTEROID_FIELD_X, ASTEROID_FIELD_Y);
          a.pos.set(p.x, p.y, randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX));
          a.scale = randRange(0.45, 1.45);
          a.radius = a.scale * 0.82;
        }
      }
      for (let i = 0; i < ast.items.length; i += 1) {
        const a = ast.items[i];
        ast.temp.position.copy(a.pos);
        ast.temp.rotation.copy(a.rot);
        ast.temp.scale.setScalar(a.scale);
        ast.temp.updateMatrix();
        ast.mesh.setMatrixAt(i, ast.temp.matrix);
      }
      ast.mesh.instanceMatrix.needsUpdate = true;

      // Optional: orbit debris can be collidable (low intensity by default).
      if (this.level.obstacleDensity >= 0.18) {
        for (const a of ast.items) {
          const dx = a.pos.x - args.playerPos.x;
          const dy = a.pos.y - args.playerPos.y;
          const dz = a.pos.z - args.playerPos.z;
          const r = args.playerRadius + a.radius;
          if (dx * dx + dy * dy + dz * dz < r * r) return { hit: true };
        }
      }
    }

    const pickups = this.pickups;
    if (pickups) {
      for (const p of pickups.items) {
        p.pos.z -= speed * dt;
        p.rot.y += p.spin * dt;
        p.rot.x += p.spin * 0.35 * dt;
        if (p.pos.z < WORLD_Z_BEHIND) {
          p.pos.set(randRange(-10, 10), randRange(-6, 6), randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX));
        }

        const dx = p.pos.x - args.playerPos.x;
        const dy = p.pos.y - args.playerPos.y;
        const dz = p.pos.z - args.playerPos.z;
        const r = args.playerRadius + p.radius;
        if (dx * dx + dy * dy + dz * dz < r * r) {
          args.onCollectPickup(1);
          p.pos.set(randRange(-10, 10), randRange(-6, 6), randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX));
        }
      }

      for (let i = 0; i < pickups.items.length; i += 1) {
        const p = pickups.items[i];
        pickups.temp.position.copy(p.pos);
        pickups.temp.rotation.copy(p.rot);
        pickups.temp.scale.setScalar(1);
        pickups.temp.updateMatrix();
        pickups.mesh.setMatrixAt(i, pickups.temp.matrix);
      }
      pickups.mesh.instanceMatrix.needsUpdate = true;
    }

    return { hit: false };
  }

  dispose() {
    this.scene.remove(this.root);

    this.star?.dispose();
    this.star = null;

    this.asteroidGeo?.dispose();
    this.asteroidGeo = null;
    (this.asteroidMat as any)?.dispose?.();
    this.asteroidMat = null;
    this.asteroids = null;

    this.pickupGeo?.dispose();
    this.pickupGeo = null;
    (this.pickupMat as any)?.dispose?.();
    this.pickupMat = null;
    this.pickups = null;

    this.root.clear();
  }
}
