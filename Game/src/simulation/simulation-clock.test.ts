import { describe, expect, it } from 'vitest';
import { millisecondsToSimTimeUs, secondsToSimTimeUs } from './sim-time';
import { SimulationClock } from './simulation-clock';

describe('SimulationClock', () => {
  it('maps the same wall instants to the same simulation time at 4 Hz and 16 Hz', () => {
    const fastPeriod = millisecondsToSimTimeUs(62.5);
    const horizon = secondsToSimTimeUs(1);
    const steps = horizon / fastPeriod;
    const fastClock = new SimulationClock(0, 0);
    const slowClock = new SimulationClock(0, 0);
    const fast: number[] = [];
    const slow: number[] = [];

    for (let step = 0; step <= steps; step += 1) {
      const wall = step * fastPeriod;
      fast.push(fastClock.mapWallTime(wall));
      if (step % 4 === 0) slow.push(slowClock.mapWallTime(wall));
    }

    expect(fast.filter((_, index) => index % 4 === 0)).toEqual(slow);
    expect(slow).toEqual([
      0,
      millisecondsToSimTimeUs(250),
      millisecondsToSimTimeUs(500),
      millisecondsToSimTimeUs(750),
      secondsToSimTimeUs(1),
    ]);

    const betweenTicks = new SimulationClock(0, secondsToSimTimeUs(12));
    const tick = millisecondsToSimTimeUs(250);
    const stamped = betweenTicks.receiptTime(183_420);
    expect(stamped).toBe(secondsToSimTimeUs(12) + 183_420);
    expect(stamped % tick).not.toBe(0);
    expect(betweenTicks.processedSimulationTime).toBe(secondsToSimTimeUs(12));
  });

  it('keeps simulation time continuous when the scale changes and applies the new scale after', () => {
    const clock = new SimulationClock(0, 0);
    const firstSecond = secondsToSimTimeUs(1);
    expect(clock.mapWallTime(firstSecond)).toBe(firstSecond);

    clock.setTimeScale(3, firstSecond + millisecondsToSimTimeUs(500));
    expect(clock.mapWallTime(firstSecond + millisecondsToSimTimeUs(500))).toBe(
      firstSecond + millisecondsToSimTimeUs(500),
    );
    expect(clock.mapWallTime(firstSecond + secondsToSimTimeUs(1))).toBe(
      firstSecond + millisecondsToSimTimeUs(500) + secondsToSimTimeUs(1.5),
    );

    const paused = new SimulationClock(0, 0);
    paused.pause(1_000);
    paused.setTimeScale(4, 2_000);
    paused.resume(3_000);
    expect(paused.mapWallTime(3_000)).toBe(1_000);
    expect(paused.mapWallTime(4_000)).toBe(5_000);
    expect(paused.timeScale).toBe(4);
  });

  it('freezes at the mapped time and resumes from a new anchor without catch-up', () => {
    const clock = new SimulationClock(0, 0);
    const frozen = millisecondsToSimTimeUs(800);
    clock.pause(frozen);
    expect(clock.paused).toBe(true);
    expect(clock.mapWallTime(secondsToSimTimeUs(2))).toBe(frozen);
    expect(clock.receiptTime(secondsToSimTimeUs(3))).toBe(frozen);
    expect(clock.processedSimulationTime).toBe(0);

    const resumeAt = secondsToSimTimeUs(4);
    clock.resume(resumeAt);
    expect(clock.paused).toBe(false);
    expect(clock.mapWallTime(resumeAt)).toBe(frozen);
    expect(clock.mapWallTime(resumeAt + millisecondsToSimTimeUs(500))).toBe(
      millisecondsToSimTimeUs(1_300),
    );
    expect(clock.processedSimulationTime).toBe(0);
  });

  it('stamps receipt from server wall time without treating the horizon as processed', () => {
    const clock = new SimulationClock(0, 5_000);
    expect(clock.receiptTime(0)).toBe(5_000);
    expect(clock.mapWallTime(1_000)).toBe(6_000);
    expect(clock.processedSimulationTime).toBe(5_000);
    expect(clock.receiptTime(1_000)).toBe(6_000);
    expect(clock.receiptTime(1_250)).toBe(6_250);
    expect(clock.processedSimulationTime).toBe(5_000);

    const caughtUp = new SimulationClock(0, 0);
    caughtUp.advanceProcessedTo(5_000);
    expect(caughtUp.receiptTime(1_000)).toBe(5_000);
    expect(caughtUp.processedSimulationTime).toBe(5_000);

    const rounding = new SimulationClock(0, 0);
    rounding.setTimeScale(0.5, 0);
    expect(rounding.mapWallTime(1)).toBe(1);
    expect(rounding.mapWallTime(2)).toBe(1);
    expect(rounding.mapWallTime(3)).toBe(2);
    expect(rounding.receiptTime(3)).toBe(2);
  });

  it('rejects unsafe values, non-positive scales, and backward wall time', () => {
    expect(() => new SimulationClock(-1, 0)).toThrow(RangeError);
    expect(() => new SimulationClock(0, -1)).toThrow(RangeError);
    expect(() => new SimulationClock(Number.NaN, 0)).toThrow(RangeError);
    expect(() => new SimulationClock(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => new SimulationClock(1.5, 0)).toThrow(RangeError);
    expect(() => new SimulationClock(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow(RangeError);

    const clock = new SimulationClock(10, 0);
    expect(() => clock.setTimeScale(0, 10)).toThrow(RangeError);
    expect(() => clock.setTimeScale(-2, 10)).toThrow(RangeError);
    expect(() => clock.setTimeScale(Number.NaN, 10)).toThrow(RangeError);
    expect(() => clock.setTimeScale(Number.POSITIVE_INFINITY, 10)).toThrow(RangeError);
    expect(() => clock.mapWallTime(1.2)).toThrow(RangeError);
    expect(() => clock.receiptTime(Number.NaN)).toThrow(RangeError);

    clock.mapWallTime(30);
    expect(() => clock.mapWallTime(29)).toThrow(RangeError);
    expect(() => clock.receiptTime(20)).toThrow(RangeError);
    expect(() => clock.pause(25)).toThrow(RangeError);
    expect(() => clock.resume(30)).toThrow(RangeError);

    clock.pause(40);
    expect(() => clock.pause(40)).toThrow(RangeError);
    expect(() => clock.resume(39)).toThrow(RangeError);
    expect(clock.mapWallTime(40)).toBe(30);
    expect(clock.processedSimulationTime).toBe(0);
    expect(clock.paused).toBe(true);
    expect(() => clock.advanceProcessedTo(-1)).toThrow(RangeError);
    expect(() => clock.advanceProcessedTo(1.5)).toThrow(RangeError);
  });

  it('reanchors at processed simulation time and leaves the mapped horizon behind', () => {
    const clock = new SimulationClock(0, 0);
    clock.advanceProcessedTo(2_000);
    expect(clock.mapWallTime(10_000)).toBe(10_000);
    expect(clock.processedSimulationTime).toBe(2_000);

    clock.reanchorToProcessed(50_000);
    expect(clock.mapWallTime(50_000)).toBe(2_000);
    expect(clock.mapWallTime(51_000)).toBe(3_000);
    expect(clock.processedSimulationTime).toBe(2_000);
    expect(() => clock.advanceProcessedTo(1_999)).toThrow(RangeError);
    expect(() => clock.reanchorToProcessed(50_999)).toThrow(RangeError);
  });
});
