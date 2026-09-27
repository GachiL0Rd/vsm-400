import { describe, expect, it } from 'vitest';
import type { ScheduledEvent } from './event-queue';
import { millisecondsToSimTimeUs, secondsToSimTimeUs } from './sim-time';
import { SimulationScheduler } from './simulation-scheduler';

interface Applied {
  readonly at: number;
  readonly order: number;
  readonly payload: string;
}

function record(applied: Applied[]): (event: ScheduledEvent<string>) => void {
  return (event) => {
    applied.push({ at: event.at, order: event.order, payload: event.payload });
  };
}

describe('SimulationScheduler', () => {
  it('produces the same event sequence at 4 Hz and 16 Hz, including a subtick receipt', () => {
    const horizon = secondsToSimTimeUs(1);
    const fastPeriod = millisecondsToSimTimeUs(62.5);
    const slowPeriod = millisecondsToSimTimeUs(250);
    const receiptWall = 183_420;

    const run = (period: number): Applied[] => {
      const scheduler = new SimulationScheduler<string>({
        maxWallGapUs: secondsToSimTimeUs(2),
        maxSimHorizonUs: secondsToSimTimeUs(2),
      });
      scheduler.queue.schedule(100_000, 'early');
      scheduler.queue.schedule(300_000, 'middle');
      scheduler.queue.schedule(horizon, 'end');
      const applied: Applied[] = [];
      const walls = new Set<number>();
      for (let wall = 0; wall <= horizon; wall += period) walls.add(wall);
      walls.add(receiptWall);
      let stamped = -1;
      for (const wall of [...walls].sort((left, right) => left - right)) {
        if (wall === receiptWall) {
          stamped = scheduler.receiptTime(wall);
          scheduler.queue.schedule(stamped, 'input');
        }
        scheduler.service(
          wall,
          () => undefined,
          (event) => {
            applied.push({ at: event.at, order: event.order, payload: event.payload });
          },
        );
      }
      expect(stamped).toBe(receiptWall);
      expect(stamped % period).not.toBe(0);
      return applied;
    };

    const fast = run(fastPeriod);
    const slow = run(slowPeriod);
    expect(fast.map(({ at, payload }) => ({ at, payload }))).toEqual([
      { at: 100_000, payload: 'early' },
      { at: receiptWall, payload: 'input' },
      { at: 300_000, payload: 'middle' },
      { at: horizon, payload: 'end' },
    ]);
    expect(slow.map(({ at, payload }) => ({ at, payload }))).toEqual(
      fast.map(({ at, payload }) => ({ at, payload })),
    );
  });

  it('applies equal timestamps in schedule order', () => {
    const scheduler = new SimulationScheduler<string>({
      maxWallGapUs: 10_000,
      maxSimHorizonUs: 10_000,
    });
    scheduler.queue.schedule(5_000, 'first');
    scheduler.queue.schedule(5_000, 'second');
    const applied: Applied[] = [];
    scheduler.service(5_000, () => undefined, record(applied));

    expect(applied.map((event) => event.payload)).toEqual(['first', 'second']);
    expect(applied[0]?.order).toBeLessThan(applied[1]?.order ?? 0);
  });

  it('keeps scheduled simulation timestamps across a scale change', () => {
    const scheduler = new SimulationScheduler<string>({
      maxWallGapUs: secondsToSimTimeUs(5),
      maxSimHorizonUs: secondsToSimTimeUs(5),
    });
    scheduler.queue.schedule(1_500_000, 'due');
    scheduler.queue.schedule(3_000_000, 'later');
    const applied: Applied[] = [];
    const apply = record(applied);

    scheduler.service(secondsToSimTimeUs(1), () => undefined, apply);
    expect(applied).toEqual([]);
    scheduler.clock.setTimeScale(2, secondsToSimTimeUs(1));
    const acceleratedWall = secondsToSimTimeUs(1) + millisecondsToSimTimeUs(250);
    scheduler.service(acceleratedWall, () => undefined, apply);

    expect(applied).toEqual([{ at: 1_500_000, order: 0, payload: 'due' }]);
    expect(scheduler.queue.pendingCount).toBe(1);
    expect(scheduler.processedSimulationTime).toBe(1_500_000);
  });

  it('does not advance simulation time across pause and does not catch up on resume', () => {
    const scheduler = new SimulationScheduler<string>({
      maxWallGapUs: secondsToSimTimeUs(5),
      maxSimHorizonUs: secondsToSimTimeUs(5),
    });
    scheduler.queue.schedule(1_000_000, 'later');
    const applied: Applied[] = [];
    const apply = record(applied);

    scheduler.service(200_000, () => undefined, apply);
    scheduler.clock.pause(200_000);
    const paused = scheduler.service(secondsToSimTimeUs(2), () => undefined, apply);
    expect(paused.skippedLag).toBe(false);
    expect(applied).toEqual([]);
    expect(scheduler.processedSimulationTime).toBe(200_000);

    scheduler.clock.resume(secondsToSimTimeUs(2));
    scheduler.service(secondsToSimTimeUs(2) + 800_000, () => undefined, apply);
    expect(applied).toEqual([{ at: 1_000_000, order: 0, payload: 'later' }]);
    expect(scheduler.processedSimulationTime).toBe(1_000_000);
  });

  it('skips a wall gap above the lag budget without applying the queued backlog', () => {
    const scheduler = new SimulationScheduler<string>({
      maxWallGapUs: 500_000,
      maxSimHorizonUs: secondsToSimTimeUs(5),
    });
    scheduler.queue.schedule(100_000, 'soon');
    scheduler.queue.schedule(2_000_000, 'far');
    const trace: string[] = [];
    scheduler.service(
      0,
      () => undefined,
      () => undefined,
    );

    const skipped = scheduler.service(
      3_000_000,
      () => {
        trace.push('materialize');
      },
      () => {
        trace.push('apply');
      },
    );

    expect(skipped.skippedLag).toBe(true);
    expect(trace).toEqual([]);
    expect(scheduler.processedSimulationTime).toBe(0);
    expect(scheduler.queue.pendingCount).toBe(2);
    expect(scheduler.clock.mapWallTime(3_000_000)).toBe(0);
    expect(scheduler.clock.processedSimulationTime).toBe(0);

    scheduler.service(
      3_100_000,
      () => undefined,
      (event) => {
        trace.push(event.payload);
      },
    );
    expect(trace).toEqual(['soon']);
    expect(scheduler.processedSimulationTime).toBe(100_000);
    expect(scheduler.queue.pendingCount).toBe(1);
  });

  it('catches a bounded simulation horizon up over successive services', () => {
    const scheduler = new SimulationScheduler<string>({
      maxWallGapUs: 10_000_000,
      maxSimHorizonUs: 1_000,
    });
    scheduler.queue.schedule(1_000, 'edge');
    scheduler.queue.schedule(1_001, 'next');
    scheduler.queue.schedule(2_000, 'later');
    const applied: string[] = [];
    const apply = (event: ScheduledEvent<string>): void => {
      applied.push(event.payload);
    };

    scheduler.service(10_000, () => undefined, apply);
    expect(applied).toEqual(['edge']);
    expect(scheduler.processedSimulationTime).toBe(1_000);
    expect(scheduler.queue.pendingCount).toBe(2);

    scheduler.service(10_000, () => undefined, apply);
    expect(applied).toEqual(['edge', 'next', 'later']);
    expect(scheduler.processedSimulationTime).toBe(2_000);
    expect(scheduler.queue.pendingCount).toBe(0);
    expect(scheduler.clock.processedSimulationTime).toBe(2_000);
    expect(scheduler.clock.mapWallTime(10_000)).toBe(10_000);

    scheduler.service(10_000, () => undefined, apply);
    expect(applied).toEqual(['edge', 'next', 'later']);
    expect(scheduler.processedSimulationTime).toBe(3_000);
    expect(scheduler.clock.mapWallTime(10_000)).toBe(10_000);
  });
});
