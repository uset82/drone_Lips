# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Commands (npm)

All commands are run from the repo root.

### Install dependencies

```sh
npm install
```

### Run the dev server

```sh
npm run dev
```

Astro dev server defaults to `http://localhost:4321` (or HTTPS if `certs/dev-cert.pem` + `certs/dev-key.pem` exist).

### Run the dev server + Auggie (AI agent)

Auggie chat runs via a local helper server (proxied under `/api/auggie/*` during dev).

```sh
npm run dev:brain
```

### Test on iPhone / another device (camera requires HTTPS)

On iOS (and most browsers), `getUserMedia()` requires a **secure context** when you’re not on `localhost`.

Recommended: LAN HTTPS via mkcert

1. Generate local dev certs (include your LAN IP):

```sh
mkcert -install
mkcert -cert-file certs/dev-cert.pem -key-file certs/dev-key.pem localhost 127.0.0.1 ::1 <your-ip>
```

2. Trust the mkcert CA on iPhone:

```sh
mkcert -CAROOT
```

Copy `rootCA.pem` to the phone, install it, and enable full trust.

3. Run the dev server exposed on LAN:

```sh
npm run dev:host
```

Open `https://<your-ip>:4321/` on the device.

### Build + preview the production build

```sh
npm run build
npm run preview
```

Build output goes to `dist/`.

### Lint / format / typecheck

```sh
npm run format:check
npm run lint
npm run typecheck
```

Auto-fix where possible:

```sh
npm run format
npm run lint:fix
```

### Tests (Vitest)

```sh
npm test
```

Watch mode:

```sh
npm run test:watch
```

Run a single test:

```sh
npm test -- src/lib/faceControls.test.js
npm test -- -t "computeMouthOpen"
```

### Astro CLI

This repo exposes Astro via an npm script (`"astro": "astro"`). For one-off CLI usage:

```sh
npm run astro -- --help
```

(Equivalent: `npx astro --help`.)

## High-level architecture

This is an Astro site with a single interactive page. The “game” runs client-side in React (three.js) and reads webcam input via MediaPipe.

### Routing + page composition

- `src/pages/index.astro` is the `/` route.
- The page renders the UI overlay and the `<video id="webcam">` element.
- The React game is mounted with `<DroneGame client:only="react" />`.
  - `client:only="react"` is important because `DroneGame` uses browser-only APIs (WebGL, webcam).

### React game + face tracking

- `src/components/DroneGame.jsx`:
  - Lazy-loads MediaPipe (`import('@mediapipe/tasks-vision')`) and runs inference in a `requestAnimationFrame` loop.
  - Calibrates a “neutral mouth open” baseline over ~5 seconds, then derives controls:
    - mouth open → forward acceleration
    - mouth asymmetry → yaw/turn
  - The mapping helpers live in `src/lib/faceControls.js` and are unit-tested.

### Game loop / rendering model

- Rendering is done with React Three Fiber (`<Canvas>`).
- Per-frame motion + camera follow happens in `useFrame(...)` using mutable refs (`velocity`, `dronePos`, `droneRot`).
- The drone mesh is animated via a Three.js ref (not per-frame React re-renders).
- Score/speed UI is updated via direct DOM writes to IDs defined in `index.astro` (`score`, `speed`, `calibrate`).
  - If you rename or move those elements in `index.astro`, update the selectors in `DroneGame.jsx` accordingly.

### MediaPipe WASM assets

- WASM assets are served locally from `public/mediapipe/wasm/` (generated on install).
- `scripts/copy-mediapipe-wasm.mjs` copies them from `node_modules/@mediapipe/tasks-vision/wasm` in `postinstall`.
- Runtime loads from `${import.meta.env.BASE_URL}mediapipe/wasm`.

## Key config files

- `astro.config.mjs`: enables the React integration (`@astrojs/react`).
- `eslint.config.mjs`, `prettier.config.mjs`: lint/format configuration.
- `tsconfig.json`: extends `astro/tsconfigs/strict` and configures React JSX.
