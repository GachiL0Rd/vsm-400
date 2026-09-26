export type WorldSpeed = 0 | 1 | 3;
export type ScheduledChange = 'pending' | 'completed';

export interface WorldState {
  readonly elapsedSeconds: number;
  readonly scheduledChange: ScheduledChange;
  readonly speed: WorldSpeed;
}

export const SCHEDULED_CHANGE_AT_SECONDS = 20;

export function createWorldState(): WorldState {
  return {
    elapsedSeconds: 0,
    scheduledChange: 'pending',
    speed: 1,
  };
}

export function setWorldSpeed(state: WorldState, speed: WorldSpeed): WorldState {
  return { ...state, speed };
}

export function advanceWorld(state: WorldState, realElapsedSeconds: number): WorldState {
  if (realElapsedSeconds < 0) {
    throw new Error('realElapsedSeconds cannot be negative.');
  }

  const elapsedSeconds = state.elapsedSeconds + realElapsedSeconds * state.speed;
  const scheduledChange =
    state.scheduledChange === 'pending' && elapsedSeconds >= SCHEDULED_CHANGE_AT_SECONDS
      ? 'completed'
      : state.scheduledChange;

  return { ...state, elapsedSeconds, scheduledChange };
}
