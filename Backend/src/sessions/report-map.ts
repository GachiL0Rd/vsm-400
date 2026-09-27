import type { Stage, Verdict } from '../engine/schema';
import { politenessOf } from '../engine/summarize';
import type { JournalEntry, RunSummary } from '../engine/types';
import type { RunReport } from './dto';

/**
 * В отчёте симуляции нет skills. competencyDelta пустой:
 * оси считает прогрессия по своим правилам, коды ачивок из отчёта не читаем.
 * outcomeNote и simulationSeconds в RunSummary не входят.
 */
export function reportToSummary(report: RunReport): RunSummary {
  const decisions = report.decisions.map((decision, index) =>
    toEntry(report.scenarioId, decision, index),
  );
  const loyalty = clamp(report.loyalty);
  const safety = clamp(report.safety);
  return {
    outcome: report.outcome,
    loyalty,
    safety,
    politeness: politenessOf(loyalty, decisions, []),
    timeouts: countMissed(decisions),
    reactionAvgMs: averageReaction(decisions),
    competencyDelta: {},
    decisions,
    facts: {
      prevented: report.facts.prevented,
      incidents: report.facts.incidents,
      complaints: report.facts.complaints,
      interventions: report.facts.interventions,
    },
  };
}

export function mapStage(stage: RunReport['decisions'][number]['stage']): Stage {
  if (stage === 'ride') {
    return 'enroute';
  }
  return stage;
}

export function mapVerdict(verdict: RunReport['decisions'][number]['verdict']): Verdict {
  if (verdict === 'correct') {
    return 'best';
  }
  if (verdict === 'late') {
    return 'ok';
  }
  if (verdict === 'incorrect') {
    return 'worse';
  }
  if (verdict === 'missed') {
    return 'missed';
  }
  return verdict;
}

function toEntry(
  scenarioId: string,
  decision: RunReport['decisions'][number],
  index: number,
): JournalEntry {
  return {
    idx: index,
    gameTime: decision.time,
    stage: mapStage(decision.stage),
    scenarioId,
    nodeId: decision.id,
    choiceId: decision.id,
    situation: decision.situation ?? '',
    action: decision.action ?? '',
    verdict: mapVerdict(decision.verdict),
    loyaltyDelta: decision.loyalty,
    safetyDelta: decision.safety,
    reactionMs: reactionMs(decision.reactionSec),
    timerSec: null,
    consequence: decision.consequence ?? null,
    lucky: decision.lucky ?? false,
    better: decision.better ?? null,
    basis: decision.basis ?? null,
    deviation: false,
  };
}

function reactionMs(reactionSec: number | undefined): number | null {
  if (reactionSec === undefined) {
    return null;
  }
  return Math.round(reactionSec * 1000);
}

export function countMissed(decisions: readonly JournalEntry[]): number {
  let count = 0;
  for (const decision of decisions) {
    if (decision.verdict === 'missed') {
      count += 1;
    }
  }
  return count;
}

export function averageReaction(decisions: readonly JournalEntry[]): number {
  let sum = 0;
  let count = 0;
  for (const decision of decisions) {
    if (decision.reactionMs === null) {
      continue;
    }
    sum += decision.reactionMs;
    count += 1;
  }
  if (count === 0) {
    return 0;
  }
  return Math.round(sum / count);
}

function clamp(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}
