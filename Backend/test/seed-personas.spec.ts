import { describe, expect, it } from 'vitest';
import { loadGameResults } from '../prisma/seed/fixtures';
import { assignPersonas, bandOf, DEMO_LOGINS } from '../prisma/seed/personas';

describe('персонажи демо-сида', () => {
  const fixtures = loadGameResults();
  const plans = assignPersonas(fixtures);

  it('раскладывает фикстуры по пяти проводникам', () => {
    expect(plans.map((plan) => plan.login)).toEqual([...DEMO_LOGINS]);
    expect(plans.map((plan) => plan.fixtureIndexes.length)).toEqual([16, 14, 12, 12, 4]);
    for (const plan of plans) {
      expect(plan.fixtureIndexes.every((index) => fixtures[index] !== undefined)).toBe(true);
      expect(plan.callsign).toMatch(/^[A-Z0-9]{4}$/);
    }
  });

  it('demo1 к концу истории едет чище, чем в начале', () => {
    const demo1 = plans.find((plan) => plan.login === 'demo1');
    expect(demo1).toBeDefined();
    if (!demo1) {
      return;
    }
    const safety = demo1.fixtureIndexes.map((index) => fixtures[index]?.scores.safety ?? 0);
    const early = average(safety.slice(0, 8));
    const late = average(safety.slice(8));
    expect(late).toBeGreaterThan(early);
  });

  it('сильный выше слабого, у новичка мало рейсов', () => {
    const mean = (login: string) => {
      const plan = plans.find((item) => item.login === login);
      const scores = (plan?.fixtureIndexes ?? []).map(
        (index) => fixtures[index]?.scores.safety ?? 0,
      );
      return average(scores);
    };
    expect(mean('demo2')).toBeGreaterThan(mean('demo4'));
    expect(plans.find((plan) => plan.login === 'demo5')?.fixtureIndexes).toHaveLength(4);
  });

  it('покрывает все политики живой игры', () => {
    const used = new Set<string>();
    for (const plan of plans) {
      for (const index of plan.fixtureIndexes) {
        const fixture = fixtures[index];
        if (fixture) {
          used.add(bandOf(fixture));
        }
      }
    }
    expect([...used].sort()).toEqual(
      [
        'careful',
        'false-brake',
        'false-journal',
        'fire-missed',
        'late',
        'missed-fault',
        'pressure-critical',
        'safe-stop',
        'timeout',
        'unsafe-admit',
        'wrong-reject',
      ].sort(),
    );
  });
});

function average(values: readonly number[]): number {
  const sum = values.reduce((total, value) => total + value, 0);
  return values.length === 0 ? 0 : sum / values.length;
}
