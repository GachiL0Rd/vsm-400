import { describe, expect, it } from 'vitest';
import { PRESSURE_SENSOR_DEFINITION } from './content/objects';
import {
  createPressureInspection,
  createPressureSystemState,
  inspectPressureIndicator,
  quickInspectPressureSystem,
} from './systems';

describe('pressure system', () => {
  it('keeps quick and detailed inspection as runtime state', () => {
    const initial = createPressureSystemState();
    const quick = quickInspectPressureSystem(initial);
    const detailed = inspectPressureIndicator(quick.state);

    expect(quick.state.quickInspected).toBe(true);
    expect(detailed.state.indicatorChecked).toBe(true);
  });

  it('builds the inspection window from definition and state', () => {
    const state = inspectPressureIndicator(createPressureSystemState()).state;
    const view = createPressureInspection(PRESSURE_SENSOR_DEFINITION, state);

    expect(view.title).toBe(PRESSURE_SENSOR_DEFINITION.inspectionTitle);
    expect(view.properties[0]?.value).toContain('норме');
    expect(view.actions[0]?.enabled).toBe(false);
  });
});
