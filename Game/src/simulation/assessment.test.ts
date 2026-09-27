import { describe, expect, it } from 'vitest';
import { AssessmentRuntime } from './assessment';
import { BASELINE_ASSESSMENT_CONFIG } from './assessment-config';

describe('AssessmentRuntime', () => {
  it('rewards correct documents, clean pre-departure, and fast fire response', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordJournalSubmission({
      sanitation: 'clean',
      reportedProblem: false,
      realProblem: false,
      falseReport: false,
      missedProblem: false,
    });
    runtime.recordBoardingDecision('p1', 'admit', 'admit');
    runtime.recordBoardingDecision('p2', 'reject', 'reject');
    runtime.recordFireStarted(10_000_000);
    runtime.recordFireExtinguished(70_000_000);

    expect(runtime.result({ kind: 'route-completed' })).toEqual({
      scores: { safety: 100, customerSatisfaction: 100 },
      achievements: {
        setVersion: 'baseline-v2',
        ids: ['clean-predeparture', 'documents-perfect', 'fast-fire-response'],
      },
    });
  });

  it('penalizes unsafe boarding and unresolved service according to class', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordBoardingDecision('p1', 'reject', 'admit');
    runtime.recordBoardingDecision('p2', 'admit', 'reject');
    runtime.recordServiceTimeout('business');
    runtime.recordServiceResolution('comfort', 200_000_000);

    expect(runtime.result({ kind: 'route-completed' }).scores).toEqual({
      safety: 85,
      customerSatisfaction: 45,
    });
  });

  it('distinguishes a justified emergency stop from an unjustified one', () => {
    const justified = new AssessmentRuntime();
    justified.recordEmergencySealRemoved();
    justified.recordEmergencyActivation(true);

    expect(
      justified.result({ kind: 'terminal-rule', outcomeId: 'route-safely-interrupted' }),
    ).toEqual({
      scores: { safety: 100, customerSatisfaction: 100 },
      achievements: { setVersion: 'baseline-v2', ids: ['safe-emergency-stop'] },
    });

    const unjustified = new AssessmentRuntime();
    unjustified.recordEmergencySealRemoved();
    unjustified.recordEmergencyActivation(false);

    expect(
      unjustified.result({ kind: 'terminal-rule', outcomeId: 'route-safely-interrupted' }).scores,
    ).toEqual({ safety: 80, customerSatisfaction: 80 });
  });

  it('lifts safety for a real pre-departure fault and not for a false report', () => {
    const real = new AssessmentRuntime();
    real.recordJournalSubmission({
      sanitation: 'clean',
      reportedProblem: true,
      realProblem: true,
      falseReport: false,
      missedProblem: false,
    });
    real.recordBoardingDecision('p1', 'reject', 'admit');

    expect(
      real.result({ kind: 'terminal-rule', outcomeId: 'wagon-unserviceable' }).scores.safety,
    ).toBe(95);

    const fake = new AssessmentRuntime();
    fake.recordJournalSubmission({
      sanitation: 'clean',
      reportedProblem: true,
      realProblem: false,
      falseReport: true,
      missedProblem: false,
    });
    fake.recordBoardingDecision('p1', 'reject', 'admit');

    expect(fake.result({ kind: 'terminal-rule', outcomeId: 'wagon-unserviceable' }).scores).toEqual(
      { safety: 75, customerSatisfaction: 60 },
    );
  });

  it('penalizes a missed critical problem and withholds clean-predeparture', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordJournalSubmission({
      sanitation: 'clean',
      reportedProblem: false,
      realProblem: false,
      falseReport: false,
      missedProblem: true,
    });

    expect(runtime.result({ kind: 'route-completed' })).toEqual({
      scores: { safety: 70, customerSatisfaction: 100 },
      achievements: { setVersion: 'baseline-v2', ids: [] },
    });
  });

  it('heavily penalizes incidents allowed to reach critical state', () => {
    const runtime = new AssessmentRuntime();
    runtime.recordFireCritical();
    runtime.recordPressureCritical();

    expect(
      runtime.result({ kind: 'terminal-rule', outcomeId: 'wagon-unsalvageable' }).scores,
    ).toEqual({
      safety: 0,
      customerSatisfaction: 45,
    });
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
    runtime.recordBoardingDecision('p1', 'reject', 'admit');

    expect(runtime.result({ kind: 'route-completed' })).toEqual({
      scores: { safety: 73, customerSatisfaction: 77 },
      achievements: { setVersion: 'custom-v2', ids: [] },
    });
  });
});
