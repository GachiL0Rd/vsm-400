import type { Competency } from '../engine/schema';
import { COMPETENCY_IDS, COMPETENCY_TITLES } from './competencies';
import type { TaggedDecision } from './decision-tags';

/** Окно экрана «изменение за 5 рейсов». */
export const LAST_RUNS = 5;

/**
 * Сумма competencyDelta за окно, с которой компетенция считается быстро растущей.
 * Ниже порога заметка есть только у просадки.
 */
export const FAST_TREND = 4;

export function buildWeakNotes(input: {
  scores: Record<Competency, number>;
  trend: Record<Competency, number>;
  weakScore: number;
  runIds: readonly string[];
  decisions: readonly TaggedDecision[];
}): Partial<Record<Competency, string>> {
  const notes: Partial<Record<Competency, string>> = {};
  const decisions = input.decisions.filter((decision) => input.runIds.includes(decision.runId));
  for (const competency of COMPETENCY_IDS) {
    const note = noteFor(
      competency,
      input.scores[competency],
      input.trend[competency],
      input.weakScore,
      input.runIds,
      decisions,
    );
    if (note) {
      notes[competency] = note;
    }
  }
  return notes;
}

function noteFor(
  competency: Competency,
  score: number,
  trend: number,
  weakScore: number,
  runIds: readonly string[],
  decisions: readonly TaggedDecision[],
): string | undefined {
  if (score < weakScore) {
    return weakText(competency, weakScore, runIds, decisions);
  }
  if (trend >= FAST_TREND) {
    return growthText(competency, runIds, decisions);
  }
  return undefined;
}

function weakText(
  competency: Competency,
  weakScore: number,
  runIds: readonly string[],
  decisions: readonly TaggedDecision[],
): string {
  const window = runIds.length;
  if (window === 0) {
    return `${COMPETENCY_TITLES[competency]} ниже порога ${weakScore}: рейсов для разбора ещё нет.`;
  }
  if (competency === 'escalation') {
    return escalationText(runIds, decisions);
  }
  const bad = runsMatching(runIds, decisions, competency, isMissOrWorse);
  if (bad === 0) {
    return `${COMPETENCY_TITLES[competency]} ниже порога ${weakScore}, в последних рейсах грубых ошибок по ней нет.`;
  }
  return failureSentence(competency, bad, window);
}

function escalationText(runIds: readonly string[], decisions: readonly TaggedDecision[]): string {
  const bad = runsMatching(
    runIds,
    decisions,
    'escalation',
    (decision) => decision.verdict !== 'best',
  );
  if (bad === 0) {
    return 'Доклады в последних рейсах своевременны, но эскалация всё ещё ниже порога.';
  }
  return `В ${bad} из ${runIds.length} последних рейсов доклад ушёл позже жалобы.`;
}

function growthText(
  competency: Competency,
  runIds: readonly string[],
  decisions: readonly TaggedDecision[],
): string {
  if (competency === 'detection') {
    return detectionGrowth(decisions);
  }
  const good = runsMatching(
    runIds,
    decisions,
    competency,
    (decision) => decision.verdict === 'best',
  );
  const title = COMPETENCY_TITLES[competency];
  if (runIds.length === 0 || good === 0) {
    return `${title} растёт по сумме последних рейсов.`;
  }
  return `Растёт: в ${good} из ${runIds.length} последних рейсов решения по «${title}» были верными.`;
}

function detectionGrowth(decisions: readonly TaggedDecision[]): string {
  const found = countDecisions(
    decisions,
    'detection',
    (decision) => decision.verdict === 'best' && decision.stage === 'acceptance',
  );
  if (found === 0) {
    return 'Растёт: осмотр на приёмке стал находить больше неисправностей.';
  }
  const noun = plural(found, [
    'неисправность найдена',
    'неисправности найдены',
    'неисправностей найдено',
  ]);
  return `Растёт: ${found} ${noun} детальным осмотром на приёмке.`;
}

function failureSentence(competency: Competency, bad: number, window: number): string {
  const tail = `В ${bad} из ${window} последних рейсов`;
  if (competency === 'detection') {
    return `${tail} неисправность на осмотре пропущена.`;
  }
  if (competency === 'safety') {
    return `${tail} по безопасности было ошибочное или пропущенное решение.`;
  }
  if (competency === 'procedure') {
    return `${tail} процедура выполнена с ошибкой или пропущена.`;
  }
  if (competency === 'reaction') {
    return `${tail} реакция запоздала.`;
  }
  return `${tail} сервис разобран с ошибкой.`;
}

function isMissOrWorse(decision: TaggedDecision): boolean {
  return decision.verdict === 'worse' || decision.verdict === 'missed';
}

function runsMatching(
  runIds: readonly string[],
  decisions: readonly TaggedDecision[],
  competency: Competency,
  match: (decision: TaggedDecision) => boolean,
): number {
  let count = 0;
  for (const runId of runIds) {
    if (runHits(runId, decisions, competency, match)) {
      count += 1;
    }
  }
  return count;
}

function runHits(
  runId: string,
  decisions: readonly TaggedDecision[],
  competency: Competency,
  match: (decision: TaggedDecision) => boolean,
): boolean {
  for (const decision of decisions) {
    if (decision.runId !== runId) {
      continue;
    }
    if (!decision.competencies.includes(competency)) {
      continue;
    }
    if (match(decision)) {
      return true;
    }
  }
  return false;
}

function countDecisions(
  decisions: readonly TaggedDecision[],
  competency: Competency,
  match: (decision: TaggedDecision) => boolean,
): number {
  let count = 0;
  for (const decision of decisions) {
    if (!decision.competencies.includes(competency)) {
      continue;
    }
    if (match(decision)) {
      count += 1;
    }
  }
  return count;
}

function plural(count: number, forms: readonly [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return forms[1];
  }
  return forms[2];
}
