import { clamp } from './math';

type RawLandmark = { x: number; y: number; z: number };

export type FaceControls = {
  calibrated: boolean;
  strafeX: number; // -1..1
  strafeY: number; // -1..1
  boost: number; // 0..1 (mouth open threshold / hysteresis)
  mouthOpen: number; // 0..1 (debug/telemetry)
  fireBurst: boolean; // short blink => burst (one-frame pulse)
  fireHold: boolean; // long blink => continuous fire (while held)
};

export type FaceTrackerOptions = {
  invertX?: boolean;
  deadzone?: number;
  gainX?: number;
  gainY?: number;
  smoothing?: number;
  mouthBoostOn?: number;
  mouthBoostOff?: number;
  eyeClosedEar?: number;
  blinkMinMs?: number;
  blinkShortMaxMs?: number;
  blinkHoldMinMs?: number;
  enableLongBlinkHold?: boolean;
};

const LEFT_EYE_H0 = 33;
const LEFT_EYE_H1 = 133;
const LEFT_EYE_V0 = 159;
const LEFT_EYE_V1 = 145;

const RIGHT_EYE_H0 = 362;
const RIGHT_EYE_H1 = 263;
const RIGHT_EYE_V0 = 386;
const RIGHT_EYE_V1 = 374;

const UPPER_LIP = 13;
const LOWER_LIP = 14;
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;

function dist2(a: RawLandmark, b: RawLandmark) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function applyDeadzone(v: number, deadzone: number) {
  const a = Math.abs(v);
  if (a < deadzone) return 0;
  const sign = v < 0 ? -1 : 1;
  return (sign * (a - deadzone)) / (1 - deadzone);
}

function mouthCenter(landmarks: RawLandmark[]) {
  const left = landmarks[MOUTH_LEFT];
  const right = landmarks[MOUTH_RIGHT];
  if (!left || !right) return null;
  return { x: (left.x + right.x) * 0.5, y: (left.y + right.y) * 0.5 };
}

function mouthWidth(landmarks: RawLandmark[]) {
  const left = landmarks[MOUTH_LEFT];
  const right = landmarks[MOUTH_RIGHT];
  if (!left || !right) return 0;
  return dist2(left, right);
}

function mouthOpenRatio(landmarks: RawLandmark[]) {
  const upper = landmarks[UPPER_LIP];
  const lower = landmarks[LOWER_LIP];
  const left = landmarks[MOUTH_LEFT];
  const right = landmarks[MOUTH_RIGHT];
  if (!upper || !lower || !left || !right) return 0;

  const open = dist2(upper, lower);
  const width = dist2(left, right) || 1e-6;
  return open / width;
}

function eyeAspectRatio(landmarks: RawLandmark[]) {
  const lH0 = landmarks[LEFT_EYE_H0];
  const lH1 = landmarks[LEFT_EYE_H1];
  const lV0 = landmarks[LEFT_EYE_V0];
  const lV1 = landmarks[LEFT_EYE_V1];

  const rH0 = landmarks[RIGHT_EYE_H0];
  const rH1 = landmarks[RIGHT_EYE_H1];
  const rV0 = landmarks[RIGHT_EYE_V0];
  const rV1 = landmarks[RIGHT_EYE_V1];

  if (!lH0 || !lH1 || !lV0 || !lV1 || !rH0 || !rH1 || !rV0 || !rV1) return 0;

  const earL = dist2(lV0, lV1) / (dist2(lH0, lH1) || 1e-6);
  const earR = dist2(rV0, rV1) / (dist2(rH0, rH1) || 1e-6);
  return (earL + earR) * 0.5;
}

export class FaceTracker {
  private readonly opts: Required<FaceTrackerOptions>;

  private videoEl: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: any = null;
  private rafId: number | null = null;

  private neutral: { x: number; y: number; w: number } | null = null;
  private cal: {
    startMs: number;
    durationMs: number;
    frames: number;
    xSum: number;
    ySum: number;
    wSum: number;
  } | null = null;

  private boostOn = false;
  private eyesClosedSinceMs: number | null = null;

  private last: FaceControls = {
    calibrated: false,
    strafeX: 0,
    strafeY: 0,
    boost: 0,
    mouthOpen: 0,
    fireBurst: false,
    fireHold: false,
  };
  private onControls: ((c: FaceControls) => void) | null = null;
  private onError: ((msg: string) => void) | null = null;

  constructor(options: FaceTrackerOptions = {}) {
    this.opts = {
      invertX: Boolean(options.invertX ?? false),
      deadzone: Number.isFinite(options.deadzone) ? (options.deadzone as number) : 0.015,
      gainX: Number.isFinite(options.gainX) ? (options.gainX as number) : 12,
      gainY: Number.isFinite(options.gainY) ? (options.gainY as number) : 12,
      smoothing: Number.isFinite(options.smoothing) ? (options.smoothing as number) : 0.18,
      mouthBoostOn: Number.isFinite(options.mouthBoostOn) ? (options.mouthBoostOn as number) : 0.22,
      mouthBoostOff: Number.isFinite(options.mouthBoostOff) ? (options.mouthBoostOff as number) : 0.18,
      eyeClosedEar: Number.isFinite(options.eyeClosedEar) ? (options.eyeClosedEar as number) : 0.18,
      blinkMinMs: Number.isFinite(options.blinkMinMs) ? (options.blinkMinMs as number) : 60,
      blinkShortMaxMs: Number.isFinite(options.blinkShortMaxMs) ? (options.blinkShortMaxMs as number) : 300,
      blinkHoldMinMs: Number.isFinite(options.blinkHoldMinMs) ? (options.blinkHoldMinMs as number) : 500,
      enableLongBlinkHold: Boolean(options.enableLongBlinkHold ?? true),
    };
  }

  setHandlers(handlers: {
    onControls?: (c: FaceControls) => void;
    onError?: (msg: string) => void;
  }) {
    this.onControls = handlers.onControls ?? null;
    this.onError = handlers.onError ?? null;
  }

  getControls(): FaceControls {
    return this.last;
  }

  async start(videoEl: HTMLVideoElement) {
    this.stop();

    this.videoEl = videoEl;

    if (!window.isSecureContext) {
      throw new Error('Camera requires HTTPS on iPhone Safari. Use mkcert (see README).');
    }

    let mp: any;
    try {
      mp = await import('@mediapipe/tasks-vision');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        msg.includes('Importing a module script failed')
          ? 'Face tracking failed to load (module import). On iPhone, make sure you are using HTTPS with a trusted certificate (mkcert) and reload.'
          : `Face tracking failed to load MediaPipe: ${msg}`,
      );
    }

    const { FaceLandmarker, FilesetResolver } = mp;

    const localWasmBase = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm/`, window.location.href).toString();
    let resolver: any;
    try {
      resolver = await FilesetResolver.forVisionTasks(localWasmBase);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[FaceTracker] Local wasm load failed, retrying with CDN', msg);
      try {
        resolver = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm');
      } catch {
        throw new Error(
          msg.includes('Importing a module script failed')
            ? `Face tracking failed to load MediaPipe wasm. Check that ${localWasmBase} contains the files from postinstall and that your HTTPS cert is trusted on iPhone.`
            : `Face tracking failed to load MediaPipe wasm: ${msg}`,
        );
      }
    }

    const createLandmarker = (delegate: 'GPU' | 'CPU') =>
      FaceLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate,
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });

    try {
      this.landmarker = await createLandmarker('GPU');
    } catch (gpuErr) {
      console.warn('[FaceTracker] GPU delegate failed, falling back to CPU', gpuErr);
      this.landmarker = await createLandmarker('CPU');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });

    videoEl.srcObject = this.stream;
    videoEl.playsInline = true;
    videoEl.muted = true;
    videoEl.autoplay = true;

    try {
      await videoEl.play();
    } catch {
      // ignore
    }

    this.rafId = window.requestAnimationFrame(this.tick);
  }

  beginCalibration(durationMs = 5000) {
    this.neutral = null;
    this.cal = {
      startMs: performance.now(),
      durationMs,
      frames: 0,
      xSum: 0,
      ySum: 0,
      wSum: 0,
    };
    this.boostOn = false;
    this.eyesClosedSinceMs = null;
  }

  stop() {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }

    try {
      this.landmarker?.close?.();
    } catch {
      // ignore
    }
    this.landmarker = null;

    this.videoEl = null;
    this.cal = null;
    this.neutral = null;
    this.boostOn = false;
    this.eyesClosedSinceMs = null;
    this.last = {
      calibrated: false,
      strafeX: 0,
      strafeY: 0,
      boost: 0,
      mouthOpen: 0,
      fireBurst: false,
      fireHold: false,
    };
  }

  private tick = () => {
    this.rafId = window.requestAnimationFrame(this.tick);

    const landmarker = this.landmarker;
    const videoEl = this.videoEl;
    if (!landmarker || !videoEl || videoEl.readyState < 2) return;

    try {
      const now = performance.now();
      const results = landmarker.detectForVideo(videoEl, now);
      const landmarks: RawLandmark[] | undefined = results?.faceLandmarks?.[0];
      if (!landmarks) return;

      const center = mouthCenter(landmarks);
      if (!center) return;
      const width = mouthWidth(landmarks);
      if (!width) return;

      const mouthRatio = mouthOpenRatio(landmarks);
      const ear = eyeAspectRatio(landmarks);

      if (this.cal) {
        const c = this.cal;
        c.frames += 1;
        c.xSum += center.x;
        c.ySum += center.y;
        c.wSum += width;

        if (now - c.startMs >= c.durationMs) {
          const frames = c.frames || 1;
          this.neutral = {
            x: c.xSum / frames,
            y: c.ySum / frames,
            w: c.wSum / frames || 1e-6,
          };
          this.cal = null;
        }
      }

      const neutral = this.neutral;
      if (!neutral) {
        this.boostOn = false;
        this.eyesClosedSinceMs = null;
        this.last = {
          calibrated: false,
          strafeX: 0,
          strafeY: 0,
          boost: 0,
          mouthOpen: 0,
          fireBurst: false,
          fireHold: false,
        };
        this.onControls?.(this.last);
        return;
      }

      const dx = (center.x - neutral.x) / neutral.w;
      const dy = (center.y - neutral.y) / neutral.w;

      let x = applyDeadzone(dx, this.opts.deadzone) * this.opts.gainX;
      if (this.opts.invertX) x = -x;
      x = clamp(x, -1, 1);

      // y is down in screen coords; invert so mouth up => positive strafeY
      let y = applyDeadzone(-dy, this.opts.deadzone) * this.opts.gainY;
      y = clamp(y, -1, 1);

      // Smoothing (simple lerp)
      const sx = this.last.strafeX + (x - this.last.strafeX) * this.opts.smoothing;
      const sy = this.last.strafeY + (y - this.last.strafeY) * this.opts.smoothing;

      // Mouth boost (hysteresis)
      if (mouthRatio > this.opts.mouthBoostOn) this.boostOn = true;
      if (mouthRatio < this.opts.mouthBoostOff) this.boostOn = false;
      const boost = this.boostOn ? 1 : 0;

      const mouthOpen = clamp(
        (mouthRatio - this.opts.mouthBoostOff) /
          Math.max(1e-6, this.opts.mouthBoostOn - this.opts.mouthBoostOff),
        0,
        1,
      );

      // Blink detection (short blink => burst, long blink => hold)
      let fireBurst = false;
      let fireHold = false;
      const eyesClosed = ear > 0 && ear < this.opts.eyeClosedEar;

      // While calibrating, ignore blink events (people blink a lot during calibration).
      if (!this.cal) {
        if (eyesClosed) {
          if (this.eyesClosedSinceMs == null) this.eyesClosedSinceMs = now;
          const heldMs = now - (this.eyesClosedSinceMs ?? now);
          if (this.opts.enableLongBlinkHold && heldMs >= this.opts.blinkHoldMinMs) {
            fireHold = true;
          }
        } else if (this.eyesClosedSinceMs != null) {
          const blinkMs = now - this.eyesClosedSinceMs;
          if (blinkMs >= this.opts.blinkMinMs && blinkMs <= this.opts.blinkShortMaxMs) {
            fireBurst = true;
          }
          this.eyesClosedSinceMs = null;
        }
      } else {
        this.eyesClosedSinceMs = null;
      }

      this.last = { calibrated: true, strafeX: sx, strafeY: sy, boost, mouthOpen, fireBurst, fireHold };
      this.onControls?.(this.last);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onError?.(msg);
    }
  };
}
