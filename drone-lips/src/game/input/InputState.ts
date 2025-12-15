export type ControlMode = 'mouth' | 'keyboard';

export type FlipCommand = { axis: 'x' | 'z'; dir: 1 | -1 };

export type InputState = {
  mode: ControlMode;
  moveX: number; // [-1..1]
  moveY: number; // [-1..1]
  boost: number; // [0..1]
  stop: boolean; // hover
  fireGuns: boolean; // held / continuous
  fireGunsBurst: boolean; // momentary burst trigger (short blink / tap)
  fireMissile: boolean; // momentary
  flip: FlipCommand | null; // momentary
  hasCamera: boolean;
};

export function createDefaultInputState(): InputState {
  return {
    mode: 'keyboard',
    moveX: 0,
    moveY: 0,
    boost: 0,
    stop: false,
    fireGuns: false,
    fireGunsBurst: false,
    fireMissile: false,
    flip: null,
    hasCamera: false,
  };
}

