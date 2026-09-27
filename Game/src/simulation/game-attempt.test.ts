import { describe, expect, it } from 'vitest';
import { GameAttempt } from './game-attempt';
import { secondsToSimTimeUs } from './sim-time';

function follow(attempt: GameAttempt, edgeIds: readonly string[]): void {
  for (const edgeId of edgeIds) {
    const movement = attempt.movePlayer(edgeId);
    attempt.advanceTo(movement.arrivesAt);
  }
}

describe('GameAttempt', () => {
  it('runs the baseline scenario from pre-departure through the normal route end', () => {
    const attempt = new GameAttempt({ rootSeed: 17 });

    expect(attempt.phase).toEqual({ kind: 'pre-departure' });
    expect(attempt.snapshot().entities.map((entity) => entity.id)).toEqual(['player']);
    expect(attempt.snapshot().activeRegionIds).toEqual(['carriage-main', 'platform-origin']);

    attempt.advanceTo(secondsToSimTimeUs(5 * 60));
    expect(attempt.phase).toEqual({ kind: 'origin-stop' });
    expect(attempt.snapshot().entities.map((entity) => entity.id)).toEqual([
      'passenger-1',
      'passenger-2',
      'passenger-3',
      'player',
    ]);
    for (const passengerId of ['passenger-1', 'passenger-2', 'passenger-3']) {
      expect(attempt.entities.get(passengerId).currentAction).toBeDefined();
    }

    attempt.advanceTo(attempt.scenario.normalEndTimeUs);
    expect(attempt.phase).toEqual({ kind: 'finished' });
    expect(attempt.termination).toEqual({
      kind: 'route-completed',
      at: attempt.scenario.normalEndTimeUs,
    });
    expect(attempt.snapshot().entities.map((entity) => entity.id)).toEqual(['player']);
  });

  it('keeps inactive platform edges authoritative and synchronizes player movement', () => {
    const attempt = new GameAttempt({ rootSeed: 1 });

    expect(() => attempt.movePlayer('platform-door-entry:backward')).toThrow(/inactive region/);

    follow(attempt, [
      'origin-desk-door:forward',
      'origin-door-entry:forward',
      'entry-cabin:forward',
      'cabin-service:forward',
    ]);

    expect(attempt.entities.get('player').position).toEqual({
      kind: 'cell',
      cellId: 'carriage.service',
    });
    expect(attempt.playerPosition()).toEqual({ kind: 'cell', cellId: 'carriage.service' });
    attempt.takeDrink();
    expect(attempt.entities.get('player').heldItemId).toBe('drink-1');
  });

  it('resolves a waiting passenger action through the authoritative item event', () => {
    const attempt = new GameAttempt({ rootSeed: 4 });
    attempt.advanceTo(secondsToSimTimeUs(5 * 60));

    const passenger = attempt.entities.get('passenger-3');
    expect(passenger.traits).toContain('thirsty');
    expect(passenger.currentAction).toBeDefined();

    // Move to the service point. The seat is an adjacent capacity-1 cell,
    // so interaction range must not require occupying the passenger's cell.
    follow(attempt, [
      'origin-desk-door:forward',
      'origin-door-entry:forward',
      'entry-cabin:forward',
      'cabin-service:forward',
    ]);
    attempt.takeDrink();

    // The deterministic seed selects request-drink for passenger-3 in this baseline.
    expect(attempt.entities.get('passenger-3').currentAction?.actionId).toBe('request-drink');
    attempt.giveHeldItem('passenger-3');

    const afterDelivery = attempt.entities.get('passenger-3');
    expect(afterDelivery.traits).not.toContain('waiting-drink');
    expect(afterDelivery.traits).toContain('has-drink');
    expect(afterDelivery.currentAction?.actionId).toBe('drink');

    const completesAt =
      afterDelivery.currentAction?.phase.kind === 'running'
        ? afterDelivery.currentAction.phase.completesAt
        : null;
    expect(completesAt).not.toBeNull();
    attempt.advanceTo(completesAt ?? attempt.time);
    expect(attempt.entities.get('passenger-3').traits).not.toContain('thirsty');
  });

  it('keeps terminal-rule outcome separate from route completion', () => {
    const attempt = new GameAttempt({ rootSeed: 8 });
    const result = attempt.signal('critical-predeparture-fault');

    expect(result).toEqual({
      kind: 'terminal-rule',
      at: 0,
      ruleId: 'predeparture-critical',
      outcomeId: 'wagon-unserviceable',
    });
    expect(attempt.phase).toEqual({ kind: 'finished' });
    expect(() => attempt.advanceTo(1)).toThrow(/Finished attempt/);
  });
});
