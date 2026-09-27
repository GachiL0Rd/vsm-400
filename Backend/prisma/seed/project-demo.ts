import { evaluateRule, type RunView } from '../../src/achievements/interpret';
import { nextStreak } from '../../src/progression/streak';
import type { PlayContext } from './content';
import { demoInstants } from './dates';
import { childSeed, MASTER_SEED } from './master';
import { type SimulatedRun, simulateRun } from './play';

const SKILLS = [0.18, 0.32, 0.46, 0.58, 0.72, 0.86] as const;
const COUNTS = [10, 12, 14, 16, 18, 22, 26, 32] as const;
const TARGET = 2340;

export type DemoPlan = {
  runs: SimulatedRun[];
  total: number;
  skill: number;
};

type Candidate = DemoPlan;

/** Подбирает число рейсов и профиль, чтобы пожизненные очки попали на уровень 7. */
export function planDemo(now: Date, ctx: PlayContext): DemoPlan {
  let best: Candidate | null = null;
  for (const skill of SKILLS) {
    for (const count of COUNTS) {
      best = closer(best, project(now, ctx, skill, count));
    }
  }
  if (!best || best.total < 2000 || best.total >= 3000) {
    throw new Error(`План demo не попал в уровень 7: ${best?.total ?? 'нет кандидата'}`);
  }
  return best;
}

function project(now: Date, ctx: PlayContext, skill: number, count: number): Candidate {
  const dates = demoInstants(now, count);
  const runs: SimulatedRun[] = [];
  for (let index = 0; index < dates.length; index += 1) {
    const finishedAt = dates[index];
    if (!finishedAt) {
      throw new Error('Пустая дата demo');
    }
    const seed = childSeed(MASTER_SEED, `demo:${skill}:${count}:${index}`);
    runs.push(simulateRun(seed, skill, finishedAt, ctx));
  }
  return { runs, total: lifetimeOf(runs, ctx), skill };
}

function lifetimeOf(runs: readonly SimulatedRun[], ctx: PlayContext): number {
  let points = 0;
  let streak = 0;
  let last: Date | null = null;
  const views: RunView[] = [];
  const earned = new Set<string>();
  for (const run of runs) {
    streak = nextStreak(streak, last, run.finishedAt);
    last = run.finishedAt;
    points += run.points;
    views.push(run.view);
    points += freshBonus(ctx, views, streak, earned);
  }
  return points;
}

function freshBonus(
  ctx: PlayContext,
  views: readonly RunView[],
  streak: number,
  earned: Set<string>,
): number {
  let bonus = 0;
  for (const entry of ctx.achievements) {
    if (earned.has(entry.code)) {
      continue;
    }
    const state = evaluateRule(entry.rule, views, streak);
    if (!state.earned) {
      continue;
    }
    earned.add(entry.code);
    bonus += entry.bonusPoints;
  }
  return bonus;
}

function closer(current: Candidate | null, next: Candidate): Candidate {
  if (!current) {
    return next;
  }
  const currentOk = inBand(current.total);
  const nextOk = inBand(next.total);
  if (nextOk !== currentOk) {
    return nextOk ? next : current;
  }
  if (Math.abs(next.total - TARGET) < Math.abs(current.total - TARGET)) {
    return next;
  }
  return current;
}

function inBand(total: number): boolean {
  return total >= 2000 && total < 3000;
}
