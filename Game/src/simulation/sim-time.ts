/** Canonical simulation time: integer microseconds since the attempt started. */
export type SimTimeUs = number;

const MICROSECONDS_PER_SECOND = 1_000_000;
const MICROSECONDS_PER_MILLISECOND = 1_000;
// Allows binary floating-point noise, while rejecting a fractional microsecond.
const MICROSECOND_ROUNDING_TOLERANCE = 0.000001;

export function assertSimTimeUs(value: number): SimTimeUs {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Simulation time must be a nonnegative safe integer in microseconds');
  }
  return value;
}

function convertToMicroseconds(value: number, multiplier: number): SimTimeUs {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Simulation time input must be finite and nonnegative');
  }

  const microseconds = value * multiplier;
  const rounded = Math.round(microseconds);
  if (
    !Number.isSafeInteger(rounded) ||
    Math.abs(microseconds - rounded) > MICROSECOND_ROUNDING_TOLERANCE
  ) {
    throw new RangeError('Simulation time must resolve to a safe whole microsecond');
  }
  return rounded;
}

export function secondsToSimTimeUs(seconds: number): SimTimeUs {
  return convertToMicroseconds(seconds, MICROSECONDS_PER_SECOND);
}

export function millisecondsToSimTimeUs(milliseconds: number): SimTimeUs {
  return convertToMicroseconds(milliseconds, MICROSECONDS_PER_MILLISECOND);
}

export function simTimeUsToSeconds(time: SimTimeUs): number {
  return assertSimTimeUs(time) / MICROSECONDS_PER_SECOND;
}
