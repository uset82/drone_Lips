# Drone Lips

Control a 3D drone using your lips (webcam + MediaPipe Face Landmarker), rendered with Three.js inside a React island in an Astro site.

## Key entrypoints

- `src/pages/index.astro`: page shell that mounts React.
- `src/components/DroneGame.tsx`: client-only React game (Three.js + MediaPipe + iPhone-first UI).
- `src/components/DroneGame.jsx`: legacy R3F version (not mounted by default).

## Development

```sh
npm install
npm run dev
```

Astro dev server defaults to `http://localhost:4321`.

## Auggie (AI agent / app "brain")

This repo includes a chat overlay plus a local "brain server". The Astro dev server proxies `/api/auggie/*` to it.

### 1) Configure OpenRouter

Copy `.env.example` → `.env` and set:

```sh
OPENROUTER_API_KEY="..."
OPENROUTER_MODEL="nex-agi/deepseek-v3.1-nex-n1:free"
```

### 2) Use it

Start both servers (default):

```sh
npm run dev
```

Then open the page. A button labeled **Auggie** appears in the bottom-left.

Notes:

- Local server: `scripts/auggie-server.mjs` (defaults to `127.0.0.1:4546`).
- Dev proxy: configured in `astro.config.mjs` so the UI can call `/api/auggie/chat`.
- To show the chat outside dev builds, set `PUBLIC_AUGGIE_CHAT="true"` (see `.env.example`).
- Toggle **Brain** in the chat UI to enable tool-using "brain mode" (read/modify files inside the repo).
- Voice input uses the browser Web Speech API (works best in Chrome/Edge). When the chat is open it auto-listens and re-listens between phrases.
- Toggle **Direct** to call OpenRouter from the browser (stores key in localStorage; not recommended for public deployments).
  - UI-only dev server (no Auggie): `npm run dev:ui`

If `certs/dev-cert.pem` + `certs/dev-key.pem` exist, it will serve HTTPS instead.

### Test from iPhone / another device (camera needs HTTPS)

Browsers require HTTPS for `getUserMedia()` (camera) when you’re not on `localhost`.

Option A (recommended): LAN HTTPS via mkcert

1. Generate local dev certs (include your PC’s LAN IP):

```sh
mkcert -install
mkcert -cert-file certs/dev-cert.pem -key-file certs/dev-key.pem localhost 127.0.0.1 ::1 <your-ip>
```

2. Trust the mkcert CA on iPhone:

```sh
mkcert -CAROOT
```

Copy `rootCA.pem` to the iPhone, install it, then enable trust in:
Settings → General → About → Certificate Trust Settings.

3. Run the dev server exposed on LAN:

```sh
npm run dev:host
```

4. Open on iPhone Safari:
   `https://<your-ip>:4321/`

Option B: run the dev server on the device with a webcam (simplest)
Clone the repo on the laptop, then run `npm install` + `npm run dev` and open `http://localhost:4321`.

## Build

```sh
npm run build
npm run preview
```

## Quality checks

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
```

## Notes

- The game requires webcam permissions in the browser.
