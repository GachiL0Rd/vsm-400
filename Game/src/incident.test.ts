import { describe, expect, it } from 'vitest';
import { createEquipmentState, prepareFireExtinguisher, takeFireExtinguisher } from './equipment';
import {
  advanceFireIncident,
  attemptToExtinguishFire,
  createFireIncidentState,
  FIRE_BECOMES_SEVERE_AT_SECONDS,
  FIRE_STARTS_AT_SECONDS,
} from './incident';

describe('fire incident', () => {
  it('starts and worsens without player input', () => {
    const active = advanceFireIncident(createFireIncidentState(), FIRE_STARTS_AT_SECONDS);
    const severe = advanceFireIncident(active, FIRE_BECOMES_SEVERE_AT_SECONDS);

    expect(active.status).toBe('active');
    expect(severe.status).toBe('severe');
    expect(severe.responseQuality).toBe('missed');
  });

  it('rejects an unprepared extinguisher and records the failed attempt', () => {
    const fire = advanceFireIncident(createFireIncidentState(), FIRE_STARTS_AT_SECONDS);
    const held = takeFireExtinguisher(createEquipmentState()).state;
    const result = attemptToExtinguishFire(fire, held);

    expect(result.accepted).toBe(false);
    expect(result.state.status).toBe('active');
    expect(result.state.failedAttempts).toBe(1);
    expect(result.state.responseQuality).toBe('incorrect');
  });

  it('resolves an active fire with a prepared extinguisher', () => {
    const fire = advanceFireIncident(createFireIncidentState(), FIRE_STARTS_AT_SECONDS);
    const held = takeFireExtinguisher(createEquipmentState()).state;
    const prepared = prepareFireExtinguisher(held).state;
    const result = attemptToExtinguishFire(fire, prepared);

    expect(result.accepted).toBe(true);
    expect(result.state.status).toBe('resolved');
    expect(result.state.responseQuality).toBe('correct');
  });

  it('keeps potential assessment late even when the factual outcome is eventually resolved', () => {
    const severe = advanceFireIncident(createFireIncidentState(), FIRE_BECOMES_SEVERE_AT_SECONDS);
    const held = takeFireExtinguisher(createEquipmentState()).state;
    const prepared = prepareFireExtinguisher(held).state;
    const result = attemptToExtinguishFire(severe, prepared);

    expect(result.state.status).toBe('resolved');
    expect(result.state.everSevere).toBe(true);
    expect(result.state.responseQuality).toBe('late');
  });
});
