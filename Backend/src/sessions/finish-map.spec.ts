import { describe, expect, it } from 'vitest';
import { politenessOf } from '../engine/summarize';
import { type FinishAssessment, finishToSummary } from './finish-map';

function assessment(
  termination: FinishAssessment['termination'],
  scores: FinishAssessment['scores'] = { safety: 96.4, customerSatisfaction: 83.5 },
): FinishAssessment {
  return { termination, scores };
}

describe('finishToSummary', () => {
  it('округляет шкалы после clamp и считает вежливость по пустому журналу', () => {
    const summary = finishToSummary(
      assessment({ kind: 'route-completed', outcomeId: 'destination-arrived' }),
    );
    expect(summary.safety).toBe(96);
    expect(summary.loyalty).toBe(84);
    expect(summary.politeness).toBe(politenessOf(84, [], []));
    expect(summary.timeouts).toBe(0);
    expect(summary.reactionAvgMs).toBe(0);
    expect(summary.competencyDelta).toEqual({});
    expect(summary.decisions).toEqual([]);
    expect(summary.facts).toEqual({
      prevented: 0,
      incidents: 0,
      complaints: 0,
      interventions: 0,
    });
  });

  it('clamp режет выход за 0..100 до округления, нечисло становится 0', () => {
    expect(
      finishToSummary(
        assessment(
          { kind: 'route-completed', outcomeId: 'x' },
          { safety: -4, customerSatisfaction: 140.2 },
        ),
      ).safety,
    ).toBe(0);
    expect(
      finishToSummary(
        assessment(
          { kind: 'route-completed', outcomeId: 'x' },
          { safety: 1, customerSatisfaction: 140.2 },
        ),
      ).loyalty,
    ).toBe(100);
    expect(
      finishToSummary(
        assessment(
          { kind: 'route-completed', outcomeId: 'x' },
          { safety: 99.5, customerSatisfaction: 0 },
        ),
      ).safety,
    ).toBe(100);
    expect(
      finishToSummary(
        assessment(
          { kind: 'route-completed', outcomeId: 'x' },
          { safety: Number.NaN, customerSatisfaction: Number.POSITIVE_INFINITY },
        ),
      ),
    ).toMatchObject({ safety: 0, loyalty: 0 });
  });

  it('route-completed всегда completed, даже если outcomeId прерывания', () => {
    const summary = finishToSummary(
      assessment({ kind: 'route-completed', outcomeId: 'route-safely-interrupted' }),
    );
    expect(summary.outcome).toBe('completed');
    expect(summary.facts.incidents).toBe(0);
    expect(summary.facts.interventions).toBe(1);
  });

  it('безопасное прерывание при шкале не ниже порога — completed и одно вмешательство', () => {
    const summary = finishToSummary(
      assessment({ kind: 'terminal-rule', outcomeId: 'route-safely-interrupted' }),
    );
    expect(summary.outcome).toBe('completed');
    expect(summary.facts).toMatchObject({ incidents: 0, interventions: 1 });
  });

  it('safety после округления ниже 30 — terminated при любом завершении', () => {
    const low = { safety: 29.4, customerSatisfaction: 80 };
    const onThreshold = { safety: 29.5, customerSatisfaction: 80 };
    const stopped = finishToSummary(
      assessment({ kind: 'terminal-rule', outcomeId: 'route-safely-interrupted' }, low),
    );
    expect(stopped.safety).toBe(29);
    expect(stopped.outcome).toBe('terminated');
    expect(stopped.facts).toMatchObject({ incidents: 0, interventions: 1 });

    const arrived = finishToSummary(
      assessment({ kind: 'route-completed', outcomeId: 'destination-arrived' }, low),
    );
    expect(arrived.outcome).toBe('terminated');
    expect(arrived.facts.incidents).toBe(0);

    const wrecked = finishToSummary(
      assessment({ kind: 'terminal-rule', outcomeId: 'wagon-unserviceable' }, low),
    );
    expect(wrecked.outcome).toBe('terminated');
    expect(wrecked.facts).toMatchObject({ incidents: 0, interventions: 0 });

    const held = finishToSummary(
      assessment({ kind: 'terminal-rule', outcomeId: 'wagon-unserviceable' }, onThreshold),
    );
    expect(held.safety).toBe(30);
    expect(held.outcome).toBe('incident');
    expect(held.facts.incidents).toBe(1);
  });

  it('прочие terminal-rule, включая неизвестный id, — incident', () => {
    for (const outcomeId of ['wagon-unserviceable', 'wagon-unsalvageable', 'unknown-rule']) {
      const summary = finishToSummary(assessment({ kind: 'terminal-rule', outcomeId }));
      expect(summary.outcome, outcomeId).toBe('incident');
      expect(summary.facts.incidents, outcomeId).toBe(1);
      expect(summary.facts.interventions, outcomeId).toBe(0);
    }
  });
});
