import { EventQueue, type ScheduledEvent } from './event-queue';
import { assertSimTimeUs, type SimTimeUs } from './sim-time';
import { SimulationClock } from './simulation-clock';

export interface SimulationSchedulerOptions {
  readonly maxWallGapUs: number;
  readonly maxSimHorizonUs: number;
  readonly initialWallUs?: number;
  readonly initialSimUs?: number;
}

export interface ServiceResult {
  readonly skippedLag: boolean;
  readonly processedSimulationTime: SimTimeUs;
}

/**
 * Owns one clock and one event queue.
 * `service` catches up at most `maxSimHorizonUs` of simulation time.
 * A wall gap above `maxWallGapUs` is not caught up: the clock reanchors at
 * the queue's current time. Publication is outside this type and cannot
 * stall the clock.
 */
export class SimulationScheduler<T> {
  readonly clock: SimulationClock;
  readonly queue: EventQueue<T>;
  private readonly maxWallGapUs: number;
  private readonly maxSimHorizonUs: number;

  constructor(options: SimulationSchedulerOptions) {
    this.maxWallGapUs = assertPositiveUs(options.maxWallGapUs, 'Maximum wall gap');
    this.maxSimHorizonUs = assertPositiveUs(options.maxSimHorizonUs, 'Maximum simulation horizon');
    const initialWallUs = assertSimTimeUs(options.initialWallUs ?? 0);
    const initialSimUs = assertSimTimeUs(options.initialSimUs ?? 0);
    this.clock = new SimulationClock(initialWallUs, initialSimUs);
    this.queue = new EventQueue<T>();
    if (initialSimUs !== this.queue.currentTime) {
      this.queue.advanceTo(
        initialSimUs,
        () => undefined,
        () => undefined,
      );
    }
  }

  get processedSimulationTime(): SimTimeUs {
    return this.queue.currentTime;
  }

  /** Server receipt mapped through the clock. Not rounded to a scheduler tick. */
  receiptTime(wallUs: number): SimTimeUs {
    return this.clock.receiptTime(wallUs);
  }

  service(
    wallUs: number,
    materialize: (time: SimTimeUs) => void,
    apply: (event: ScheduledEvent<T>) => void,
  ): ServiceResult {
    const wall = assertSimTimeUs(wallUs);
    const gap = wall - this.clock.wallTime;
    if (!this.clock.paused && gap > this.maxWallGapUs) {
      this.clock.advanceProcessedTo(this.queue.currentTime);
      this.clock.reanchorToProcessed(wall);
      return { skippedLag: true, processedSimulationTime: this.queue.currentTime };
    }

    if (this.clock.paused) {
      this.clock.mapWallTime(wall);
      return { skippedLag: false, processedSimulationTime: this.queue.currentTime };
    }

    const mapped = this.clock.mapWallTime(wall);
    const target = boundedTarget(this.queue.currentTime, mapped, this.maxSimHorizonUs);
    try {
      this.queue.advanceTo(target, materialize, apply);
    } finally {
      this.clock.advanceProcessedTo(this.queue.currentTime);
    }
    return { skippedLag: false, processedSimulationTime: this.queue.currentTime };
  }
}

function assertPositiveUs(value: number, label: string): number {
  const safe = assertSimTimeUs(value);
  if (safe === 0) throw new RangeError(`${label} must be a positive safe integer`);
  return safe;
}

function boundedTarget(
  processed: SimTimeUs,
  mapped: SimTimeUs,
  maxSimHorizonUs: number,
): SimTimeUs {
  if (mapped <= processed) return processed;
  const sum = processed + maxSimHorizonUs;
  const capped = Number.isSafeInteger(sum) ? sum : Number.MAX_SAFE_INTEGER;
  return mapped < capped ? mapped : capped;
}
