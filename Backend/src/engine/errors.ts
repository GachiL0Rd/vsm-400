export type EngineErrorCode =
  | 'CHOICE_NOT_AVAILABLE'
  | 'UNKNOWN_CHOICE'
  | 'SESSION_FINISHED'
  | 'EMPTY_PLAN'
  | 'SCENARIO_MISSING'
  | 'NODE_MISSING'
  | 'TIMEOUT_UNHANDLED'
  | 'CAR_CLASS_EMPTY'
  | 'RNG_SEED'
  | 'RNG_RANGE'
  | 'RNG_EMPTY';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode) {
    super(code);
    this.name = 'EngineError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
