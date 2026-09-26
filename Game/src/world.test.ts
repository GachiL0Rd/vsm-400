import { describe, expect, it } from 'vitest';
import {
  advanceWorld,
  createWorldState,
  SCHEDULED_CHANGE_AT_SECONDS,
  setWorldSpeed,
} from './world';

describe('world time', () => {
  it('does not complete the scheduled change before its threshold', () => {
    const world = advanceWorld(createWorldState(), SCHEDULED_CHANGE_AT_SECONDS - 0.1);

    expect(world.scheduledChange).toBe('pending');
  });

  it('completes the scheduled change when time crosses its threshold', () => {
    const beforeThreshold = advanceWorld(createWorldState(), SCHEDULED_CHANGE_AT_SECONDS - 0.1);
    const world = advanceWorld(beforeThreshold, 0.1);

    expect(world.scheduledChange).toBe('completed');
  });

  it('does not repeat a completed scheduled change', () => {
    const completed = advanceWorld(createWorldState(), SCHEDULED_CHANGE_AT_SECONDS);
    const world = advanceWorld(completed, SCHEDULED_CHANGE_AT_SECONDS);

    expect(world.scheduledChange).toBe('completed');
  });

  it('keeps time paused at zero speed and advances it faster at triple speed', () => {
    const paused = setWorldSpeed(createWorldState(), 0);
    const stillPaused = advanceWorld(paused, 5);
    const accelerated = advanceWorld(setWorldSpeed(stillPaused, 3), 5);

    expect(stillPaused.elapsedSeconds).toBe(0);
    expect(accelerated.elapsedSeconds).toBe(15);
  });
});
