import { describe, expect, it } from 'vitest';

import {
  computeMouthAsym,
  computeMouthOffsetsFromLandmarks,
  computeMouthOpen,
  computeMouthOpenFromLandmarks,
  getBlendshapeScore,
} from './faceControls.js';

describe('getBlendshapeScore', () => {
  it('returns the score for a matching category', () => {
    const categories = [
      { categoryName: 'eyeBlinkLeft', score: 0.1 },
      { categoryName: 'mouthOpen', score: 0.42 },
    ];

    expect(getBlendshapeScore(categories, 'mouthOpen')).toBeCloseTo(0.42);
  });

  it('returns 0 when the category is missing', () => {
    const categories = [{ categoryName: 'eyeBlinkLeft', score: 0.1 }];
    expect(getBlendshapeScore(categories, 'mouthOpen')).toBe(0);
  });
});

describe('computeMouthOpen', () => {
  it('subtracts the neutral baseline and scales', () => {
    expect(computeMouthOpen(0.6, 0.2, 2)).toBeCloseTo(0.8);
  });

  it('clamps negative values to 0', () => {
    expect(computeMouthOpen(0.1, 0.2, 2)).toBe(0);
  });
});

describe('computeMouthOpenFromLandmarks', () => {
  it('returns 0 for missing landmarks', () => {
    expect(computeMouthOpenFromLandmarks(null)).toBe(0);
  });

  it('returns a normalized mouth-open score', () => {
    const landmarks = [];

    // Mouth corners define width
    landmarks[61] = { x: 0.4, y: 0.5 };
    landmarks[291] = { x: 0.6, y: 0.5 };

    // Inner lips define open
    landmarks[13] = { x: 0.5, y: 0.4 };
    landmarks[14] = { x: 0.5, y: 0.6 };

    // open=0.2, width=0.2 => score=1
    expect(computeMouthOpenFromLandmarks(landmarks)).toBeCloseTo(1);
  });
});

describe('computeMouthOffsetsFromLandmarks', () => {
  it('returns 0 offsets for missing landmarks', () => {
    expect(computeMouthOffsetsFromLandmarks(null)).toEqual({ x: 0, y: 0 });
  });

  it('returns normalized mouth dx/dy offsets', () => {
    const landmarks = [];

    // Eye outer corners define face width + X center
    landmarks[33] = { x: 0.4, y: 0.4 };
    landmarks[263] = { x: 0.6, y: 0.4 };

    // Forehead + chin define face height + Y center
    landmarks[10] = { x: 0.5, y: 0.2 };
    landmarks[152] = { x: 0.5, y: 0.8 };

    // Symmetric mouth around X center, slightly below face center
    landmarks[61] = { x: 0.45, y: 0.6 };
    landmarks[291] = { x: 0.55, y: 0.6 };

    const { x, y } = computeMouthOffsetsFromLandmarks(landmarks);
    expect(x).toBeCloseTo(0);
    expect(y).toBeGreaterThan(0);
  });
});

describe('computeMouthAsym', () => {
  it('returns 0 for missing landmarks', () => {
    expect(computeMouthAsym(null)).toBe(0);
  });

  it('returns a signed steering signal (left/right) based on mouth center', () => {
    const landmarks = [];

    // Face width from outer eye corners
    landmarks[33] = { x: 0.4, y: 0.4 };
    landmarks[263] = { x: 0.6, y: 0.4 };

    // Forehead + chin needed for offsets
    landmarks[10] = { x: 0.5, y: 0.2 };
    landmarks[152] = { x: 0.5, y: 0.8 };

    // Symmetric mouth around face center
    landmarks[61] = { x: 0.45, y: 0.6 };
    landmarks[291] = { x: 0.55, y: 0.6 };
    expect(computeMouthAsym(landmarks)).toBeCloseTo(0);

    // Shift mouth to the right
    landmarks[61] = { x: 0.47, y: 0.6 };
    landmarks[291] = { x: 0.57, y: 0.6 };
    expect(computeMouthAsym(landmarks)).toBeGreaterThan(0);
  });
});
