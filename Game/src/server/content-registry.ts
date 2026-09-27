import { GameAttempt } from '../simulation/game-attempt.ts';
import type { SessionMode } from './types.ts';

export interface ResolvedGameContent {
  readonly gameLevelId: string;
  readonly gameLevelVersion: string;
  readonly simulationCompatibilityVersion: string;
  createAttempt(rootSeed: number, mode: SessionMode): GameAttempt;
}

export interface GameContentRegistry {
  resolve(gameLevelId: string): ResolvedGameContent;
}

export class BaselineContentRegistry implements GameContentRegistry {
  resolve(gameLevelId: string): ResolvedGameContent {
    if (gameLevelId !== 'vsm-baseline-01')
      throw new RangeError(`Unknown game level ${gameLevelId}`);
    return {
      gameLevelId,
      gameLevelVersion: 'vsm-baseline-01',
      simulationCompatibilityVersion: '0.1.0',
      createAttempt: (rootSeed) => new GameAttempt({ rootSeed }),
    };
  }
}
