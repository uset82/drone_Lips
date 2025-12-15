import * as THREE from 'three';

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { Drone } from './Drone';
import { Enemy, type EnemyConfig, type EnemyKind, type EnemySpawnBounds } from './Enemy';
import { LaserShot, MissileShot } from './Projectiles';
import type { InputState } from './input/InputState';
import { getLevelConfig, type LevelConfig } from './levels';
import { clamp, randInt } from './math';
import { createWorld } from './worlds/createWorld';
import type { World } from './worlds/World';

export type RefLike<T> = { current: T };

export type GameInput = {
  state: RefLike<InputState>;
  update: (nowMs: number) => void;
};

export type GameHudRefs = {
  scoreEl: RefLike<HTMLSpanElement | null>;
  speedEl: RefLike<HTMLSpanElement | null>;
};

export type GameCallbacks = {
  onRendererError?: (msg: string | null) => void;
  onHitFlash?: () => void;
};

export type GameOptions = {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  isIOS: boolean;
  input: GameInput;
  levelId?: number;
  hud?: GameHudRefs;
  callbacks?: GameCallbacks;
};

const PLAYER_RADIUS = 1.1;

const MAX_LASERS = 140;
const MAX_MISSILES = 8;

const GUN_BURST_COUNT = 5;
const GUN_BURST_INTERVAL_MS = 70;
const GUN_HOLD_INTERVAL_MS = 95;

const LASER_SPEED = 58;
const LASER_TTL = 1.1;
const LASER_Z_MAX = 260;

const MISSILE_SPEED = 26;
const MISSILE_TTL = 3.2;
const MISSILE_TURN_RATE = 4.2;

const STRAFE_SPEED = 10;

type EnemySlot = {
  enemy: Enemy;
  deadUntilMs: number;
};

type Explosion = {
  mesh: THREE.Mesh;
  age: number;
  lifetime: number;
  startScale: number;
};

function createEnemyMesh(kind: EnemyKind) {
  if (kind === 'ship') {
    const group = new THREE.Group();
    group.renderOrder = 2;

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    const panelMat = new THREE.MeshStandardMaterial({
      color: '#7a0a1f',
      emissive: '#ff2d55',
      emissiveIntensity: 0.55,
      metalness: 0.25,
      roughness: 0.42,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: '#1b1014',
      metalness: 0.65,
      roughness: 0.3,
    });
    const coreMat = new THREE.MeshStandardMaterial({
      color: '#24262c',
      emissive: '#ff2d55',
      emissiveIntensity: 0.28,
      metalness: 0.85,
      roughness: 0.22,
    });

    materials.push(panelMat, frameMat, coreMat);

    const wingGeo = new THREE.BoxGeometry(1.55, 2.45, 0.16);
    const wingFrameGeo = new THREE.BoxGeometry(1.7, 2.6, 0.06);
    const barGeo = new THREE.CylinderGeometry(0.085, 0.085, 3.6, 14, 1, false);
    const coreGeo = new THREE.SphereGeometry(0.42, 24, 24);
    const ringGeo = new THREE.TorusGeometry(0.52, 0.085, 12, 26);

    geometries.push(wingGeo, wingFrameGeo, barGeo, coreGeo, ringGeo);

    const leftWing = new THREE.Mesh(wingGeo, panelMat);
    leftWing.position.set(-1.9, 0, 0);
    group.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeo, panelMat);
    rightWing.position.set(1.9, 0, 0);
    group.add(rightWing);

    const leftFrame = new THREE.Mesh(wingFrameGeo, frameMat);
    leftFrame.position.set(-1.9, 0, -0.11);
    group.add(leftFrame);

    const rightFrame = new THREE.Mesh(wingFrameGeo, frameMat);
    rightFrame.position.set(1.9, 0, -0.11);
    group.add(rightFrame);

    const bar = new THREE.Mesh(barGeo, frameMat);
    bar.rotation.z = Math.PI / 2;
    group.add(bar);

    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    const ring = new THREE.Mesh(ringGeo, frameMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.z = 0.08;
    group.add(ring);

    const glowGeo = new THREE.SphereGeometry(0.11, 10, 10);
    const glowMat = new THREE.MeshBasicMaterial({
      color: '#ff2d55',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geometries.push(glowGeo);
    materials.push(glowMat);

    const engineGlow = new THREE.Mesh(glowGeo, glowMat);
    engineGlow.position.set(0, -0.08, -0.65);
    group.add(engineGlow);

    group.scale.setScalar(1.05);

    return {
      mesh: group,
      dispose: () => {
        for (const g of geometries) g.dispose();
        for (const m of materials) m.dispose();
      },
    };
  }

  const geo = new THREE.IcosahedronGeometry(1.2, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: '#ff2d55',
    emissive: '#ff1a1a',
    emissiveIntensity: 0.85,
    metalness: 0.35,
    roughness: 0.42,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, dispose: () => (geo.dispose(), mat.dispose()) };
}

function findNearestEnemy(enemies: EnemySlot[], from: THREE.Vector3): Enemy | null {
  let best: { d2: number; e: Enemy } | null = null;
  for (const slot of enemies) {
    const e = slot.enemy;
    if (!e.alive) continue;
    const dx = e.mesh.position.x - from.x;
    const dy = e.mesh.position.y - from.y;
    const dz = e.mesh.position.z - from.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (!best || d2 < best.d2) best = { d2, e };
  }
  return best?.e ?? null;
}

export class Game {
  private readonly opts: GameOptions;

  private running = false;
  private crashed = false;
  private raf = 0;
  private lastMs = performance.now();

  private level: LevelConfig = getLevelConfig(8);
  private world: World | null = null;

  private readonly score = { value: 1 };
  private speedBase = 0;
  private speed = 0;
  private readonly pos = new THREE.Vector3(0, 0, 0);

  private gunBurstRemaining = 0;
  private gunBurstNextMs = 0;
  private lastGunFireMs = 0;

  private readonly laserSpawnPos = new THREE.Vector3();
  private readonly laserSpawnVel = new THREE.Vector3(0, 0, LASER_SPEED);
  private readonly missileSpawnPos = new THREE.Vector3();
  private readonly missileSpawnVel = new THREE.Vector3(0, 0, MISSILE_SPEED);
  private readonly camTarget = new THREE.Vector3();

  private renderer: THREE.WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private fxaaPass: ShaderPass | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private drone: Drone | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  private enemies: EnemySlot[] = [];
  private enemyDisposers: Array<() => void> = [];

  private lasers: { mesh: THREE.InstancedMesh; items: LaserShot[]; temp: THREE.Object3D } | null = null;
  private missiles: Array<{ shot: MissileShot; mesh: THREE.Mesh; trail: THREE.Mesh }> = [];
  private explosions: Explosion[] = [];

  private laserGeo: THREE.BufferGeometry | null = null;
  private laserMat: THREE.Material | null = null;
  private missileGeo: THREE.BufferGeometry | null = null;
  private missileMat: THREE.Material | null = null;
  private trailGeo: THREE.BufferGeometry | null = null;
  private trailMat: THREE.Material | null = null;
  private expGeo: THREE.BufferGeometry | null = null;
  private expMat: THREE.Material | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private readonly boundResize = () => this.resize();

  constructor(options: GameOptions) {
    this.opts = options;
    this.init();
    this.setLevel(options.levelId ?? 8);
    this.startLoop();
  }

  setRunning(running: boolean) {
    this.running = running;
  }

  setLevel(levelId: number) {
    const scene = this.scene;
    if (!scene) return;

    const next = getLevelConfig(levelId);
    this.level = next;

    this.world?.dispose();
    this.world = null;

    this.disposeEnemies();

    const world = createWorld({ scene, isIOS: this.opts.isIOS, level: next });
    world.create();
    this.world = world;

    this.createEnemiesForLevel();
    this.reset('reset');
  }

  private addScore(amount: number) {
    const delta = Math.max(0, Math.floor(amount));
    if (!delta) return;
    this.score.value += delta;
    if (this.opts.hud?.scoreEl.current) this.opts.hud.scoreEl.current.textContent = `${this.score.value}`;
  }

  private getEnemyKillReward(): number {
    const min = Math.max(1, Math.floor(this.level.enemyScoreMin));
    const max = Math.max(min, Math.floor(this.level.enemyScoreMax));
    return randInt(min, max);
  }

  private updateSpeed(dt: number, boost: number, stopActive: boolean) {
    const baseSpeed = Math.max(0, this.level.baseSpeed);
    const maxSpeed = Math.max(baseSpeed, this.level.maxSpeed);
    const accel = Math.max(0, this.level.accelPerSec);
    const boostMult = Math.max(1, this.level.boostMultiplier);

    if (stopActive) {
      this.speedBase = baseSpeed;
      this.speed = 0;
      return;
    }

    if (this.level.autoForward) {
      this.speedBase = clamp(this.speedBase + accel * dt, baseSpeed, maxSpeed);
      const target = clamp(this.speedBase * (1 + boost * (boostMult - 1)), 0, maxSpeed);
      const t = 1 - Math.exp(-8 * dt);
      this.speed = THREE.MathUtils.lerp(this.speed, target, t);
      return;
    }

    // Manual forward: use boost as a simple throttle (useful for Level 1 tutorial).
    const target = clamp(baseSpeed + boost * (maxSpeed - baseSpeed), 0, maxSpeed);
    const t = 1 - Math.exp(-10 * dt);
    this.speed = THREE.MathUtils.lerp(this.speed, target, t);
    this.speedBase = baseSpeed;
  }

  private computeEnemyPoolSize(level: LevelConfig): number {
    const rate = Number(level.enemyRate);
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    const est = Math.round(rate * 16);
    return Math.max(0, Math.min(20, est));
  }

  private createEnemiesForLevel() {
    const scene = this.scene;
    const world = this.world;
    if (!scene || !world) return;

    const count = this.computeEnemyPoolSize(this.level);
    if (count <= 0) return;

    const enemyCfgs: Record<EnemyKind, EnemyConfig> = {
      ship: { kind: 'ship', hp: 3, radius: 1.2, approachSpeed: 7, reward: 10 },
      spike: { kind: 'spike', hp: 2, radius: 1.1, approachSpeed: 9, reward: 5 },
    };

    const enemyDisposers: Array<() => void> = [];
    const enemies: EnemySlot[] = [];
    const bounds: EnemySpawnBounds = world.enemySpawnBounds;

    for (let i = 0; i < count; i += 1) {
      const kind: EnemyKind = Math.random() < 0.65 ? 'ship' : 'spike';
      const meshObj = createEnemyMesh(kind);
      scene.add(meshObj.mesh);

      enemyDisposers.push(() => {
        scene.remove(meshObj.mesh);
        meshObj.dispose();
      });

      const e = new Enemy(i + 1, kind, meshObj.mesh, enemyCfgs[kind]);
      e.spawn(bounds, 0);
      enemies.push({ enemy: e, deadUntilMs: 0 });
    }

    this.enemies = enemies;
    this.enemyDisposers = enemyDisposers;
  }

  private disposeEnemies() {
    for (const d of this.enemyDisposers) d();
    this.enemyDisposers = [];
    this.enemies = [];
  }

  reset(reason: 'reset' | 'hit' = 'reset') {
    this.score.value = 1;
    this.speedBase = Math.max(0, this.level.baseSpeed);
    this.speed = 0;
    this.pos.set(0, 0, 0);

    this.gunBurstRemaining = 0;
    this.gunBurstNextMs = 0;
    this.lastGunFireMs = 0;

    this.opts.hud?.scoreEl.current && (this.opts.hud.scoreEl.current.textContent = '1');
    this.opts.hud?.speedEl.current && (this.opts.hud.speedEl.current.textContent = '0.0');

    const drone = this.drone;
    if (drone) drone.position.copy(this.pos);

    this.world?.reset(this.pos);

    const bounds: EnemySpawnBounds = this.world?.enemySpawnBounds ?? { xRange: 12, yRange: 7, zMin: 110, zMax: 190 };
    for (const slot of this.enemies) {
      slot.deadUntilMs = 0;
      slot.enemy.spawn(bounds, this.pos.y);
    }

    const lasers = this.lasers?.items;
    if (lasers) for (const l of lasers) l.active = false;
    for (const m of this.missiles) m.shot.active = false;
    for (const e of this.explosions) {
      e.mesh.visible = false;
      e.age = e.lifetime;
    }

    if (reason === 'hit') this.opts.callbacks?.onHitFlash?.();
  }

  queueGunBurst(count = GUN_BURST_COUNT) {
    if (!this.running) return;
    const now = performance.now();
    this.gunBurstRemaining = Math.min(25, this.gunBurstRemaining + Math.max(1, Math.floor(count)));
    if (this.gunBurstNextMs < now) this.gunBurstNextMs = now;
  }

  fireMissile() {
    if (!this.running) return;
    const slot = this.missiles.find((m) => !m.shot.active);
    if (!slot) return;

    this.missileSpawnPos.set(this.pos.x, this.pos.y - 0.15, this.pos.z + 1.1);
    slot.shot.spawn(this.missileSpawnPos, this.missileSpawnVel, MISSILE_TTL);
    slot.mesh.visible = true;
    slot.trail.visible = true;
  }

  triggerFlip(axis: 'x' | 'z', dir: 1 | -1) {
    this.drone?.triggerFlip(axis, dir);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    const canvas = this.opts.canvas as any;
    canvas?.removeEventListener?.('webglcontextlost', this.onContextLost as any);
    canvas?.removeEventListener?.('webglcontextrestored', this.onContextRestored as any);

    this.world?.dispose();
    this.world = null;

    this.drone?.dispose();
    this.drone = null;

    this.laserGeo?.dispose();
    (this.laserMat as any)?.dispose?.();
    this.missileGeo?.dispose();
    (this.missileMat as any)?.dispose?.();
    this.trailGeo?.dispose();
    (this.trailMat as any)?.dispose?.();
    this.expGeo?.dispose();
    (this.expMat as any)?.dispose?.();

    for (const d of this.enemyDisposers) d();
    this.enemyDisposers = [];
    this.enemies = [];

    this.composer?.dispose();
    this.composer = null;
    this.fxaaPass = null;

    this.envTarget?.dispose();
    this.envTarget = null;
    this.pmrem?.dispose();
    this.pmrem = null;

    this.renderer?.dispose();
    this.renderer = null;

    this.scene = null;
    this.camera = null;
    this.lasers = null;
    this.missiles = [];
    this.explosions = [];
  }

  private init() {
    const { canvas, container, isIOS } = this.opts;
    const dpr = isIOS ? 1 : Math.min(1.5, window.devicePixelRatio || 1);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isIOS,
      alpha: false,
      powerPreference: isIOS ? 'default' : 'high-performance',
    });
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.opts.isIOS ? 1.1 : 1.05;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');
    this.scene = scene;

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.045);
    scene.environment = envTarget.texture;
    this.pmrem = pmrem;
    this.envTarget = envTarget;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
    camera.position.set(0, 3.4, -15);
    this.camera = camera;

    scene.add(new THREE.HemisphereLight('#cbd8ff', '#090913', 0.62));
    const key = new THREE.DirectionalLight('#ffffff', 1.05);
    key.position.set(6, 7, -8);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#9ad6ff', 0.55);
    rim.position.set(-8, 2.5, 10);
    scene.add(rim);

    const drone = new Drone();
    scene.add(drone.group);
    this.drone = drone;

    let composer: EffectComposer | null = null;
    let fxaaPass: ShaderPass | null = null;
    if (!isIOS) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.22, 0.6));
      fxaaPass = new ShaderPass(FXAAShader);
      composer.addPass(fxaaPass);
    }
    this.composer = composer;
    this.fxaaPass = fxaaPass;

    const laserGeo = new THREE.SphereGeometry(0.07, 10, 10);
    const laserMat = new THREE.MeshBasicMaterial({
      color: '#63b3ff',
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.laserGeo = laserGeo;
    this.laserMat = laserMat;
    const laserMesh = new THREE.InstancedMesh(laserGeo, laserMat, MAX_LASERS);
    laserMesh.frustumCulled = false;
    scene.add(laserMesh);
    const laserTemp = new THREE.Object3D();
    const lasers: LaserShot[] = Array.from({ length: MAX_LASERS }, () => new LaserShot());
    this.lasers = { mesh: laserMesh, items: lasers, temp: laserTemp };

    const missileGroup = new THREE.Group();
    scene.add(missileGroup);

    const missileGeo = new THREE.SphereGeometry(0.13, 14, 14);
    const missileMat = new THREE.MeshStandardMaterial({
      color: '#2b2b2b',
      emissive: '#ffb347',
      emissiveIntensity: 2.0,
      metalness: 0.2,
      roughness: 0.55,
    });
    const trailGeo = new THREE.ConeGeometry(0.12, 0.55, 12, 1, true);
    const trailMat = new THREE.MeshBasicMaterial({
      color: '#ff9f0a',
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.missileGeo = missileGeo;
    this.missileMat = missileMat;
    this.trailGeo = trailGeo;
    this.trailMat = trailMat;

    for (let i = 0; i < MAX_MISSILES; i += 1) {
      const m = new THREE.Mesh(missileGeo, missileMat);
      m.visible = false;
      const t = new THREE.Mesh(trailGeo, trailMat);
      t.visible = false;
      missileGroup.add(m);
      missileGroup.add(t);
      this.missiles.push({ shot: new MissileShot(), mesh: m, trail: t });
    }

    const explosions: Explosion[] = [];
    const expGeo = new THREE.SphereGeometry(1, 12, 12);
    const expMat = new THREE.MeshBasicMaterial({
      color: '#ffd36a',
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.expGeo = expGeo;
    this.expMat = expMat;
    for (let i = 0; i < 14; i += 1) {
      const m = new THREE.Mesh(expGeo, expMat);
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      explosions.push({ mesh: m, age: 999, lifetime: 0.5, startScale: 0.7 });
    }
    this.explosions = explosions;

    this.resizeObserver = new ResizeObserver(this.boundResize);
    this.resizeObserver.observe(container);
    this.resize();

    canvas.addEventListener('webglcontextlost', this.onContextLost as any, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored as any, false);
  }

  private resize() {
    const renderer = this.renderer;
    const camera = this.camera;
    const container = this.opts.container;
    if (!renderer || !camera) return;

    const dpr = this.opts.isIOS ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;

    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    this.composer?.setSize(w, h);
    if (this.fxaaPass?.material?.uniforms?.resolution?.value?.set) {
      this.fxaaPass.material.uniforms.resolution.value.set(1 / (w * dpr), 1 / (h * dpr));
    }
  }

  private onContextLost = (e: Event) => {
    e.preventDefault?.();
    this.opts.callbacks?.onRendererError?.(
      'WebGL context lost (common on iOS under memory pressure). Reload and try again.',
    );
  };

  private onContextRestored = () => {
    this.opts.callbacks?.onRendererError?.(null);
  };

  private startLoop() {
    const tick = () => {
      this.raf = window.requestAnimationFrame(tick);
      this.frame();
    };
    tick();
  }

  private frame() {
    if (this.crashed) return;

    try {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    const drone = this.drone;
    const lasers = this.lasers;
    const world = this.world;
    if (!renderer || !scene || !camera || !drone || !lasers || !world) return;

    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;

    this.opts.input.update(nowMs);

    if (!this.running) {
      if (this.composer) this.composer.render();
      else renderer.render(scene, camera);
      return;
    }

    const input = this.opts.input.state.current;

    const stopActive = input.stop;
    const boost = clamp(input.boost, 0, 1);

    const wind = stopActive ? 0 : clamp(this.level.windForce, 0, 1);
    const windDriftX = wind > 0 ? Math.sin(nowMs * 0.00025) * wind * 0.8 : 0;

    // Camera is behind the player looking "forward" (+Z), so screen X is flipped vs world X.
    // Invert movement X here so controls feel natural: Left => left, Right => right.
    const strafeX = clamp(-(input.moveX + windDriftX), -1, 1);
    const strafeY = input.moveY;

    this.updateSpeed(dt, boost, stopActive);

    const bounds = world.playerBounds;
    this.pos.x = clamp(this.pos.x + strafeX * STRAFE_SPEED * dt, bounds.xMin, bounds.xMax);
    this.pos.y = clamp(this.pos.y + strafeY * STRAFE_SPEED * dt, bounds.yMin, bounds.yMax);

    drone.position.copy(this.pos);
    drone.update(dt, { timeMs: nowMs, strafeX, strafeY, speed: this.speed });

    this.camTarget.set(this.pos.x * 0.25, this.pos.y * 0.25 + 3.4, -15);
    camera.position.lerp(this.camTarget, 1 - Math.exp(-4.2 * dt));
    camera.lookAt(this.pos.x * 0.1, this.pos.y * 0.1, 8);

    const worldRes = world.update({
      dt,
      nowMs,
      speed: this.speed,
      playerPos: this.pos,
      playerRadius: PLAYER_RADIUS,
      onCollectPickup: (count) => this.addScore(count * Math.max(1, Math.floor(this.level.pickupScore))),
    });
    if (worldRes.hit) {
      this.reset('hit');
      return;
    }

    // Enemies + collision
    const spawnBounds = world.enemySpawnBounds;
    const behindZ = world.behindZ;
    for (const slot of this.enemies) {
      if (!slot.enemy.alive) {
        if (nowMs >= slot.deadUntilMs) {
          slot.enemy.spawn(spawnBounds, this.pos.y);
          slot.deadUntilMs = 0;
        }
        continue;
      }

      slot.enemy.update(dt, this.speed, this.pos, nowMs);
      if (slot.enemy.kind === 'ship') slot.enemy.mesh.lookAt(this.pos);

      if (slot.enemy.isOutOfRange(behindZ)) {
        slot.enemy.spawn(spawnBounds, this.pos.y);
        continue;
      }

      const ex = slot.enemy.mesh.position.x - this.pos.x;
      const ey = slot.enemy.mesh.position.y - this.pos.y;
      const ez = slot.enemy.mesh.position.z - this.pos.z;
      if (ex * ex + ey * ey + ez * ez < (PLAYER_RADIUS + slot.enemy.radius) * (PLAYER_RADIUS + slot.enemy.radius)) {
        this.reset('hit');
        return;
      }
    }

    if (input.fireMissile) this.fireMissile();
    if (input.flip) this.triggerFlip(input.flip.axis, input.flip.dir);

    // Guns (blink burst + hold)
    if (input.fireGunsBurst) this.queueGunBurst();

    const spawnLaser = () => {
      const shot = lasers.items.find((s) => !s.active);
      if (!shot) return false;
      this.laserSpawnPos.set(this.pos.x, this.pos.y + 0.02, this.pos.z + 1.35);
      shot.spawn(this.laserSpawnPos, this.laserSpawnVel, LASER_TTL);
      return true;
    };

    if (this.gunBurstRemaining > 0 && nowMs >= this.gunBurstNextMs) {
      if (spawnLaser()) {
        this.gunBurstRemaining -= 1;
        this.gunBurstNextMs += GUN_BURST_INTERVAL_MS;
        this.lastGunFireMs = nowMs;
      } else {
        this.gunBurstRemaining = 0;
      }
    } else {
      const wantsHoldFire = input.fireGuns;
      if (wantsHoldFire && nowMs - this.lastGunFireMs >= GUN_HOLD_INTERVAL_MS) {
        if (spawnLaser()) this.lastGunFireMs = nowMs;
      }
    }

    // Lasers simulation
    for (const l of lasers.items) l.update(dt);
    for (const l of lasers.items) {
      if (!l.active) continue;
      if (l.pos.z > LASER_Z_MAX) {
        l.active = false;
        continue;
      }

      for (const slot of this.enemies) {
        const e = slot.enemy;
        if (!e.alive) continue;
        const dx = e.mesh.position.x - l.pos.x;
        const dy = e.mesh.position.y - l.pos.y;
        const dz = e.mesh.position.z - l.pos.z;
        if (dx * dx + dy * dy + dz * dz < (e.radius + 0.32) * (e.radius + 0.32)) {
          l.active = false;
          e.takeDamage(1);

          if (!e.alive) {
            this.addScore(this.getEnemyKillReward());

            const exp = this.explosions.find((x) => !x.mesh.visible);
            if (exp) {
              exp.mesh.visible = true;
              exp.mesh.position.copy(e.mesh.position);
              exp.mesh.scale.setScalar(exp.startScale);
              exp.age = 0;
            }

            slot.deadUntilMs = nowMs + 700 + randInt(0, 600);
          }
          break;
        }
      }
    }

    // Missiles
    for (const m of this.missiles) {
      if (!m.shot.active) {
        m.mesh.visible = false;
        m.trail.visible = false;
        continue;
      }

      const target = findNearestEnemy(this.enemies, m.shot.pos);
      m.shot.update(dt, target ? target.mesh.position : null, MISSILE_TURN_RATE);

      m.mesh.visible = true;
      m.trail.visible = true;

      m.mesh.position.copy(m.shot.pos);
      m.trail.position.copy(m.shot.pos);
      m.trail.position.z -= 0.35;
      m.trail.lookAt(m.shot.pos.x, m.shot.pos.y, m.shot.pos.z + 1);

      if (target) {
        const dx = target.mesh.position.x - m.shot.pos.x;
        const dy = target.mesh.position.y - m.shot.pos.y;
        const dz = target.mesh.position.z - m.shot.pos.z;
        if (dx * dx + dy * dy + dz * dz < (target.radius + 0.5) * (target.radius + 0.5)) {
          m.shot.active = false;
          target.takeDamage(999);
          this.addScore(this.getEnemyKillReward());

          const exp = this.explosions.find((x) => !x.mesh.visible);
          if (exp) {
            exp.mesh.visible = true;
            exp.mesh.position.copy(target.mesh.position);
            exp.mesh.scale.setScalar(exp.startScale * 1.2);
            exp.age = 0;
          }

          const slot = this.enemies.find((s) => s.enemy.id === target.id);
          if (slot) slot.deadUntilMs = nowMs + 800 + randInt(0, 800);
        }
      }

      if (m.shot.pos.z > LASER_Z_MAX) m.shot.active = false;
    }

    // Lasers render instances
    for (let i = 0; i < lasers.items.length; i += 1) {
      const l = lasers.items[i];
      if (!l.active) {
        lasers.temp.position.set(0, -9999, 0);
        lasers.temp.scale.setScalar(0);
      } else {
        lasers.temp.position.copy(l.pos);
        lasers.temp.scale.setScalar(1);
      }
      lasers.temp.updateMatrix();
      lasers.mesh.setMatrixAt(i, lasers.temp.matrix);
    }
    lasers.mesh.instanceMatrix.needsUpdate = true;

    // Explosions
    for (const exp of this.explosions) {
      if (!exp.mesh.visible) continue;
      exp.age += dt;
      const p = clamp(exp.age / exp.lifetime, 0, 1);
      exp.mesh.scale.setScalar(exp.startScale + p * 2.6);
      (exp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - p);
      if (p >= 1) {
        exp.mesh.visible = false;
      }
    }

    if (this.opts.hud?.speedEl.current) this.opts.hud.speedEl.current.textContent = this.speed.toFixed(1);

    if (this.composer) this.composer.render();
    else renderer.render(scene, camera);
    } catch (err) {
      this.crashed = true;
      this.running = false;
      try {
        cancelAnimationFrame(this.raf);
      } catch {
        // ignore
      }

      const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
      const stack = err instanceof Error ? err.stack : null;
      const details = stack ? `${msg}\n\n${stack}` : msg;
      this.opts.callbacks?.onRendererError?.(details);
    }
  }
}
