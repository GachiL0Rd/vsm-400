import { describe, expect, it } from 'vitest';
import type { StatDecision } from './stats';
import { summarizeStats } from './stats';

function decision(partial: Partial<StatDecision> & Pick<StatDecision, 'verdict'>): StatDecision {
  return {
    stage: 'enroute',
    competencies: [],
    reactionMs: null,
    lucky: false,
    ...partial,
  };
}

describe('summarizeStats', () => {
  const runs = [
    { outcome: 'completed' as const },
    { outcome: 'completed' as const },
    { outcome: 'incident' as const },
    { outcome: 'terminated' as const },
  ];
  const decisions: StatDecision[] = [
    decision({ verdict: 'best', stage: 'acceptance', competencies: ['procedure'] }),
    decision({ verdict: 'best', stage: 'enroute', competencies: ['detection'] }),
    decision({ verdict: 'best', stage: 'enroute', competencies: ['service'] }),
    decision({ verdict: 'missed', stage: 'acceptance', competencies: ['detection'] }),
    decision({ verdict: 'best', competencies: ['escalation'], reactionMs: 4000 }),
    decision({ verdict: 'worse', competencies: ['escalation'], reactionMs: 11_000, lucky: true }),
    decision({ verdict: 'ok', competencies: ['escalation'] }),
  ];

  const stats = summarizeStats(runs, decisions);

  it('считает исходы, журналы, пропуски, давление со стоп-краном и везение', () => {
    expect(stats).toMatchObject({
      runs: 4,
      completed: 2,
      incidents: 1,
      terminated: 1,
      defectsFound: 2,
      missedChecks: 1,
      escalationsCorrect: 1,
      escalationsTotal: 3,
      luckyViolations: 1,
    });
  });

  it('средняя реакция в секундах с одним знаком', () => {
    expect(stats.avgReactionSec).toBe(7.5);
    expect(summarizeStats([], []).avgReactionSec).toBe(0);
  });
});
