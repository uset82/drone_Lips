import type { LevelConfig } from '../levels';

import { EarthParkWorld } from './EarthParkWorld';
import { OrbitWorld } from './OrbitWorld';
import type { World, WorldInitArgs } from './World';

function isSpaceEnvironment(env: LevelConfig['environment']): boolean {
  return env === 'orbit' || env === 'upper-atmos' || env === 'alien' || env === 'war';
}

export function createWorld(args: WorldInitArgs): World {
  if (isSpaceEnvironment(args.level.environment)) return new OrbitWorld(args);
  return new EarthParkWorld(args);
}

