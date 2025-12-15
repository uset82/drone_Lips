export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (dt <= 0) return current;
  const t = 1 - Math.exp(-lambda * dt);
  return lerp(current, target, t);
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randInt(minInclusive: number, maxInclusive: number): number {
  return Math.floor(randRange(minInclusive, maxInclusive + 1));
}

export function pickOne<T>(items: readonly T[]): T {
  if (!items.length) throw new Error('pickOne() requires a non-empty array.');
  return items[Math.floor(Math.random() * items.length)] as T;
}

