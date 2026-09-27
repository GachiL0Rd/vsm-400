import { assertSimTimeUs, type SimTimeUs } from './sim-time';

/**
 * Maps injected server wall time onto a simulation horizon.
 * `mapped = anchorSim + round(wallDelta × timeScale)`.
 * That horizon is not processed simulation time: the processed cursor moves
 * only through `advanceProcessedTo`. Pause freezes the mapping; resume and
 * `reanchorToProcessed` start a new anchor without converting the skipped
 * wall gap into simulation time.
 */
export class SimulationClock {
  private anchorWallUs: number;
  private anchorSimUs: SimTimeUs;
  private scale = 1;
  private holding = false;
  private lastWallUs: number;
  /** Simulation time already applied. Not the mapped wall horizon. */
  private processedSimUs: SimTimeUs;

  constructor(initialWallUs: number, initialSimUs: number) {
    this.anchorWallUs = assertSimTimeUs(initialWallUs);
    this.anchorSimUs = assertSimTimeUs(initialSimUs);
    this.lastWallUs = this.anchorWallUs;
    this.processedSimUs = this.anchorSimUs;
  }

  get timeScale(): number {
    return this.scale;
  }

  get paused(): boolean {
    return this.holding;
  }

  get wallTime(): number {
    return this.lastWallUs;
  }

  /** Simulation time already applied. Mapping or stamping wall time does not change it. */
  get processedSimulationTime(): SimTimeUs {
    return this.processedSimUs;
  }

  /** Anchored simulation horizon at `wallUs`. Scheduler period is not an input. */
  mapWallTime(wallUs: number): SimTimeUs {
    const wall = this.acceptWall(wallUs);
    return this.project(wall);
  }

  /**
   * Authoritative simulation timestamp for input received at server `wallUs`.
   * There is no client timestamp. The stamp may lie ahead of processed time,
   * but it is never earlier than simulation time already applied.
   */
  receiptTime(wallUs: number): SimTimeUs {
    const mapped = this.mapWallTime(wallUs);
    if (mapped < this.processedSimUs) return this.processedSimUs;
    return mapped;
  }

  /** Keeps the mapped horizon continuous at `wallUs`, then applies `scale`. */
  setTimeScale(scale: number, wallUs: number): void {
    const nextScale = assertTimeScale(scale);
    const wall = this.acceptWall(wallUs);
    const sim = this.project(wall);
    this.anchorWallUs = wall;
    this.anchorSimUs = sim;
    this.scale = nextScale;
  }

  /** Freezes the mapping at the projection of `wallUs`. Processed time stays put. */
  pause(wallUs: number): void {
    if (this.holding) throw new RangeError('Simulation clock is already paused');
    const wall = this.acceptWall(wallUs);
    const sim = this.project(wall);
    this.anchorWallUs = wall;
    this.anchorSimUs = sim;
    this.holding = true;
  }

  /** New wall anchor at the frozen mapping. Elapsed pause is not applied. */
  resume(wallUs: number): void {
    if (!this.holding) throw new RangeError('Simulation clock is not paused');
    const wall = this.acceptWall(wallUs);
    this.anchorWallUs = wall;
    this.holding = false;
  }

  /** Moves processed simulation time forward. Mapping a later wall does not do this. */
  advanceProcessedTo(simUs: number): void {
    const sim = assertSimTimeUs(simUs);
    if (sim < this.processedSimUs) {
      throw new RangeError('Processed simulation time must not move backwards');
    }
    this.processedSimUs = sim;
  }

  /**
   * Drops the open wall gap and continues from simulation time already applied.
   * Used when scheduler lag is treated as a pause rather than catch-up.
   */
  reanchorToProcessed(wallUs: number): void {
    const wall = this.acceptWall(wallUs);
    this.anchorWallUs = wall;
    this.anchorSimUs = this.processedSimUs;
  }

  private acceptWall(wallUs: number): number {
    const wall = assertSimTimeUs(wallUs);
    if (wall < this.lastWallUs) throw new RangeError('Wall time must not move backwards');
    this.lastWallUs = wall;
    return wall;
  }

  private project(wallUs: number): SimTimeUs {
    if (this.holding) return this.anchorSimUs;
    const scaled = scaleWallDelta(wallUs - this.anchorWallUs, this.scale);
    return assertSimTimeUs(this.anchorSimUs + scaled);
  }
}

function assertTimeScale(scale: number): number {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || !(scale > 0)) {
    throw new RangeError('Time scale must be a positive finite number');
  }
  return scale;
}

/** Nearest microsecond. Positive half-integers round away from zero. */
function scaleWallDelta(wallDeltaUs: number, timeScale: number): number {
  const rounded = Math.round(wallDeltaUs * timeScale);
  return assertSimTimeUs(rounded);
}
