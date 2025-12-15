import type { FaceControls } from '../FaceTracker';
import type { VoiceCommand } from '../VoiceHandler';
import { clamp } from '../math';

import { createDefaultInputState, type ControlMode, type FlipCommand, type InputState } from './InputState';

export type RefLike<T> = { current: T };

type ManualNudge = { x: number; y: number; untilMs: number };

export type InputRouterOptions = {
  face: RefLike<FaceControls>;
  onTogglePause?: () => void;
};

export class InputRouter {
  readonly state: RefLike<InputState>;

  private readonly face: RefLike<FaceControls>;
  private readonly onTogglePause?: () => void;

  private hasCamera = false;

  private keys = {
    left: false,
    right: false,
    up: false,
    down: false,
    boost: false,
    fire: false,
    stop: false,
  };

  private manualNudge: ManualNudge | null = null;
  private stopHeld = false;
  private stopToggled = false;

  private queuedGunBurst = false;
  private queuedMissile = false;
  private queuedFlip: FlipCommand | null = null;

  private lastVoiceFireMs = 0;
  private lastVoiceMissileMs = 0;
  private lastVoiceStopMs = 0;

  constructor(options: InputRouterOptions) {
    this.face = options.face;
    this.onTogglePause = options.onTogglePause;
    this.state = { current: createDefaultInputState() };

    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp, { passive: true });
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown as any);
    window.removeEventListener('keyup', this.onKeyUp as any);
  }

  reset() {
    this.manualNudge = null;
    this.stopHeld = false;
    this.stopToggled = false;
    this.queuedGunBurst = false;
    this.queuedMissile = false;
    this.queuedFlip = null;
    this.keys = {
      left: false,
      right: false,
      up: false,
      down: false,
      boost: false,
      fire: false,
      stop: false,
    };
    this.lastVoiceFireMs = 0;
    this.lastVoiceMissileMs = 0;
    this.lastVoiceStopMs = 0;

    this.state.current = createDefaultInputState();
  }

  setHasCamera(hasCamera: boolean) {
    this.hasCamera = Boolean(hasCamera);
  }

  setStopHeld(held: boolean) {
    this.stopHeld = Boolean(held);
  }

  toggleStop() {
    this.stopToggled = !this.stopToggled;
    this.manualNudge = null;
  }

  nudge(x: number, y: number, durationMs = 700) {
    const ms = Number.isFinite(durationMs) ? durationMs : 700;
    this.manualNudge = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), untilMs: performance.now() + ms };
  }

  queueGunBurst() {
    this.queuedGunBurst = true;
  }

  queueMissile() {
    this.queuedMissile = true;
  }

  queueFlip(axis: 'x' | 'z', dir: 1 | -1) {
    this.queuedFlip = { axis, dir };
  }

  handleVoiceCommand(cmd: VoiceCommand) {
    if (cmd.type === 'fireGuns') {
      const now = performance.now();
      if (now - this.lastVoiceFireMs < 450) return;
      this.lastVoiceFireMs = now;
      this.queueGunBurst();
      return;
    }

    if (cmd.type === 'fireMissile') {
      const now = performance.now();
      if (now - this.lastVoiceMissileMs < 700) return;
      this.lastVoiceMissileMs = now;
      this.queueMissile();
      return;
    }

    if (cmd.type === 'stop') {
      const now = performance.now();
      if (now - this.lastVoiceStopMs < 650) return;
      this.lastVoiceStopMs = now;
      this.toggleStop();
      return;
    }

    if (cmd.type === 'nudge') {
      this.nudge(cmd.x, cmd.y, cmd.durationMs);
      return;
    }

    if (cmd.type === 'flip') {
      this.queueFlip(cmd.axis, cmd.dir);
      return;
    }

    if (cmd.type === 'togglePause') {
      this.onTogglePause?.();
    }
  }

  update(nowMs: number) {
    const face = this.face.current;
    const hasMouth = Boolean(face.calibrated);
    const mode: ControlMode = hasMouth ? 'mouth' : 'keyboard';

    let moveX = hasMouth ? face.strafeX : 0;
    let moveY = hasMouth ? face.strafeY : 0;

    const manual = this.manualNudge;
    if (manual && manual.untilMs > nowMs) {
      moveX = manual.x;
      moveY = manual.y;
    } else if (manual && manual.untilMs <= nowMs) {
      this.manualNudge = null;
    }

    const keyX = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const keyY = (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0);
    if (keyX || keyY) {
      moveX = clamp(moveX + keyX, -1, 1);
      moveY = clamp(moveY + keyY, -1, 1);
    }

    const boost = clamp((hasMouth ? face.boost : 0) + (this.keys.boost ? 1 : 0), 0, 1);
    const stop = this.stopHeld || this.stopToggled || this.keys.stop;

    const fireGuns = (hasMouth && face.fireHold) || this.keys.fire;
    const fireGunsBurst = (hasMouth && face.fireBurst) || this.queuedGunBurst;
    const fireMissile = this.queuedMissile;
    const flip = this.queuedFlip;

    const s = this.state.current;
    s.mode = mode;
    s.moveX = moveX;
    s.moveY = moveY;
    s.boost = boost;
    s.stop = stop;
    s.fireGuns = fireGuns;
    s.fireGunsBurst = fireGunsBurst;
    s.fireMissile = fireMissile;
    s.flip = flip;
    s.hasCamera = this.hasCamera || hasMouth;

    // Consume one-frame actions.
    this.queuedGunBurst = false;
    this.queuedMissile = false;
    this.queuedFlip = null;
  }

  private shouldIgnoreKeyEvent(e: KeyboardEvent) {
    const target = e.target as any;
    const tag = String(target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(target?.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.shouldIgnoreKeyEvent(e)) return;

    const k = e.key.toLowerCase();

    if (k === 'a' || e.key === 'ArrowLeft') {
      this.keys.left = true;
      e.preventDefault();
    }
    if (k === 'd' || e.key === 'ArrowRight') {
      this.keys.right = true;
      e.preventDefault();
    }
    if (k === 'w' || e.key === 'ArrowUp') {
      this.keys.up = true;
      e.preventDefault();
    }
    if (k === 's' || e.key === 'ArrowDown') {
      this.keys.down = true;
      e.preventDefault();
    }
    if (e.key === 'Shift') this.keys.boost = true;

    if (k === 'x' || k === 'c') {
      this.keys.stop = true;
      e.preventDefault();
    }

    if (e.key === ' ') {
      this.keys.fire = true;
      if (!e.repeat) this.queueGunBurst();
      e.preventDefault();
    }

    if (k === 'f') {
      this.queueGunBurst();
    }
    if (k === 'm') {
      if (!e.repeat) this.queueMissile();
    }
    if (k === 'p') {
      if (!e.repeat) this.onTogglePause?.();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.shouldIgnoreKeyEvent(e)) return;

    const k = e.key.toLowerCase();

    if (k === 'a' || e.key === 'ArrowLeft') this.keys.left = false;
    if (k === 'd' || e.key === 'ArrowRight') this.keys.right = false;
    if (k === 'w' || e.key === 'ArrowUp') this.keys.up = false;
    if (k === 's' || e.key === 'ArrowDown') this.keys.down = false;
    if (e.key === 'Shift') this.keys.boost = false;
    if (k === 'x' || k === 'c') this.keys.stop = false;
    if (e.key === ' ') this.keys.fire = false;
  };
}
