import { describe, expect, it } from 'vitest';
import { GameAttempt } from './game-attempt';
import { BASELINE_LEVEL } from './level';
import { BASELINE_SCENARIO_DEFINITION, loadScenarioDefinition } from './scenario';
import { secondsToSimTimeUs } from './sim-time';

function follow(attempt: GameAttempt, edgeIds: readonly string[]): void {
  for (const edgeId of edgeIds) {
    const movement = attempt.movePlayer(edgeId);
    attempt.advanceTo(movement.arrivesAt);
  }
}

function completeJournal(
  attempt: GameAttempt,
  overrides: Partial<Parameters<GameAttempt['editJournal']>[0]> = {},
): void {
  attempt.takeJournal();
  attempt.editJournal({
    communication: 'ok',
    extinguisher: 'ok',
    climate: 'ok',
    emergencyBrake: 'ok',
    sanitation: 'clean',
    note: '',
    accepted: true,
    ...overrides,
  });
  attempt.returnJournal();
}

function scenarioWithoutIncidents() {
  return loadScenarioDefinition({ ...BASELINE_SCENARIO_DEFINITION, incidents: [] }, BASELINE_LEVEL);
}

function prepareForBaselineFire(attempt: GameAttempt): void {
  completeJournal(attempt);
  attempt.advanceTo(secondsToSimTimeUs(5 * 60));
  follow(attempt, ['origin-desk-door:forward', 'origin-door-entry:forward', 'entry-cabin:forward']);
  attempt.takeExtinguisher();
  attempt.prepareExtinguisher();
}

describe('GameAttempt', () => {
  it('runs the baseline scenario from pre-departure through the normal route end', () => {
    const attempt = new GameAttempt({ rootSeed: 17 });

    expect(attempt.phase).toEqual({ kind: 'pre-departure' });
    expect(attempt.snapshot().entities.map((entity) => entity.id)).toEqual(['player']);
    expect(attempt.snapshot().activeRegionIds).toEqual(['carriage-main', 'platform-origin']);

    prepareForBaselineFire(attempt);
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

    const fireAt = secondsToSimTimeUs(45 * 60);
    attempt.advanceTo(fireAt);
    expect(
      attempt.snapshot().fields.find((field) => field.cellId === 'carriage.cabin')?.fire,
    ).toBeGreaterThan(0);
    attempt.useExtinguisher('fire:carriage.cabin');
    expect(attempt.snapshot().fields.find((field) => field.cellId === 'carriage.cabin')?.fire).toBe(
      0,
    );

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
    completeJournal(attempt);
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

  it('gates departure on a completed and returned acceptance journal', () => {
    const attempt = new GameAttempt({ rootSeed: 2 });

    attempt.advanceTo(secondsToSimTimeUs(5 * 60));
    expect(attempt.phase).toEqual({ kind: 'pre-departure' });
    expect(attempt.snapshot().entities.map((entity) => entity.id)).toEqual(['player']);

    attempt.takeJournal();
    attempt.editJournal({
      communication: 'ok',
      extinguisher: 'ok',
      climate: 'ok',
      emergencyBrake: 'ok',
      sanitation: 'issue',
      note: 'minor cleaning issue',
      accepted: true,
    });
    attempt.returnJournal();

    expect(attempt.phase).toEqual({ kind: 'origin-stop' });
    expect(attempt.snapshot().items.journal).toMatchObject({
      location: 'anchor',
      submitted: true,
      sanitation: 'issue',
    });
    expect(attempt.snapshot().entities.map((entity) => entity.id)).toEqual([
      'passenger-1',
      'passenger-2',
      'passenger-3',
      'player',
    ]);
  });

  it('can complete a delayed acceptance and shifts the remaining route from the actual handover time', () => {
    const attempt = new GameAttempt({ rootSeed: 9, scenario: scenarioWithoutIncidents() });
    const delayedAt = secondsToSimTimeUs(6 * 60);
    attempt.advanceTo(delayedAt);
    expect(attempt.phase).toEqual({ kind: 'pre-departure' });

    completeJournal(attempt);
    expect(attempt.phase).toEqual({ kind: 'origin-stop' });

    const shiftedEnd =
      attempt.scenario.normalEndTimeUs +
      (delayedAt - attempt.scenario.definition.preDeparture.durationUs);
    attempt.advanceTo(shiftedEnd);
    expect(attempt.termination).toEqual({ kind: 'route-completed', at: shiftedEnd });
  });

  it('rejects an incomplete journal and terminates on a declared critical pre-departure fault', () => {
    const attempt = new GameAttempt({ rootSeed: 3 });
    attempt.takeJournal();
    expect(() => attempt.returnJournal()).toThrow(/checklist is incomplete/);
    expect(attempt.snapshot().items.journal.location).toBe('held');

    attempt.editJournal({
      communication: 'ok',
      extinguisher: 'problem',
      climate: 'ok',
      emergencyBrake: 'ok',
      sanitation: 'clean',
      note: 'pressure gauge outside normal range',
      accepted: true,
    });
    attempt.returnJournal();

    expect(attempt.termination).toEqual({
      kind: 'terminal-rule',
      at: 0,
      ruleId: 'predeparture-critical',
      outcomeId: 'wagon-unserviceable',
    });
    expect(attempt.snapshot().items.journal.submitted).toBe(true);
  });

  it('terminates when the baseline fire is ignored until it becomes critical', () => {
    const attempt = new GameAttempt({ rootSeed: 12 });
    completeJournal(attempt);
    attempt.advanceTo(secondsToSimTimeUs(50 * 60));

    expect(attempt.termination).toEqual({
      kind: 'terminal-rule',
      at: attempt.termination?.at,
      ruleId: 'fire-unsalvageable',
      outcomeId: 'wagon-unsalvageable',
    });
    expect(attempt.termination?.at).toBeGreaterThan(secondsToSimTimeUs(45 * 60));
  });

  it('models staged pressure loss by euclidean distance and refreshes the climate sensor on demand', () => {
    const attempt = new GameAttempt({ rootSeed: 21 });
    prepareForBaselineFire(attempt);
    attempt.advanceTo(secondsToSimTimeUs(45 * 60));
    attempt.useExtinguisher('fire:carriage.cabin');

    const beforeLeak = attempt.inspectClimate();
    expect(beforeLeak.pressureKPa).toBe(101.3);

    attempt.advanceTo(secondsToSimTimeUs(70 * 60));
    const actual = new Map(
      attempt.snapshot().fields.map((field) => [field.cellId, field.pressure]),
    );
    expect(actual.get('carriage.entry')).toBe(4);
    expect(actual.get('carriage.cabin')).toBeCloseTo(1.5);
    expect(attempt.inspectClimate()).toEqual(beforeLeak);

    const refreshed = attempt.refreshClimate();
    expect(refreshed.updatedAt).toBe(attempt.time);
    expect(refreshed.pressureKPa).toBeLessThan(101.3);
    expect(refreshed.pressureKPa).toBeGreaterThan(95);
    expect(attempt.entities.get('player').traits).toContain('pressure-whistle');
  });

  it('terminates when a pressure incident drives the mean cabin pressure below its critical threshold', () => {
    const definition = {
      ...structuredClone(BASELINE_SCENARIO_DEFINITION),
      incidents: [
        {
          id: 'critical-pressure',
          kind: 'pressure-leak' as const,
          startAfterDepartureUs: secondsToSimTimeUs(1),
          failureLocationId: 'pressure.entry',
          baseCabinPressureKPa: 101.3,
          attenuationKPaPerMeter: 5,
          whistleDistanceM: 1.5,
          earsBlockedDistanceM: 1,
          criticalCabinPressureKPa: 80,
          stages: [{ afterStartUs: 0, pressureLossAtSourceKPa: 30 }],
        },
      ],
    };
    const scenario = loadScenarioDefinition(definition, BASELINE_LEVEL);
    const attempt = new GameAttempt({ rootSeed: 22, scenario });
    completeJournal(attempt);
    attempt.advanceTo(secondsToSimTimeUs(35 * 60 + 2));

    expect(attempt.termination).toMatchObject({
      kind: 'terminal-rule',
      ruleId: 'pressure-critical',
      outcomeId: 'wagon-unserviceable',
    });
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
