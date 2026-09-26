/** В EngineState и ShiftPlan нет часов рейса — они едут числом в params. */
export const PARAM_GAME_TIME_MIN = 'gameTimeMin';
export const PARAM_NODE_STEP_MIN = 'nodeStepMin';
export const PARAM_SCENARIO_TOTAL = 'scenarioTotal';

export const DEFAULT_NODE_STEP_MIN = 3;
export const DEFAULT_GAME_TIME_MIN = 6 * 60;

export function copyNumbers(
  source: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const copy: Record<string, number> = {};
  if (!source) {
    return copy;
  }
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value === 'number') {
      copy[key] = value;
    }
  }
  return copy;
}

export function takeParams(
  source: Readonly<Record<string, number>> | undefined,
  total: number,
  inheritedStep: number | undefined,
): Record<string, number> {
  const params = copyNumbers(source);
  params[PARAM_SCENARIO_TOTAL] = total;
  if (params[PARAM_NODE_STEP_MIN] === undefined && inheritedStep !== undefined) {
    params[PARAM_NODE_STEP_MIN] = inheritedStep;
  }
  return params;
}
