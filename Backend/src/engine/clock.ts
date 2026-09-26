import {
  DEFAULT_GAME_TIME_MIN,
  DEFAULT_NODE_STEP_MIN,
  PARAM_GAME_TIME_MIN,
  PARAM_NODE_STEP_MIN,
} from './params';
import type { EngineState } from './types';

export function formatClock(totalMinutes: number): string {
  const day = 24 * 60;
  const mod = ((Math.trunc(totalMinutes) % day) + day) % day;
  const hours = Math.floor(mod / 60);
  const minutes = mod % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/** Время узла растёт внутри сценария и не откатывается за предыдущий ход. */
export function nextGameTime(state: EngineState): string {
  const stepMin = state.params[PARAM_NODE_STEP_MIN] ?? DEFAULT_NODE_STEP_MIN;
  const fallback = DEFAULT_GAME_TIME_MIN + state.scenarioIndex * 20;
  const start = state.params[PARAM_GAME_TIME_MIN] ?? fallback;
  let indexInScenario = 0;
  for (const entry of state.journal) {
    if (entry.scenarioId === state.scenarioId) {
      indexInScenario += 1;
    }
  }
  let minute = start + indexInScenario * stepMin;
  const last = state.journal[state.journal.length - 1];
  if (last) {
    const prev = parseClock(last.gameTime);
    if (prev !== null && minute <= prev) {
      minute = prev + stepMin;
    }
  }
  return formatClock(minute);
}
