# MouthPilot / Drone Lips — Task-Based Build Plan

This is the “do it by tasks” blueprint so we can ship the full game without random code dumps.

## 0) Source Of Truth

- Product + gameplay requirements: `maingameIDEA/architecture.md`
- Tech architecture + systems: `maingameIDEA/structure.md`
- Running app codebase: `drone-lips/`

## 1) Current Repo Architecture (What You Actually Have)

### Runtime shell
- `drone-lips/src/pages/index.astro`: Astro page that mounts the game React island and shows a “boot overlay” for iPhone black-screen debugging.
- `drone-lips/astro.config.mjs`: configures HTTPS dev server when `certs/dev-key.pem` + `certs/dev-cert.pem` exist; proxies `/api/auggie/*` to the local brain server in dev.
- `drone-lips/scripts/dev-brain.mjs`: starts 2 processes in dev: the Auggie server + Astro dev server.

### Game island (current)
- `drone-lips/src/components/DroneGame.tsx`: single React component that:
  - owns gameplay UI state (`phase`, overlays, refs for HUD text)
  - renders the iPhone HUD + buttons overlay
  - creates and drives the `Game` core (`drone-lips/src/game/Game.ts`)

### Game modules (already extracted)
- `drone-lips/src/game/Drone.ts`: procedural TIE-like player drone (wings + bar + cockpit sphere + 3 yellow lights + flip animation).
- `drone-lips/src/game/Enemy.ts`: enemy "ship/spike" logic (spawn/update/hp/reward).
- `drone-lips/src/game/Projectiles.ts`: `LaserShot` + `MissileShot` (homing).
- `drone-lips/src/game/FaceTracker.ts`: MediaPipe FaceLandmarker wrapper (mouth-center strafe + mouth-open boost + blink fire via EAR).
- `drone-lips/src/game/VoiceHandler.ts`: Web Speech recognition parser -> `VoiceCommand`.
- `drone-lips/src/game/math.ts`: math helpers.
- `drone-lips/src/game/Game.ts`: Three.js scene + RAF loop + gameplay simulation (space MVP).

### Key observation (important)
Right now, the “engine” and “systems” are still mostly inside `DroneGame.tsx`. The docs in `maingameIDEA/structure.md` describe a cleaner system order and data models; we’ll migrate toward that **incrementally**.

## 2) Target Architecture (From `maingameIDEA/structure.md`)

### Single loop (non-negotiable order)
1) input -> `InputState`
2) drone apply input (xy + stop/hover intent)
3) speed system (forward speed target + smoothing)
4) integrate movement
5) camera follow
6) spawner
7) entities update (lasers/missiles/enemies)
8) collisions
9) score/hud update
10) cleanup / pooling

### Canonical data models
- `InputState`: unified input (mouth + keyboard + voice + buttons).
- `GameState`: `menu/running/paused/gameover/levelComplete` + score/speed/time/unlocks.
- `LevelConfig`: 10 levels, each defined by environment + rates + tuning + (optional) boss config.

### Worlds
Each world is a procedural “builder”:
- Earth levels: ground plane + trees/buildings, wind, obstacles
- Space levels: starfield + asteroids + debris + UFO patterns

## 3) Gap Analysis (What’s Done vs Missing)

### Already implemented (space MVP)
- Third-person chase camera
- HUD: `Puntos: X · Vel: Y.Y` starts at 1 / 0.0
- Touch buttons: `Misile` + `Guns` (separated, iPhone-friendly)
- Stars + asteroids + pickups + enemies + collisions + respawn flash
- Guns burst + missiles homing
- Face tracking start after user gesture + calibration flow
- Voice commands on browsers that support Web Speech (mostly desktop Chrome/Edge)

### Missing to match the docs
- `LevelConfig` table + `LevelManager` + progression (10 worlds).
- World builders (`EarthParkWorld`, `CityWorld`, `OrbitWorld`, etc).
- Boss UFO + waves.
- Seeded RNG option (daily challenge later).

## 4) Task Plan (Milestones + Acceptance Criteria)

Each milestone is meant to be shippable and testable on iPhone after it lands.

### M0 — Baseline + “No regression” harness
Deliverables:
- Manual test checklist (iPhone + desktop)
- Confirm current UI/controls match screenshots
Acceptance:
- iPhone loads reliably over HTTPS and doesn’t stay black
- buttons + face tracking still work

### M1 - Extract a real `Game` core (engine boundary)
Goal: remove most "engine code" from React component.
Deliverables:
- `drone-lips/src/game/Game.ts` orchestrates init + RAF loop + dispose
- React component becomes "UI + lifecycle wrapper"
Acceptance:
- no gameplay behavior changes
- `Game` can be started/stopped cleanly (no WebGL context leaks)
Status: ✅ implemented

### M2 — Implement `InputState` + `InputRouter`
Deliverables:
- `drone-lips/src/game/input/InputState.ts`
- `InputRouter` merges: MouthTracker + Keyboard + Voice + TouchButtons
- `TouchButtons` exposes guns/missile/stop as part of input (not “call fire() directly”)
Acceptance:
- all inputs still work
- no duplicate fire events (debounced correctly)
Status: ✅ implemented

### M3 - Mouth-only math + Blink-to-fire
Deliverables:
- `MouthTracker` using mouth center (61/291) + mouth open ratio (13/14)
- Blink detection using EAR + debounce logic from `maingameIDEA/structure.md`
- Calibration UI becomes “Calibrate Mouth”
Acceptance:
- mouth center reliably strafes on iPhone (with deadzone + smoothing)
- short blink triggers a 5-shot burst (consistent, low false-positives)
- long blink (>500ms) optionally enables continuous fire while held
Status: ✅ implemented (currently inside `FaceTracker`)

### M4 - STOP/Hover mode (accessibility-critical)
Deliverables:
- `stop` boolean in `InputState`
- Speed system respects stop: forward speed ramps to 0, higher damping for stable hover
- Keyboard stop key: `X` (per docs)
- UI: hold-to-hover STOP button (touch-friendly)
Acceptance:
- holding STOP keeps speed near 0 until released
- releasing STOP returns to ramped forward speed
Status: ✅ implemented (UI hold-to-hover + engine stop input)

### M5 - Level system + configs
Deliverables:
- `levels.ts` + `LevelConfig` copied from `maingameIDEA/structure.md`
- `LevelManager` (current level, completion badges, best scores, persistence via `localStorage`)
- UI: free-select level picker + "Suggested path" ordering + completion markers
Acceptance:
- can play Level 1 and Level 8 at minimum
- score/speed tune changes per level config

### M6 — World builders (first 2 worlds)
Deliverables:
- `World` interface (`create(scene)`, `update(dt)`, `dispose()`, spawn bounds)
- `OrbitWorld` extracted from current space scene
- `EarthParkWorld` (ground plane + trees + simple obstacles; `autoForward:false`)
Acceptance:
- Level 1 feels like slow tutorial (no enemies by default)
- Level 8 feels like current space run

### M7 — Expand worlds 2–7 and 9–10
Deliverables:
- City / Coast / Desert / Military / UpperAtmo / Alien / War worlds
- Environment-specific obstacles + palettes + fog/sky gradients
Acceptance:
- all 10 `LevelConfig` entries load without errors
- performance stays stable on iPhone (instancing + low-poly)

### M8 — Boss UFO + wave system
Deliverables:
- `BossUFO` entity with HP + patterns
- Boss spawn rule: `score >= boss.spawnAtScore`
Acceptance:
- boss fight is beatable, doesn’t tank FPS

### M9 — Polish (feel + UX)
Deliverables:
- quality toggle (mobile low vs desktop high)
- better explosions + hit feedback + mild screenshake
- optional: share card screenshot (future)
Acceptance:
- “Nintendo / liquid glass” UI polish achieved (buttons + HUD)

### M10 — Production readiness
Deliverables:
- build + preview + deploy notes (Netlify/Vercel)
- error/telemetry hooks (optional)
Acceptance:
- `npm run build` works, output is static
- consistent camera permission handling + clear privacy messaging

## 5) Decision Checklist (We Should Confirm Before M2/M3)

### Confirmed defaults (from you)
- Movement: mouth-center mapping (61/291) is the default; head/pose becomes an “Advanced Mode” later.
- Blink fire: short blink → 5-shot burst; long blink (>500ms) → optional continuous fire.
- STOP/Hover: add a UI hold button (iPhone-first); keep keyboard `X` on desktop.
- Progression: free-select levels for launch (with “Suggested path” + completion/best-score badges).

### Still open (we’ll decide when we get there)
- “Game over” model: respawn flash only vs lives/level fail.
- Language: Spanish-only UI vs bilingual.

## 6) Known Risks / Constraints (So We Don’t Get Surprised)

- iPhone Safari: Web Speech voice recognition is often unavailable; voice must be optional and never block gameplay.
- iPhone camera: `getUserMedia()` requires HTTPS on LAN; dev cert + trusted CA are mandatory.
- WebGL context loss (iOS): needs defensive handling (restore overlays + recreate renderer if necessary).
- Performance: avoid per-frame allocations; use pooling + InstancedMesh; clamp DPR; avoid heavy shadows.
- Assets: prefer procedural geometry; minimize texture sizes; preload and handle missing assets gracefully.
