import { describe, expect, it } from 'vitest';
import { politenessOf } from '../engine/summarize';
import type { GameAssessment } from './finish-facts';
import { type FinishAssessment, finishToSummary } from './finish-map';

type Fact = GameAssessment['facts'][number];

function fact(partial: Partial<Fact> & Pick<Fact, 'id' | 'kind' | 'verdict'>): Fact {
  return {
    at: 0,
    scoreDelta: { safety: 0, customerSatisfaction: 0 },
    detail: {},
    ...partial,
  };
}

function fromFacts(
  facts: Fact[],
  patch: Partial<FinishAssessment> = {},
): ReturnType<typeof finishToSummary> {
  return finishToSummary({
    termination: { kind: 'route-completed', outcomeId: 'destination-arrived' },
    scores: { safety: 96.4, customerSatisfaction: 83.5 },
    content: { gameLevelId: 'vsm-baseline-01' },
    assessment: { setVersion: 'baseline-v1', durationUs: 3_600_000_000, facts },
    ...patch,
  });
}

describe('assessment → решения', () => {
  it('не пересчитывает шкалы и оставляет вежливость от пустого журнала', () => {
    const summary = fromFacts([
      fact({
        id: 'fire:cabin',
        kind: 'fire',
        verdict: 'correct',
        scoreDelta: { safety: 40, customerSatisfaction: -20 },
        detail: { extinguished: true, critical: false },
      }),
    ]);
    expect(summary.safety).toBe(96);
    expect(summary.loyalty).toBe(84);
    expect(summary.outcome).toBe('completed');
    expect(summary.politeness).toBe(politenessOf(84, [], []));
  });

  it('safety ниже порога остаётся terminated при любых фактах', () => {
    const summary = fromFacts(
      [
        fact({
          id: 'fire:cabin',
          kind: 'fire',
          verdict: 'correct',
          detail: { extinguished: true, critical: false },
        }),
      ],
      {
        scores: { safety: 20.2, customerSatisfaction: 90 },
      },
    );
    expect(summary.safety).toBe(20);
    expect(summary.outcome).toBe('terminated');
  });

  it('пустой assessment не подставляет счётчики termination', () => {
    const incident = finishToSummary({
      termination: { kind: 'terminal-rule', outcomeId: 'wagon-unserviceable' },
      scores: { safety: 80, customerSatisfaction: 80 },
      content: { gameLevelId: 'vsm-baseline-01' },
      assessment: { setVersion: 'baseline-v1', durationUs: 0, facts: [] },
    });
    expect(incident.outcome).toBe('incident');
    expect(incident.facts).toEqual({
      prevented: 0,
      incidents: 0,
      complaints: 0,
      interventions: 0,
    });

    const stopped = finishToSummary({
      termination: { kind: 'terminal-rule', outcomeId: 'route-safely-interrupted' },
      scores: { safety: 80, customerSatisfaction: 80 },
      assessment: { setVersion: 'baseline-v1', durationUs: 0, facts: [] },
    });
    expect(stopped.outcome).toBe('completed');
    expect(stopped.facts.interventions).toBe(0);
    expect(stopped.decisions).toEqual([]);
  });

  it('кладёт вид, этап, вердикт, дельты и время', () => {
    const summary = fromFacts([
      fact({
        id: 'journal:1',
        kind: 'journal-submission',
        at: 0,
        verdict: 'incorrect',
        scoreDelta: { safety: -1.6, customerSatisfaction: 1.2 },
        detail: { falseReport: true, accepted: false },
      }),
      fact({
        id: 'board:2',
        kind: 'boarding-decision',
        at: 5_400_000_000,
        verdict: 'late',
        reactionUs: 1_500,
        detail: { passengerId: 'passenger-2', expected: 'admit', actual: 'admit' },
      }),
      fact({
        id: 'later-but-first',
        kind: 'custom-signal',
        at: 60_000_000,
        verdict: 'missed',
      }),
    ]);
    expect(summary.decisions.map((entry) => entry.idx)).toEqual([0, 1, 2]);
    expect(summary.decisions[0]).toMatchObject({
      stage: 'acceptance',
      verdict: 'worse',
      scenarioId: 'vsm-baseline-01',
      nodeId: 'journal:1',
      choiceId: 'journal-submission',
      gameTime: '00:00',
      situation: 'Приёмка: журнал вагона',
      action: 'Отмечена неисправность без проверки',
      safetyDelta: -2,
      loyaltyDelta: 1,
      reactionMs: null,
      timerSec: null,
      better: 'Отмечать неисправность только после проверки оборудования',
      basis: null,
      consequence: null,
      lucky: false,
      deviation: false,
    });
    expect(summary.decisions[1]).toMatchObject({
      stage: 'boarding',
      verdict: 'ok',
      gameTime: '01:30',
      situation: 'Посадка пассажира passenger-2',
      action: 'Фактически: допустить. Ожидалось: допустить',
      reactionMs: 2,
      better: null,
    });
    expect(summary.decisions[2]).toMatchObject({
      stage: 'enroute',
      verdict: 'missed',
      gameTime: '00:01',
      situation: 'Событие рейса',
      action: 'Факт зафиксирован',
      choiceId: 'custom-signal',
      better: 'Сверить действие с порядком на участке',
    });
    expect(summary.competencyDelta).toEqual({
      procedure: 0,
      detection: -1,
      safety: 1,
    });
    expect(summary.timeouts).toBe(1);
    expect(summary.reactionAvgMs).toBe(2);
  });

  it('режет дробную минуту и замыкает сутки', () => {
    const summary = fromFacts([
      fact({ id: 'a', kind: 'fire', verdict: 'correct', at: 90_000_000, detail: {} }),
      fact({
        id: 'b',
        kind: 'fire',
        verdict: 'correct',
        at: 86_400_000_000,
        detail: {},
      }),
    ]);
    expect(summary.decisions.map((entry) => entry.gameTime)).toEqual(['00:01', '00:00']);
  });

  it('без content.gameLevelId scenarioId пустой, реакция 0 входит в среднее', () => {
    const summary = finishToSummary({
      termination: { kind: 'route-completed', outcomeId: 'destination-arrived' },
      scores: { safety: 50, customerSatisfaction: 50 },
      assessment: {
        setVersion: 'baseline-v1',
        durationUs: 0,
        facts: [
          fact({ id: 'a', kind: 'fire', verdict: 'correct', reactionUs: 0, detail: {} }),
          fact({ id: 'b', kind: 'fire', verdict: 'late', reactionUs: 2_000, detail: {} }),
        ],
      },
    });
    expect(summary.decisions[0]?.scenarioId).toBe('');
    expect(summary.decisions[0]?.reactionMs).toBe(0);
    expect(summary.reactionAvgMs).toBe(1);
    expect(summary.timeouts).toBe(0);
  });

  it('считает компетенции по вердикту и суммирует повтор вида', () => {
    const summary = fromFacts([
      fact({
        id: 'j1',
        kind: 'journal-submission',
        verdict: 'correct',
        detail: { accepted: true },
      }),
      fact({
        id: 'j2',
        kind: 'journal-submission',
        verdict: 'missed',
        detail: { missedProblem: true },
      }),
      fact({
        id: 'p',
        kind: 'pressure',
        verdict: 'incorrect',
        detail: { incidentId: 'salon', critical: false },
      }),
      fact({ id: 's', kind: 'service-request', verdict: 'late', detail: { timedOut: false } }),
      fact({ id: 'u', kind: 'weather', verdict: 'correct', detail: {} }),
    ]);
    expect(summary.decisions[1]).toMatchObject({
      action: 'Реальная неисправность не внесена в журнал',
      better: 'Вносить в журнал каждую выявленную неисправность',
      verdict: 'missed',
    });
    expect(summary.decisions[2]).toMatchObject({
      situation: 'Отклонение давления, salon',
      action: 'Давление вне критического уровня',
      better: 'Действовать по фактическому давлению',
    });
    expect(summary.decisions[3]).toMatchObject({
      situation: 'Запрос обслуживания',
      action: 'Запрос обслужен',
      better: null,
      stage: 'enroute',
    });
    expect(summary.competencyDelta).toEqual({
      procedure: 0,
      detection: 0,
      safety: -1,
      reaction: -1,
      escalation: -1,
      service: 1,
    });
  });

  it('даёт тексты и подсказки по каждому известному виду', () => {
    const summary = fromFacts([
      fact({
        id: 'board-bad',
        kind: 'boarding-decision',
        verdict: 'incorrect',
        detail: { expected: 'reject', actual: 'admit' },
      }),
      fact({
        id: 'board-miss',
        kind: 'boarding-decision',
        verdict: 'missed',
        detail: {},
      }),
      fact({
        id: 'svc',
        kind: 'service-request',
        verdict: 'missed',
        detail: {
          passengerId: 'passenger-1',
          serviceClass: 'business',
          timedOut: true,
          targetUs: 30_000_000,
        },
      }),
      fact({
        id: 'fire:cabin-fire',
        kind: 'fire',
        verdict: 'missed',
        detail: { incidentId: 'cabin-fire', extinguished: false, critical: true },
      }),
      fact({
        id: 'pressure:1',
        kind: 'pressure',
        verdict: 'missed',
        detail: { incidentId: 'line', critical: true },
      }),
      fact({
        id: 'brake',
        kind: 'emergency-brake',
        verdict: 'incorrect',
        detail: { sealRemoved: true, activated: true, hazardActive: false },
      }),
      fact({
        id: 'brake-miss',
        kind: 'emergency-brake',
        verdict: 'missed',
        detail: { sealRemoved: false, activated: false, hazardActive: true },
      }),
    ]);
    expect(summary.decisions.map((entry) => [entry.action, entry.better])).toEqual([
      ['Фактически: допустить. Ожидалось: отказать', 'Не допускать пассажира без права на посадку'],
      ['Решение о посадке', 'Принять решение о посадке до отправления'],
      ['Запрос не закрыт в срок', 'Отвечать на запрос пассажира в отведённое время'],
      ['Очаг не потушен', 'Потушить очаг до перехода в критическое состояние'],
      ['Давление критическое', 'Не оставлять критическое давление без действий'],
      [
        'Стоп-кран приведён в действие',
        'Приводить стоп-кран в действие только при реальной опасности',
      ],
      ['Стоп-кран не приведён', 'При опасности привести стоп-кран в действие'],
    ]);
    expect(summary.decisions[2]?.situation).toBe(
      'Запрос обслуживания, бизнес, пассажир passenger-1',
    );
    expect(summary.decisions[3]).toMatchObject({
      situation: 'Пожар перешёл в критическое состояние, cabin-fire',
      stage: 'enroute',
    });
    expect(summary.decisions[4]?.situation).toBe('Давление достигло критического уровня, line');
    expect(summary.decisions[5]?.situation).toBe('Стоп-кран');
    expect(summary.decisions[6]?.situation).toBe('На маршруте активна опасность');
  });

  it('отказ при ожидании допуска и пломба без срыва имеют свои тексты', () => {
    const summary = fromFacts([
      fact({
        id: 'board-flip',
        kind: 'boarding-decision',
        verdict: 'incorrect',
        detail: { expected: 'admit', actual: 'reject' },
      }),
      fact({
        id: 'brake-seal',
        kind: 'emergency-brake',
        verdict: 'correct',
        detail: { sealRemoved: true, activated: false, hazardActive: false },
      }),
    ]);
    expect(summary.decisions[0]?.better).toBe('Допускать пассажира, если посадка разрешена');
    expect(summary.decisions[1]).toMatchObject({
      action: 'Пломба снята, кран не приведён',
      better: null,
      verdict: 'best',
    });
  });

  it('собирает incidents, prevented, complaints и interventions только из фактов', () => {
    const summary = fromFacts(
      [
        fact({
          id: 'fire-ok',
          kind: 'fire',
          verdict: 'correct',
          detail: { extinguished: true, critical: false },
        }),
        fact({
          id: 'fire-late',
          kind: 'fire',
          verdict: 'late',
          detail: { critical: true, extinguished: true },
        }),
        fact({
          id: 'fire-word',
          kind: 'fire',
          verdict: 'correct',
          detail: { critical: 'true', extinguished: true },
        }),
        fact({
          id: 'pressure-bad',
          kind: 'pressure',
          verdict: 'incorrect',
          detail: { critical: true },
        }),
        fact({
          id: 'svc-miss',
          kind: 'service-request',
          verdict: 'missed',
          detail: { serviceClass: 'comfort', timedOut: true },
        }),
        fact({
          id: 'svc-wrong',
          kind: 'service-request',
          verdict: 'incorrect',
          detail: { serviceClass: 'basic', timedOut: false },
        }),
        fact({
          id: 'brake-on',
          kind: 'emergency-brake',
          verdict: 'correct',
          detail: { activated: true, hazardActive: true },
        }),
        fact({
          id: 'brake-off',
          kind: 'emergency-brake',
          verdict: 'correct',
          detail: { activated: false },
        }),
      ],
      {
        termination: { kind: 'terminal-rule', outcomeId: 'route-safely-interrupted' },
      },
    );
    expect(summary.outcome).toBe('completed');
    expect(summary.facts).toEqual({
      prevented: 2,
      incidents: 2,
      complaints: 1,
      interventions: 1,
    });
    expect(summary.decisions[5]?.better).toBe('Выполнять тот запрос, который поступил');
    expect(summary.decisions[4]?.situation).toBe('Запрос обслуживания, комфорт');
  });
});
