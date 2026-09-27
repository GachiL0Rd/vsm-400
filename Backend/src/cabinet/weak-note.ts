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
    return `${COMPETENCY_TITLES[competency]} ниже порога ${weakScore}: ${EMPTY_SUBJECT[competency]} в рейсах ещё нет.`;
  }
  if (competency === 'escalation') {
    return escalationText(runIds, decisions);
  }
  const bad = runsMatching(runIds, decisions, competency, isMissOrWorse);
  if (bad === 0) {
    return CLEAN_WEAK[competency](weakScore);
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
    return 'Давление и стоп-кран в последних рейсах без ошибки, но эскалация всё ещё ниже порога.';
  }
  return `В ${bad} из ${runIds.length} последних рейсов давление стало критическим или стоп-кран применён не при опасности.`;
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
  if (runIds.length === 0 || good === 0) {
    return GROWTH_BARE[competency];
  }
  return `Растёт: в ${good} из ${runIds.length} последних рейсов ${GROWTH_HIT[competency]}.`;
}

function detectionGrowth(decisions: readonly TaggedDecision[]): string {
  const found = countDecisions(
    decisions,
    'detection',
    (decision) => decision.verdict === 'best' && decision.stage === 'acceptance',
  );
  if (found === 0) {
    return 'Растёт: журнал приёмки в последних рейсах без пропуска неисправности.';
  }
  const noun = plural(found, [
    'журнал приёмки сдан без пропуска и без ложной отметки',
    'журнала приёмки сданы без пропуска и без ложной отметки',
    'журналов приёмки сдано без пропуска и без ложной отметки',
  ]);
  return `Растёт: ${found} ${noun}.`;
}

function failureSentence(competency: Competency, bad: number, window: number): string {
  const tail = `В ${bad} из ${window} последних рейсов`;
  if (competency === 'detection') {
    return `${tail} журнал приёмки сдан с пропуском неисправности или с ложной отметкой.`;
  }
  if (competency === 'safety') {
    return `${tail} ошибка или пропуск в посадке, пожаре, давлении или стоп-кране.`;
  }
  if (competency === 'procedure') {
    return `${tail} ошибка или пропуск в журнале приёмки или в посадке.`;
  }
  if (competency === 'reaction') {
    return `${tail} пожар не потушен или давление дошло до критического.`;
  }
  return `${tail} запрос пассажира остался без ответа.`;
}

/** Факты, которые двигают компетенцию. См. FACT_COMPETENCIES в finish-facts.ts. */
const EMPTY_SUBJECT: Record<Competency, string> = {
  safety: 'посадки, пожара, давления и стоп-крана',
  procedure: 'журнала приёмки и посадки',
  detection: 'журнала приёмки',
  reaction: 'пожара и давления',
  service: 'запросов пассажира',
  escalation: 'давления и стоп-крана',
};

const CLEAN_WEAK: Record<Exclude<Competency, 'escalation'>, (weakScore: number) => string> = {
  safety: (weakScore) =>
    `Безопасность ниже порога ${weakScore}, в последних рейсах посадка, пожар, давление и стоп-кран без ошибки и без пропуска.`,
  procedure: (weakScore) =>
    `Процедуры ниже порога ${weakScore}, в последних рейсах журнал приёмки и посадка без ошибки и без пропуска.`,
  detection: (weakScore) =>
    `Обнаружение ниже порога ${weakScore}, в последних рейсах журнал приёмки без пропуска неисправности и без ложной отметки.`,
  reaction: (weakScore) =>
    `Реакция ниже порога ${weakScore}, в последних рейсах пожар и давление не пропущены.`,
  service: (weakScore) =>
    `Сервис ниже порога ${weakScore}, в последних рейсах запросы пассажира не остались без ответа.`,
};

const GROWTH_BARE: Record<Exclude<Competency, 'detection'>, string> = {
  safety: 'Растёт: посадка, пожар, давление и стоп-кран по сумме последних рейсов.',
  procedure: 'Растёт: журнал приёмки и посадка по сумме последних рейсов.',
  reaction: 'Растёт: тушение пожара и удержание давления по сумме последних рейсов.',
  service: 'Растёт: запросы пассажира по сумме последних рейсов.',
  escalation: 'Растёт: давление и стоп-кран по сумме последних рейсов.',
};

const GROWTH_HIT: Record<Exclude<Competency, 'detection'>, string> = {
  safety: 'верное решение по посадке, пожару, давлению или стоп-крану',
  procedure: 'верно сдан журнал приёмки или верно решена посадка',
  reaction: 'пожар потушен до критического или давление удержано',
  service: 'запрос пассажира обслужен в срок',
  escalation: 'давление удержано или стоп-кран приведён при опасности',
};

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
