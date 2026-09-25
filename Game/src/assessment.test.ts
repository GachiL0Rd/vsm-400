import { describe, expect, it } from 'vitest';
import { createDebrief } from './assessment';
import { createEquipmentState, prepareFireExtinguisher, takeFireExtinguisher } from './equipment';
import {
  advanceFireIncident,
  attemptToExtinguishFire,
  createFireIncidentState,
  FIRE_BECOMES_SEVERE_AT_SECONDS,
} from './incident';
import { DEMO_PASSENGER } from './content/passengers';
import { createPassengerState, decideDocuments } from './passenger';

describe('debrief', () => {
  it('separates player quality from the factual result', () => {
    const passenger = decideDocuments(DEMO_PASSENGER, createPassengerState(DEMO_PASSENGER), 'admit').state;
    const severe = advanceFireIncident(createFireIncidentState(), FIRE_BECOMES_SEVERE_AT_SECONDS);
    const held = takeFireExtinguisher(createEquipmentState()).state;
    const prepared = prepareFireExtinguisher(held).state;
    const resolvedLate = attemptToExtinguishFire(severe, prepared).state;

    const debrief = createDebrief(passenger, resolvedLate);

    expect(debrief.potentialAssessment.join(' ')).toContain('поздно');
    expect(debrief.factualOutcome.join(' ')).toContain('ликвидирован');
  });
});
