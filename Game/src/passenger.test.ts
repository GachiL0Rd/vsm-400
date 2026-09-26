import { describe, expect, it } from 'vitest';
import { DEMO_PASSENGER } from './content/passengers';
import {
  advancePassenger,
  createPassengerState,
  decideDocuments,
  type PassengerDefinition,
} from './passenger';

describe('passenger autonomous behaviour', () => {
  it('changes activity without a player command as world time advances', () => {
    const initial = createPassengerState(DEMO_PASSENGER);
    const boarding = advancePassenger(
      DEMO_PASSENGER,
      initial,
      DEMO_PASSENGER.behaviour.timeline[0]!.atSeconds,
    );
    const seated = advancePassenger(
      DEMO_PASSENGER,
      boarding,
      DEMO_PASSENGER.behaviour.timeline[1]!.atSeconds,
    );

    expect(initial.activity).toBe('waiting-on-platform');
    expect(boarding.activity).toBe('boarding');
    expect(seated.activity).toBe('seated');
  });

  it('keeps behaviour timings editable per passenger definition', () => {
    const slowPassenger: PassengerDefinition = {
      ...DEMO_PASSENGER,
      id: 'slow-passenger',
      behaviour: {
        timeline: [
          { atSeconds: 30, activity: 'boarding' },
          { atSeconds: 60, activity: 'seated' },
        ],
      },
    };
    const initial = createPassengerState(slowPassenger);

    expect(advancePassenger(slowPassenger, initial, 15).activity).toBe('waiting-on-platform');
    expect(advancePassenger(slowPassenger, initial, 30).activity).toBe('boarding');
  });

  it('records document quality separately and does not block the passenger state machine', () => {
    const rejected = decideDocuments(
      DEMO_PASSENGER,
      createPassengerState(DEMO_PASSENGER),
      'reject',
    );
    const later = advancePassenger(
      DEMO_PASSENGER,
      rejected.state,
      DEMO_PASSENGER.behaviour.timeline[1]!.atSeconds,
    );

    expect(rejected.state.decisionQuality).toBe('incorrect');
    expect(rejected.state.mood).toBe('annoyed');
    expect(later.activity).toBe('seated');
  });
});
