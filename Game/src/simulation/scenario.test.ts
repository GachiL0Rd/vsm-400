import { describe, expect, it } from 'vitest';
import { BASELINE_LEVEL, loadLevelDefinition } from './level';
import {
  BASELINE_SCENARIO,
  BASELINE_SCENARIO_DEFINITION,
  loadScenarioDefinition,
} from './scenario';
import { secondsToSimTimeUs } from './sim-time';

describe('scenario definition', () => {
  it('loads the baseline pre-departure, boarding, route and terminal rules', () => {
    expect(BASELINE_SCENARIO.passengerIds).toEqual(['passenger-1', 'passenger-2', 'passenger-3']);
    expect(BASELINE_SCENARIO.passenger('passenger-3')).toMatchObject({
      serviceClass: 'business',
      traits: ['awake', 'thirsty', 'impatient'],
      seatCellId: 'carriage.seat-3',
    });
    expect(BASELINE_SCENARIO.terminalRuleForSignal('emergency-brake-used')).toMatchObject({
      outcomeId: 'route-safely-interrupted',
    });
    expect(BASELINE_SCENARIO.terminalRuleForSignal('missing')).toBeNull();

    const expected =
      secondsToSimTimeUs(5 * 60) +
      secondsToSimTimeUs(30 * 60) +
      secondsToSimTimeUs(60 * 60) +
      secondsToSimTimeUs(2 * 60) +
      secondsToSimTimeUs(18 * 60);
    expect(BASELINE_SCENARIO.normalEndTimeUs).toBe(expected);
  });

  it('rejects scenarios that target another level or reference impossible passengers', () => {
    expect(() =>
      loadScenarioDefinition(
        { ...BASELINE_SCENARIO_DEFINITION, levelVersion: '2.0.0' },
        BASELINE_LEVEL,
      ),
    ).toThrow(RangeError);

    expect(() =>
      loadScenarioDefinition(
        {
          ...BASELINE_SCENARIO_DEFINITION,
          originStop: {
            ...BASELINE_SCENARIO_DEFINITION.originStop,
            passengerFlow: {
              boardPassengerIds: ['missing-passenger'],
              leavePassengerIds: [],
            },
          },
        },
        BASELINE_LEVEL,
      ),
    ).toThrow(RangeError);
  });

  it('validates level/scenario compatibility independently of object identity', () => {
    const reloadedLevel = loadLevelDefinition(structuredClone(BASELINE_LEVEL.definition));
    const loaded = loadScenarioDefinition(
      structuredClone(BASELINE_SCENARIO_DEFINITION),
      reloadedLevel,
    );
    expect(loaded.definition.levelId).toBe(reloadedLevel.definition.id);
    expect(loaded.definition).not.toBe(BASELINE_SCENARIO_DEFINITION);
  });
});
