import { Environment, Lightformer, OrbitControls, Stars } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Component, forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import GltfModel from './GltfModel.jsx';

import {
  computeMouthOffsetsFromLandmarks,
  computeMouthOpen,
  computeMouthOpenFromLandmarks,
} from '../lib/faceControls.js';

import { DEFAULT_DRONE_SKIN_ID, DRONE_SKINS, getDroneSkin } from '../lib/droneSkins.js';

const CALIBRATION_DURATION_MS = 5000;
const RING_COUNT = 30;

const HYPER_STREAK_COUNT = 450;
const HYPER_STREAK_RADIUS = 35;
const HYPER_STREAK_Z_RANGE = 160;

const MAX_LASERS = 64;
const MAX_MISSILES = 16;

const LASER_SPEED = 48;
const LASER_LIFETIME = 0.7;

const MISSILE_SPEED = 30;
const MISSILE_LIFETIME = 2.2;

const MAX_ENEMIES = 10;
const ENEMY_MAX_DISTANCE = 220;
const ENEMY_SPAWN_INTERVAL_MS = 850;
const ENEMY_SPAWN_DISTANCE_MIN = 35;
const ENEMY_SPAWN_DISTANCE_MAX = 85;
const ENEMY_RADIUS = 0.85;

// Explosion constants
const EXPLOSION_SPEED = 8;
const EXPLOSION_LIFETIME = 0.6;
const MAX_EXPLOSIONS = 20;

// Enemy types with different behaviors
const ENEMY_TYPES = [
  {
    id: 'scout',
    texture: '/assets/enemies/enemy1.png',
    hp: 2,
    speed: 10,
    speedVariance: 2,
    fireRate: 1200,
    fireRateVariance: 400,
    scale: 0.8,
    color: '#88ffff',
    emissive: '#00ffff',
    weight: 3, // More common
  },
  {
    id: 'fighter',
    texture: '/assets/enemies/enemy1.png',
    hp: 4,
    speed: 7,
    speedVariance: 1.5,
    fireRate: 800,
    fireRateVariance: 200,
    scale: 1.0,
    color: '#ffff88',
    emissive: '#ffaa00',
    weight: 2,
  },
  {
    id: 'heavy',
    texture: '/assets/enemies/enemy2.png',
    hp: 6,
    speed: 5,
    speedVariance: 1,
    fireRate: 600,
    fireRateVariance: 150,
    scale: 1.4,
    color: '#ff8888',
    emissive: '#ff4400',
    weight: 1, // Less common
  },
];

// Weighted random enemy type picker
function pickRandomEnemyType() {
  const totalWeight = ENEMY_TYPES.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * totalWeight;
  for (const type of ENEMY_TYPES) {
    r -= type.weight;
    if (r <= 0) return type;
  }
  return ENEMY_TYPES[0];
}

const MAX_ENEMY_LASERS = 96;
const ENEMY_LASER_SPEED = 34;
const ENEMY_LASER_LIFETIME = 2.2;
const ENEMY_FIRE_RANGE = 85;

function detectIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1;
}

function detectWebGLSupport() {
  if (typeof document === 'undefined') return true;

  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

class CanvasErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[DroneGame] Canvas render failed:', error);
  }

  render() {
    if (this.state.error) return this.props.fallback || null;
    return this.props.children;
  }
}

// Optional assets:
// - Player drone (classic): public/assets/models/drone.glb
// - Extra drones: public/assets/models/drones/<id>.glb
// - World: public/assets/models/world.glb
const WORLD_MODEL_URL = '/assets/models/world.glb';

function FallbackWorld() {
  // Default environment is "space".
  // If there's no world.glb, render nothing (avoids a visible horizon/ground plane).
  return null;
}

function WorldBackdrop() {
  return <GltfModel url={WORLD_MODEL_URL} fallback={<FallbackWorld />} />;
}

function HyperspaceStreaks({ velocityRef }) {
  const groupRef = useRef(null);
  const meshRef = useRef(null);
  const materialRef = useRef(null);

  const xsRef = useRef(new Float32Array(HYPER_STREAK_COUNT));
  const ysRef = useRef(new Float32Array(HYPER_STREAK_COUNT));
  const zsRef = useRef(new Float32Array(HYPER_STREAK_COUNT));
  const readyRef = useRef(false);

  useEffect(() => {
    const xs = xsRef.current;
    const ys = ysRef.current;
    const zs = zsRef.current;

    for (let i = 0; i < HYPER_STREAK_COUNT; i += 1) {
      xs[i] = (Math.random() - 0.5) * 2 * HYPER_STREAK_RADIUS;
      ys[i] = (Math.random() - 0.5) * 2 * HYPER_STREAK_RADIUS;
      zs[i] = -1 - Math.random() * HYPER_STREAK_Z_RANGE;
    }

    readyRef.current = true;
  }, []);

  const temp = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, delta) => {
    if (!readyRef.current) return;

    // Keep streaks in camera space
    if (groupRef.current) {
      groupRef.current.position.copy(state.camera.position);
      groupRef.current.quaternion.copy(state.camera.quaternion);
    }

    const mesh = meshRef.current;
    if (!mesh) return;

    const speed = Math.abs(velocityRef.current[2]);
    const t = Math.max(0, Math.min(1, speed / 10));

    const drift = (18 + t * 280) * delta;
    const length = 1.2 + t * 22;

    if (materialRef.current) {
      materialRef.current.opacity = 0.12 + t * 0.7;
    }

    const xs = xsRef.current;
    const ys = ysRef.current;
    const zs = zsRef.current;

    for (let i = 0; i < HYPER_STREAK_COUNT; i += 1) {
      zs[i] += drift;
      if (zs[i] > 1) {
        zs[i] = -HYPER_STREAK_Z_RANGE;
        xs[i] = (Math.random() - 0.5) * 2 * HYPER_STREAK_RADIUS;
        ys[i] = (Math.random() - 0.5) * 2 * HYPER_STREAK_RADIUS;
      }

      temp.position.set(xs[i], ys[i], zs[i]);
      temp.scale.set(0.04, 0.04, length);
      temp.updateMatrix();
      mesh.setMatrixAt(i, temp.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[null, null, HYPER_STREAK_COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          ref={materialRef}
          color="#e8fbff"
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}

// Individual enemy sprite component for better texture support
function EnemySprite({ enemy, dronePosRef }) {
  const meshRef = useRef();
  const type = enemy.type || ENEMY_TYPES[0];

  // Load texture for this enemy type
  const texture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(type.texture);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [type.texture]);

  useFrame(() => {
    if (!meshRef.current) return;
    const dronePos = dronePosRef.current;

    // Billboard effect - always face the player
    meshRef.current.position.set(enemy.pos[0], enemy.pos[1], enemy.pos[2]);
    meshRef.current.lookAt(dronePos[0], dronePos[1], dronePos[2]);

    // Pulsing glow effect based on HP
    const hpRatio = Math.max(0, Math.min(1, (enemy.hp || 0) / (type.hp || 1)));
    const pulse = 1 + Math.sin(performance.now() * 0.005) * (0.06 + (1 - hpRatio) * 0.08);
    const s = (enemy.scale || 1) * type.scale * pulse;
    meshRef.current.scale.set(s * 1.8, s * 1.8, 1);

    const mat = meshRef.current.material;
    if (mat && typeof mat.opacity === 'number') {
      mat.opacity = 0.6 + 0.4 * hpRatio;
    }
  });

  return (
    <mesh ref={meshRef} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={texture}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        color={type.color}
      />
    </mesh>
  );
}

function EnemySwarm({
  calibratedRef,
  pausedRef,
  enemiesRef,
  dronePosRef,
  droneRotRef,
  projectilesRef,
  resetRun,
}) {
  const spawnRef = useRef({
    nextSpawnMs: 0,
    nextId: 1,
  });

  const [renderEnemies, setRenderEnemies] = useState(() => []);

  useFrame((_state, delta) => {
    if (!calibratedRef.current || pausedRef.current) return;

    const nowMs = performance.now();
    const spawn = spawnRef.current;
    const enemies = enemiesRef.current;

    const yaw = droneRotRef.current[1];
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);

    // Player forward direction (same as guns): -forwardVector
    const dirX = -fx;
    const dirZ = -fz;
    // Player right direction
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const desiredCount = Math.min(MAX_ENEMIES, 8);
    let needsUpdate = false;

    if (enemies.length < desiredCount && nowMs >= spawn.nextSpawnMs) {
      const base = dronePosRef.current;
      const distance =
        ENEMY_SPAWN_DISTANCE_MIN +
        Math.random() * (ENEMY_SPAWN_DISTANCE_MAX - ENEMY_SPAWN_DISTANCE_MIN);
      const lateral = (Math.random() - 0.5) * 30;
      const vertical = (Math.random() - 0.5) * 12;

      const pos = [
        base[0] + dirX * distance + rightX * lateral,
        Math.max(1.5, Math.min(26, base[1] + vertical)),
        base[2] + dirZ * distance + rightZ * lateral,
      ];

      // Pick random enemy type
      const type = pickRandomEnemyType();

      enemiesRef.current.push({
        id: spawn.nextId++,
        type: type,
        hp: type.hp,
        radius: ENEMY_RADIUS * type.scale,
        pos,
        speed: type.speed + Math.random() * type.speedVariance,
        bobPhase: Math.random() * Math.PI * 2,
        fireEveryMs: type.fireRate + Math.random() * type.fireRateVariance,
        nextFireMs: nowMs + 650 + Math.random() * 650,
        scale: 0.9 + Math.random() * 0.25,
      });

      spawn.nextSpawnMs = nowMs + ENEMY_SPAWN_INTERVAL_MS + Math.random() * 400;
      needsUpdate = true;
    }

    const dronePos = dronePosRef.current;
    const enemyProjectiles = projectilesRef.current.enemyLasers;

    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const e = enemies[i];
      if (!e?.pos) {
        enemiesRef.current.splice(i, 1);
        needsUpdate = true;
        continue;
      }

      const dx = dronePos[0] - e.pos[0];
      const dy = dronePos[1] - e.pos[1];
      const dz = dronePos[2] - e.pos[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(d2 || 1e-6);

      if (dist > ENEMY_MAX_DISTANCE) {
        enemiesRef.current.splice(i, 1);
        needsUpdate = true;
        continue;
      }

      const hitRadius = (e.radius || ENEMY_RADIUS) + 0.55;
      if (d2 < hitRadius * hitRadius) {
        resetRun?.('hit');
        return;
      }

      const ndx = dx / dist;
      const ndy = dy / dist;
      const ndz = dz / dist;

      const speed = e.speed || 8;
      // More aggressive strafing for scouts, less for heavies
      const strafeMultiplier = e.type?.id === 'scout' ? 3.0 : e.type?.id === 'heavy' ? 1.2 : 2.2;
      const strafeBase = Math.sin(nowMs * 0.0015 + (e.bobPhase || 0)) * strafeMultiplier;
      const strafeX = -ndz * strafeBase;
      const strafeZ = ndx * strafeBase;
      const bob = Math.sin(nowMs * 0.0022 + (e.bobPhase || 0)) * 0.65;

      const chase = Math.min(1, dist / 35);
      enemiesRef.current[i].pos[0] += (ndx * speed * chase + strafeX) * delta;
      enemiesRef.current[i].pos[1] += (ndy * speed * chase + bob) * delta;
      enemiesRef.current[i].pos[2] += (ndz * speed * chase + strafeZ) * delta;

      // Fire at the player when in range
      if (dist < ENEMY_FIRE_RANGE && nowMs >= (e.nextFireMs || 0)) {
        // Heavy enemies fire multiple shots
        const shotCount = e.type?.id === 'heavy' ? 3 : 1;
        for (let s = 0; s < shotCount; s++) {
          const spread = e.type?.id === 'heavy' ? (s - 1) * 0.08 : 0;
          enemyProjectiles.push({
            pos: [e.pos[0] + ndx * 0.9, e.pos[1] + ndy * 0.9, e.pos[2] + ndz * 0.9],
            dir: [ndx + spread, ndy, ndz],
            speed: ENEMY_LASER_SPEED,
            ttl: ENEMY_LASER_LIFETIME,
          });
        }

        if (enemyProjectiles.length > MAX_ENEMY_LASERS) {
          enemyProjectiles.splice(0, enemyProjectiles.length - MAX_ENEMY_LASERS);
        }

        enemiesRef.current[i].nextFireMs = nowMs + (e.fireEveryMs || 1100) + Math.random() * 250;
      }

      // Despawn enemies that are far behind the player
      const relX = e.pos[0] - dronePos[0];
      const relZ = e.pos[2] - dronePos[2];
      const ahead = relX * dirX + relZ * dirZ;
      if (ahead < -20 && dist > 40) {
        enemiesRef.current.splice(i, 1);
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      setRenderEnemies(enemiesRef.current.slice());
    } else if (enemies.length === 0) {
      setRenderEnemies((prev) => (prev.length ? [] : prev));
    }
  });

  return (
    <group>
      {renderEnemies.map((enemy) => (
        <EnemySprite key={enemy.id} enemy={enemy} dronePosRef={dronePosRef} />
      ))}
    </group>
  );
}

function EnemyLasers({ calibratedRef, pausedRef, projectilesRef, dronePosRef, resetRun }) {
  const lasersMeshRef = useRef(null);
  const temp = useMemo(() => new THREE.Object3D(), []);

  useFrame((_state, delta) => {
    if (!calibratedRef.current || pausedRef.current) return;

    const lasers = projectilesRef.current.enemyLasers;
    const dronePos = dronePosRef.current;

    for (let i = lasers.length - 1; i >= 0; i -= 1) {
      const p = lasers[i];
      p.ttl -= delta;
      p.pos[0] += p.dir[0] * p.speed * delta;
      p.pos[1] += p.dir[1] * p.speed * delta;
      p.pos[2] += p.dir[2] * p.speed * delta;

      const dx = p.pos[0] - dronePos[0];
      const dy = p.pos[1] - dronePos[1];
      const dz = p.pos[2] - dronePos[2];
      const d2 = dx * dx + dy * dy + dz * dz;

      if (d2 < 0.95 * 0.95) {
        resetRun?.('hit');
        return;
      }

      if (p.ttl <= 0) lasers.splice(i, 1);
    }

    const mesh = lasersMeshRef.current;
    if (!mesh) return;

    const n = Math.min(MAX_ENEMY_LASERS, lasers.length);
    for (let i = 0; i < MAX_ENEMY_LASERS; i += 1) {
      if (i < n) {
        const p = lasers[i];
        temp.position.set(p.pos[0], p.pos[1], p.pos[2]);
        temp.scale.setScalar(1);
      } else {
        temp.position.set(0, -9999, 0);
        temp.scale.setScalar(0);
      }
      temp.updateMatrix();
      mesh.setMatrixAt(i, temp.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={lasersMeshRef} args={[null, null, MAX_ENEMY_LASERS]} frustumCulled={false}>
      <sphereGeometry args={[0.06, 10, 10]} />
      <meshBasicMaterial
        color="#6bff6b"
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

// Simple explosion effect using instanced mesh for better performance
function Explosions({ calibratedRef, pausedRef, explosionsRef }) {
  const meshRef = useRef();
  const temp = useMemo(() => new THREE.Object3D(), []);
  const MAX_EXPLOSION_PARTICLES = 200;

  useFrame((_state, delta) => {
    if (!calibratedRef.current || pausedRef.current) return;

    const explosions = explosionsRef.current;

    // Update explosions
    for (let i = explosions.length - 1; i >= 0; i--) {
      const exp = explosions[i];
      exp.age += delta;

      if (exp.age >= exp.lifetime) {
        explosions.splice(i, 1);
        continue;
      }

      // Update each particle
      /* eslint-disable react-hooks/immutability */
      for (const particle of exp.particles) {
        particle.pos[0] += particle.vel[0] * delta;
        particle.pos[1] += particle.vel[1] * delta;
        particle.pos[2] += particle.vel[2] * delta;
        particle.vel[1] -= 6 * delta; // Gravity
      }
      /* eslint-enable react-hooks/immutability */
    }

    // Render all particles
    const mesh = meshRef.current;
    if (!mesh) return;

    let idx = 0;
    for (const exp of explosions) {
      const progress = exp.age / exp.lifetime;
      const alpha = 1 - progress;

      for (const particle of exp.particles) {
        if (idx >= MAX_EXPLOSION_PARTICLES) break;

        const s = particle.size * alpha * 2;
        temp.position.set(particle.pos[0], particle.pos[1], particle.pos[2]);
        temp.scale.set(s, s, s);
        temp.updateMatrix();
        mesh.setMatrixAt(idx, temp.matrix);
        idx++;
      }
    }

    // Hide unused instances
    for (let i = idx; i < MAX_EXPLOSION_PARTICLES; i++) {
      temp.position.set(0, -9999, 0);
      temp.scale.set(0, 0, 0);
      temp.updateMatrix();
      mesh.setMatrixAt(i, temp.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, MAX_EXPLOSION_PARTICLES]} frustumCulled={false}>
      <sphereGeometry args={[0.1, 6, 6]} />
      <meshBasicMaterial
        color="#ff8800"
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

// Helper to spawn an explosion
function spawnExplosion(explosionsRef, pos, color = '#ff6600', scale = 1) {
  const particles = [];
  const particleCount = Math.floor(12 * scale); // Reduced particle count

  for (let i = 0; i < particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const speed = EXPLOSION_SPEED * (0.4 + Math.random() * 0.6) * scale;

    particles.push({
      pos: [...pos],
      vel: [
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.sin(phi) * Math.sin(theta) * speed + 2,
        Math.cos(phi) * speed,
      ],
      size: (0.1 + Math.random() * 0.15) * scale,
    });
  }

  explosionsRef.current.push({
    id: Date.now() + Math.random(),
    pos: [...pos],
    color,
    particles,
    age: 0,
    lifetime: EXPLOSION_LIFETIME,
  });

  if (explosionsRef.current.length > MAX_EXPLOSIONS) {
    explosionsRef.current.shift();
  }
}

function Weapons({ calibratedRef, pausedRef, projectilesRef, enemiesRef, explosionsRef, scoreRef }) {
  const lasersMeshRef = useRef(null);
  const missilesMeshRef = useRef(null);

  const temp = useMemo(() => new THREE.Object3D(), []);

  useFrame((_state, delta) => {
    if (!calibratedRef.current || pausedRef.current) return;

    const lasers = projectilesRef.current.lasers;
    const missiles = projectilesRef.current.missiles;
    const enemies = enemiesRef.current;

    for (let i = lasers.length - 1; i >= 0; i -= 1) {
      const p = lasers[i];
      p.ttl -= delta;
      p.pos[0] += p.dir[0] * p.speed * delta;
      p.pos[1] += p.dir[1] * p.speed * delta;
      p.pos[2] += p.dir[2] * p.speed * delta;
      if (p.ttl <= 0) lasers.splice(i, 1);
    }

    for (let i = missiles.length - 1; i >= 0; i -= 1) {
      const p = missiles[i];
      p.ttl -= delta;
      p.pos[0] += p.dir[0] * p.speed * delta;
      p.pos[1] += p.dir[1] * p.speed * delta;
      p.pos[2] += p.dir[2] * p.speed * delta;
      if (p.ttl <= 0) missiles.splice(i, 1);
    }

    if (enemies.length) {
      for (let i = lasers.length - 1; i >= 0; i -= 1) {
        const p = lasers[i];
        for (let j = enemies.length - 1; j >= 0; j -= 1) {
          const e = enemies[j];
          if (!e?.pos) continue;

          const r = (e.radius || ENEMY_RADIUS) + 0.25;
          const dx = p.pos[0] - e.pos[0];
          const dy = p.pos[1] - e.pos[1];
          const dz = p.pos[2] - e.pos[2];
          if (dx * dx + dy * dy + dz * dz > r * r) continue;

          const nextHp = (e.hp || 1) - 1;
          enemiesRef.current[j].hp = nextHp;
          lasers.splice(i, 1);

          // Small hit spark effect
          if (explosionsRef) {
            spawnExplosion(explosionsRef, [...e.pos], '#ffff00', 0.3);
          }

          if (nextHp <= 0) {
            // Big explosion when enemy dies!
            const enemyType = e.type;
            const explosionScale = enemyType?.scale || 1;
            const explosionColor = enemyType?.emissive || '#ff6600';
            if (explosionsRef) {
              spawnExplosion(explosionsRef, [...e.pos], explosionColor, explosionScale);
            }

            enemiesRef.current.splice(j, 1);
            if (scoreRef?.current != null) scoreRef.current += 50;
          }

          break;
        }
      }

      for (let i = missiles.length - 1; i >= 0; i -= 1) {
        const p = missiles[i];
        for (let j = enemies.length - 1; j >= 0; j -= 1) {
          const e = enemies[j];
          if (!e?.pos) continue;

          const r = (e.radius || ENEMY_RADIUS) + 0.55;
          const dx = p.pos[0] - e.pos[0];
          const dy = p.pos[1] - e.pos[1];
          const dz = p.pos[2] - e.pos[2];
          if (dx * dx + dy * dy + dz * dz > r * r) continue;

          const nextHp = (e.hp || 1) - 3;
          enemiesRef.current[j].hp = nextHp;
          missiles.splice(i, 1);

          // Medium hit effect for missiles
          if (explosionsRef) {
            spawnExplosion(explosionsRef, [...e.pos], '#ff8800', 0.5);
          }

          if (nextHp <= 0) {
            // Bigger explosion for missile kills!
            const enemyType = e.type;
            const explosionScale = (enemyType?.scale || 1) * 1.3;
            const explosionColor = enemyType?.emissive || '#ff6600';
            if (explosionsRef) {
              spawnExplosion(explosionsRef, [...e.pos], explosionColor, explosionScale);
            }

            enemiesRef.current.splice(j, 1);
            if (scoreRef?.current != null) scoreRef.current += 120;
          }

          break;
        }
      }
    }

    const lasersMesh = lasersMeshRef.current;
    if (lasersMesh) {
      const n = Math.min(MAX_LASERS, lasers.length);
      for (let i = 0; i < MAX_LASERS; i += 1) {
        if (i < n) {
          const p = lasers[i];
          temp.position.set(p.pos[0], p.pos[1], p.pos[2]);
          temp.scale.setScalar(1);
        } else {
          temp.position.set(0, -9999, 0);
          temp.scale.setScalar(0);
        }
        temp.updateMatrix();
        lasersMesh.setMatrixAt(i, temp.matrix);
      }
      lasersMesh.instanceMatrix.needsUpdate = true;
    }

    const missilesMesh = missilesMeshRef.current;
    if (missilesMesh) {
      const n = Math.min(MAX_MISSILES, missiles.length);
      for (let i = 0; i < MAX_MISSILES; i += 1) {
        if (i < n) {
          const p = missiles[i];
          temp.position.set(p.pos[0], p.pos[1], p.pos[2]);
          temp.scale.setScalar(1);
        } else {
          temp.position.set(0, -9999, 0);
          temp.scale.setScalar(0);
        }
        temp.updateMatrix();
        missilesMesh.setMatrixAt(i, temp.matrix);
      }
      missilesMesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={lasersMeshRef} args={[null, null, MAX_LASERS]} frustumCulled={false}>
        <sphereGeometry args={[0.05, 10, 10]} />
        <meshBasicMaterial
          color="#ff5b5b"
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>

      <instancedMesh ref={missilesMeshRef} args={[null, null, MAX_MISSILES]} frustumCulled={false}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial
          color="#2b2b2b"
          emissive="#ffcc66"
          emissiveIntensity={2.2}
          metalness={0.2}
          roughness={0.6}
        />
      </instancedMesh>
    </>
  );
}

function ProceduralDroneBody({ frameMat, glowMat, hullMat, panelMat }) {
  return (
    <>
      {/* Central cockpit */}
      <mesh material={hullMat}>
        <sphereGeometry args={[0.35, 32, 32]} />
      </mesh>
      <mesh material={frameMat} position={[0, 0, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.18, 32]} />
      </mesh>
      <mesh material={panelMat} position={[0, 0, 0.39]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.02, 32]} />
      </mesh>
      <mesh material={glowMat} position={[0, -0.06, -0.34]}>
        <sphereGeometry args={[0.05, 16, 16]} />
      </mesh>
      <mesh material={glowMat} position={[0.08, -0.06, -0.34]}>
        <sphereGeometry args={[0.04, 16, 16]} />
      </mesh>
      <mesh material={glowMat} position={[-0.08, -0.06, -0.34]}>
        <sphereGeometry args={[0.04, 16, 16]} />
      </mesh>

      {/* Wing struts */}
      <mesh material={frameMat} position={[0.55, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 1.1, 16]} />
      </mesh>
      <mesh material={frameMat} position={[-0.55, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 1.1, 16]} />
      </mesh>

      {/* Left wing */}
      <group position={[-1.15, 0, 0]}>
        <mesh material={frameMat}>
          <boxGeometry args={[0.08, 1.4, 1.4]} />
        </mesh>
        <mesh material={panelMat}>
          <boxGeometry args={[0.02, 1.2, 1.2]} />
        </mesh>
        <mesh material={frameMat}>
          <boxGeometry args={[0.1, 0.12, 1.35]} />
        </mesh>
        <mesh material={frameMat}>
          <boxGeometry args={[0.1, 1.35, 0.12]} />
        </mesh>
      </group>

      {/* Right wing */}
      <group position={[1.15, 0, 0]}>
        <mesh material={frameMat}>
          <boxGeometry args={[0.08, 1.4, 1.4]} />
        </mesh>
        <mesh material={panelMat}>
          <boxGeometry args={[0.02, 1.2, 1.2]} />
        </mesh>
        <mesh material={frameMat}>
          <boxGeometry args={[0.1, 0.12, 1.35]} />
        </mesh>
        <mesh material={frameMat}>
          <boxGeometry args={[0.1, 1.35, 0.12]} />
        </mesh>
      </group>
    </>
  );
}

const Drone = forwardRef(function Drone({ skinId = DEFAULT_DRONE_SKIN_ID }, ref) {
  const skin = useMemo(() => getDroneSkin(skinId), [skinId]);

  const mats = useMemo(() => {
    const p = skin.palette || {};

    const hullMat = new THREE.MeshStandardMaterial({
      color: p.hull || '#b8c2d0',
      metalness: typeof p.metalness === 'number' ? p.metalness : 0.9,
      roughness: typeof p.roughness === 'number' ? p.roughness : 0.25,
    });

    const panelMat = new THREE.MeshStandardMaterial({
      color: p.panel || '#1a1f2a',
      metalness: 0.2,
      roughness: 0.9,
    });

    const frameMat = new THREE.MeshStandardMaterial({
      color: p.frame || '#7c8799',
      metalness: 0.7,
      roughness: 0.35,
    });

    const glowMat = new THREE.MeshStandardMaterial({
      color: '#121212',
      emissive: p.glow || '#ffd24a',
      emissiveIntensity: typeof p.glowIntensity === 'number' ? p.glowIntensity : 3.5,
    });

    return { hullMat, panelMat, frameMat, glowMat };
  }, [skin]);

  useEffect(() => {
    return () => {
      mats.hullMat.dispose();
      mats.panelMat.dispose();
      mats.frameMat.dispose();
      mats.glowMat.dispose();
    };
  }, [mats]);

  return (
    <group ref={ref} scale={skin.scale ?? 1.25}>
      {/* Fix: Rotate the model 180 deg so it faces forward (away from camera) instead of backward (at face). */}
      <group rotation={[0, Math.PI, 0]}>
        <GltfModel
          key={skin.modelUrl}
          url={skin.modelUrl}
          // If the drone model is missing, fall back to a procedural mesh.
          fallback={
            <ProceduralDroneBody
              hullMat={mats.hullMat}
              panelMat={mats.panelMat}
              frameMat={mats.frameMat}
              glowMat={mats.glowMat}
            />
          }
        />
      </group>
    </group>
  );
});

function Scene({
  calibratedRef,
  pausedRef,
  manualControlRef,
  flipRef,
  projectilesRef,
  enemiesRef,
  explosionsRef,
  resetRun,
  droneRef,
  rings,
  velocityRef,
  dronePosRef,
  droneRotRef,
  scoreRef,
  scoreElRef,
  speedElRef,
  mouthOpenRef,
  mouthXRef,
  mouthYRef,
  droneSkinId,
}) {
  useFrame((state, delta) => {
    if (!calibratedRef.current || pausedRef.current) return;

    const nowMs = performance.now();

    let mouthOpen = mouthOpenRef.current;
    let mouthX = mouthXRef.current;
    let mouthY = mouthYRef.current;

    const manual = manualControlRef.current;
    if (manual?.untilMs && manual.untilMs > nowMs) {
      mouthOpen = Math.max(mouthOpen, manual.open ?? 0);
      mouthX = manual.x ?? mouthX;
      mouthY = manual.y ?? mouthY;
    }

    const drag = 0.95;
    const turnSpeed = 1.8;
    const forwardAccel = mouthOpen * 7.5 * delta;

    velocityRef.current[2] -= forwardAccel;
    velocityRef.current[2] *= drag;

    // +yaw turns to the right in this coordinate system.
    droneRotRef.current[1] += mouthX * turnSpeed * delta;

    const forwardVector = [Math.sin(droneRotRef.current[1]), 0, Math.cos(droneRotRef.current[1])];

    dronePosRef.current[0] += forwardVector[0] * velocityRef.current[2] * delta;
    dronePosRef.current[2] += forwardVector[2] * velocityRef.current[2] * delta;

    const gravity = 0.65;
    const verticalAccel = 6;

    // mouthY: +down => drone goes down
    velocityRef.current[1] -= mouthY * verticalAccel * delta;
    velocityRef.current[1] -= gravity * delta;
    velocityRef.current[1] *= drag;

    dronePosRef.current[1] += velocityRef.current[1] * delta;

    if (dronePosRef.current[1] < -5) {
      if (typeof resetRun === 'function') {
        resetRun('crash');
        return;
      }

      dronePosRef.current[0] = 0;
      dronePosRef.current[1] = 10;
      dronePosRef.current[2] = 0;
      velocityRef.current = [0, 0, 0];
      droneRotRef.current = [0, 0, 0];
      scoreRef.current = 0;
    }

    let extraRotX = 0;
    let extraRotZ = 0;

    const flip = flipRef.current;
    if (flip?.axis) {
      flip.t += delta;
      const p = Math.min(1, flip.t / (flip.duration || 0.35));
      const eased = p * (2 - p);
      const angle = (flip.dir || 1) * Math.PI * 2 * eased;

      if (flip.axis === 'x') extraRotX = angle;
      if (flip.axis === 'z') extraRotZ = angle;

      if (p >= 1) {
        flip.axis = null;
        flip.t = 0;
      }
    }

    if (droneRef.current) {
      droneRef.current.position.set(
        dronePosRef.current[0],
        dronePosRef.current[1],
        dronePosRef.current[2],
      );
      droneRef.current.rotation.set(
        droneRotRef.current[0] + extraRotX,
        droneRotRef.current[1],
        droneRotRef.current[2] + extraRotZ,
      );
    }

    scoreRef.current += Math.abs(velocityRef.current[2]) * delta;
    if (scoreElRef.current) scoreElRef.current.textContent = `${Math.floor(scoreRef.current)}`;
    if (speedElRef.current)
      speedElRef.current.textContent = `${Math.abs(velocityRef.current[2]).toFixed(1)}`;

    state.camera.position.set(
      dronePosRef.current[0] + forwardVector[0] * 5,
      dronePosRef.current[1] + 2,
      dronePosRef.current[2] + forwardVector[2] * 5,
    );
    state.camera.lookAt(dronePosRef.current[0], dronePosRef.current[1], dronePosRef.current[2]);
  });

  return (
    <>
      <color attach="background" args={['#04050a']} />

      <Environment resolution={128} frames={1} background={false}>
        {/* Big softbox above */}
        <Lightformer
          intensity={2.2}
          position={[0, 8, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[22, 22, 1]}
        />

        {/* Side panels for specular highlights */}
        <Lightformer
          intensity={1.1}
          position={[10, 3, 0]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[18, 5, 1]}
        />
        <Lightformer
          intensity={0.9}
          position={[-10, 2, 0]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[18, 5, 1]}
        />
      </Environment>

      <ambientLight intensity={0.18} />
      <directionalLight position={[6, 10, 6]} intensity={1.25} />
      <pointLight position={[0, 6, 2]} intensity={0.75} />

      <Stars radius={180} depth={60} count={1500} factor={8} saturation={0} fade speed={0.6} />
      <WorldBackdrop />
      <HyperspaceStreaks velocityRef={velocityRef} />
      <EnemySwarm
        calibratedRef={calibratedRef}
        pausedRef={pausedRef}
        enemiesRef={enemiesRef}
        dronePosRef={dronePosRef}
        droneRotRef={droneRotRef}
        projectilesRef={projectilesRef}
        resetRun={resetRun}
      />
      <EnemyLasers
        calibratedRef={calibratedRef}
        pausedRef={pausedRef}
        projectilesRef={projectilesRef}
        dronePosRef={dronePosRef}
        resetRun={resetRun}
      />
      <Weapons
        calibratedRef={calibratedRef}
        pausedRef={pausedRef}
        projectilesRef={projectilesRef}
        enemiesRef={enemiesRef}
        dronePosRef={dronePosRef}
        scoreRef={scoreRef}
        explosionsRef={explosionsRef}
        resetRun={resetRun}
      />
      <Explosions
        calibratedRef={calibratedRef}
        pausedRef={pausedRef}
        explosionsRef={explosionsRef}
      />

      {rings.map((ring) => (
        <mesh key={ring.id} position={ring.position}>
          <torusGeometry args={[4, 0.25, 14, 90]} />
          <meshStandardMaterial color="#2cc9ff" emissive="#0aa3ff" emissiveIntensity={2.2} />
        </mesh>
      ))}

      <Drone ref={droneRef} skinId={droneSkinId} />

      <OrbitControls enabled={false} />
    </>
  );
}

export default function DroneGame() {
  const [phase, setPhase] = useState('intro');
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState(null);
  const [rendererError, setRendererError] = useState(null);

  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);

  const [cameraMode, setCameraMode] = useState('mini');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionPressed, setActionPressed] = useState(null);

  const isIOS = useMemo(() => detectIOS(), []);
  const webglSupported = useMemo(() => detectWebGLSupport(), []);

  useEffect(() => {
    try {
      window.dispatchEvent(new Event('drone-lips:booted'));
    } catch {
      // ignore
    }
  }, []);

  const [droneSkinId, setDroneSkinId] = useState(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_DRONE_SKIN_ID;
      const saved = window.localStorage.getItem('drone-lips:drone-skin');
      return saved || DEFAULT_DRONE_SKIN_ID;
    } catch {
      return DEFAULT_DRONE_SKIN_ID;
    }
  });

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem('drone-lips:drone-skin', droneSkinId);
    } catch {
      // ignore
    }
  }, [droneSkinId]);

  const selectedDroneSkin = useMemo(() => getDroneSkin(droneSkinId), [droneSkinId]);
  const selectedDroneModelHint = useMemo(() => {
    if (selectedDroneSkin.id === 'classic') return 'public/assets/models/drone.glb';
    return `public/assets/models/drones/${selectedDroneSkin.id}.glb`;
  }, [selectedDroneSkin]);

  const [settings, setSettings] = useState({
    invertX: true,
    sensOpen: 30,
    sensX: 8,
    sensY: 8,
  });

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const toastIdRef = useRef(0);
  const showToast = useCallback((msg, ms = 900) => {
    const id = (toastIdRef.current += 1);
    setStatusText(msg);

    window.setTimeout(() => {
      if (toastIdRef.current !== id) return;
      if (phaseRef.current === 'playing') setStatusText('');
    }, ms);
  }, []);

  const calibratedRef = useRef(false);
  const cancelledRef = useRef(false);
  const trackingStartedRef = useRef(false);

  const droneRef = useRef(null);

  const velocityRef = useRef([0, 0, 0]);
  const dronePosRef = useRef([0, 0, 0]);
  const droneRotRef = useRef([0, 0, 0]);
  const scoreRef = useRef(0);

  const mouthOpenRef = useRef(0);
  const mouthXRef = useRef(0);
  const mouthYRef = useRef(0);

  const manualControlRef = useRef({ x: 0, y: 0, open: 0, untilMs: 0 });
  const flipRef = useRef({ axis: null, dir: 1, t: 0, duration: 0.35 });

  const projectilesRef = useRef({ lasers: [], missiles: [], enemyLasers: [] });
  const enemiesRef = useRef([]);
  const explosionsRef = useRef([]);

  const neutralRef = useRef({ open: 0, x: 0, y: 0 });
  const calibrationRef = useRef({
    startMs: null,
    frames: 0,
    openSum: 0,
    xSum: 0,
    ySum: 0,
  });

  const webcamElRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const rafIdRef = useRef(null);

  const scoreElRef = useRef(null);
  const speedElRef = useRef(null);

  const resetRun = useCallback(
    (reason = 'reset') => {
      if (!calibratedRef.current) return;

      dronePosRef.current = [0, 10, 0];
      droneRotRef.current = [0, 0, 0];
      velocityRef.current = [0, 0, 0];
      scoreRef.current = 0;

      mouthOpenRef.current = 0;
      mouthXRef.current = 0;
      mouthYRef.current = 0;

      manualControlRef.current = { x: 0, y: 0, open: 0, untilMs: 0 };
      flipRef.current = { axis: null, dir: 1, t: 0, duration: 0.35 };

      projectilesRef.current.lasers.length = 0;
      projectilesRef.current.missiles.length = 0;
      projectilesRef.current.enemyLasers.length = 0;

      enemiesRef.current.length = 0;
      explosionsRef.current.length = 0;

      if (scoreElRef.current) scoreElRef.current.textContent = '0';
      if (speedElRef.current) speedElRef.current.textContent = '0';

      if (droneRef.current) {
        droneRef.current.position.set(0, 10, 0);
        droneRef.current.rotation.set(0, 0, 0);
      }

      if (reason === 'hit') showToast('HIT!', 900);
      else if (reason === 'crash') showToast('CRASH!', 900);
      else showToast('RESET', 700);
    },
    [showToast],
  );

  const fireGuns = useCallback(() => {
    const yaw = droneRotRef.current[1];
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);

    // Forward travel is -forwardVector in our movement convention.
    const dir = [-fx, 0, -fz];
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    const base = dronePosRef.current;

    const spawnLaser = (side) => {
      const pos = [
        base[0] + dir[0] * 0.8 + rx * 0.35 * side,
        base[1] + 0.05,
        base[2] + dir[2] * 0.8 + rz * 0.35 * side,
      ];

      projectilesRef.current.lasers.push({
        pos,
        dir: [...dir],
        speed: LASER_SPEED,
        ttl: LASER_LIFETIME,
      });

      if (projectilesRef.current.lasers.length > MAX_LASERS) {
        projectilesRef.current.lasers.splice(0, projectilesRef.current.lasers.length - MAX_LASERS);
      }
    };

    spawnLaser(-1);
    spawnLaser(1);
  }, []);

  const fireMissile = useCallback(() => {
    const yaw = droneRotRef.current[1];
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);

    const dir = [-fx, 0, -fz];

    const base = dronePosRef.current;
    const pos = [base[0] + dir[0] * 0.7, base[1] - 0.02, base[2] + dir[2] * 0.7];

    projectilesRef.current.missiles.push({
      pos,
      dir: [...dir],
      speed: MISSILE_SPEED,
      ttl: MISSILE_LIFETIME,
    });

    if (projectilesRef.current.missiles.length > MAX_MISSILES) {
      projectilesRef.current.missiles.splice(
        0,
        projectilesRef.current.missiles.length - MAX_MISSILES,
      );
    }
  }, []);

  const rings = useMemo(
    () =>
      Array.from({ length: RING_COUNT }, (_, i) => ({
        id: i,
        position: [(Math.random() - 0.5) * 50, Math.random() * 20, -i * 30 - 60],
      })),
    [],
  );

  const predictWebcamRef = useRef(null);

  const scheduleNextFrame = useCallback(() => {
    rafIdRef.current = window.requestAnimationFrame(() => {
      predictWebcamRef.current?.();
    });
  }, []);

  const onVideoReady = useCallback(() => {
    if (cancelledRef.current) return;
    if (rafIdRef.current != null) return;
    scheduleNextFrame();
  }, [scheduleNextFrame]);

  const stopTracking = useCallback(() => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop());
      webcamStreamRef.current = null;
    }

    if (faceLandmarkerRef.current?.close) {
      faceLandmarkerRef.current.close();
    }

    faceLandmarkerRef.current = null;
    trackingStartedRef.current = false;
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    return () => {
      cancelledRef.current = true;
      stopTracking();
    };
  }, [stopTracking]);

  const startCalibration = useCallback(() => {
    calibratedRef.current = false;
    calibrationRef.current = {
      startMs: null,
      frames: 0,
      openSum: 0,
      xSum: 0,
      ySum: 0,
    };

    mouthOpenRef.current = 0;
    mouthXRef.current = 0;
    mouthYRef.current = 0;

    scoreRef.current = 0;
    if (scoreElRef.current) scoreElRef.current.textContent = '0';
    if (speedElRef.current) speedElRef.current.textContent = '0';

    projectilesRef.current.lasers.length = 0;
    projectilesRef.current.missiles.length = 0;
    projectilesRef.current.enemyLasers.length = 0;
    enemiesRef.current.length = 0;
    explosionsRef.current.length = 0;

    setPaused(false);
    setPhase('calibrating');
    setStatusText('Calibrando... Mantén boca neutral 5 seg');
  }, []);

  useEffect(() => {
    predictWebcamRef.current = () => {
      if (cancelledRef.current) return;

      const faceLandmarker = faceLandmarkerRef.current;
      const video = webcamElRef.current;
      if (!faceLandmarker || !video) {
        scheduleNextFrame();
        return;
      }

      const now = performance.now();
      const results = faceLandmarker.detectForVideo(video, now);
      const landmarks = results?.faceLandmarks?.[0];

      if (landmarks) {
        const mouthOpenScore = computeMouthOpenFromLandmarks(landmarks);
        const offsets = computeMouthOffsetsFromLandmarks(landmarks);

        if (!calibratedRef.current) {
          const cal = calibrationRef.current;
          if (cal.startMs === null) cal.startMs = now;

          cal.openSum += mouthOpenScore;
          cal.xSum += offsets.x;
          cal.ySum += offsets.y;
          cal.frames += 1;

          if (now - cal.startMs >= CALIBRATION_DURATION_MS) {
            const frames = cal.frames || 1;
            neutralRef.current = {
              open: cal.openSum / frames,
              x: cal.xSum / frames,
              y: cal.ySum / frames,
            };

            calibratedRef.current = true;
            setPhase('playing');
            setStatusText('');
          }
        } else {
          const { invertX, sensOpen, sensX, sensY } = settingsRef.current;
          const neutral = neutralRef.current;

          const openRaw = computeMouthOpen(mouthOpenScore, neutral.open, sensOpen);
          const open = Math.max(0, Math.min(1, openRaw));

          let x = (offsets.x - neutral.x) * sensX;
          if (invertX) x = -x;
          x = Math.max(-1, Math.min(1, x));

          let y = (offsets.y - neutral.y) * sensY;
          y = Math.max(-1, Math.min(1, y));

          mouthOpenRef.current = open;
          mouthXRef.current = x;
          mouthYRef.current = y;
        }
      }

      scheduleNextFrame();
    };
  }, [scheduleNextFrame]);

  const ensureTracking = useCallback(async () => {
    setErrorText(null);

    if (!window.isSecureContext) {
      setPhase('error');
      setStatusText('');
      setErrorText(
        'Necesitas HTTPS con un certificado confiable para usar la cámara (iPhone). Usa mkcert (ver README).',
      );
      return false;
    }

    const videoEl = webcamElRef.current;
    if (!(videoEl instanceof HTMLVideoElement)) {
      setPhase('error');
      setStatusText('');
      setErrorText('Video element not ready.');
      return false;
    }

    if (trackingStartedRef.current) return true;

    setPhase('starting');
    setStatusText('Solicitando cámara...');

    stopTracking();

    try {
      const mp = await import('@mediapipe/tasks-vision');
      const { FaceLandmarker, FilesetResolver } = mp;

      const wasmBase = `${import.meta.env.BASE_URL}mediapipe/wasm`;
      const resolver = await FilesetResolver.forVisionTasks(wasmBase);

      const createLandmarker = (delegate) =>
        FaceLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate,
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        });

      try {
        faceLandmarkerRef.current = await createLandmarker('GPU');
      } catch (gpuErr) {
        console.warn('[DroneGame] GPU delegate failed, falling back to CPU', gpuErr);
        faceLandmarkerRef.current = await createLandmarker('CPU');
      }

      webcamStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      videoEl.srcObject = webcamStreamRef.current;
      videoEl.addEventListener('loadedmetadata', onVideoReady, { once: true });
      videoEl.addEventListener('loadeddata', onVideoReady, { once: true });

      try {
        // iOS Safari often needs an explicit play() call after a user gesture.
        await videoEl.play();
      } catch (playErr) {
        console.warn('[DroneGame] video.play() failed:', playErr);
      }

      if (videoEl.readyState >= 2) onVideoReady();

      trackingStartedRef.current = true;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[DroneGame] MediaPipe init failed:', err);

      setPhase('error');
      setStatusText('');
      setErrorText(msg);

      trackingStartedRef.current = false;
      stopTracking();
      return false;
    }
  }, [onVideoReady, stopTracking]);

  const handleStart = useCallback(async () => {
    const ok = await ensureTracking();
    if (!ok) return;
    startCalibration();
  }, [ensureTracking, startCalibration]);

  const handleRecalibrate = useCallback(async () => {
    const ok = await ensureTracking();
    if (!ok) return;
    startCalibration();
  }, [ensureTracking, startCalibration]);

  const cycleCameraMode = useCallback(() => {
    setCameraMode((m) => (m === 'visible' ? 'mini' : m === 'mini' ? 'hidden' : 'visible'));
  }, []);

  const voiceKickoffRef = useRef(false);
  const ensureVoice = useCallback(() => {
    if (voiceKickoffRef.current) return;
    voiceKickoffRef.current = true;

    try {
      window.dispatchEvent(new CustomEvent('drone-lips:voice-start'));
    } catch {
      // ignore
    }
  }, []);

  const openChat = useCallback(() => {
    try {
      ensureVoice();
      window.dispatchEvent(new CustomEvent('drone-lips:open-chat'));
    } catch {
      // ignore
    }
  }, [ensureVoice]);

  const showScoreHud = phase !== 'intro';
  const showFullControls = phase !== 'playing' || paused;
  const showCompactControls = phase === 'playing' && !paused;

  useEffect(() => {
    // Don’t let settings overlay stay open during gameplay.
    if (phase === 'playing') setSettingsOpen(false);
  }, [phase]);

  useEffect(() => {
    const onCommand = (event) => {
      const cmd = event?.detail;
      if (!cmd || typeof cmd !== 'object') return;

      switch (cmd.type) {
        case 'start': {
          handleStart().catch(() => undefined);
          return;
        }
        case 'recalibrate': {
          handleRecalibrate().catch(() => undefined);
          return;
        }
        case 'pause': {
          setPaused(true);
          return;
        }
        case 'resume': {
          setPaused(false);
          return;
        }
        case 'togglePause': {
          setPaused((p) => !p);
          return;
        }
        case 'setCameraMode': {
          if (cmd.mode === 'visible' || cmd.mode === 'mini' || cmd.mode === 'hidden') {
            setCameraMode(cmd.mode);
          }
          return;
        }
        case 'cycleCameraMode': {
          cycleCameraMode();
          return;
        }
        case 'setInvertX': {
          if (typeof cmd.value === 'boolean') {
            setSettings((s) => ({
              ...s,
              invertX: cmd.value,
            }));
          }
          return;
        }
        case 'setSensitivity': {
          const axis = cmd.axis;
          const value = Number(cmd.value);
          if (!Number.isFinite(value)) return;

          if (axis === 'open') {
            setSettings((s) => ({
              ...s,
              sensOpen: Math.max(1, Math.min(120, Math.round(value))),
            }));
          }

          if (axis === 'x') {
            setSettings((s) => ({
              ...s,
              sensX: Math.max(1, Math.min(40, Math.round(value))),
            }));
          }

          if (axis === 'y') {
            setSettings((s) => ({
              ...s,
              sensY: Math.max(1, Math.min(40, Math.round(value))),
            }));
          }

          return;
        }
        case 'stop': {
          velocityRef.current = [0, 0, 0];
          manualControlRef.current = { x: 0, y: 0, open: 0, untilMs: 0 };
          return;
        }
        case 'nudge': {
          const durationMs = Number(cmd.durationMs ?? 600);
          const untilMs = performance.now() + (Number.isFinite(durationMs) ? durationMs : 600);

          let x = 0;
          let y = 0;

          if (cmd.direction === 'left') x = -1;
          if (cmd.direction === 'right') x = 1;
          if (cmd.direction === 'up') y = -1;
          if (cmd.direction === 'down') y = 1;

          if (typeof cmd.x === 'number' && Number.isFinite(cmd.x))
            x = Math.max(-1, Math.min(1, cmd.x));
          if (typeof cmd.y === 'number' && Number.isFinite(cmd.y))
            y = Math.max(-1, Math.min(1, cmd.y));

          manualControlRef.current = { x, y, open: 0, untilMs };
          return;
        }
        case 'fireGuns': {
          fireGuns();
          return;
        }
        case 'fireMissile': {
          fireMissile();
          return;
        }
        case 'flip': {
          const direction = cmd.direction;
          const flip = flipRef.current;

          if (!flip) return;

          if (direction === 'left') {
            flip.axis = 'z';
            flip.dir = -1;
            flip.t = 0;
            flip.duration = 0.35;
          }

          if (direction === 'right') {
            flip.axis = 'z';
            flip.dir = 1;
            flip.t = 0;
            flip.duration = 0.35;
          }

          if (direction === 'up') {
            flip.axis = 'x';
            flip.dir = -1;
            flip.t = 0;
            flip.duration = 0.35;
          }

          if (direction === 'down') {
            flip.axis = 'x';
            flip.dir = 1;
            flip.t = 0;
            flip.duration = 0.35;
          }

          return;
        }
        case 'showSettings': {
          setSettingsOpen(true);
          return;
        }
        case 'hideSettings': {
          setSettingsOpen(false);
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener('drone-lips:command', onCommand);
    return () => window.removeEventListener('drone-lips:command', onCommand);
  }, [cycleCameraMode, fireGuns, fireMissile, handleRecalibrate, handleStart]);

  // Keyboard controls for testing without webcam
  const keysRef = useRef({ up: false, down: false, left: false, right: false, w: false });

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!calibratedRef.current) {
        // Allow space/enter to start calibration
        if (e.code === 'Space' || e.code === 'Enter') {
          if (phase === 'intro' || phase === 'calibrating') {
            // Skip calibration for keyboard mode - auto-calibrate
            calibratedRef.current = true;
            setPhase('playing');
            setStatusText('');
          }
        }
        return;
      }

      switch (e.code) {
        case 'ArrowUp':
          keysRef.current.up = true;
          e.preventDefault();
          break;
        case 'ArrowDown':
          keysRef.current.down = true;
          e.preventDefault();
          break;
        case 'ArrowLeft':
          keysRef.current.left = true;
          e.preventDefault();
          break;
        case 'ArrowRight':
          keysRef.current.right = true;
          e.preventDefault();
          break;
        case 'KeyW':
          keysRef.current.w = true;
          e.preventDefault();
          break;
        case 'Space':
          fireGuns();
          e.preventDefault();
          break;
        case 'KeyM':
          fireMissile();
          e.preventDefault();
          break;
      }
    };

    const onKeyUp = (e) => {
      switch (e.code) {
        case 'ArrowUp':
          keysRef.current.up = false;
          break;
        case 'ArrowDown':
          keysRef.current.down = false;
          break;
        case 'ArrowLeft':
          keysRef.current.left = false;
          break;
        case 'ArrowRight':
          keysRef.current.right = false;
          break;
        case 'KeyW':
          keysRef.current.w = false;
          break;
      }
    };

    // Update manual controls based on keyboard state
    const updateKeyboardControls = () => {
      if (!calibratedRef.current || pausedRef.current) return;

      const keys = keysRef.current;
      let x = 0;
      let y = 0;
      let open = 0;

      if (keys.left) x = -0.8;
      if (keys.right) x = 0.8;
      if (keys.up) y = -0.8;
      if (keys.down) y = 0.8;
      if (keys.w) open = 0.8;

      // Apply keyboard input to mouth controls
      if (x !== 0 || y !== 0 || open !== 0) {
        mouthOpenRef.current = open;
        mouthXRef.current = x;
        mouthYRef.current = y;
      }
    };

    const interval = setInterval(updateKeyboardControls, 16);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      clearInterval(interval);
    };
  }, [phase, fireGuns, fireMissile]);

  const videoStyle = useMemo(() => {
    if (cameraMode === 'hidden') {
      return {
        position: 'absolute',
        top: -10000,
        left: -10000,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      };
    }

    const width = cameraMode === 'visible' ? 220 : 120;

    return {
      position: 'absolute',
      top: 16,
      right: 16,
      width,
      maxWidth: '45vw',
      borderRadius: 12,
      zIndex: 30,
      transform: 'scaleX(-1)',
      background: 'rgba(0,0,0,0.35)',
      border: '1px solid rgba(255,255,255,0.12)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      pointerEvents: 'none',
    };
  }, [cameraMode]);

  const rootStyle = useMemo(
    () => ({
      position: 'fixed',
      inset: 0,
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }),
    [],
  );

  const hudStyle = useMemo(
    () => ({
      position: 'absolute',
      top: 16,
      left: 16,
      zIndex: 50,
      color: 'white',
      background: 'rgba(0,0,0,0.55)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: 12,
      padding: 12,
      minWidth: 240,
      maxWidth: 'calc(100vw - 32px)',
      backdropFilter: 'blur(8px)',
    }),
    [],
  );

  const controlsDockStyle = useMemo(
    () => ({
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      zIndex: 60,
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 12,
      pointerEvents: 'none',
    }),
    [],
  );

  const centerPillStyle = useMemo(
    () => ({
      pointerEvents: 'auto',
      color: 'white',
      background: 'rgba(0,0,0,0.55)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: 999,
      padding: 8,
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backdropFilter: 'blur(8px)',
    }),
    [],
  );

  const dockBtnStyle = useMemo(
    () => ({
      pointerEvents: 'auto',
      padding: '10px 12px',
      borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.18)',
      background: 'rgba(255,255,255,0.10)',
      color: 'white',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
      fontWeight: 700,
    }),
    [],
  );

  const actionBtnBaseStyle = useMemo(
    () => ({
      pointerEvents: 'auto',
      borderRadius: '50%',
      border: '1px solid rgba(255,255,255,0.26)',
      color: 'rgba(255,255,255,0.96)',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      cursor: 'pointer',
      backdropFilter: 'blur(18px) saturate(180%)',
      boxShadow:
        '0 18px 42px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -18px 26px rgba(0,0,0,0.28)',
      transition: 'transform 120ms ease, filter 120ms ease',
      outline: 'none',
    }),
    [],
  );

  const actionBtnSheenStyle = useMemo(
    () => ({
      position: 'absolute',
      inset: -1,
      borderRadius: '50%',
      pointerEvents: 'none',
      background:
        'radial-gradient(circle at 30% 22%, rgba(255,255,255,0.55), rgba(255,255,255,0) 55%), linear-gradient(180deg, rgba(255,255,255,0.20), rgba(255,255,255,0) 60%)',
      opacity: 0.9,
    }),
    [],
  );

  const actionBtnRimStyle = useMemo(
    () => ({
      position: 'absolute',
      inset: 0,
      borderRadius: '50%',
      pointerEvents: 'none',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12), inset 0 0 0 2px rgba(0,0,0,0.18)',
    }),
    [],
  );

  const actionBtnContentStyle = useMemo(
    () => ({
      position: 'relative',
      zIndex: 2,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      width: '100%',
      height: '100%',
      lineHeight: 1,
    }),
    [],
  );

  const actionBtnLabelStyle = useMemo(
    () => ({
      fontSize: 12,
      fontWeight: 900,
      letterSpacing: 1,
      textTransform: 'uppercase',
      textShadow: '0 2px 14px rgba(0,0,0,0.55)',
      opacity: 0.98,
    }),
    [],
  );

  const actionBtnIconStyle = useMemo(
    () => ({
      width: 26,
      height: 26,
      filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.55))',
      opacity: 0.95,
    }),
    [],
  );

  const gunsBtnStyle = useMemo(
    () => ({
      ...actionBtnBaseStyle,
      width: 90,
      height: 90,
      background:
        'radial-gradient(circle at 45% 120%, rgba(255,80,80,0.62), rgba(255,80,80,0) 62%), radial-gradient(circle at 65% 110%, rgba(0,0,0,0.35), rgba(0,0,0,0) 62%), linear-gradient(160deg, rgba(255,255,255,0.20), rgba(255,255,255,0.06) 46%, rgba(0,0,0,0.22))',
    }),
    [actionBtnBaseStyle],
  );

  const missileBtnStyle = useMemo(
    () => ({
      ...actionBtnBaseStyle,
      width: 78,
      height: 78,
      background:
        'radial-gradient(circle at 45% 120%, rgba(255,196,74,0.58), rgba(255,196,74,0) 62%), radial-gradient(circle at 65% 110%, rgba(0,0,0,0.35), rgba(0,0,0,0) 62%), linear-gradient(160deg, rgba(255,255,255,0.20), rgba(255,255,255,0.06) 46%, rgba(0,0,0,0.22))',
    }),
    [actionBtnBaseStyle],
  );

  const actionStackStyle = useMemo(
    () => ({
      display: 'grid',
      gap: 18,
      justifyItems: 'end',
      pointerEvents: 'none',
    }),
    [],
  );

  const canvasDpr = useMemo(() => (isIOS ? 1 : [1, 1.5]), [isIOS]);

  const canvasGl = useMemo(
    () => ({
      antialias: !isIOS,
      alpha: false,
      powerPreference: isIOS ? 'default' : 'high-performance',
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.1,
    }),
    [isIOS],
  );

  const onCanvasCreated = useCallback(({ gl }) => {
    const canvas = gl?.domElement;
    if (!canvas?.addEventListener) return;

    const onLost = (e) => {
      e.preventDefault?.();
      setRendererError(
        'WebGL context lost (iOS can do this under memory pressure). Reload and try Low Power Mode off.',
      );
    };

    const onRestored = () => {
      setRendererError(null);
    };

    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);
  }, []);

  const canvasFallback = useMemo(
    () => (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          color: 'white',
          background:
            'radial-gradient(circle at 30% 20%, rgba(40,90,180,0.35), rgba(0,0,0,0.92))',
        }}
      >
        <div
          style={{
            width: 520,
            maxWidth: '100%',
            padding: 18,
            borderRadius: 16,
            background: 'rgba(0,0,0,0.68)',
            border: '1px solid rgba(255,255,255,0.14)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Graphics Error</div>
          <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.4 }}>
            Your browser failed to start WebGL for the 3D scene.
            <br />
            Try reloading, turning off Low Power Mode, and using Safari (not an in-app browser).
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.14)',
              color: 'white',
              fontWeight: 700,
            }}
          >
            Reload
          </button>
        </div>
      </div>
    ),
    [],
  );

  if (!webglSupported) {
    return (
      <div style={rootStyle}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            color: 'white',
            background:
              'radial-gradient(circle at 30% 20%, rgba(40,90,180,0.35), rgba(0,0,0,0.92))',
          }}
        >
          <div
            style={{
              width: 520,
              maxWidth: '100%',
              padding: 18,
              borderRadius: 16,
              background: 'rgba(0,0,0,0.68)',
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>WebGL Not Available</div>
            <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.4 }}>
              This device/browser can’t create a WebGL context, so the 3D game can’t render.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={rootStyle} onPointerDownCapture={ensureVoice}>
      <CanvasErrorBoundary fallback={canvasFallback}>
        <Canvas dpr={canvasDpr} gl={canvasGl} onCreated={onCanvasCreated} style={{ width: '100%', height: '100%' }}>
          <Scene
            calibratedRef={calibratedRef}
            pausedRef={pausedRef}
            manualControlRef={manualControlRef}
            flipRef={flipRef}
            projectilesRef={projectilesRef}
            enemiesRef={enemiesRef}
            explosionsRef={explosionsRef}
            resetRun={resetRun}
            droneRef={droneRef}
            rings={rings}
            velocityRef={velocityRef}
            dronePosRef={dronePosRef}
            droneRotRef={droneRotRef}
            scoreRef={scoreRef}
            scoreElRef={scoreElRef}
            speedElRef={speedElRef}
            mouthOpenRef={mouthOpenRef}
            mouthXRef={mouthXRef}
            mouthYRef={mouthYRef}
            droneSkinId={droneSkinId}
          />
        </Canvas>
      </CanvasErrorBoundary>

      <video ref={webcamElRef} autoPlay playsInline muted style={videoStyle} />

      {rendererError ? (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'rgba(0,0,0,0.55)',
          }}
        >
          <div
            style={{
              width: 520,
              maxWidth: '100%',
              padding: 18,
              borderRadius: 16,
              color: 'white',
              background: 'rgba(0,0,0,0.72)',
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 20px 50px rgba(0,0,0,0.65)',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Graphics Interrupted</div>
            <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.4 }}>{rendererError}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.14)',
                  color: 'white',
                  fontWeight: 700,
                }}
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => setRendererError(null)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.08)',
                  color: 'white',
                  fontWeight: 700,
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={hudStyle}>
        {statusText ? (
          <div
            style={{
              marginBottom: 10,
              padding: '8px 10px',
              borderRadius: 10,
              background: 'rgba(255,215,0,0.95)',
              color: '#111',
              fontWeight: 700,
            }}
          >
            {statusText}
          </div>
        ) : null}

        {errorText ? (
          <div
            style={{
              marginBottom: 10,
              padding: '8px 10px',
              borderRadius: 10,
              background: 'rgba(255,80,80,0.25)',
              border: '1px solid rgba(255,120,120,0.35)',
            }}
          >
            {errorText}
          </div>
        ) : null}

        {showScoreHud ? (
          <div style={{ fontSize: 14, marginBottom: 10 }}>
            Puntos: <span ref={scoreElRef}>0</span> · Vel: <span ref={speedElRef}>0</span>
          </div>
        ) : null}

        {showFullControls ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {phase === 'intro' ? (
                <button
                  type="button"
                  onClick={handleStart}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(255,255,255,0.14)',
                    color: 'white',
                  }}
                >
                  Start
                </button>
              ) : null}

              <button
                type="button"
                onClick={handleRecalibrate}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.10)',
                  color: 'white',
                }}
              >
                Recalibrate
              </button>

              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                disabled={phase === 'intro' || phase === 'starting' || phase === 'error'}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.10)',
                  color: 'white',
                  opacity: phase === 'intro' || phase === 'starting' || phase === 'error' ? 0.5 : 1,
                }}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>

              <button
                type="button"
                onClick={cycleCameraMode}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.10)',
                  color: 'white',
                }}
              >
                Camera: {cameraMode}
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: settingsOpen ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.10)',
                  color: 'white',
                }}
              >
                Settings
              </button>

              <button
                type="button"
                onClick={openChat}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(120,210,255,0.22)',
                  color: 'white',
                }}
              >
                Chat
              </button>
            </div>

            {settingsOpen ? (
              <div style={{ marginTop: 12, fontSize: 13, opacity: 0.95 }}>
                <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <div>Drone: {selectedDroneSkin.name}</div>
                    <select
                      value={droneSkinId}
                      onChange={(e) => setDroneSkinId(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: 'rgba(0,0,0,0.35)',
                        color: 'white',
                        outline: 'none',
                      }}
                    >
                      {DRONE_SKINS.map((s) => (
                        <option key={s.id} value={s.id} style={{ color: '#111' }}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedDroneSkin.preview ? (
                    <img
                      src={selectedDroneSkin.preview}
                      alt={selectedDroneSkin.name}
                      style={{
                        width: '100%',
                        height: 90,
                        objectFit: 'cover',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(0,0,0,0.25)',
                      }}
                      loading="lazy"
                    />
                  ) : null}

                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    To enable a real 3D model, drop a GLB at: {selectedDroneModelHint}
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={settings.invertX}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        invertX: e.target.checked,
                      }))
                    }
                  />
                  Invert X
                </label>

                <div style={{ display: 'grid', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <div>Speed sensitivity: {settings.sensOpen}</div>
                    <input
                      type="range"
                      min={5}
                      max={80}
                      step={1}
                      value={settings.sensOpen}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          sensOpen: Number(e.target.value),
                        }))
                      }
                    />
                  </label>

                  <label style={{ display: 'grid', gap: 6 }}>
                    <div>Turn sensitivity: {settings.sensX}</div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={1}
                      value={settings.sensX}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          sensX: Number(e.target.value),
                        }))
                      }
                    />
                  </label>

                  <label style={{ display: 'grid', gap: 6 }}>
                    <div>Vertical sensitivity: {settings.sensY}</div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={1}
                      value={settings.sensY}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          sensY: Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {showCompactControls ? (
        <div style={controlsDockStyle}>
          <div style={centerPillStyle}>
            <button type="button" onClick={() => setPaused(true)} style={dockBtnStyle}>
              Pause
            </button>
            <button type="button" onClick={cycleCameraMode} style={dockBtnStyle}>
              Cam
            </button>
            <button type="button" onClick={openChat} style={dockBtnStyle}>
              Chat
            </button>
          </div>

          <div style={actionStackStyle}>
            <button
              type="button"
              onClick={fireMissile}
              onPointerDown={() => setActionPressed('missile')}
              onPointerUp={() => setActionPressed(null)}
              onPointerCancel={() => setActionPressed(null)}
              onPointerLeave={() => setActionPressed(null)}
              style={{
                ...missileBtnStyle,
                transform: actionPressed === 'missile' ? 'scale(0.965)' : 'scale(1)',
                filter: actionPressed === 'missile' ? 'brightness(1.12) saturate(1.2)' : 'none',
              }}
              aria-label="Missile"
            >
              <div aria-hidden style={actionBtnSheenStyle} />
              <div aria-hidden style={actionBtnRimStyle} />
              <div style={actionBtnContentStyle}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  style={actionBtnIconStyle}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 11.5L21 3l-8.5 18-2.2-7.2L3 11.5z" />
                  <path d="M10.3 13.8l-1.9 4.1" />
                </svg>
                <div style={actionBtnLabelStyle}>Missile</div>
              </div>
            </button>
            <button
              type="button"
              onClick={fireGuns}
              onPointerDown={() => setActionPressed('guns')}
              onPointerUp={() => setActionPressed(null)}
              onPointerCancel={() => setActionPressed(null)}
              onPointerLeave={() => setActionPressed(null)}
              style={{
                ...gunsBtnStyle,
                transform: actionPressed === 'guns' ? 'scale(0.965)' : 'scale(1)',
                filter: actionPressed === 'guns' ? 'brightness(1.12) saturate(1.2)' : 'none',
              }}
              aria-label="Guns"
            >
              <div aria-hidden style={actionBtnSheenStyle} />
              <div aria-hidden style={actionBtnRimStyle} />
              <div style={actionBtnContentStyle}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  style={actionBtnIconStyle}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="4.5" />
                  <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                  <path d="M12 9.5v5M9.5 12h5" opacity="0.65" />
                </svg>
                <div style={actionBtnLabelStyle}>Guns</div>
              </div>
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'intro' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background:
              'radial-gradient(circle at 30% 20%, rgba(40,90,180,0.35), rgba(0,0,0,0.92))',
          }}
        >
          <div
            style={{
              width: 520,
              maxWidth: '100%',
              padding: 18,
              borderRadius: 16,
              background: 'rgba(0,0,0,0.68)',
              border: '1px solid rgba(255,255,255,0.14)',
              color: 'white',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>Drone Lips</div>
            <div style={{ fontSize: 16, opacity: 0.9, marginBottom: 12 }}>How the game works</div>

            <div style={{ fontSize: 14, lineHeight: 1.4, opacity: 0.95 }}>
              <div style={{ marginBottom: 8 }}>
                • Tap Start to activate the camera (required on iPhone).
              </div>
              <div style={{ marginBottom: 8 }}>
                • Keep your mouth neutral for 5 seconds to calibrate.
              </div>
              <div style={{ marginBottom: 8 }}>• Open mouth = speed boost.</div>
              <div style={{ marginBottom: 8 }}>• Move mouth left/right = steer.</div>
              <div style={{ marginBottom: 12 }}>• Move mouth up/down = fly up/down.</div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleStart}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.16)',
                  color: 'white',
                  fontWeight: 700,
                }}
              >
                Start
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.10)',
                  color: 'white',
                }}
              >
                Settings
              </button>
            </div>

            {errorText ? (
              <div style={{ marginTop: 10, color: '#ffb4b4', fontSize: 13 }}>{errorText}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
