# ARCHITECTURE.md — MouthPilot (Tech Design + Systems)

## 1) Goals
MouthPilot must:
- Run smoothly on **iPhone Safari** and desktop browsers.
- Support **two input modes**:
  - **Mouth-Only (Accessibility)** — primary
  - **Keyboard (Testing)** — fallback
- Maintain a clean, scalable architecture for 10 worlds (Earth → Space War).
- Keep performance stable (60 FPS target) using simple collision and instancing.

---

## 2) Core Runtime Loop (Frame Order)
Single `requestAnimationFrame` loop.

**Per-frame order (important):**
1) `input.update(dt)` → produce `InputState`
2) `drone.applyInput(InputState, dt)` → update x/y velocity, boost, stop/hover
3) `speedSystem.update(dt)` → forward speed target + smoothing
4) `drone.integrate(dt)` → update position (x,y,z)
5) `camera.follow(drone, dt)` → chase camera lerp + lookAt
6) `spawner.update(dt)` → spawn pickups/enemies/obstacles
7) `entities.update(dt)` → lasers, missiles, enemies movement, animations
8) `collisions.check()` → pickups, hits, shots
9) `score/hud.update()` → update HUD strings + UI state
10) `cleanup.dispose()` → despawn offscreen objects & reuse pools

---

## 3) Data Models

### 3.1 InputState (unified)
```ts
export type ControlMode = "mouth" | "keyboard";

export type InputState = {
  mode: ControlMode;
  moveX: number;     // [-1..1]
  moveY: number;     // [-1..1]
  boost: number;     // [0..1]
  stop: boolean;     // hover
  fireGuns: boolean; // momentary or held depending on mode
  fireMissile: boolean; // momentary
  hasCamera: boolean;
};
3.2 GameState
ts
Copy code
export type GamePhase = "menu" | "running" | "paused" | "gameover" | "levelComplete";

export type GameState = {
  phase: GamePhase;
  levelId: number;
  score: number;     // Puntos
  speed: number;     // forward speed
  time: number;      // elapsed in level
  progressUnlocked: number; // highest unlocked level
};
3.3 Entity base (simple)
ts
Copy code
export type Entity = {
  id: string;
  kind: "pickup" | "enemy" | "laser" | "missile" | "obstacle" | "boss";
  mesh: THREE.Object3D;
  radius: number;          // bounding sphere
  alive: boolean;
  update(dt: number): void;
  dispose(): void;
};
4) Level System (10 worlds via config)
4.1 LevelConfig type
ts
Copy code
export type Environment =
  | "earth-park"
  | "earth-park-slalom"
  | "city"
  | "coast"
  | "desert"
  | "military"
  | "upper-atmos"
  | "orbit"
  | "alien"
  | "war";

export type LevelConfig = {
  id: number;
  name: string;
  environment: Environment;

  // Movement tuning
  autoForward: boolean;
  baseSpeed: number;     // initial speed
  maxSpeed: number;      // clamp
  accelPerSec: number;   // how fast speed ramps
  boostMultiplier: number; // boost effect

  // Forces
  windForce: number;     // 0..1 lateral drift

  // Content
  obstacleDensity: number; // 0..1 (trees/buildings/rocks)
  asteroidCount: number;   // only space-like levels

  pickupRate: number;      // pickups per second
  enemyRate: number;       // enemies per second
  ufoRate: number;         // UFO enemies per second

  // Scoring
  pickupScore: number;     // +1 usually
  enemyScoreMin: number;   // +5
  enemyScoreMax: number;   // +10

  // Boss (optional)
  boss?: {
    hp: number;
    spawnAtScore: number;
    ufoSupportRate: number; // extra spawns during boss
  };
};
5) LevelConfig Table (All 10 Levels — Filled Numbers)
These values are tuned for “learn → speed → combat → chaos”.
You can adjust later, but this is a solid starting point.

ts
Copy code
export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: "NYC Park Tutorial",
    environment: "earth-park",
    autoForward: false,
    baseSpeed: 0.0,
    maxSpeed: 6.0,
    accelPerSec: 1.2,
    boostMultiplier: 1.6,
    windForce: 0.05,
    obstacleDensity: 0.35,
    asteroidCount: 0,
    pickupRate: 0.25,
    enemyRate: 0.0,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10
  },
  {
    id: 2,
    name: "Park Slalom",
    environment: "earth-park-slalom",
    autoForward: false,
    baseSpeed: 0.5,
    maxSpeed: 7.0,
    accelPerSec: 1.4,
    boostMultiplier: 1.7,
    windForce: 0.08,
    obstacleDensity: 0.55,
    asteroidCount: 0,
    pickupRate: 0.45,
    enemyRate: 0.0,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10
  },
  {
    id: 3,
    name: "City Flight",
    environment: "city",
    autoForward: true,
    baseSpeed: 1.2,
    maxSpeed: 9.0,
    accelPerSec: 1.8,
    boostMultiplier: 1.7,
    windForce: 0.10,
    obstacleDensity: 0.65,
    asteroidCount: 0,
    pickupRate: 0.55,
    enemyRate: 0.10,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10
  },
  {
    id: 4,
    name: "Coast Wind Run",
    environment: "coast",
    autoForward: true,
    baseSpeed: 1.8,
    maxSpeed: 10.0,
    accelPerSec: 2.0,
    boostMultiplier: 1.8,
    windForce: 0.22,
    obstacleDensity: 0.45,
    asteroidCount: 0,
    pickupRate: 0.60,
    enemyRate: 0.18,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10
  },
  {
    id: 5,
    name: "Desert Canyon",
    environment: "desert",
    autoForward: true,
    baseSpeed: 2.2,
    maxSpeed: 11.0,
    accelPerSec: 2.2,
    boostMultiplier: 1.9,
    windForce: 0.12,
    obstacleDensity: 0.70,
    asteroidCount: 0,
    pickupRate: 0.65,
    enemyRate: 0.28,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10
  },
  {
    id: 6,
    name: "Military Base Combat",
    environment: "military",
    autoForward: true,
    baseSpeed: 2.6,
    maxSpeed: 12.0,
    accelPerSec: 2.4,
    boostMultiplier: 2.0,
    windForce: 0.10,
    obstacleDensity: 0.55,
    asteroidCount: 0,
    pickupRate: 0.60,
    enemyRate: 0.50,
    ufoRate: 0.05,
    pickupScore: 1,
    enemyScoreMin: 6,
    enemyScoreMax: 10
  },
  {
    id: 7,
    name: "Upper Atmosphere",
    environment: "upper-atmos",
    autoForward: true,
    baseSpeed: 3.0,
    maxSpeed: 13.0,
    accelPerSec: 2.6,
    boostMultiplier: 2.1,
    windForce: 0.08,
    obstacleDensity: 0.35,
    asteroidCount: 10,
    pickupRate: 0.65,
    enemyRate: 0.55,
    ufoRate: 0.12,
    pickupScore: 1,
    enemyScoreMin: 6,
    enemyScoreMax: 10
  },
  {
    id: 8,
    name: "Orbit Debris Field",
    environment: "orbit",
    autoForward: true,
    baseSpeed: 3.4,
    maxSpeed: 14.0,
    accelPerSec: 2.8,
    boostMultiplier: 2.1,
    windForce: 0.06,
    obstacleDensity: 0.20,
    asteroidCount: 60,
    pickupRate: 0.70,
    enemyRate: 0.62,
    ufoRate: 0.18,
    pickupScore: 1,
    enemyScoreMin: 6,
    enemyScoreMax: 10
  },
  {
    id: 9,
    name: "Alien Zone",
    environment: "alien",
    autoForward: true,
    baseSpeed: 3.8,
    maxSpeed: 15.0,
    accelPerSec: 3.0,
    boostMultiplier: 2.2,
    windForce: 0.04,
    obstacleDensity: 0.18,
    asteroidCount: 80,
    pickupRate: 0.75,
    enemyRate: 0.78,
    ufoRate: 0.35,
    pickupScore: 1,
    enemyScoreMin: 7,
    enemyScoreMax: 10
  },
  {
    id: 10,
    name: "Space War (Boss)",
    environment: "war",
    autoForward: true,
    baseSpeed: 4.2,
    maxSpeed: 16.0,
    accelPerSec: 3.2,
    boostMultiplier: 2.3,
    windForce: 0.03,
    obstacleDensity: 0.15,
    asteroidCount: 100,
    pickupRate: 0.80,
    enemyRate: 0.95,
    ufoRate: 0.50,
    pickupScore: 1,
    enemyScoreMin: 8,
    enemyScoreMax: 12,
    boss: { hp: 220, spawnAtScore: 90, ufoSupportRate: 0.65 }
  }
];
6) MouthTracker (Math + Thresholds)
6.1 Landmark indices used
Mouth:

Left corner: 61

Right corner: 291

Upper lip: 13

Lower lip: 14

Eyes (simple EAR):

Left eye horizontal: 33 ↔ 133

Left eye vertical: 159 ↔ 145

Right eye horizontal: 362 ↔ 263

Right eye vertical: 386 ↔ 374

6.2 Mouth movement mapping
Compute mouth center:

mouthCenter = midpoint(lm[61], lm[291])

Neutral values stored on calibrate:

neutralX = mouthCenter.x

neutralY = mouthCenter.y

neutralW = distance(lm[61], lm[291])

Normalized offset:

dx = (mouthCenter.x - neutralX) / neutralW

dy = (mouthCenter.y - neutralY) / neutralW

Mapping to input:

moveX = clamp(applyDeadzone(dx) * gainX, -1, 1)

moveY = clamp(applyDeadzone(-dy) * gainY, -1, 1) (invert dy)

Recommended params:

deadzone = 0.015

gainX = 12

gainY = 12

smoothing:

moveX = lerp(prevX, moveX, 0.18)

moveY = lerp(prevY, moveY, 0.18)

6.3 Boost by mouth open ratio
open = distance(lm[13], lm[14])

width = distance(lm[61], lm[291])

ratio = open / width

Hysteresis:

Boost ON if ratio > 0.22

Boost OFF if ratio < 0.18

Boost output:

boost = boostOn ? 1 : 0

6.4 Blink detection (continuous fire while closed)
EAR per eye:

earL = dist(159,145) / dist(33,133)

earR = dist(386,374) / dist(362,263)

ear = (earL + earR) * 0.5

Threshold:

Eyes closed if ear < 0.18

Debounce logic:

Start a timer when closed.

If closed for >= 0.15s, set fireGuns = true.

When open again, set fireGuns = false immediately.

Cooldown optional: 50–100ms to avoid flicker.

7) Movement & STOP/Hover (Important for accessibility)
7.1 Drone kinematics (simple & stable)
State variables:

pos: Vector3

velXY: Vector2

speedZ: number

targetSpeedZ: number

Strafe acceleration:

velXY += (input.move * strafeAccel) * dt

clamp velXY to max strafe speed

Damping:

velXY *= exp(-damp * dt)

Forward speed:

If autoForward: targetSpeedZ ramps from baseSpeed to maxSpeed with accelPerSec

Apply boost:

targetSpeedZ *= (1 + input.boost * (boostMultiplier - 1))

STOP/Hover:

If input.stop:

targetSpeedZ = 0

increase damping (e.g. damp = 10–14) for stable hover

Else:

normal damping (e.g. damp = 4–6)

Integrate:

pos.x += velXY.x * dt

pos.y += velXY.y * dt

pos.z += speedZ * dt

speedZ = lerp(speedZ, targetSpeedZ, 0.12)

Clamp bounds (avoid losing player):

x,y within lane width per world (e.g. [-4..4] Earth, [-6..6] Space)

8) Spawning System
8.1 Randomness (seeded optional)
Use a simple seeded RNG so Daily Challenges can exist later:

mulberry32(seed) or sfc32

8.2 Spawn rules
All spawns happen ahead of player relative to drone z:

spawnZ = drone.z + spawnDistance (e.g. 60–110 units)

Pickups:

spawn at random lane positions

pink diamond mesh

slow rotation animation

Enemies:

spawn with simple approach motion toward player

or “lane pattern”: left/right/up/down wave

Boss:

spawn when score >= boss.spawnAtScore

stays ahead; shoots or rams in simple patterns

Cleanup:

despawn entities when entity.z < drone.z - 30

9) Collision System (Bounding Spheres)
9.1 Pickup collision
If distance(dronePos, pickupPos) < (droneRadius + pickupRadius):

score += pickupScore

remove pickup + spawn sparkle FX

9.2 Laser vs Enemy
If collision:

enemy dies, add score + explosion FX

9.3 Drone vs Enemy/Obstacle
If collision:

flash effect + “respawn”

Respawn approach:

set drone x/y back to 0

set speed to small safe value

give 1.0s invulnerability (blink drone material)

10) Rendering & Performance Guidelines
10.1 Materials
Use MeshStandardMaterial for metallic look.

Avoid too many unique materials—reuse.

10.2 Instancing
Trees, buildings, asteroids should be InstancedMesh.

Keep geometry simple.

10.3 Post-processing
Optional bloom:

Desktop: medium bloom

Mobile: low bloom or off
Provide a Quality toggle:

low: no composer, minimal lights

high: bloom enabled, more particles

10.4 DPR clamp
Always:

renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio))

11) World Builders (Distinct Looks, Procedural)
EarthParkWorld
Ground: green plane

Sky: gradient background

Trees: instanced cylinders+cones

Obstacles: tree trunks + posts

CityWorld
Tall box buildings, lanes

Slight fog + grey palette

CoastWorld
Blue ground/sea plane + wind drift

More open lanes

DesertWorld
Sand ground + canyon walls (two long extruded meshes)

Faster speed feeling

MilitaryWorld
Dark ground + “hangars” (boxes)

More enemies

UpperAtmoWorld
Sky to dark gradient + thin clouds (planes)

Orbit/Alien/War Worlds
Starfield (Points)

Asteroids (instanced icosa)

Debris fields (thin rods/plates)

UFO colors (green/purple emissive) for alien zones

12) HUD Update Rules
HUD is updated every frame:

Puntos: ${score} Vel: ${speed.toFixed(1)}
Speed is forward speed, not strafe.

If Level 1 tutorial exists:

show additional instruction string under HUD:

“Move mouth left/right…”

“Open mouth to boost…”

“Close eyes to shoot…”

13) Optional: Daily Challenge & Share Card (Future)
Seeded spawn layout:

seed = YYYYMMDD

Share card:

capture canvas screenshot + overlay text

“Mouth-Only Mode” label for virality

14) Testing Checklist
Desktop (Keyboard)
WASD/Arrows move X/Y

X STOP freezes forward motion

Space fires

Score increases on pickups/enemy kills

iPhone (Mouth)
Calibrate works

Mouth direction moves drone smoothly

Mouth open boosts (Vel increases)

Eyes closed triggers continuous fire

No camera permission -> fallback to keyboard + buttons

makefile
Copy code
::contentReference[oaicite:0]{index=0}