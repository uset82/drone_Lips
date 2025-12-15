export type Environment =
  | 'earth-park'
  | 'earth-park-slalom'
  | 'city'
  | 'coast'
  | 'desert'
  | 'military'
  | 'upper-atmos'
  | 'orbit'
  | 'alien'
  | 'war';

export type LevelBossConfig = {
  hp: number;
  spawnAtScore: number;
  ufoSupportRate: number;
};

export type LevelConfig = {
  id: number;
  name: string;
  environment: Environment;

  // Movement tuning
  autoForward: boolean;
  baseSpeed: number;
  maxSpeed: number;
  accelPerSec: number;
  boostMultiplier: number;

  // Forces
  windForce: number;

  // Content
  obstacleDensity: number;
  asteroidCount: number;

  pickupRate: number;
  enemyRate: number;
  ufoRate: number;

  // Scoring
  pickupScore: number;
  enemyScoreMin: number;
  enemyScoreMax: number;

  boss?: LevelBossConfig;
};

export const LEVELS: ReadonlyArray<LevelConfig> = [
  {
    id: 1,
    name: 'NYC Park Tutorial',
    environment: 'earth-park',
    autoForward: false,
    baseSpeed: 0.0,
    maxSpeed: 6.0,
    accelPerSec: 1.2,
    boostMultiplier: 1.6,
    windForce: 0.05,
    obstacleDensity: 0.35,
    asteroidCount: 0,
    pickupRate: 0.25,
    enemyRate: 0.0,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10,
  },
  {
    id: 2,
    name: 'Park Slalom',
    environment: 'earth-park-slalom',
    autoForward: false,
    baseSpeed: 0.5,
    maxSpeed: 7.0,
    accelPerSec: 1.4,
    boostMultiplier: 1.7,
    windForce: 0.08,
    obstacleDensity: 0.55,
    asteroidCount: 0,
    pickupRate: 0.45,
    enemyRate: 0.0,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10,
  },
  {
    id: 3,
    name: 'City Flight',
    environment: 'city',
    autoForward: true,
    baseSpeed: 1.2,
    maxSpeed: 9.0,
    accelPerSec: 1.8,
    boostMultiplier: 1.7,
    windForce: 0.1,
    obstacleDensity: 0.65,
    asteroidCount: 0,
    pickupRate: 0.55,
    enemyRate: 0.1,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10,
  },
  {
    id: 4,
    name: 'Coast Wind Run',
    environment: 'coast',
    autoForward: true,
    baseSpeed: 1.8,
    maxSpeed: 10.0,
    accelPerSec: 2.0,
    boostMultiplier: 1.8,
    windForce: 0.22,
    obstacleDensity: 0.45,
    asteroidCount: 0,
    pickupRate: 0.6,
    enemyRate: 0.18,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10,
  },
  {
    id: 5,
    name: 'Desert Canyon',
    environment: 'desert',
    autoForward: true,
    baseSpeed: 2.2,
    maxSpeed: 11.0,
    accelPerSec: 2.2,
    boostMultiplier: 1.9,
    windForce: 0.12,
    obstacleDensity: 0.7,
    asteroidCount: 0,
    pickupRate: 0.65,
    enemyRate: 0.28,
    ufoRate: 0.0,
    pickupScore: 1,
    enemyScoreMin: 5,
    enemyScoreMax: 10,
  },
  {
    id: 6,
    name: 'Military Base Combat',
    environment: 'military',
    autoForward: true,
    baseSpeed: 2.6,
    maxSpeed: 12.0,
    accelPerSec: 2.4,
    boostMultiplier: 2.0,
    windForce: 0.1,
    obstacleDensity: 0.55,
    asteroidCount: 0,
    pickupRate: 0.6,
    enemyRate: 0.5,
    ufoRate: 0.05,
    pickupScore: 1,
    enemyScoreMin: 6,
    enemyScoreMax: 10,
  },
  {
    id: 7,
    name: 'Upper Atmosphere',
    environment: 'upper-atmos',
    autoForward: true,
    baseSpeed: 3.0,
    maxSpeed: 13.0,
    accelPerSec: 2.6,
    boostMultiplier: 2.1,
    windForce: 0.08,
    obstacleDensity: 0.35,
    asteroidCount: 10,
    pickupRate: 0.65,
    enemyRate: 0.55,
    ufoRate: 0.12,
    pickupScore: 1,
    enemyScoreMin: 6,
    enemyScoreMax: 10,
  },
  {
    id: 8,
    name: 'Orbit Debris Field',
    environment: 'orbit',
    autoForward: true,
    baseSpeed: 3.4,
    maxSpeed: 14.0,
    accelPerSec: 2.8,
    boostMultiplier: 2.1,
    windForce: 0.06,
    obstacleDensity: 0.2,
    asteroidCount: 60,
    pickupRate: 0.7,
    enemyRate: 0.62,
    ufoRate: 0.18,
    pickupScore: 1,
    enemyScoreMin: 6,
    enemyScoreMax: 10,
  },
  {
    id: 9,
    name: 'Alien Zone',
    environment: 'alien',
    autoForward: true,
    baseSpeed: 3.8,
    maxSpeed: 15.0,
    accelPerSec: 3.0,
    boostMultiplier: 2.2,
    windForce: 0.04,
    obstacleDensity: 0.18,
    asteroidCount: 80,
    pickupRate: 0.75,
    enemyRate: 0.78,
    ufoRate: 0.35,
    pickupScore: 1,
    enemyScoreMin: 7,
    enemyScoreMax: 10,
  },
  {
    id: 10,
    name: 'Space War (Boss)',
    environment: 'war',
    autoForward: true,
    baseSpeed: 4.2,
    maxSpeed: 16.0,
    accelPerSec: 3.2,
    boostMultiplier: 2.3,
    windForce: 0.03,
    obstacleDensity: 0.15,
    asteroidCount: 100,
    pickupRate: 0.8,
    enemyRate: 0.95,
    ufoRate: 0.5,
    pickupScore: 1,
    enemyScoreMin: 8,
    enemyScoreMax: 12,
    boss: { hp: 220, spawnAtScore: 90, ufoSupportRate: 0.65 },
  },
];

export const DEFAULT_LEVEL_ID = 8;

export function isValidLevelId(levelId: number): boolean {
  return Number.isInteger(levelId) && levelId >= 1 && levelId <= LEVELS.length;
}

export function getLevelConfig(levelId: number): LevelConfig {
  const fallback = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, DEFAULT_LEVEL_ID - 1))];
  if (!Number.isFinite(levelId)) return fallback;
  return LEVELS.find((l) => l.id === levelId) ?? fallback;
}

