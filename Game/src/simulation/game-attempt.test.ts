import { describe, expect, it } from 'vitest';
import type { AssessmentResult } from './assessment';
import { BASELINE_ASSESSMENT_CONFIG } from './assessment-config';
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

function resolveOriginBoarding(
  attempt: GameAttempt,
  decisions: Partial<
    Record<'passenger-1' | 'passenger-2' | 'passenger-3', 'admit' | 'reject'>
  > = {},
): void {
  for (const passengerId of ['passenger-1', 'passenger-2', 'passenger-3'] as const) {
    attempt.decidePassengerBoarding(
      passengerId,
      decisions[passengerId] ?? (passengerId === 'passenger-3' ? 'reject' : 'admit'),
    );
  }
}

function scenarioWithoutIncidents() {
  return loadScenarioDefinition({ ...BASELINE_SCENARIO_DEFINITION, incidents: [] }, BASELINE_LEVEL);
}

function faultExtinguisher(attempt: GameAttempt): void {
  follow(attempt, ['origin-desk-door:forward', 'origin-door-entry:forward', 'entry-cabin:forward']);
  attempt.takeExtinguisher();
  attempt.prepareExtinguisher();
  attempt.returnExtinguisher();
  follow(attempt, [
    'entry-cabin:backward',
    'origin-door-entry:backward',
    'origin-desk-door:backward',
  ]);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function expectInvariant(result: AssessmentResult, starting = 100): void {
  let safety = 0;
  let customerSatisfaction = 0;
  for (const fact of result.facts) {
    safety += fact.scoreDelta.safety;
    customerSatisfaction += fact.scoreDelta.customerSatisfaction;
  }
  expect(result.scores.safety).toBe(clampScore(starting + safety));
  expect(result.scores.customerSatisfaction).toBe(clampScore(starting + customerSatisfaction));
}

function finishQuietRoute(attempt: GameAttempt): void {
  const originAt = secondsToSimTimeUs(5 * 60);
  if (attempt.time < originAt) attempt.advanceTo(originAt);
  resolveOriginBoarding(attempt);
  attempt.advanceTo(attempt.scenario.normalEndTimeUs);
}

function prepareForBaselineFire(attempt: GameAttempt): void {
  completeJournal(attempt);
  attempt.advanceTo(secondsToSimTimeUs(5 * 60));
  resolveOriginBoarding(attempt);
  follow(attempt, ['origin-desk-door:forward', 'origin-door-entry:forward', 'entry-cabin:forward']);
  attempt.takeExtinguisher();
  attempt.prepareExtinguisher();
}

describe('GameAttempt', () => {
  it('reproduces the same baseline run from the same seed and authoritative inputs', () => {
    const run = () => {
      const attempt = new GameAttempt({ rootSeed: 17 });
      prepareForBaselineFire(attempt);
      attempt.advanceTo(secondsToSimTimeUs(45 * 60));
      attempt.useExtinguisher('fire:carriage.cabin');
      attempt.advanceTo(attempt.scenario.normalEndTimeUs);
      return {
        snapshot: attempt.snapshot(),
        termination: attempt.termination,
        assessment: attempt.assessmentResult(),
      };
    };

    const first = run();
    expect(first).toEqual(run());
    expectInvariant(first.assessment);
    expect(first.assessment.facts.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining([
        'journal-submission',
        'boarding-decision',
        'service-request',
        'fire',
        'pressure',
      ]),
    );
    const fire = first.assessment.facts.find((fact) => fact.id === 'fire:cabin-fire');
    const pressure = first.assessment.facts.find(
      (fact) => fact.id === 'pressure:entry-pressure-leak',
    );
    expect(fire).toMatchObject({
      verdict: 'correct',
      detail: { incidentId: 'cabin-fire', extinguished: true, critical: false },
    });
    expect(pressure).toMatchObject({
      verdict: 'correct',
      detail: { incidentId: 'entry-pressure-leak', critical: false },
    });
  });

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
      'player',
    ]);
    for (const passengerId of ['passenger-1', 'passenger-2']) {
      expect(attempt.entities.get(passengerId).currentAction).toBeDefined();
    }
    expect(() => attempt.entities.get('passenger-3')).toThrow(/Unknown entity/);

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
    resolveOriginBoarding(attempt, { 'passenger-3': 'admit' });

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

  it('gates origin departure on explicit passenger document decisions', () => {
    const attempt = new GameAttempt({ rootSeed: 31, scenario: scenarioWithoutIncidents() });
    completeJournal(attempt);
    attempt.advanceTo(secondsToSimTimeUs(5 * 60));

    expect(attempt.phase).toEqual({ kind: 'origin-stop' });
    expect(attempt.boardingDecision('passenger-1')).toBe('pending');
    expect(attempt.entities.get('passenger-1').position).toEqual({
      kind: 'cell',
      cellId: 'platform-origin.door',
    });

    attempt.advanceTo(secondsToSimTimeUs(35 * 60));
    expect(attempt.phase).toEqual({ kind: 'origin-stop' });

    expect(attempt.decidePassengerBoarding('passenger-1', 'admit')).toBe('admit');
    expect(attempt.entities.get('passenger-1').position).toEqual({
      kind: 'cell',
      cellId: 'carriage.seat-1',
    });
    expect(attempt.entities.get('passenger-1').currentAction).toBeDefined();

    attempt.decidePassengerBoarding('passenger-2', 'admit');
    attempt.decidePassengerBoarding('passenger-3', 'reject');
    expect(() => attempt.entities.get('passenger-3')).toThrow(/Unknown entity/);
    expect(attempt.phase).toEqual({ kind: 'travel', nextStopIndex: 0 });
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
    resolveOriginBoarding(attempt);

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
    attempt.advanceTo(secondsToSimTimeUs(5 * 60));
    resolveOriginBoarding(attempt);
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
    attempt.advanceTo(secondsToSimTimeUs(5 * 60));
    resolveOriginBoarding(attempt);
    attempt.advanceTo(secondsToSimTimeUs(35 * 60 + 2));

    expect(attempt.termination).toMatchObject({
      kind: 'terminal-rule',
      ruleId: 'pressure-critical',
      outcomeId: 'wagon-unserviceable',
    });
  });

  it('requires the emergency-brake seal to be removed before a controlled stop', () => {
    const attempt = new GameAttempt({ rootSeed: 24, scenario: scenarioWithoutIncidents() });
    completeJournal(attempt);
    attempt.advanceTo(secondsToSimTimeUs(5 * 60));
    resolveOriginBoarding(attempt);
    attempt.advanceTo(secondsToSimTimeUs(35 * 60));

    expect(attempt.phase).toEqual({ kind: 'travel', nextStopIndex: 0 });
    expect(attempt.inspectEmergencyBrake()).toEqual({ seal: 'intact', activated: false });
    expect(() => attempt.activateEmergencyBrake()).toThrow(/seal must be removed/i);

    expect(attempt.removeEmergencyBrakeSeal()).toEqual({ seal: 'broken', activated: false });
    expect(attempt.termination).toBeNull();

    expect(attempt.activateEmergencyBrake()).toMatchObject({
      kind: 'terminal-rule',
      ruleId: 'emergency-brake',
      outcomeId: 'route-safely-interrupted',
    });
    expect(attempt.inspectEmergencyBrake).toBeDefined();
    expect(attempt.snapshot().emergencyBrake).toEqual({ seal: 'broken', activated: true });
    expect(
      attempt.assessmentResult().facts.find((fact) => fact.kind === 'emergency-brake'),
    ).toEqual({
      id: 'emergency-brake',
      kind: 'emergency-brake',
      at: attempt.termination?.at,
      verdict: 'incorrect',
      scoreDelta: { safety: -20, customerSatisfaction: -20 },
      detail: { sealRemoved: true, activated: true, hazardActive: false },
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

  it('penalizes a false critical journal report and does not lift safety', () => {
    const attempt = new GameAttempt({ rootSeed: 3 });
    completeJournal(attempt, {
      extinguisher: 'problem',
      note: 'pressure gauge outside normal range',
    });

    expect(attempt.termination).toEqual({
      kind: 'terminal-rule',
      at: 0,
      ruleId: 'predeparture-critical',
      outcomeId: 'wagon-unserviceable',
    });
    const result = attempt.assessmentResult();
    expect(result.scores).toEqual({ safety: 90, customerSatisfaction: 60 });
    expect(result.achievements).toEqual({ setVersion: 'baseline-v2', ids: [] });
    expect(result.facts).toEqual([
      {
        id: 'journal-submission',
        kind: 'journal-submission',
        at: 0,
        verdict: 'incorrect',
        scoreDelta: { safety: -10, customerSatisfaction: -40 },
        detail: {
          communication: 'ok',
          extinguisher: 'problem',
          climate: 'ok',
          emergencyBrake: 'ok',
          sanitation: 'clean',
          accepted: true,
          reportedProblem: true,
          realProblem: false,
          falseReport: true,
          missedProblem: false,
        },
      },
    ]);
    expectInvariant(result);
  });

  it('treats climate and communication problem marks as false reports', () => {
    for (const field of ['climate', 'communication'] as const) {
      const attempt = new GameAttempt({ rootSeed: 5 });
      completeJournal(attempt, { [field]: 'problem' });

      expect(attempt.termination).toMatchObject({
        kind: 'terminal-rule',
        outcomeId: 'wagon-unserviceable',
      });
      const result = attempt.assessmentResult();
      expect(result.scores).toEqual({
        safety: 90,
        customerSatisfaction: 60,
      });
      expect(result.achievements.ids).not.toContain('clean-predeparture');
      expect(result.facts[0]).toMatchObject({
        kind: 'journal-submission',
        verdict: 'incorrect',
        detail: { [field]: 'problem', falseReport: true, realProblem: false },
      });
      expectInvariant(result);
    }
  });

  it('keeps the safe pre-departure floor when the reported extinguisher fault is real', () => {
    const attempt = new GameAttempt({
      rootSeed: 41,
      assessmentConfig: {
        ...BASELINE_ASSESSMENT_CONFIG,
        startingScore: 50,
      },
    });
    faultExtinguisher(attempt);
    expect(attempt.snapshot().items.extinguisher).toMatchObject({
      pin: 'removed',
      seal: 'broken',
    });
    completeJournal(attempt, { extinguisher: 'problem' });

    expect(attempt.termination).toMatchObject({
      kind: 'terminal-rule',
      ruleId: 'predeparture-critical',
      outcomeId: 'wagon-unserviceable',
    });
    const result = attempt.assessmentResult();
    expect(result.scores.safety).toBe(95);
    expect(result.scores.customerSatisfaction).toBe(50);
    expect(result.achievements.ids).not.toContain('clean-predeparture');
    expect(result.facts).toEqual([
      expect.objectContaining({
        id: 'journal-submission',
        verdict: 'correct',
        scoreDelta: { safety: 45, customerSatisfaction: 0 },
        detail: expect.objectContaining({
          extinguisher: 'problem',
          reportedProblem: true,
          realProblem: true,
          falseReport: false,
          missedProblem: false,
        }),
      }),
    ]);
    expectInvariant(result, 50);
  });

  it('penalizes a missed critical fault when the journal marks it ok', () => {
    const attempt = new GameAttempt({ rootSeed: 11, scenario: scenarioWithoutIncidents() });
    faultExtinguisher(attempt);
    completeJournal(attempt);

    expect(attempt.termination).toBeNull();
    finishQuietRoute(attempt);

    expect(attempt.termination).toMatchObject({ kind: 'route-completed' });
    const result = attempt.assessmentResult();
    expect(result.scores).toEqual({ safety: 70, customerSatisfaction: 0 });
    expect(result.achievements).toEqual({ setVersion: 'baseline-v2', ids: ['documents-perfect'] });
    expect(result.facts.find((fact) => fact.kind === 'journal-submission')).toMatchObject({
      verdict: 'missed',
      scoreDelta: { safety: -30, customerSatisfaction: 0 },
      detail: { extinguisher: 'ok', missedProblem: true, falseReport: false },
    });
    expectInvariant(result);
  });

  it('stacks a false mark with a missed real fault and does not lift safety', () => {
    const attempt = new GameAttempt({ rootSeed: 8 });
    faultExtinguisher(attempt);
    completeJournal(attempt, { communication: 'problem', extinguisher: 'ok' });

    expect(attempt.termination).toMatchObject({
      kind: 'terminal-rule',
      outcomeId: 'wagon-unserviceable',
    });
    const result = attempt.assessmentResult();
    expect(result.scores).toEqual({ safety: 60, customerSatisfaction: 60 });
    expect(result.achievements).toEqual({ setVersion: 'baseline-v2', ids: [] });
    expect(result.facts).toEqual([
      expect.objectContaining({
        kind: 'journal-submission',
        verdict: 'missed',
        scoreDelta: { safety: -40, customerSatisfaction: -40 },
        detail: expect.objectContaining({
          communication: 'problem',
          extinguisher: 'ok',
          falseReport: true,
          missedProblem: true,
          realProblem: false,
        }),
      }),
    ]);
    expectInvariant(result);
  });

  it('keeps honest pre-departure scores and grants clean-predeparture', () => {
    const attempt = new GameAttempt({ rootSeed: 11, scenario: scenarioWithoutIncidents() });
    completeJournal(attempt);
    finishQuietRoute(attempt);

    const result = attempt.assessmentResult();
    expect(result.scores).toEqual({ safety: 100, customerSatisfaction: 0 });
    expect(result.achievements).toEqual({
      setVersion: 'baseline-v2',
      ids: ['clean-predeparture', 'documents-perfect'],
    });
    expect(result.facts.some((fact) => fact.kind === 'emergency-brake')).toBe(false);
    expect(result.facts.find((fact) => fact.kind === 'journal-submission')).toMatchObject({
      at: 0,
      verdict: 'correct',
      scoreDelta: { safety: 0, customerSatisfaction: 0 },
    });
    expectInvariant(result);
  });

  it('stamps boarding decisions with the simulation time', () => {
    const attempt = new GameAttempt({ rootSeed: 11, scenario: scenarioWithoutIncidents() });
    completeJournal(attempt);
    const decidedAt = secondsToSimTimeUs(5 * 60);
    attempt.advanceTo(decidedAt);
    resolveOriginBoarding(attempt, { 'passenger-2': 'reject' });
    attempt.advanceTo(attempt.scenario.normalEndTimeUs);

    const result = attempt.assessmentResult();
    expect(result.facts.find((fact) => fact.id === 'boarding:passenger-2')).toEqual({
      id: 'boarding:passenger-2',
      kind: 'boarding-decision',
      at: decidedAt,
      verdict: 'incorrect',
      scoreDelta: { safety: 0, customerSatisfaction: -25 },
      detail: { passengerId: 'passenger-2', expected: 'admit', actual: 'reject' },
    });
    expectInvariant(result);
  });

  it('records a missed business service against the passenger and the timeout time', () => {
    const attempt = new GameAttempt({ rootSeed: 4 });
    completeJournal(attempt);
    attempt.advanceTo(secondsToSimTimeUs(5 * 60));
    resolveOriginBoarding(attempt, { 'passenger-3': 'admit' });
    const action = attempt.entities.get('passenger-3').currentAction;
    expect(action?.actionId).toBe('request-drink');
    const timeoutAt = (action?.startedAt ?? 0) + secondsToSimTimeUs(120);
    attempt.advanceTo(timeoutAt);
    attempt.signal('critical-predeparture-fault');

    const service = attempt
      .assessmentResult()
      .facts.find(
        (fact) => fact.kind === 'service-request' && fact.detail.passengerId === 'passenger-3',
      );
    expect(service).toEqual({
      id: 'service:passenger-3:0',
      kind: 'service-request',
      at: timeoutAt,
      verdict: 'missed',
      scoreDelta: { safety: 0, customerSatisfaction: -20 },
      detail: {
        passengerId: 'passenger-3',
        serviceClass: 'business',
        timedOut: true,
        targetUs: 60_000_000,
      },
    });
  });

  it('records a late service response from the authoritative delivery time', () => {
    const attempt = new GameAttempt({ rootSeed: 4 });
    completeJournal(attempt);
    attempt.advanceTo(secondsToSimTimeUs(5 * 60));
    resolveOriginBoarding(attempt, { 'passenger-3': 'admit' });
    const action = attempt.entities.get('passenger-3').currentAction;
    expect(action?.actionId).toBe('request-drink');
    const startedAt = action?.startedAt ?? 0;
    follow(attempt, [
      'origin-desk-door:forward',
      'origin-door-entry:forward',
      'entry-cabin:forward',
      'cabin-service:forward',
    ]);
    attempt.takeDrink();
    const servedAt = startedAt + 70_000_000;
    attempt.advanceTo(servedAt);
    attempt.giveHeldItem('passenger-3');
    attempt.signal('critical-predeparture-fault');

    expect(
      attempt.assessmentResult().facts.find((fact) => fact.id === 'service:passenger-3:0'),
    ).toEqual({
      id: 'service:passenger-3:0',
      kind: 'service-request',
      at: servedAt,
      verdict: 'late',
      scoreDelta: { safety: 0, customerSatisfaction: -5 },
      reactionUs: 70_000_000,
      detail: {
        passengerId: 'passenger-3',
        serviceClass: 'business',
        timedOut: false,
        targetUs: 60_000_000,
      },
    });
  });

  it('records the cabin fire from ignition through extinguishing', () => {
    const attempt = new GameAttempt({ rootSeed: 17 });
    prepareForBaselineFire(attempt);
    attempt.advanceTo(secondsToSimTimeUs(45 * 60));
    const extinguishedAt = attempt.time;
    attempt.useExtinguisher('fire:carriage.cabin');
    attempt.signal('critical-predeparture-fault');

    const fire = attempt.assessmentResult().facts.find((fact) => fact.kind === 'fire');
    expect(fire).toMatchObject({
      id: 'fire:cabin-fire',
      at: extinguishedAt,
      verdict: 'correct',
      detail: { incidentId: 'cabin-fire', extinguished: true, critical: false },
    });
    expect(fire?.reactionUs).toBe(extinguishedAt - secondsToSimTimeUs(45 * 60));
  });

  it('records a critical fire and a critical pressure incident', () => {
    const fireAttempt = new GameAttempt({ rootSeed: 12 });
    completeJournal(fireAttempt);
    fireAttempt.advanceTo(secondsToSimTimeUs(5 * 60));
    resolveOriginBoarding(fireAttempt);
    fireAttempt.advanceTo(secondsToSimTimeUs(50 * 60));
    expect(fireAttempt.assessmentResult().facts.find((fact) => fact.kind === 'fire')).toMatchObject(
      {
        id: 'fire:cabin-fire',
        verdict: 'missed',
        at: fireAttempt.termination?.at,
        scoreDelta: { safety: -60, customerSatisfaction: -30 },
        detail: { incidentId: 'cabin-fire', extinguished: false, critical: true },
      },
    );

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
    const pressureAttempt = new GameAttempt({
      rootSeed: 22,
      scenario: loadScenarioDefinition(definition, BASELINE_LEVEL),
    });
    completeJournal(pressureAttempt);
    pressureAttempt.advanceTo(secondsToSimTimeUs(5 * 60));
    resolveOriginBoarding(pressureAttempt);
    pressureAttempt.advanceTo(secondsToSimTimeUs(35 * 60 + 2));
    const pressure = pressureAttempt
      .assessmentResult()
      .facts.find((fact) => fact.kind === 'pressure');
    expect(pressure).toMatchObject({
      id: 'pressure:critical-pressure',
      verdict: 'missed',
      at: pressureAttempt.termination?.at,
      scoreDelta: { safety: -50, customerSatisfaction: -25 },
      detail: { incidentId: 'critical-pressure', critical: true },
    });
    expectInvariant(pressureAttempt.assessmentResult());
  });
});
