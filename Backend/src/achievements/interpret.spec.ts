import { describe, expect, it } from 'vitest';
import type { AchievementRule } from './achievement.schema';
import { type DecisionView, decisionMatches, evaluateRule, type RunView } from './interpret';
import { loadAchievements } from './load-achievements';

const TIMER_SEC = 15;

function decision(partial: Partial<DecisionView> = {}): DecisionView {
  return {
    idx: 0,
    stage: 'enroute',
    scenarioId: 's',
    category: 'service',
    choiceId: 'ask',
    situation: 'Ситуация',
    verdict: 'ok',
    reactionMs: 1000,
    timerSec: TIMER_SEC,
    safetyDelta: 0,
    loyaltyDelta: 0,
    lucky: false,
    deviation: false,
    ...partial,
  };
}

function run(partial: Partial<RunView> = {}): RunView {
  return {
    outcome: 'completed',
    safety: 70,
    loyalty: 70,
    suspicious: false,
    timeouts: 0,
    facts: { prevented: 0, incidents: 0, complaints: 0, interventions: 0 },
    decisions: [],
    ...partial,
  };
}

function times(count: number, make: (index: number) => DecisionView): DecisionView[] {
  const decisions: DecisionView[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = make(index);
    item.idx = index;
    decisions.push(item);
  }
  return decisions;
}

type Sample = {
  runs: RunView[];
  streakDays: number;
  progress: number;
  earned: boolean;
};

const pass: Record<string, Sample> = {
  'before-boarding': {
    runs: [
      run({
        decisions: [
          decision({
            stage: 'acceptance',
            verdict: 'best',
            choiceId: 'journal-submission',
            category: null,
          }),
        ],
      }),
    ],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  'before-complaint': {
    runs: [
      run({
        decisions: [decision({ verdict: 'best', choiceId: 'service-request', category: null })],
      }),
    ],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  'clean-sweep': {
    runs: [run({ decisions: [decision()] })],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  'cold-head': {
    runs: [
      run({
        decisions: times(5, () =>
          decision({ choiceId: 'fire', verdict: 'best', timerSec: null, category: null }),
        ),
      }),
    ],
    streakDays: 0,
    progress: 5,
    earned: true,
  },
  streak: { runs: [], streakDays: 7, progress: 7, earned: true },
  pressure: {
    runs: [
      run({
        decisions: [
          decision({
            choiceId: 'pressure',
            verdict: 'best',
            situation: 'Отклонение давления',
            timerSec: null,
          }),
        ],
      }),
    ],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  detail: {
    runs: [
      run({
        decisions: times(5, () =>
          decision({ stage: 'acceptance', verdict: 'best', choiceId: 'journal-submission' }),
        ),
      }),
    ],
    streakDays: 0,
    progress: 5,
    earned: true,
  },
  'three-calls': {
    runs: [
      run({
        decisions: times(3, () => decision({ verdict: 'best', choiceId: 'service-request' })),
      }),
    ],
    streakDays: 0,
    progress: 3,
    earned: true,
  },
  'no-delay': {
    runs: [run({ decisions: [decision()] })],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  'steady-hand': {
    runs: [run({ safety: 80 })],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  'report-in-time': {
    runs: [
      run({
        decisions: times(3, () =>
          decision({ choiceId: 'emergency-brake', verdict: 'best', timerSec: null }),
        ),
      }),
    ],
    streakDays: 0,
    progress: 3,
    earned: true,
  },
  prevented: {
    runs: [run({ facts: { prevented: 2, incidents: 0, complaints: 0, interventions: 0 } })],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
};

const fail: Record<string, Sample> = {
  'before-boarding': {
    runs: [
      run({
        decisions: [
          decision({ stage: 'boarding', verdict: 'best', choiceId: 'journal-submission' }),
        ],
      }),
    ],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  'before-complaint': {
    runs: [
      run({
        facts: { prevented: 0, incidents: 0, complaints: 1, interventions: 0 },
        decisions: [decision({ verdict: 'best', choiceId: 'service-request' })],
      }),
    ],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  'clean-sweep': {
    runs: [run({ decisions: [decision({ verdict: 'missed' })] })],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  'cold-head': {
    runs: [
      run({
        decisions: times(4, () => decision({ choiceId: 'pressure', verdict: 'best' })),
      }),
    ],
    streakDays: 0,
    progress: 4,
    earned: false,
  },
  streak: { runs: [], streakDays: 6, progress: 6, earned: false },
  pressure: {
    runs: [
      run({
        decisions: [decision({ choiceId: 'pressure', verdict: 'missed' })],
      }),
    ],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  detail: {
    runs: [
      run({
        decisions: times(2, () =>
          decision({ stage: 'acceptance', verdict: 'best', choiceId: 'journal-submission' }),
        ),
      }),
    ],
    streakDays: 0,
    progress: 2,
    earned: false,
  },
  'three-calls': {
    runs: [
      run({
        decisions: times(2, () => decision({ verdict: 'best', choiceId: 'service-request' })),
      }),
    ],
    streakDays: 0,
    progress: 2,
    earned: false,
  },
  'no-delay': {
    runs: [run({ timeouts: 1, decisions: [decision({ choiceId: 'timeout', verdict: 'missed' })] })],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  'steady-hand': {
    runs: [run({ safety: 79 })],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  'report-in-time': {
    runs: [
      run({
        decisions: times(2, () => decision({ choiceId: 'emergency-brake', verdict: 'best' })),
      }),
    ],
    streakDays: 0,
    progress: 2,
    earned: false,
  },
  prevented: {
    runs: [run({ facts: { prevented: 1, incidents: 0, complaints: 0, interventions: 0 } })],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
};

const TITLES: Record<string, string> = {
  'before-boarding': 'Журнал без ошибки',
  'before-complaint': 'Запрос в срок',
  'clean-sweep': 'Чистый рейс',
  'cold-head': 'Пять угроз',
  streak: 'Неделя в строю',
  pressure: 'Давление удержано',
  detail: 'Пять журналов',
  'three-calls': 'Три запроса',
  'no-delay': 'Рейс с решением',
  'steady-hand': 'Держать порог',
  'report-in-time': 'Стоп-кран по делу',
  prevented: 'Оба под контролем',
};

describe('achievements.yaml', () => {
  const file = loadAchievements();

  it('держит тексты кабинета и условия по фактам игры', () => {
    for (const [code, title] of Object.entries(TITLES)) {
      expect(file.achievements.find((entry) => entry.code === code)?.title).toBe(title);
    }
    const cold = file.achievements.find((entry) => entry.code === 'cold-head');
    expect(cold?.rule.type).toBe('count');
    if (cold?.rule.type === 'count') {
      expect(cold.rule.where.choices).toEqual(['fire', 'pressure', 'emergency-brake']);
      expect(cold.rule.where.withinHalfTimer).toBeUndefined();
      expect(cold.rule.total).toBe(5);
    }
    const calls = file.achievements.find((entry) => entry.code === 'three-calls');
    expect(calls?.rule.type).toBe('count');
    const held = file.achievements.find((entry) => entry.code === 'prevented');
    expect(held?.rule.type === 'condition' && held.rule.where.preventedMin).toBe(2);
    expect(file.achievements.find((entry) => entry.code === 'streak')?.rule).toMatchObject({
      type: 'streak',
      total: 7,
    });
    for (const code of ['first-aid', 'rare', 'handover', 'seal']) {
      expect(file.achievements.find((entry) => entry.code === code)).toBeUndefined();
    }
  });

  it('Холодная голова считает пожар, давление и стоп-кран, не журнал', () => {
    const cold = file.achievements.find((entry) => entry.code === 'cold-head');
    if (cold?.rule.type !== 'count') {
      throw new Error('cold-head');
    }
    const hazards = times(5, (index) =>
      decision({
        choiceId: index % 2 === 0 ? 'fire' : 'emergency-brake',
        verdict: 'best',
        timerSec: null,
      }),
    );
    const journals = times(5, () =>
      decision({ choiceId: 'journal-submission', verdict: 'best', stage: 'acceptance' }),
    );
    expect(evaluateRule(cold.rule, [run({ decisions: hazards })], 0)).toEqual({
      progress: 5,
      earned: true,
    });
    expect(evaluateRule(cold.rule, [run({ decisions: journals })], 0)).toEqual({
      progress: 0,
      earned: false,
    });
  });

  it('withinHalfTimer требует timerSec и реакцию не длиннее половины', () => {
    const where = { verdict: 'best' as const, withinHalfTimer: true as const };
    expect(
      decisionMatches(decision({ verdict: 'best', reactionMs: 4_000, timerSec: 10 }), where),
    ).toBe(true);
    expect(
      decisionMatches(decision({ verdict: 'best', reactionMs: 6_000, timerSec: 10 }), where),
    ).toBe(false);
    expect(
      decisionMatches(decision({ verdict: 'best', reactionMs: 1_000, timerSec: null }), where),
    ).toBe(false);
  });

  it('у каждого кода есть проход и отказ', () => {
    const codes = file.achievements.map((entry) => entry.code).sort();
    expect(Object.keys(pass).sort()).toEqual(codes);
    expect(Object.keys(fail).sort()).toEqual(codes);
  });

  it.each(file.achievements)('$code срабатывает на своём примере и молчит на соседнем', (entry) => {
    const rule = entry.rule as AchievementRule;
    const good = pass[entry.code];
    const bad = fail[entry.code];
    if (!good || !bad) {
      throw new Error(`нет примера для ${entry.code}`);
    }
    expect(evaluateRule(rule, good.runs, good.streakDays)).toEqual({
      progress: good.progress,
      earned: good.earned,
    });
    expect(evaluateRule(rule, bad.runs, bad.streakDays)).toEqual({
      progress: bad.progress,
      earned: bad.earned,
    });
  });
});
