import { DEFAULT_LEVEL_ID, getLevelConfig, isValidLevelId, LEVELS, type LevelConfig } from './levels';

export type LevelManagerOptions = {
  storageKey?: string;
  defaultLevelId?: number;
};

const DEFAULT_STORAGE_KEY = 'drone-lips:level-id';

export class LevelManager {
  private readonly storageKey: string;
  private readonly defaultLevelId: number;
  private _levelId: number;

  constructor(options: LevelManagerOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.defaultLevelId =
      typeof options.defaultLevelId === 'number' && isValidLevelId(options.defaultLevelId)
        ? options.defaultLevelId
        : DEFAULT_LEVEL_ID;

    this._levelId = this.defaultLevelId;
    this._levelId = this.load();
  }

  get levelId(): number {
    return this._levelId;
  }

  get level(): LevelConfig {
    return getLevelConfig(this._levelId);
  }

  get allLevels(): ReadonlyArray<LevelConfig> {
    return LEVELS;
  }

  setLevelId(levelId: number) {
    const next = isValidLevelId(levelId) ? levelId : this.defaultLevelId;
    this._levelId = next;
    this.persist(next);
  }

  private load(): number {
    if (typeof window === 'undefined') return this.defaultLevelId;
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      const n = Number(raw);
      return isValidLevelId(n) ? n : this.defaultLevelId;
    } catch {
      return this.defaultLevelId;
    }
  }

  private persist(levelId: number) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(this.storageKey, String(levelId));
    } catch {
      // ignore
    }
  }
}

