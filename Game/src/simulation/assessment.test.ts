import { describe, expect, it } from 'vitest';
import {
  type AssessmentResult,
  AssessmentRuntime,
  type AssessmentTermination,
  type JournalAssessmentInput,
} from './assessment';
import { BASELINE_ASSESSMENT_CONFIG } from './assessment-config';

function journalInput(overrides: Partial<JournalAssessmentInput> = {}): JournalAssessmentInput {
  return {
    at: 0,
    communication: 'ok',
    extinguisher: 'ok',
    climate: 'ok',
    emergencyBrake: 'ok',
    sanitation: 'clean',
    accepted: true,
    reportedProblem: false,
    realProblem: false,
    falseReport: false,
    missedProblem: false,
    ...overrides,
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function expectInvariant(result: AssessmentResult, starting: number): void {
  let safety = 0;
  let customerSatisfaction = 0;
  for (const fact of result.facts) {
    safety += fact.scoreDelta.safety;
    customerSatisfaction += fact.scoreDelta.customerSatisfaction;
  }
  expect(result.scores.safety).toBe(clampScore(starting + safety));
  expect(result.scores.customerSatisfaction).toBe(clampScore(starting + customerSatisfaction));
  const ordered = [...result.facts].sort((left, right) =>
    left.at === right.at
      ? left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0
      : left.at - right.at,
  );
  expect(result.facts).toEqual(ordered);
}

function finish(
  runtime: AssessmentRuntime,
  termination: AssessmentTermination,
  starting = BASELINE_ASSESSMENT_CONFIG.startingScore,
): AssessmentResult {
  const result = runtime.result(termination);
  expectInvariant(result, starting);
  return result;
}

describe('AssessmentRuntime', () => {
  it('rewards correct documents, clean pre-departure, and fast fire response', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordJournalSubmission(journalInput());
    runtime.recordBoardingDecision('p1', 'admit', 'admit', 1_000);
    runtime.recordBoardingDecision('p2', 'reject', 'reject', 2_000);
    runtime.recordFireStarted('cabin-fire', 10_000_000);
    runtime.recordFireExtinguished('cabin-fire', 70_000_000);

    expect(finish(runtime, { kind: 'route-completed', at: 80_000_000 })).toEqual({
      scores: { safety: 100, customerSatisfaction: 100 },
      achievements: {
        setVersion: 'baseline-v2',
        ids: ['clean-predeparture', 'documents-perfect', 'fast-fire-response'],
      },
      facts: [
        {
          id: 'journal-submission',
          kind: 'journal-submission',
          at: 0,
          verdict: 'correct',
          scoreDelta: { safety: 0, customerSatisfaction: 0 },
          detail: {
            communication: 'ok',
            extinguisher: 'ok',
            climate: 'ok',
            emergencyBrake: 'ok',
            sanitation: 'clean',
            accepted: true,
            reportedProblem: false,
            realProblem: false,
            falseReport: false,
            missedProblem: false,
          },
        },
        {
          id: 'boarding:p1',
          kind: 'boarding-decision',
          at: 1_000,
          verdict: 'correct',
          scoreDelta: { safety: 0, customerSatisfaction: 0 },
          detail: { passengerId: 'p1', expected: 'admit', actual: 'admit' },
        },
        {
          id: 'boarding:p2',
          kind: 'boarding-decision',
          at: 2_000,
          verdict: 'correct',
          scoreDelta: { safety: 0, customerSatisfaction: 0 },
          detail: { passengerId: 'p2', expected: 'reject', actual: 'reject' },
        },
        {
          id: 'fire:cabin-fire',
          kind: 'fire',
          at: 70_000_000,
          verdict: 'correct',
          scoreDelta: { safety: 0, customerSatisfaction: 0 },
          reactionUs: 60_000_000,
          detail: { incidentId: 'cabin-fire', extinguished: true, critical: false },
        },
      ],
    });
  });

  it('penalizes unsafe boarding and unresolved service according to class', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordBoardingDecision('p1', 'reject', 'admit', 10);
    runtime.recordBoardingDecision('p2', 'admit', 'reject', 20);
    runtime.recordServiceTimeout({
      passengerId: 'passenger-business',
      serviceClass: 'business',
      at: 30,
    });
    runtime.recordServiceResolution({
      passengerId: 'passenger-comfort',
      serviceClass: 'comfort',
      responseUs: 200_000_000,
      at: 40,
    });

    const result = finish(runtime, { kind: 'route-completed' });
    expect(result.scores).toEqual({ safety: 85, customerSatisfaction: 45 });
    expect(result.facts).toEqual([
      {
        id: 'boarding:p1',
        kind: 'boarding-decision',
        at: 10,
        verdict: 'incorrect',
        scoreDelta: { safety: -15, customerSatisfaction: 0 },
        detail: { passengerId: 'p1', expected: 'reject', actual: 'admit' },
      },
      {
        id: 'boarding:p2',
        kind: 'boarding-decision',
        at: 20,
        verdict: 'incorrect',
        scoreDelta: { safety: 0, customerSatisfaction: -25 },
        detail: { passengerId: 'p2', expected: 'admit', actual: 'reject' },
      },
      {
        id: 'service:passenger-business:0',
        kind: 'service-request',
        at: 30,
        verdict: 'missed',
        scoreDelta: { safety: 0, customerSatisfaction: -20 },
        detail: {
          passengerId: 'passenger-business',
          serviceClass: 'business',
          timedOut: true,
          targetUs: 60_000_000,
        },
      },
      {
        id: 'service:passenger-comfort:0',
        kind: 'service-request',
        at: 40,
        verdict: 'late',
        scoreDelta: { safety: 0, customerSatisfaction: -10 },
        reactionUs: 200_000_000,
        detail: {
          passengerId: 'passenger-comfort',
          serviceClass: 'comfort',
          timedOut: false,
          targetUs: 90_000_000,
        },
      },
    ]);
  });

  it('marks an over-target service late and keeps the very-late penalty distinct', () => {
    const runtime = new AssessmentRuntime();
    const basicTarget = BASELINE_ASSESSMENT_CONFIG.service.targetResponseUs.basic;
    runtime.recordServiceResolution({
      passengerId: 'passenger-1',
      serviceClass: 'basic',
      responseUs: basicTarget,
      at: 1,
    });
    runtime.recordServiceResolution({
      passengerId: 'passenger-1',
      serviceClass: 'basic',
      responseUs: basicTarget + 1,
      at: 2,
    });
    runtime.recordServiceResolution({
      passengerId: 'passenger-1',
      serviceClass: 'basic',
      responseUs: basicTarget * 2 + 1,
      at: 3,
    });

    const result = finish(runtime, { kind: 'route-completed' });
    expect(result.scores).toEqual({ safety: 100, customerSatisfaction: 85 });
    expect(
      result.facts.map((fact) => [fact.id, fact.verdict, fact.scoreDelta.customerSatisfaction]),
    ).toEqual([
      ['service:passenger-1:0', 'correct', 0],
      ['service:passenger-1:1', 'late', -5],
      ['service:passenger-1:2', 'late', -10],
    ]);
    expect(result.achievements.ids).toContain('all-service-requests-resolved');
  });

  it('orders facts by time and then id', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordBoardingDecision('passenger-2', 'admit', 'admit', 5);
    runtime.recordJournalSubmission(journalInput({ at: 5 }));
    runtime.recordServiceResolution({
      passengerId: 'passenger-1',
      serviceClass: 'basic',
      responseUs: 1,
      at: 4,
    });

    expect(finish(runtime, { kind: 'route-completed' }).facts.map((fact) => fact.id)).toEqual([
      'service:passenger-1:0',
      'boarding:passenger-2',
      'journal-submission',
    ]);
  });

  it('distinguishes a justified emergency stop from an unjustified one', () => {
    const justified = new AssessmentRuntime();
    justified.recordEmergencySealRemoved(1);
    justified.recordEmergencyActivation(true, 2);

    expect(
      finish(justified, { kind: 'terminal-rule', outcomeId: 'route-safely-interrupted' }),
    ).toEqual({
      scores: { safety: 100, customerSatisfaction: 100 },
      achievements: { setVersion: 'baseline-v2', ids: ['safe-emergency-stop'] },
      facts: [
        {
          id: 'emergency-brake',
          kind: 'emergency-brake',
          at: 2,
          verdict: 'correct',
          scoreDelta: { safety: 0, customerSatisfaction: 0 },
          detail: { sealRemoved: true, activated: true, hazardActive: true },
        },
      ],
    });

    const unjustified = new AssessmentRuntime();
    unjustified.recordEmergencySealRemoved(3);
    unjustified.recordEmergencyActivation(false, 4);

    const unjustifiedResult = finish(unjustified, {
      kind: 'terminal-rule',
      outcomeId: 'route-safely-interrupted',
    });
    expect(unjustifiedResult.scores).toEqual({ safety: 80, customerSatisfaction: 80 });
    expect(unjustifiedResult.facts).toEqual([
      {
        id: 'emergency-brake',
        kind: 'emergency-brake',
        at: 4,
        verdict: 'incorrect',
        scoreDelta: { safety: -20, customerSatisfaction: -20 },
        detail: { sealRemoved: true, activated: true, hazardActive: false },
      },
    ]);
  });

  it('penalizes a removed seal that is never activated and ignores an untouched brake', () => {
    const removed = new AssessmentRuntime();
    removed.recordEmergencySealRemoved(8);
    const removedResult = finish(removed, { kind: 'route-completed', at: 9 });
    expect(removedResult.scores).toEqual({ safety: 95, customerSatisfaction: 100 });
    expect(removedResult.facts[0]).toMatchObject({
      kind: 'emergency-brake',
      at: 8,
      verdict: 'incorrect',
      scoreDelta: { safety: -5, customerSatisfaction: 0 },
      detail: { sealRemoved: true, activated: false, hazardActive: false },
    });

    expect(finish(new AssessmentRuntime(), { kind: 'route-completed' }).facts).toEqual([]);
  });

  it('lifts safety for a real pre-departure fault and not for a false report', () => {
    const real = new AssessmentRuntime();
    real.recordJournalSubmission(
      journalInput({
        reportedProblem: true,
        realProblem: true,
        extinguisher: 'problem',
      }),
    );
    real.recordBoardingDecision('p1', 'reject', 'admit', 4);

    const realResult = finish(real, { kind: 'terminal-rule', outcomeId: 'wagon-unserviceable' });
    expect(realResult.scores.safety).toBe(95);
    expect(realResult.facts).toEqual([
      {
        id: 'journal-submission',
        kind: 'journal-submission',
        at: 0,
        verdict: 'correct',
        scoreDelta: { safety: 10, customerSatisfaction: 0 },
        detail: {
          communication: 'ok',
          extinguisher: 'problem',
          climate: 'ok',
          emergencyBrake: 'ok',
          sanitation: 'clean',
          accepted: true,
          reportedProblem: true,
          realProblem: true,
          falseReport: false,
          missedProblem: false,
        },
      },
      {
        id: 'boarding:p1',
        kind: 'boarding-decision',
        at: 4,
        verdict: 'incorrect',
        scoreDelta: { safety: -15, customerSatisfaction: 0 },
        detail: { passengerId: 'p1', expected: 'reject', actual: 'admit' },
      },
    ]);

    const fake = new AssessmentRuntime();
    fake.recordJournalSubmission(
      journalInput({
        reportedProblem: true,
        falseReport: true,
        communication: 'problem',
      }),
    );
    fake.recordBoardingDecision('p1', 'reject', 'admit', 4);

    const fakeResult = finish(fake, { kind: 'terminal-rule', outcomeId: 'wagon-unserviceable' });
    expect(fakeResult.scores).toEqual({ safety: 75, customerSatisfaction: 60 });
    expect(fakeResult.facts[0]).toMatchObject({
      verdict: 'incorrect',
      scoreDelta: { safety: -10, customerSatisfaction: -40 },
    });
  });

  it('keeps a missed real fault as missed when another field is a false report', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordJournalSubmission(
      journalInput({
        communication: 'problem',
        extinguisher: 'ok',
        reportedProblem: true,
        falseReport: true,
        missedProblem: true,
      }),
    );

    const result = finish(runtime, { kind: 'terminal-rule', outcomeId: 'wagon-unserviceable' });
    expect(result.scores).toEqual({ safety: 60, customerSatisfaction: 60 });
    expect(result.facts[0]).toMatchObject({
      verdict: 'missed',
      scoreDelta: { safety: -40, customerSatisfaction: -40 },
      detail: { falseReport: true, missedProblem: true, realProblem: false },
    });
  });

  it('folds the safe pre-departure floor into the journal delta', () => {
    const runtime = new AssessmentRuntime({
      ...BASELINE_ASSESSMENT_CONFIG,
      startingScore: 50,
    });
    runtime.recordJournalSubmission(
      journalInput({
        reportedProblem: true,
        realProblem: true,
        missedProblem: true,
        extinguisher: 'problem',
      }),
    );

    const result = finish(runtime, { kind: 'terminal-rule', outcomeId: 'wagon-unserviceable' }, 50);
    expect(result.scores).toEqual({ safety: 95, customerSatisfaction: 50 });
    expect(result.facts[0]?.scoreDelta).toEqual({ safety: 45, customerSatisfaction: 0 });
  });

  it('penalizes a missed critical problem and withholds clean-predeparture', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordJournalSubmission(journalInput({ missedProblem: true, extinguisher: 'ok' }));

    expect(finish(runtime, { kind: 'route-completed' })).toEqual({
      scores: { safety: 70, customerSatisfaction: 100 },
      achievements: { setVersion: 'baseline-v2', ids: [] },
      facts: [
        {
          id: 'journal-submission',
          kind: 'journal-submission',
          at: 0,
          verdict: 'missed',
          scoreDelta: { safety: -30, customerSatisfaction: 0 },
          detail: {
            communication: 'ok',
            extinguisher: 'ok',
            climate: 'ok',
            emergencyBrake: 'ok',
            sanitation: 'clean',
            accepted: true,
            reportedProblem: false,
            realProblem: false,
            falseReport: false,
            missedProblem: true,
          },
        },
      ],
    });
  });

  it('heavily penalizes incidents allowed to reach critical state', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordFireCritical('cabin-fire', 5);
    runtime.recordPressureCritical('entry-pressure-leak', 6);

    const result = finish(runtime, { kind: 'terminal-rule', outcomeId: 'wagon-unsalvageable' });
    expect(result.scores).toEqual({ safety: 0, customerSatisfaction: 45 });
    expect(result.facts).toEqual([
      {
        id: 'fire:cabin-fire',
        kind: 'fire',
        at: 5,
        verdict: 'missed',
        scoreDelta: { safety: -60, customerSatisfaction: -30 },
        detail: { incidentId: 'cabin-fire', extinguished: false, critical: true },
      },
      {
        id: 'pressure:entry-pressure-leak',
        kind: 'pressure',
        at: 6,
        verdict: 'missed',
        scoreDelta: { safety: -50, customerSatisfaction: -25 },
        detail: { incidentId: 'entry-pressure-leak', critical: true },
      },
    ]);
  });

  it('records a non-critical pressure start and a fire that was extinguished before it went critical', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordPressureStarted('entry-pressure-leak', 12);
    runtime.recordFireStarted('cabin-fire', 10);
    runtime.recordFireExtinguished('cabin-fire', 15);
    runtime.recordFireCritical('cabin-fire', 16);

    const result = finish(runtime, { kind: 'route-completed', at: 40 });
    expect(result.scores).toEqual({ safety: 40, customerSatisfaction: 70 });
    expect(result.facts).toEqual([
      {
        id: 'pressure:entry-pressure-leak',
        kind: 'pressure',
        at: 12,
        verdict: 'correct',
        scoreDelta: { safety: 0, customerSatisfaction: 0 },
        detail: { incidentId: 'entry-pressure-leak', critical: false },
      },
      {
        id: 'fire:cabin-fire',
        kind: 'fire',
        at: 16,
        verdict: 'missed',
        scoreDelta: { safety: -60, customerSatisfaction: -30 },
        reactionUs: 5,
        detail: { incidentId: 'cabin-fire', extinguished: true, critical: true },
      },
    ]);
    expect(result.achievements.ids).toContain('fast-fire-response');
  });

  it('treats an unextinguished fire as missed without a score penalty', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordFireStarted('cabin-fire', 10);

    const result = finish(runtime, { kind: 'route-completed', at: 50 });
    expect(result.scores).toEqual({ safety: 100, customerSatisfaction: 100 });
    expect(result.facts[0]).toMatchObject({
      verdict: 'missed',
      at: 50,
      scoreDelta: { safety: 0, customerSatisfaction: 0 },
      detail: { extinguished: false, critical: false },
    });
    expect(result.facts[0]?.reactionUs).toBeUndefined();
  });

  it('uses externally supplied assessment weights and version', () => {
    const runtime = new AssessmentRuntime({
      ...BASELINE_ASSESSMENT_CONFIG,
      setVersion: 'custom-v2',
      startingScore: 80,
      boarding: {
        ...BASELINE_ASSESSMENT_CONFIG.boarding,
        unsafeAdmit: { safety: -7, customerSatisfaction: -3 },
      },
    });
    runtime.recordBoardingDecision('p1', 'reject', 'admit', 1);

    expect(finish(runtime, { kind: 'route-completed' }, 80)).toEqual({
      scores: { safety: 73, customerSatisfaction: 77 },
      achievements: { setVersion: 'custom-v2', ids: [] },
      facts: [
        {
          id: 'boarding:p1',
          kind: 'boarding-decision',
          at: 1,
          verdict: 'incorrect',
          scoreDelta: { safety: -7, customerSatisfaction: -3 },
          detail: { passengerId: 'p1', expected: 'reject', actual: 'admit' },
        },
      ],
    });
  });
});
