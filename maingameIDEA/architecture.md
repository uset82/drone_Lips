# MouthPilot — 3D Drone Flying Game (Web) with Mouth-Only Accessibility Controls

## Summary
**MouthPilot** is a mobile-first 3D flying/shooter game that runs in the browser (iPhone Safari + desktop).  
It features a unique **Mouth-Only Accessibility Mode** designed for players who can primarily move their mouth. The player controls a third-person drone through 10 progressively harder worlds, starting with a calm Earth tutorial (NYC park) and ending in a full space war against UFOs.

The game is built with **TypeScript + Three.js** and uses **MediaPipe Face Landmarker** to track mouth movement and blinking for controls.

---

## Core Idea (What it is)
A third-person drone game with:
- **Simple, readable HUD** (mobile-style)
- **Touch buttons** for weapons
- **Two control modes**
  1) **Mouth-Only (Accessibility)** — main mode
  2) **Keyboard (Testing/PC)** — fallback mode

The goal is to fly forward, avoid threats, collect pickups, and defeat enemies while score and speed increase.

---

## How It Works (High-Level)
### Game Loop
- The drone is updated at 60 FPS using `requestAnimationFrame`.
- The world spawns:
  - obstacles (trees/buildings/space debris/asteroids),
  - pickups (pink diamonds),
  - enemies (red drones / spiky red asteroids / UFOs).
- Collisions are simplified using **bounding spheres** (fast and mobile-friendly).
- Score and speed update in real time on the HUD.

### Camera
- Third-person **chase camera** behind and slightly above the drone.
- Camera follows with a smooth lag (`lerp`) so movement feels cinematic and stable.

### Scoring
- Pickup collected: **+1 Puntos**
- Enemy destroyed: **+5 to +10 Puntos**
- Collision with enemy/obstacle: flash effect + respawn (and optional small penalty)

---

## UI/UX Requirements
### HUD (must match)
Top-left HUD:
- `Puntos: X  Vel: Y.Y`
- Start values: `Puntos: 1`, `Vel: 0.0`

Bottom-right:
- **Misile** button (brown/orange circle)
- **Guns** button (red circle)

Optional:
- Pause
- Camera mini (PIP) toggle for mouth tracking

---

## Controls
### Mode A — Mouth-Only Accessibility (Primary)
Uses the front camera + MediaPipe Face Landmarker.

#### Movement (Mouth Direction)
We track the **mouth center** and compare it to a calibrated neutral position:
- Mouth moves right → Drone strafes right
- Mouth moves left → Drone strafes left
- Mouth moves up → Drone moves up
- Mouth moves down → Drone moves down

To reduce jitter:
- **Deadzone** (ignores tiny movements)
- **Smoothing** (lerp/filter)

#### Speed Boost (Mouth Open)
If mouth opens beyond a threshold (normalized ratio), drone boosts forward speed temporarily:
- Mouth open → faster velocity

#### Fire (Blink + Optional Voice)
- **Blink fire:** blinking triggers guns (recommended: burst or continuous while eyes closed)
- Optional voice commands (where supported):
  - “fire”, “shoot”, “dispara”
> Note: iOS voice support can be limited. The design must never depend on voice to function.

#### Calibration
A “Calibrate Mouth” button captures the neutral mouth position for reliable control.

---

### Mode B — Keyboard (Testing on Desktop)
- WASD or Arrow Keys: move up/down/left/right
- **X** (or C): STOP / hover mode
- **Space:** Guns fire
- **M:** Misile (optional)
- **Shift:** Boost (optional)

---

## 3D Drone Models (Procedural — No Blender Required)
All models are built from Three.js primitives (procedural modeling).

### Player Drone (TIE-style silhouette)
- Wings: two large thin rectangles (BoxGeometry)
- Wing frame bars: thin box strips over the wing surface
- Center: metallic sphere cockpit
- Ring detail: torus around the cockpit front
- Connector: thin cylinder between wings and cockpit
- Lights: 3 yellow point lights on cockpit surface
- Visual polish:
  - metallic PBR materials (MeshStandardMaterial)
  - emissive + bloom/glow for lights and shots
  - subtle banking (roll) on movement

### Enemies
- Red enemy drone variant (same silhouette, red emissive accents)
- Spiky red asteroid enemy (Icosahedron with noise displacement or scaled spikes)

### UFO Boss
- Disk + dome + emissive core
- HP bar (minimal UI or boss flash feedback)

---

## World/Level Progression (10 Worlds)
Each world is defined by a `LevelConfig` object (spawn rates, speed ranges, environment builder).

### Level 1 — Earth: NYC Park Tutorial
**Purpose:** learn movement + STOP + boost  
Environment: green ground, trees, park paths, simple obstacles  
No enemies (or extremely low threat).  
Tutorial flow uses ring checkpoints (optional but recommended).

### Level 2 — Park Slalom
Tighter tree corridors, more pickups, precision flying.

### Level 3 — City Flight
Buildings, narrow lanes, reaction timing.

### Level 4 — Coast / Wind Zone
Light wind drift introduced. STOP becomes useful.

### Level 5 — Desert Canyon
Higher speed, tighter curves, first slow enemies.

### Level 6 — Military Base Combat
More enemies, introduce missiles and dodging patterns.

### Level 7 — Upper Atmosphere Transition
More combat, fewer ground obstacles, speed increases.

### Level 8 — Orbit Debris (Space)
Stars + debris + asteroids. Parallax starfield. Increased difficulty.

### Level 9 — Alien Zone
UFO enemies with movement patterns (zig-zag, dive, surround).

### Level 10 — Space War (Final)
Wave combat + boss UFO battle. Highest speed and spawn intensity.

---

## Tech Stack (Tools Used)
### Development
- **Cursor** (primary IDE + AI-assisted coding)
- **Node.js + npm**
- **TypeScript**

### Frontend / Build
- **Astro** (lightweight site structure) or **Vite** (if pure app)
- **Svelte** (optional) for UI island components (menu/HUD)
- **Vanilla DOM UI** is acceptable for maximum performance

### 3D Engine
- **Three.js (r165+)** for rendering, scene, materials, effects

### Computer Vision (Mouth/Face)
- **@mediapipe/tasks-vision** (FaceLandmarker)

### Optional
- Web Speech API (voice commands)
- Postprocessing bloom (Three.js EffectComposer) with mobile quality toggles

---

## Architecture (Recommended Modules)
src/
main.ts
game/
Game.ts
levels.ts
worlds/
EarthParkWorld.ts
CityWorld.ts
SpaceWorld.ts
entities/
Drone.ts
Enemy.ts
Pickup.ts
Laser.ts
Missile.ts
BossUFO.ts
input/
InputRouter.ts
MouthTracker.ts
KeyboardInput.ts
VoiceHandler.ts
fx/
Particles.ts
ui/
hud.ts
menu.ts

yaml
Copy code

### Key Design Principles
- Keep per-frame allocations near zero (mobile performance)
- Reuse geometries/materials
- InstancedMesh for repeated objects (trees, asteroids)
- Bounding sphere collisions for speed

---

## Performance & Mobile Constraints
- Target: stable **60 FPS**
- Clamp DPR: `Math.min(1.5, devicePixelRatio)`
- Avoid heavy shadows on mobile
- Bloom/FX toggles:
  - High (desktop)
  - Low (mobile)
- Camera/mouth tracking must start only after a user gesture (“Tap to Start”) to satisfy iOS permission rules.

---

## Privacy Notes (Important)
- Camera feed is used only for real-time tracking.
- No video should be uploaded or stored by default.
- Provide clear UI text: “Camera used for mouth control only. No recording.”

---

## Roadmap (Practical Build Order)
1) Basic Three.js scene + drone + chase camera
2) HUD + buttons (Guns/Misile)
3) Keyboard mode (fast testing)
4) Mouth-Only mode + calibration + smoothing
5) Pickups + scoring
6) Enemies + guns + collisions + respawn flash
7) Missile + homing
8) Worlds 1, 8 (Earth + Space) first
9) Complete levels 2–7–9–10 via configs
10) Boss fight + wave system
11) Viral features: share card + daily seed + leaderboard (optional)

---

## Viral Growth Features (Optional, High-Impact)
- **Share Card**: auto-generate an image after death with score, level, and “Mouth-Only Mode”
- **Daily Challenge Seed**: everyone plays the same obstacle layout daily
- **Mouth-Only Leaderboard**: separate ranking category for accessibility mode
- Short replay export (later): MediaRecorder to generate a 5–8s clip

---

## Definition of Done (Acceptance)
- Runs on iPhone Safari and Desktop Chrome/Edge
- Mouth-Only mode:
  - mouth direction controls movement reliably
  - mouth open boosts speed
  - blink fires weapons
  - calibration works
- Keyboard mode:
  - WASD/arrows move drone
  - Space fires
  - STOP/hover works
- Level progression exists with 10 world configs
- HUD displays exactly: `Puntos: X  Vel: Y.Y`