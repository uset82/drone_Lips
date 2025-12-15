export function getBlendshapeScore(categories, categoryName) {
  return categories?.find((bs) => bs.categoryName === categoryName)?.score ?? 0;
}

// Normalized mouth-open signal derived from face landmarks.
// Returns ~0 when closed; increases as the inner lips separate.
export function computeMouthOpenFromLandmarks(landmarks) {
  if (!Array.isArray(landmarks)) return 0;

  // MediaPipe FaceMesh landmark indices
  const upperInnerLip = landmarks[13];
  const lowerInnerLip = landmarks[14];
  const leftMouthCorner = landmarks[61];
  const rightMouthCorner = landmarks[291];

  if (!upperInnerLip || !lowerInnerLip || !leftMouthCorner || !rightMouthCorner) return 0;

  const mouthWidth = Math.abs(rightMouthCorner.x - leftMouthCorner.x);
  if (mouthWidth < 1e-4) return 0;

  const mouthOpen = Math.abs(lowerInnerLip.y - upperInnerLip.y);
  return mouthOpen / mouthWidth;
}

// Normalized mouth position offsets relative to the face center.
// x: +right, -left (in video coordinates)
// y: +down, -up
export function computeMouthOffsetsFromLandmarks(landmarks) {
  if (!Array.isArray(landmarks)) return { x: 0, y: 0 };

  // Eye outer corners => face width + X center
  const leftEyeOuter = landmarks[33];
  const rightEyeOuter = landmarks[263];

  // Forehead + chin => face height + Y center
  const forehead = landmarks[10];
  const chin = landmarks[152];

  // Mouth corners => mouth center
  const leftMouthCorner = landmarks[61];
  const rightMouthCorner = landmarks[291];

  if (
    !leftEyeOuter ||
    !rightEyeOuter ||
    !forehead ||
    !chin ||
    !leftMouthCorner ||
    !rightMouthCorner
  ) {
    return { x: 0, y: 0 };
  }

  const faceCenterX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
  const faceCenterY = (forehead.y + chin.y) / 2;

  const faceWidth = Math.abs(rightEyeOuter.x - leftEyeOuter.x);
  const faceHeight = Math.abs(chin.y - forehead.y);

  if (faceWidth < 1e-4 || faceHeight < 1e-4) return { x: 0, y: 0 };

  const mouthCenterX = (leftMouthCorner.x + rightMouthCorner.x) / 2;
  const mouthCenterY = (leftMouthCorner.y + rightMouthCorner.y) / 2;

  return {
    x: (mouthCenterX - faceCenterX) / faceWidth,
    y: (mouthCenterY - faceCenterY) / faceHeight,
  };
}

export function computeMouthOpen(mouthOpenScore, neutralMouthOpenScore, scale = 2) {
  return Math.max(0, (mouthOpenScore - neutralMouthOpenScore) * scale);
}

// Left/right steering signal derived from mouth position vs face center.
// Returns a value in [-1, 1].
export function computeMouthAsym(landmarks, scale = 3) {
  const { x } = computeMouthOffsetsFromLandmarks(landmarks);

  const scaled = x * scale;
  return Math.max(-1, Math.min(1, scaled));
}
