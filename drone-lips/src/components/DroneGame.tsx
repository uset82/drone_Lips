import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AuggieChat from './AuggieChat.jsx';

import { FaceTracker, type FaceControls } from '../game/FaceTracker';
import { Game } from '../game/Game';
import { LevelManager } from '../game/LevelManager';
import { LEVELS, getLevelConfig } from '../game/levels';
import { VoiceHandler, type VoiceCommand } from '../game/VoiceHandler';
import { InputRouter } from '../game/input/InputRouter';

type Phase = 'intro' | 'starting' | 'calibrating' | 'playing' | 'paused' | 'error';

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ often reports "Macintosh" in the UA.
  return /Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1;
}

function detectWebGLSupport(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function safeRequestFullscreen() {
  const el = document.documentElement as any;
  try {
    el?.requestFullscreen?.();
  } catch {
    // ignore
  }
}

function safeRequestPointerLock(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const anyCanvas = canvas as any;
  try {
    anyCanvas.requestPointerLock?.();
  } catch {
    // ignore
  }
}

export default function DroneGame() {
  const [phase, setPhase] = useState<Phase>('intro');
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const isIOS = useMemo(() => detectIOS(), []);
  const webglSupported = useMemo(() => detectWebGLSupport(), []);

  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');
  const [cameraMode, setCameraMode] = useState<'mini' | 'hidden'>('mini');
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);

  const [levelManager] = useState(() => new LevelManager({ defaultLevelId: 8 }));
  const [levelId, setLevelId] = useState<number>(() => levelManager.levelId);
  const levelIdRef = useRef(levelId);
  useEffect(() => {
    levelIdRef.current = levelId;
  }, [levelId]);

  const level = useMemo(() => getLevelConfig(levelId), [levelId]);
  const [levelPickerOpen, setLevelPickerOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const webcamRef = useRef<HTMLVideoElement | null>(null);

  const scoreElRef = useRef<HTMLSpanElement | null>(null);
  const speedElRef = useRef<HTMLSpanElement | null>(null);

  const togglePause = useCallback(() => {
    setPhase((p) => (p === 'paused' ? 'playing' : p === 'playing' ? 'paused' : p));
  }, []);

  const faceControlsRef = useRef<FaceControls>({
    calibrated: false,
    strafeX: 0,
    strafeY: 0,
    boost: 0,
    mouthOpen: 0,
    fireBurst: false,
    fireHold: false,
  });

  const [stopHeld, setStopHeld] = useState(false);
  const [viewportBottomInset, setViewportBottomInset] = useState(0);

  const inputRouterRef = useRef<InputRouter | null>(null);

  const voiceKickoffRef = useRef(false);

  const faceTrackerRef = useRef<FaceTracker | null>(null);
  const voiceHandlerRef = useRef<VoiceHandler | null>(null);
  const gameRef = useRef<Game | null>(null);

  useEffect(() => {
    try {
      window.dispatchEvent(new Event('drone-lips:booted'));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const bottom = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setViewportBottomInset(Math.min(140, Math.round(bottom)));
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('resize', update);

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    const router = new InputRouter({
      face: faceControlsRef,
      onTogglePause: togglePause,
    });
    inputRouterRef.current = router;
    return () => {
      router.dispose();
      if (inputRouterRef.current === router) inputRouterRef.current = null;
    };
  }, [togglePause]);

  const resetRun = useCallback((reason: 'reset' | 'hit' = 'reset') => {
    setStopHeld(false);
    inputRouterRef.current?.reset();
    gameRef.current?.reset(reason);
  }, []);

  const fireGunsBurst = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    inputRouterRef.current?.queueGunBurst();
  }, []);

  const fireMissile = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    inputRouterRef.current?.queueMissile();
  }, []);

  const applyVoiceCommand = useCallback((cmd: VoiceCommand) => {
    inputRouterRef.current?.handleVoiceCommand(cmd);
  }, []);

  const ensureVoice = useCallback(() => {
    if (voiceKickoffRef.current) return;
    voiceKickoffRef.current = true;
    if (!voiceHandlerRef.current?.supported) return;
    voiceHandlerRef.current.start();
  }, []);

  const handleStart = useCallback(async () => {
    if (phaseRef.current === 'starting' || phaseRef.current === 'calibrating') return;

    setErrorText(null);
    setStatusText('Starting…');
    setPhase('starting');

    resetRun('reset');
    safeRequestFullscreen();
    ensureVoice();

    const face = faceTrackerRef.current;
    const videoEl = webcamRef.current;

    if (face && videoEl) {
      try {
        await face.start(videoEl);
        inputRouterRef.current?.setHasCamera(true);
        face.beginCalibration(5000);
        setPhase('calibrating');
        setStatusText('Calibrando... mantén tu boca neutral (5s)');
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorText(msg);
        inputRouterRef.current?.setHasCamera(false);
      }
    }

    setPhase('playing');
    setStatusText('');
  }, [ensureVoice, resetRun]);

  const handleRecalibrate = useCallback(async () => {
    const face = faceTrackerRef.current;
    const videoEl = webcamRef.current;
    if (!face || !videoEl) return;

    setErrorText(null);
    setPhase('calibrating');
    setStatusText('Calibrando... mantén tu boca neutral (5s)');

    try {
      await face.start(videoEl);
      inputRouterRef.current?.setHasCamera(true);
      face.beginCalibration(5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorText(msg);
      inputRouterRef.current?.setHasCamera(false);
      setPhase('playing');
      setStatusText('');
    }
  }, []);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const cmd = (event as CustomEvent<any>)?.detail;
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
          setPhase('paused');
          return;
        }
        case 'resume': {
          setPhase('playing');
          return;
        }
        case 'togglePause': {
          togglePause();
          return;
        }
        case 'setCameraMode': {
          const mode = cmd.mode === 'visible' ? 'mini' : cmd.mode;
          if (mode === 'mini' || mode === 'hidden') setCameraMode(mode);
          return;
        }
        case 'cycleCameraMode': {
          setCameraMode((m) => (m === 'mini' ? 'hidden' : 'mini'));
          return;
        }
        case 'stop': {
          inputRouterRef.current?.toggleStop();
          return;
        }
        case 'nudge': {
          const durationMs = Number(cmd.durationMs ?? 700);
          const ms = Number.isFinite(durationMs) ? durationMs : 700;

          if (typeof cmd.x === 'number' && typeof cmd.y === 'number') {
            inputRouterRef.current?.nudge(cmd.x, cmd.y, ms);
            return;
          }

          const dir = cmd.direction;
          const x = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
          const y = dir === 'up' ? 1 : dir === 'down' ? -1 : 0;
          if (x || y) inputRouterRef.current?.nudge(x, y, ms);
          return;
        }
        case 'fireGuns': {
          inputRouterRef.current?.queueGunBurst();
          return;
        }
        case 'fireMissile': {
          inputRouterRef.current?.queueMissile();
          return;
        }
        case 'flip': {
          const dir = cmd.direction;
          if (dir === 'left') inputRouterRef.current?.queueFlip('z', -1);
          else if (dir === 'right') inputRouterRef.current?.queueFlip('z', 1);
          else if (dir === 'up') inputRouterRef.current?.queueFlip('x', -1);
          else if (dir === 'down') inputRouterRef.current?.queueFlip('x', 1);
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener('drone-lips:command', onCommand as any);
    return () => window.removeEventListener('drone-lips:command', onCommand as any);
  }, [handleRecalibrate, handleStart, togglePause]);

  useEffect(() => {
    // The webcam preview is mirrored (scaleX(-1)), so invert X to keep controls intuitive.
    faceTrackerRef.current = new FaceTracker({ invertX: true });
    faceTrackerRef.current.setHandlers({
      onControls: (c) => {
        faceControlsRef.current = c;
        if (phaseRef.current === 'calibrating' && c.calibrated) {
          setPhase('playing');
          setStatusText('');
        }
      },
      onError: (msg) => setErrorText(msg),
    });

    voiceHandlerRef.current = new VoiceHandler({
      onCommand: (cmd) => applyVoiceCommand(cmd),
      onError: (msg) => setErrorText(`Voice: ${msg}`),
    });

    return () => {
      faceTrackerRef.current?.stop();
      faceTrackerRef.current = null;
      inputRouterRef.current?.setHasCamera(false);
      voiceHandlerRef.current?.stop();
      voiceHandlerRef.current = null;
    };
  }, [applyVoiceCommand]);

  // Legacy engine loop moved into `src/game/Game.ts` (M1).
  /*
  useEffect(() => {
    if (!webglSupported) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

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
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
    camera.position.set(0, 3.2, -12);

    scene.add(new THREE.HemisphereLight('#cbd8ff', '#0a0a10', 0.75));
    const sun = new THREE.DirectionalLight('#ffffff', 1.0);
    sun.position.set(0, 5, -10);
    scene.add(sun);

    const star = createStarfield();
    scene.add(star.points);

    const drone = new Drone();
    scene.add(drone.group);

    const asteroidGeo = new THREE.IcosahedronGeometry(1, 0);
    const asteroidMat = new THREE.MeshStandardMaterial({
      color: '#9aa3ad',
      metalness: 0.25,
      roughness: 0.9,
    });
    const astMesh = new THREE.InstancedMesh(asteroidGeo, asteroidMat, ASTEROID_COUNT);
    astMesh.frustumCulled = false;
    scene.add(astMesh);

    const astTemp = new THREE.Object3D();
    const asteroids: Asteroid[] = Array.from({ length: ASTEROID_COUNT }, () => ({
      pos: new THREE.Vector3(
        randRange(-18, 18),
        randRange(-10, 10),
        randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX),
      ),
      rot: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
      spin: new THREE.Vector3(randRange(-1.2, 1.2), randRange(-1.2, 1.2), randRange(-1.2, 1.2)),
      scale: randRange(0.5, 1.8),
    }));

    const pickupGeo = new THREE.OctahedronGeometry(0.55, 0);
    const pickupMat = new THREE.MeshStandardMaterial({
      color: '#ff4fb8',
      emissive: '#ff4fb8',
      emissiveIntensity: 1.4,
      metalness: 0.35,
      roughness: 0.25,
    });
    const pickupMesh = new THREE.InstancedMesh(pickupGeo, pickupMat, PICKUP_COUNT);
    pickupMesh.frustumCulled = false;
    scene.add(pickupMesh);

    const pickupTemp = new THREE.Object3D();
    const pickups: Pickup[] = Array.from({ length: PICKUP_COUNT }, () => ({
      pos: new THREE.Vector3(
        randRange(-10, 10),
        randRange(-6, 6),
        randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX),
      ),
      rot: new THREE.Euler(0, 0, 0),
      spin: randRange(0.8, 2.0),
    }));

    const loader = new THREE.TextureLoader();

    const enemyConfigs: Record<EnemyKind, EnemyConfig> = {
      ship: { kind: 'ship', hp: 3, radius: 1.35, approachSpeed: 7, reward: 10 },
      spike: { kind: 'spike', hp: 2, radius: 1.1, approachSpeed: 9, reward: 5 },
    };
    const bounds: EnemySpawnBounds = { xRange: 12, yRange: 7, zMin: ENEMY_Z_SPAWN_MIN, zMax: ENEMY_Z_SPAWN_MAX };

    const enemyDisposers: Array<() => void> = [];
    const enemies: EnemySlot[] = [];

    for (let i = 0; i < ENEMY_COUNT; i += 1) {
      const kind: EnemyKind = pickOne(['ship', 'spike'] as const);
      const shipTex =
        kind === 'ship'
          ? pickOne(['/assets/enemies/enemy1.png', '/assets/enemies/enemy2.png'] as const)
          : '';

      const created = createEnemyMesh(kind, loader, shipTex);
      enemyDisposers.push(created.dispose);
      scene.add(created.mesh);

      const enemy = new Enemy(i + 1, kind, created.mesh, enemyConfigs[kind]);
      const slot: EnemySlot = { enemy, deadUntilMs: 0 };
      slot.enemy.spawn(bounds, dronePosRef.current.y);
      enemies.push(slot);
    }

    let composer: EffectComposer | null = null;
    let fxaaPass: ShaderPass | null = null;
    if (!isIOS) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.22, 0.6));
      fxaaPass = new ShaderPass(FXAAShader);
      composer.addPass(fxaaPass);
    }

    const laserGeo = new THREE.SphereGeometry(0.07, 10, 10);
    const laserMat = new THREE.MeshBasicMaterial({
      color: '#63b3ff',
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const laserMesh = new THREE.InstancedMesh(laserGeo, laserMat, MAX_LASERS);
    laserMesh.frustumCulled = false;
    scene.add(laserMesh);

    const laserTemp = new THREE.Object3D();
    const lasers: LaserShot[] = Array.from({ length: MAX_LASERS }, () => new LaserShot());

    const missileGroup = new THREE.Group();
    scene.add(missileGroup);

    const missileGeo = new THREE.SphereGeometry(0.13, 14, 14);
    const missileMat = new THREE.MeshStandardMaterial({
      color: '#2b2b2b',
      emissive: '#ffb347',
      emissiveIntensity: 2.4,
      metalness: 0.2,
      roughness: 0.7,
    });
    const trailGeo = new THREE.ConeGeometry(0.12, 0.55, 12, 1, true);
    const trailMat = new THREE.MeshBasicMaterial({
      color: '#ffb347',
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const missiles: Array<{ shot: MissileShot; mesh: THREE.Mesh; trail: THREE.Mesh }> = [];
    for (let i = 0; i < MAX_MISSILES; i += 1) {
      const m = new THREE.Mesh(missileGeo, missileMat);
      m.visible = false;
      const t = new THREE.Mesh(trailGeo, trailMat);
      t.visible = false;
      t.rotation.x = Math.PI;
      missileGroup.add(m);
      missileGroup.add(t);
      missiles.push({ shot: new MissileShot(), mesh: m, trail: t });
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
    for (let i = 0; i < 16; i += 1) {
      const m = new THREE.Mesh(expGeo, expMat);
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      explosions.push({ mesh: m, age: 999, lifetime: 0.5, startScale: 0.7 });
    }

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      composer?.setSize(w, h);
      if (fxaaPass?.material?.uniforms?.resolution?.value?.set) {
        fxaaPass.material.uniforms.resolution.value.set(1 / (w * dpr), 1 / (h * dpr));
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const onLost = (e: Event) => {
      e.preventDefault?.();
      setRendererError('WebGL context lost (common on iOS under memory pressure). Reload and try again.');
    };
    const onRestored = () => setRendererError(null);

    canvas.addEventListener('webglcontextlost', onLost as any, false);
    canvas.addEventListener('webglcontextrestored', onRestored as any, false);

    let raf = 0;
    let lastMs = performance.now();
    const camTarget = new THREE.Vector3();
    const laserSpawnPos = new THREE.Vector3();
    const laserSpawnVel = new THREE.Vector3(0, 0, LASER_SPEED);

    worldRef.current = {
      renderer,
      composer,
      fxaaPass,
      scene,
      camera,
      drone,
      star,
      asteroids: { mesh: astMesh, items: asteroids, temp: astTemp },
      pickups: { mesh: pickupMesh, items: pickups, temp: pickupTemp },
      enemies,
      enemyDisposers,
      lasers: { mesh: laserMesh, items: lasers, temp: laserTemp },
      missiles,
      explosions,
      dispose: () => undefined,
    };

    if (scoreElRef.current) scoreElRef.current.textContent = `${scoreRef.current}`;
    if (speedElRef.current) speedElRef.current.textContent = `${speedRef.current.toFixed(1)}`;

    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      const nowMs = performance.now();
      const dt = Math.min(0.05, (nowMs - lastMs) / 1000);
      lastMs = nowMs;

      star.material.uniforms.uTime.value = nowMs * 0.001;

      if (phaseRef.current !== 'playing') {
        if (composer) composer.render();
        else renderer.render(scene, camera);
        return;
      }

      const face = faceControlsRef.current;
      const manual = manualNudgeRef.current;

      let strafeX = face.calibrated ? face.strafeX : 0;
      let strafeY = face.calibrated ? face.strafeY : 0;

      if (manual && manual.untilMs > nowMs) {
        strafeX = manual.x;
        strafeY = manual.y;
      } else if (manual && manual.untilMs <= nowMs) {
        manualNudgeRef.current = null;
      }

      const keys = keysRef.current;
      const keyX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const keyY = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
      if (keyX || keyY) {
        strafeX = clamp(strafeX + keyX, -1, 1);
        strafeY = clamp(strafeY + keyY, -1, 1);
      }
      const keyBoost = keys.boost ? 1 : 0;
      const stopActive = stopHeldRef.current || stopToggledRef.current || keys.stop;

      const boost = clamp(
        (face.calibrated ? face.boost : 0) + keyBoost,
        0,
        1,
      );

      let speed = 0;
      if (!stopActive) {
        speedBaseRef.current = Math.min(SPEED_CRUISE, speedBaseRef.current + SPEED_ACCEL * dt);
        speed = clamp(speedBaseRef.current + boost * BOOST_EXTRA, 0, SPEED_MAX);
      } else {
        speedBaseRef.current = 0;
        speed = 0;
      }
      speedRef.current = speed;

      const pos = dronePosRef.current;
      pos.x = clamp(pos.x + strafeX * STRAFE_SPEED * dt, -11, 11);
      pos.y = clamp(pos.y + strafeY * STRAFE_SPEED * dt, -7, 7);

      drone.position.copy(pos);
      drone.update(dt, { timeMs: nowMs, strafeX, strafeY, speed });

      camTarget.set(pos.x * 0.25, pos.y * 0.25 + 3.2, -12);
      camera.position.lerp(camTarget, 1 - Math.exp(-4.2 * dt));
      camera.lookAt(pos.x * 0.1, pos.y * 0.1, 6);

      // Asteroids
      for (const a of asteroids) {
        a.pos.z -= speed * dt;
        a.rot.x += a.spin.x * dt;
        a.rot.y += a.spin.y * dt;
        a.rot.z += a.spin.z * dt;
        if (a.pos.z < WORLD_Z_BEHIND) {
          a.pos.set(randRange(-18, 18), randRange(-10, 10), randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX));
          a.scale = randRange(0.5, 1.8);
        }
      }
      for (let i = 0; i < asteroids.length; i += 1) {
        const a = asteroids[i];
        astTemp.position.copy(a.pos);
        astTemp.rotation.copy(a.rot);
        astTemp.scale.setScalar(a.scale);
        astTemp.updateMatrix();
        astMesh.setMatrixAt(i, astTemp.matrix);
      }
      astMesh.instanceMatrix.needsUpdate = true;

      // Pickups
      for (const p of pickups) {
        p.pos.z -= speed * dt;
        p.rot.y += p.spin * dt;
        p.rot.x += p.spin * 0.35 * dt;

        const dx = p.pos.x - pos.x;
        const dy = p.pos.y - pos.y;
        const dz = p.pos.z - pos.z;
        if (dx * dx + dy * dy + dz * dz < (PLAYER_RADIUS + 0.7) * (PLAYER_RADIUS + 0.7)) {
          scoreRef.current += 1;
          if (scoreElRef.current) scoreElRef.current.textContent = `${scoreRef.current}`;
          p.pos.set(randRange(-10, 10), randRange(-6, 6), randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX));
          p.rot.set(0, 0, 0);
          p.spin = randRange(0.8, 2.0);
        }

        if (p.pos.z < WORLD_Z_BEHIND) {
          p.pos.set(randRange(-10, 10), randRange(-6, 6), randRange(WORLD_Z_SPAWN_MIN, WORLD_Z_SPAWN_MAX));
          p.rot.set(0, 0, 0);
          p.spin = randRange(0.8, 2.0);
        }
      }
      for (let i = 0; i < pickups.length; i += 1) {
        const p = pickups[i];
        pickupTemp.position.copy(p.pos);
        pickupTemp.rotation.copy(p.rot);
        pickupTemp.scale.setScalar(1);
        pickupTemp.updateMatrix();
        pickupMesh.setMatrixAt(i, pickupTemp.matrix);
      }
      pickupMesh.instanceMatrix.needsUpdate = true;

      // Enemies + collision
      for (const slot of enemies) {
        if (!slot.enemy.alive) {
          if (nowMs >= slot.deadUntilMs) {
            slot.enemy.spawn(bounds, pos.y);
            slot.deadUntilMs = 0;
          }
          continue;
        }

        slot.enemy.update(dt, speed, pos, nowMs);
        if (slot.enemy.kind === 'ship') slot.enemy.mesh.lookAt(pos);

        if (slot.enemy.isOutOfRange(WORLD_Z_BEHIND)) {
          slot.enemy.spawn(bounds, pos.y);
          continue;
        }

        const ex = slot.enemy.mesh.position.x - pos.x;
        const ey = slot.enemy.mesh.position.y - pos.y;
        const ez = slot.enemy.mesh.position.z - pos.z;
        if (ex * ex + ey * ey + ez * ez < (PLAYER_RADIUS + slot.enemy.radius) * (PLAYER_RADIUS + slot.enemy.radius)) {
          resetRun('hit');
          return;
        }
      }

      // Guns (blink burst + hold)
      if (face.calibrated && face.fireBurst) {
        fireGunsBurst();
      }

      const spawnLaser = () => {
        const shot = lasers.find((s) => !s.active);
        if (!shot) return false;
        laserSpawnPos.set(pos.x, pos.y + 0.02, pos.z + 1.35);
        shot.spawn(laserSpawnPos, laserSpawnVel, LASER_TTL);
        return true;
      };

      const burst = gunBurstRef.current;
      if (burst.remaining > 0 && nowMs >= burst.nextMs) {
        if (spawnLaser()) {
          burst.remaining -= 1;
          burst.nextMs += GUN_BURST_INTERVAL_MS;
          lastGunFireMsRef.current = nowMs;
        } else {
          burst.remaining = 0;
        }
      } else {
        const wantsHoldFire = (face.calibrated && face.fireHold) || keys.fire;
        if (wantsHoldFire && nowMs - lastGunFireMsRef.current >= GUN_HOLD_INTERVAL_MS) {
          if (spawnLaser()) lastGunFireMsRef.current = nowMs;
        }
      }

      // Lasers
      for (const l of lasers) l.update(dt);
      for (const l of lasers) {
        if (!l.active) continue;
        if (l.pos.z > LASER_Z_MAX) {
          l.active = false;
          continue;
        }

        for (const slot of enemies) {
          const e = slot.enemy;
          if (!e.alive) continue;
          const dx = e.mesh.position.x - l.pos.x;
          const dy = e.mesh.position.y - l.pos.y;
          const dz = e.mesh.position.z - l.pos.z;
          if (dx * dx + dy * dy + dz * dz < (e.radius + 0.32) * (e.radius + 0.32)) {
            l.active = false;
            e.takeDamage(1);

            if (!e.alive) {
              scoreRef.current += e.reward;
              if (scoreElRef.current) scoreElRef.current.textContent = `${scoreRef.current}`;

              const exp = explosions.find((x) => !x.mesh.visible);
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

      for (let i = 0; i < MAX_LASERS; i += 1) {
        const l = lasers[i];
        if (l.active) {
          laserTemp.position.copy(l.pos);
          laserTemp.scale.setScalar(1);
        } else {
          laserTemp.position.set(0, -9999, 0);
          laserTemp.scale.setScalar(0);
        }
        laserTemp.updateMatrix();
        laserMesh.setMatrixAt(i, laserTemp.matrix);
      }
      laserMesh.instanceMatrix.needsUpdate = true;

      // Missiles
      for (const m of missiles) {
        if (!m.shot.active) {
          m.mesh.visible = false;
          m.trail.visible = false;
          continue;
        }

        const target = findNearestEnemy(enemies, m.shot.pos);
        m.shot.update(dt, target ? target.mesh.position : null, MISSILE_TURN_RATE);

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
            scoreRef.current += target.reward;
            if (scoreElRef.current) scoreElRef.current.textContent = `${scoreRef.current}`;

            const exp = explosions.find((x) => !x.mesh.visible);
            if (exp) {
              exp.mesh.visible = true;
              exp.mesh.position.copy(target.mesh.position);
              exp.mesh.scale.setScalar(exp.startScale * 1.2);
              exp.age = 0;
            }

            const slot = enemies.find((s) => s.enemy.id === target.id);
            if (slot) slot.deadUntilMs = nowMs + 800 + randInt(0, 800);
          }
        }

        if (m.shot.pos.z > LASER_Z_MAX) m.shot.active = false;
      }

      // Explosions
      for (const exp of explosions) {
        if (!exp.mesh.visible) continue;
        exp.age += dt;
        const p = exp.age / exp.lifetime;
        if (p >= 1) {
          exp.mesh.visible = false;
          continue;
        }
        exp.mesh.scale.setScalar(exp.startScale + p * 2.6);
        (exp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - p);
      }

      if (speedElRef.current) speedElRef.current.textContent = speed.toFixed(1);

      if (composer) composer.render();
      else renderer.render(scene, camera);
    };

    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost as any);
      canvas.removeEventListener('webglcontextrestored', onRestored as any);

      worldRef.current = null;

      star.dispose();
      drone.dispose();

      asteroidGeo.dispose();
      asteroidMat.dispose();
      pickupGeo.dispose();
      pickupMat.dispose();
      laserGeo.dispose();
      laserMat.dispose();
      missileGeo.dispose();
      missileMat.dispose();
      trailGeo.dispose();
      trailMat.dispose();
      expGeo.dispose();
      expMat.dispose();
      for (const d of enemyDisposers) d();

      composer?.dispose();
      renderer.dispose();
    };
  }, [fireGunsBurst, isIOS, resetRun, webglSupported]);
  */

  useEffect(() => {
    if (!webglSupported) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const router = inputRouterRef.current;
    if (!router) return;

    const game = new Game({
      container,
      canvas,
      isIOS,
      levelId: levelIdRef.current,
      input: {
        state: router.state,
        update: (nowMs) => router.update(nowMs),
      },
      hud: {
        scoreEl: scoreElRef,
        speedEl: speedElRef,
      },
      callbacks: {
        onRendererError: (msg) => setRendererError(msg),
        onHitFlash: () => {
          setFlashOn(true);
          window.setTimeout(() => setFlashOn(false), 140);
        },
      },
    });

    gameRef.current = game;
    game.setRunning(phaseRef.current === 'playing');

    return () => {
      game.dispose();
      if (gameRef.current === game) gameRef.current = null;
    };
  }, [isIOS, webglSupported]);

  useEffect(() => {
    gameRef.current?.setRunning(phase === 'playing');
  }, [phase]);

  useEffect(() => {
    levelManager.setLevelId(levelId);
    inputRouterRef.current?.reset();
    gameRef.current?.setLevel(levelId);
  }, [levelId, levelManager]);

  const cycleCameraMode = useCallback(() => {
    setCameraMode((m) => (m === 'mini' ? 'hidden' : 'mini'));
  }, []);

  const videoStyle = useMemo(() => {
    if (cameraMode === 'hidden') {
      return {
        position: 'absolute' as const,
        top: -10000,
        left: -10000,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none' as const,
      };
    }

    return {
      position: 'absolute' as const,
      top: 'calc(12px + env(safe-area-inset-top, 0px))',
      right: 12,
      width: 120,
      maxWidth: '42vw',
      borderRadius: 14,
      zIndex: 60,
      transform: 'scaleX(-1)',
      background: 'rgba(0,0,0,0.35)',
      border: '1px solid rgba(255,255,255,0.14)',
      boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
      pointerEvents: 'none' as const,
    };
  }, [cameraMode]);

  const hudStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      top: 'calc(12px + env(safe-area-inset-top, 0px))',
      left: 12,
      zIndex: 70,
      color: 'white',
      background: 'rgba(0,0,0,0.55)',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: 14,
      padding: '12px 14px',
      minWidth: 220,
      maxWidth: 'calc(100vw - 24px)',
      backdropFilter: 'blur(10px) saturate(160%)',
      WebkitBackdropFilter: 'blur(10px) saturate(160%)',
      boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
      fontSize: 16,
      fontWeight: 700,
      letterSpacing: 0.2,
      pointerEvents: 'none' as const,
    }),
    [],
  );

  const dockBtnStyle = useMemo(
    () => ({
      padding: '10px 14px',
      borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.18)',
      background: 'rgba(255,255,255,0.10)',
      color: 'white',
      touchAction: 'manipulation' as const,
      userSelect: 'none' as const,
      WebkitTapHighlightColor: 'transparent',
      fontWeight: 800,
      fontSize: 14,
      letterSpacing: 0.2,
    }),
    [],
  );

  const actionBtnBaseStyle = useMemo(
    () => ({
      pointerEvents: 'auto' as const,
      borderRadius: '50%',
      border: '1px solid rgba(255,255,255,0.22)',
      color: 'rgba(255,255,255,0.96)',
      touchAction: 'manipulation' as const,
      userSelect: 'none' as const,
      WebkitTapHighlightColor: 'transparent',
      position: 'relative' as const,
      overflow: 'hidden' as const,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      cursor: 'pointer',
      backdropFilter: 'blur(18px) saturate(180%)',
      WebkitBackdropFilter: 'blur(18px) saturate(180%)',
      boxShadow:
        '0 18px 42px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -18px 26px rgba(0,0,0,0.28)',
      transition: 'transform 120ms ease, filter 120ms ease',
      outline: 'none',
    }),
    [],
  );

  const actionBtnSheenStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      inset: -1,
      borderRadius: '50%',
      pointerEvents: 'none' as const,
      background:
        'radial-gradient(circle at 30% 22%, rgba(255,255,255,0.55), rgba(255,255,255,0) 55%), linear-gradient(180deg, rgba(255,255,255,0.20), rgba(255,255,255,0) 60%)',
      opacity: 0.9,
    }),
    [],
  );

  const actionBtnLabelStyle = useMemo(
    () => ({
      fontSize: 12,
      fontWeight: 900,
      letterSpacing: 1,
      textTransform: 'uppercase' as const,
      textShadow: '0 2px 14px rgba(0,0,0,0.55)',
      opacity: 0.98,
    }),
    [],
  );

  const gunsBtnStyle = useMemo(
    () => ({
      ...actionBtnBaseStyle,
      width: 94,
      height: 94,
      background:
        'radial-gradient(circle at 45% 120%, rgba(255,80,80,0.62), rgba(255,80,80,0) 62%), radial-gradient(circle at 65% 110%, rgba(0,0,0,0.35), rgba(0,0,0,0) 62%), linear-gradient(160deg, rgba(255,255,255,0.20), rgba(255,255,255,0.06) 46%, rgba(0,0,0,0.22))',
    }),
    [actionBtnBaseStyle],
  );

  const missileBtnStyle = useMemo(
    () => ({
      ...actionBtnBaseStyle,
      width: 82,
      height: 82,
      background:
        'radial-gradient(circle at 45% 120%, rgba(183,123,42,0.62), rgba(183,123,42,0) 62%), radial-gradient(circle at 65% 110%, rgba(0,0,0,0.35), rgba(0,0,0,0) 62%), linear-gradient(160deg, rgba(255,255,255,0.20), rgba(255,255,255,0.06) 46%, rgba(0,0,0,0.22))',
    }),
    [actionBtnBaseStyle],
  );

  const stopBtnStyle = useMemo(
    () => ({
      ...actionBtnBaseStyle,
      width: 78,
      height: 78,
      background:
        'radial-gradient(circle at 45% 120%, rgba(120,195,255,0.55), rgba(120,195,255,0) 62%), radial-gradient(circle at 65% 110%, rgba(0,0,0,0.35), rgba(0,0,0,0) 62%), linear-gradient(160deg, rgba(255,255,255,0.20), rgba(255,255,255,0.06) 46%, rgba(0,0,0,0.22))',
      transform: stopHeld ? 'scale(0.96)' : undefined,
      filter: stopHeld ? 'brightness(1.08)' : undefined,
    }),
    [actionBtnBaseStyle, stopHeld],
  );

  if (!webglSupported) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#000',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        WebGL not available on this device/browser.
      </div>
    );
  }

  return (
    <div
      onPointerDownCapture={() => {
        ensureVoice();
        if (phaseRef.current === 'playing') safeRequestPointerLock(canvasRef.current);
      }}
      style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>

      <video ref={webcamRef} style={videoStyle} autoPlay playsInline muted />

      <div style={hudStyle}>
        Puntos: <span ref={scoreElRef}>1</span> · Vel: <span ref={speedElRef}>0.0</span>
        {statusText ? <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>{statusText}</div> : null}
        {errorText ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>{errorText}</div> : null}
      </div>

      {flashOn ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 75,
            background: 'rgba(255,255,255,0.85)',
            mixBlendMode: 'screen',
            opacity: 1,
            transition: 'opacity 140ms ease',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {rendererError ? (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 200,
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

      {phase === 'playing' || phase === 'paused' ? (
        <div
          style={{
            position: 'absolute',
            left: 'calc(12px + env(safe-area-inset-left, 0px))',
            right: 'calc(12px + env(safe-area-inset-right, 0px))',
            bottom: `calc(${12 + viewportBottomInset}px + env(safe-area-inset-bottom, 0px))`,
            zIndex: 120,
            pointerEvents: 'none',
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto',
            alignItems: 'end',
            columnGap: 14,
          }}
        >
          <div style={{ pointerEvents: 'none' }}>
            <button
              type="button"
              aria-label="Stop / Hover (hold)"
              aria-pressed={stopHeld}
              onPointerDown={(e) => {
                e.preventDefault();
                try {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                } catch {
                  // ignore
                }
                inputRouterRef.current?.setStopHeld(true);
                setStopHeld(true);
              }}
              onPointerUp={() => {
                inputRouterRef.current?.setStopHeld(false);
                setStopHeld(false);
              }}
              onPointerCancel={() => {
                inputRouterRef.current?.setStopHeld(false);
                setStopHeld(false);
              }}
              onPointerLeave={() => {
                inputRouterRef.current?.setStopHeld(false);
                setStopHeld(false);
              }}
              style={stopBtnStyle}
            >
              <div aria-hidden style={actionBtnSheenStyle} />
              <div style={{ position: 'relative', zIndex: 2, display: 'grid', gap: 6, placeItems: 'center' }}>
                <div style={actionBtnLabelStyle}>Stop</div>
              </div>
            </button>
          </div>

          <div
            style={{
              pointerEvents: 'none',
              display: 'flex',
              justifyContent: 'center',
              minWidth: 0,
            }}
          >
            <div
              style={{
                pointerEvents: 'auto',
                color: 'white',
                background: 'rgba(0,0,0,0.58)',
                border: '1px solid rgba(255,255,255,0.16)',
                borderRadius: 999,
                padding: 8,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'center',
                justifyContent: 'center',
                maxWidth: '100%',
                backdropFilter: 'blur(10px) saturate(160%)',
                WebkitBackdropFilter: 'blur(10px) saturate(160%)',
                boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
              }}
            >
              <button
                type="button"
                onClick={() => setPhase((p) => (p === 'paused' ? 'playing' : 'paused'))}
                style={dockBtnStyle}
              >
                {phase === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button type="button" onClick={cycleCameraMode} style={dockBtnStyle}>
                Cam
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.dispatchEvent(new Event('drone-lips:open-chat'));
                  } catch {
                    // ignore
                  }
                }}
                style={dockBtnStyle}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setLevelPickerOpen(true)}
                style={dockBtnStyle}
                title={level.name}
              >
                Lv {levelId}
              </button>
            </div>
          </div>

          <div
            style={{
              pointerEvents: 'none',
              display: 'grid',
              gap: 18,
              justifyItems: 'end',
            }}
          >
            <button type="button" onClick={fireMissile} style={missileBtnStyle} aria-label="Misile">
              <div aria-hidden style={actionBtnSheenStyle} />
              <div style={{ position: 'relative', zIndex: 2, display: 'grid', gap: 6, placeItems: 'center' }}>
                <div style={actionBtnLabelStyle}>Misile</div>
              </div>
            </button>

            <button type="button" onClick={fireGunsBurst} style={gunsBtnStyle} aria-label="Guns">
              <div aria-hidden style={actionBtnSheenStyle} />
              <div style={{ position: 'relative', zIndex: 2, display: 'grid', gap: 6, placeItems: 'center' }}>
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
            zIndex: 150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'radial-gradient(circle at 30% 20%, rgba(40,90,180,0.35), rgba(0,0,0,0.92))',
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
            <div style={{ fontSize: 26, fontWeight: 900, marginBottom: 6 }}>Drone Lips</div>
            <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 12 }}>
              Auto-flight forward. Pink diamonds + enemies. Mouth open = boost. Blink = guns.
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.95 }}>
              <div>• Move mouth left/right/up/down = strafe.</div>
              <div>• Open mouth = boost.</div>
              <div>• Blink = guns (burst). Long blink = hold-to-fire.</div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleStart}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.16)',
                  color: 'white',
                  fontWeight: 800,
                }}
              >
                Start
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.dispatchEvent(new Event('drone-lips:open-chat'));
                  } catch {
                    // ignore
                  }
                }}
                style={dockBtnStyle}
              >
                Voice / Chat
              </button>
              <button type="button" onClick={() => setLevelPickerOpen(true)} style={dockBtnStyle} title={level.name}>
                Worlds
              </button>
            </div>
            {errorText ? <div style={{ marginTop: 10, color: '#ffb4b4', fontSize: 13 }}>{errorText}</div> : null}
          </div>
        </div>
      ) : null}

      {phase === 'calibrating' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 140,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 420,
              maxWidth: '100%',
              padding: 16,
              borderRadius: 16,
              background: 'rgba(0,0,0,0.55)',
              border: '1px solid rgba(255,255,255,0.14)',
              color: 'white',
              backdropFilter: 'blur(10px)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Calibrating…</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>Keep your face neutral for 5 seconds.</div>
          </div>
        </div>
      ) : null}

      {levelPickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 180,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'rgba(0,0,0,0.55)',
          }}
          onPointerDown={() => setLevelPickerOpen(false)}
        >
          <div
            style={{
              width: 520,
              maxWidth: '100%',
              maxHeight: 'calc(100vh - 32px)',
              overflow: 'auto',
              padding: 16,
              borderRadius: 16,
              background: 'rgba(0,0,0,0.72)',
              border: '1px solid rgba(255,255,255,0.14)',
              color: 'white',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>Worlds</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 12 }}>
              Currently playable: Level 1 (Earth Park) and Level 8 (Orbit).
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {LEVELS.map((l) => {
                const enabled = l.id === 1 || l.id === 8;
                const selected = l.id === levelId;
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={!enabled}
                    onClick={() => {
                      setStopHeld(false);
                      setLevelId(l.id);
                      setLevelPickerOpen(false);
                    }}
                    style={{
                      padding: '12px 12px',
                      borderRadius: 14,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: selected ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)',
                      color: 'white',
                      textAlign: 'left',
                      opacity: enabled ? 1 : 0.4,
                      cursor: enabled ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      Lv {l.id} · {l.name}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{l.environment}</div>
                    {!enabled ? (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Coming soon.</div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setLevelPickerOpen(false)} style={dockBtnStyle}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AuggieChat />
    </div>
  );
}
