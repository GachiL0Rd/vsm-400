import { describe, expect, it } from 'vitest';
import type { AchievementRule } from './achievement.schema';
import { type DecisionView, evaluateRule, type RunView } from './interpret';
import { loadAchievements } from './load-achievements';

const TIMER_SEC = 15;
const HALF = (TIMER_SEC * 1000) / 2;

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
        decisions: [decision({ stage: 'acceptance', verdict: 'best', category: 'technical' })],
      }),
    ],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  'before-complaint': {
    runs: [run({ decisions: [decision({ verdict: 'best', category: 'conflict' })] })],
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
  'first-aid': {
    runs: [
      run({
        decisions: [decision({ category: 'medical', verdict: 'best', safetyDelta: 4 })],
      }),
    ],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  'cold-head': {
    runs: [
      run({
        decisions: times(5, () =>
          decision({ category: 'safety', verdict: 'best', reactionMs: HALF }),
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
          decision({ situation: 'Пассажиру закладывает уши', verdict: 'best', reactionMs: 2000 }),
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
          decision({ stage: 'acceptance', verdict: 'best', choiceId: 'inspect-full' }),
        ),
      }),
    ],
    streakDays: 0,
    progress: 5,
    earned: true,
  },
  'three-calls': {
    runs: [run({ decisions: times(3, () => decision({ verdict: 'best', category: 'service' })) })],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  rare: {
    runs: [run({ decisions: [decision({ deviation: true, verdict: 'best' })] })],
    streakDays: 0,
    progress: 1,
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
  handover: {
    runs: [run({ decisions: [decision({ stage: 'handover', verdict: 'best' })] })],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  'report-in-time': {
    runs: [
      run({
        decisions: times(3, () =>
          decision({ category: 'conflict', verdict: 'best', reactionMs: 1000 }),
        ),
      }),
    ],
    streakDays: 0,
    progress: 3,
    earned: true,
  },
  prevented: {
    runs: [run({ facts: { prevented: 3, incidents: 0, complaints: 0, interventions: 0 } })],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
  seal: {
    runs: [
      run({
        decisions: [
          decision({
            stage: 'acceptance',
            verdict: 'best',
            situation: 'Сорвана пломба огнетушителя',
          }),
        ],
      }),
    ],
    streakDays: 0,
    progress: 1,
    earned: true,
  },
};

const fail: Record<string, Sample> = {
  'before-boarding': {
    runs: [
      run({ decisions: [decision({ stage: 'boarding', verdict: 'best', category: 'technical' })] }),
    ],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  'before-complaint': {
    runs: [
      run({
        facts: { prevented: 0, incidents: 0, complaints: 1, interventions: 0 },
        decisions: [decision({ verdict: 'best', category: 'service' })],
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
  'first-aid': {
    runs: [
      run({ decisions: [decision({ category: 'medical', verdict: 'best', safetyDelta: -1 })] }),
    ],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  'cold-head': {
    runs: [
      run({
        decisions: times(4, () =>
          decision({ category: 'medical', verdict: 'best', reactionMs: 1000 }),
        ),
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
        decisions: [
          decision({ situation: 'Пассажиру закладывает уши', verdict: 'best', reactionMs: 8000 }),
        ],
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
          decision({ stage: 'acceptance', verdict: 'best', choiceId: 'inspect-full' }),
        ),
      }),
    ],
    streakDays: 0,
    progress: 2,
    earned: false,
  },
  'three-calls': {
    runs: [run({ decisions: times(2, () => decision({ verdict: 'best', category: 'service' })) })],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  rare: {
    runs: [run({ decisions: [decision({ deviation: false, verdict: 'best' })] })],
    streakDays: 0,
    progress: 0,
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
  handover: {
    runs: [run({ decisions: [decision({ stage: 'handover', verdict: 'ok' })] })],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  'report-in-time': {
    runs: [
      run({
        decisions: times(2, () =>
          decision({ category: 'conflict', verdict: 'best', reactionMs: 1000 }),
        ),
      }),
    ],
    streakDays: 0,
    progress: 2,
    earned: false,
  },
  prevented: {
    runs: [run({ facts: { prevented: 2, incidents: 0, complaints: 0, interventions: 0 } })],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
  seal: {
    runs: [
      run({
        decisions: [decision({ stage: 'enroute', verdict: 'best', situation: 'Сорвана пломба' })],
      }),
    ],
    streakDays: 0,
    progress: 0,
    earned: false,
  },
};

const DEMO_TITLES: Record<string, string> = {
  'before-boarding': 'До посадки',
  'before-complaint': 'Раньше жалобы',
  'clean-sweep': 'Чистый обход',
  'first-aid': 'Первая помощь',
  'cold-head': 'Холодная голова',
  streak: 'Неделя в строю',
  pressure: 'Уши заложило',
  detail: 'Под лупой',
  'three-calls': 'Три обращения',
  rare: 'Редкий случай',
};

describe('achievements.yaml', () => {
  const file = loadAchievements();

  it('держит тексты демо кабинета и порог половины таймера', () => {
    for (const [code, title] of Object.entries(DEMO_TITLES)) {
      expect(file.achievements.find((entry) => entry.code === code)?.title).toBe(title);
    }
    const cold = file.achievements.find((entry) => entry.code === 'cold-head');
    expect(cold?.rule.type).toBe('count');
    if (cold?.rule.type === 'count') {
      expect(cold.rule.where.withinHalfTimer).toBe(true);
      expect(cold.rule.total).toBe(5);
    }
    expect(file.achievements.find((entry) => entry.code === 'streak')?.rule).toMatchObject({
      type: 'streak',
      total: 7,
    });
    expect(file.achievements.find((entry) => entry.code === 'seal')?.hidden).toBe(true);
  });

  it('Холодная голова сравнивает реакцию с половиной timerSec узла', () => {
    const cold = file.achievements.find((entry) => entry.code === 'cold-head');
    if (cold?.rule.type !== 'count') {
      throw new Error('cold-head');
    }
    const fast = times(5, () =>
      decision({ category: 'safety', verdict: 'best', reactionMs: 4_000, timerSec: 10 }),
    );
    const slow = times(5, () =>
      decision({ category: 'safety', verdict: 'best', reactionMs: 6_000, timerSec: 10 }),
    );
    expect(evaluateRule(cold.rule, [run({ decisions: fast })], 0)).toEqual({
      progress: 5,
      earned: true,
    });
    expect(evaluateRule(cold.rule, [run({ decisions: slow })], 0)).toEqual({
      progress: 0,
      earned: false,
    });
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
