import { describe, expect, it } from 'vitest';
import { catalogOf, loadAchievementEntries, loadGraphs, loadRoutes } from '../prisma/seed/content';
import { simulateRun } from '../prisma/seed/play';
import { planDemo } from '../prisma/seed/project-demo';
import { loadRules } from '../src/rules/rules.service';

const now = new Date('2026-09-01T12:00:00.000Z');
const graphs = loadGraphs();
const ctx = {
  graphs,
  catalog: catalogOf(graphs, new Map()),
  routes: loadRoutes(),
  scoring: loadRules().scoring,
  achievements: loadAchievementEntries(),
};

describe('сводка сида', () => {
  it('один seed даёт один итог и непустой журнал', () => {
    const seed = Buffer.alloc(32, 7);
    const first = simulateRun(seed, 0.6, now, ctx);
    const second = simulateRun(seed, 0.6, now, ctx);
    expect(first.summary).toEqual(second.summary);
    expect(first.summary.decisions.length).toBeGreaterThan(0);
    expect(first.seq).toBe(first.summary.decisions.length);
    expect(first.points).toBeGreaterThanOrEqual(0);
    expect(['completed', 'incident', 'terminated']).toContain(first.summary.outcome);
  });

  it('разный навык меняет долю лучших ходов', () => {
    const seed = Buffer.alloc(32, 9);
    const strong = simulateRun(seed, 0.9, now, ctx);
    const weak = simulateRun(seed, 0.1, now, ctx);
    const share = (verdict: string, run: typeof strong) =>
      run.summary.decisions.filter((decision) => decision.verdict === verdict).length;
    expect(share('best', strong) + share('ok', strong)).toBeGreaterThanOrEqual(
      share('best', weak) + share('ok', weak),
    );
  });

  it('план demo попадает в уровень 7', () => {
    const plan = planDemo(now, ctx);
    expect(plan.runs.length).toBeGreaterThan(0);
    expect(plan.total).toBeGreaterThanOrEqual(2000);
    expect(plan.total).toBeLessThan(3000);
  });
});
