import { describe, expect, it } from 'vitest';
import { politenessOf } from '../engine/summarize';
import type { RunReport } from './dto';
import { mapStage, mapVerdict, reportToSummary } from './report-map';

function report(): RunReport {
  return {
    contractVersion: 1,
    protocolVersion: 1,
    scenarioId: 'pressure',
    simulationSeconds: 40,
    outcome: 'completed',
    outcomeNote: 'Доложено',
    safety: 89,
    loyalty: 87,
    facts: { prevented: 1, incidents: 0, complaints: 0, interventions: 0 },
    decisions: [
      {
        id: 'report-panel',
        time: '00:20',
        stage: 'ride',
        verdict: 'correct',
        safety: 1,
        loyalty: 2,
        reactionSec: 12,
      },
      {
        id: 'late-call',
        time: '00:40',
        stage: 'boarding',
        verdict: 'late',
        safety: -2,
        loyalty: 1,
        reactionSec: 0.2,
      },
      {
        id: 'wrong',
        time: '00:50',
        stage: 'enroute',
        verdict: 'incorrect',
        safety: -5,
        loyalty: -1,
      },
      {
        id: 'skip',
        time: '01:00',
        stage: 'stop',
        verdict: 'missed',
        safety: -3,
        loyalty: -2,
      },
    ],
    checks: [
      {
        id: 'pressure-panel',
        detected: true,
        reportRequired: true,
        reported: true,
        actionCorrect: true,
        consequenceRolled: false,
      },
    ],
  };
}

describe('отчёт симуляции', () => {
  it('мапит вердикты, стадии и реакцию в RunSummary', () => {
    expect(mapVerdict('correct')).toBe('best');
    expect(mapVerdict('late')).toBe('ok');
    expect(mapVerdict('incorrect')).toBe('worse');
    expect(mapVerdict('missed')).toBe('missed');
    expect(mapStage('ride')).toBe('enroute');
    expect(mapStage('boarding')).toBe('boarding');

    const summary = reportToSummary(report());
    expect(summary.outcome).toBe('completed');
    expect(summary.loyalty).toBe(87);
    expect(summary.safety).toBe(89);
    expect(summary.timeouts).toBe(1);
    expect(summary.reactionAvgMs).toBe(Math.round((12_000 + 200) / 2));
    expect(summary.competencyDelta).toEqual({});
    expect(summary.facts).toEqual({ prevented: 1, incidents: 0, complaints: 0, interventions: 0 });
    expect(summary.decisions.map((decision) => decision.verdict)).toEqual([
      'best',
      'ok',
      'worse',
      'missed',
    ]);
    expect(summary.decisions.map((decision) => decision.stage)).toEqual([
      'enroute',
      'boarding',
      'enroute',
      'stop',
    ]);
    expect(summary.decisions[0]).toMatchObject({
      scenarioId: 'pressure',
      choiceId: 'report-panel',
      reactionMs: 12_000,
      loyaltyDelta: 2,
      safetyDelta: 1,
    });
    expect(summary.decisions[1]?.reactionMs).toBe(200);
    expect(summary.decisions[2]?.reactionMs).toBeNull();
    expect(summary.politeness).toBe(politenessOf(87, summary.decisions, []));
  });

  it('клампит шкалы', () => {
    const source = report();
    source.safety = 140;
    source.loyalty = -5;
    const summary = reportToSummary(source);
    expect(summary.safety).toBe(100);
    expect(summary.loyalty).toBe(0);
  });
});
