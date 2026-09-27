import { formatClock } from '../engine/clock';
import type { Competency, Stage, Verdict } from '../engine/schema';
import { addSkills } from '../engine/skills';
import type { JournalEntry, RunSummary } from '../engine/types';
import type { FinishedGameResult } from './platform.dto';
import { averageReaction, countMissed, mapVerdict } from './report-map';

export type GameAssessment = NonNullable<FinishedGameResult['assessment']>;

type Fact = GameAssessment['facts'][number];
type Detail = Fact['detail'];

const US_PER_MINUTE = 60_000_000;

/**
 * Компетенции факта Game. Величина как порядок навыков в YAML сценариев:
 * best +2, ok +1, worse −1, missed −2. addSkills суммирует без потолка:
 * у движка отдельного clamp навыков нет.
 */
const FACT_COMPETENCIES: Record<string, readonly Competency[]> = {
  'journal-submission': ['procedure', 'detection'],
  'boarding-decision': ['procedure', 'safety'],
  'service-request': ['service'],
  fire: ['safety', 'reaction'],
  pressure: ['safety', 'reaction', 'escalation'],
  'emergency-brake': ['safety', 'escalation'],
};

const SKILL_BY_VERDICT: Record<Verdict, number> = {
  best: 2,
  ok: 1,
  worse: -1,
  missed: -2,
};

const INCORRECT_HINT: Record<string, string> = {
  'journal-submission': 'Отмечать неисправность только после проверки оборудования',
  'service-request': 'Выполнять тот запрос, который поступил',
  fire: 'Тушить подтверждённый очаг и не оставлять его',
  pressure: 'Действовать по фактическому давлению',
  'emergency-brake': 'Приводить стоп-кран в действие только при реальной опасности',
};

const MISSED_HINT: Record<string, string> = {
  'journal-submission': 'Вносить в журнал каждую выявленную неисправность',
  'boarding-decision': 'Принять решение о посадке до отправления',
  'service-request': 'Отвечать на запрос пассажира в отведённое время',
  fire: 'Потушить очаг до перехода в критическое состояние',
  pressure: 'Не оставлять критическое давление без действий',
  'emergency-brake': 'При опасности привести стоп-кран в действие',
};

const GENERIC_HINT = 'Сверить действие с порядком на участке';

const TEXT_OF: Record<string, (detail: Detail) => { situation: string; action: string }> = {
  'journal-submission': journalText,
  'boarding-decision': boardingText,
  'service-request': serviceText,
  fire: fireText,
  pressure: pressureText,
  'emergency-brake': brakeText,
};

export type MappedAssessment = {
  timeouts: number;
  reactionAvgMs: number;
  competencyDelta: Partial<Record<Competency, number>>;
  decisions: JournalEntry[];
  facts: RunSummary['facts'];
};

export function mapAssessment(assessment: GameAssessment, scenarioId: string): MappedAssessment {
  const decisions = assessment.facts.map((fact, index) => toEntry(fact, index, scenarioId));
  return {
    timeouts: countMissed(decisions),
    reactionAvgMs: averageReaction(decisions),
    competencyDelta: competencyDelta(assessment.facts),
    decisions,
    facts: factCounts(assessment.facts),
  };
}

function toEntry(fact: Fact, index: number, scenarioId: string): JournalEntry {
  const verdict = mapVerdict(fact.verdict);
  const text = textOf(fact);
  return {
    idx: index,
    gameTime: formatClock(fact.at / US_PER_MINUTE),
    stage: stageOf(fact.kind),
    scenarioId,
    nodeId: fact.id,
    choiceId: fact.kind,
    situation: text.situation,
    action: text.action,
    verdict,
    loyaltyDelta: roundedDelta(fact.scoreDelta.customerSatisfaction),
    safetyDelta: roundedDelta(fact.scoreDelta.safety),
    reactionMs: reactionMs(fact.reactionUs),
    timerSec: null,
    consequence: null,
    lucky: false,
    better: betterOf(fact, verdict),
    basis: null,
    deviation: false,
  };
}

function stageOf(kind: string): Stage {
  if (kind === 'journal-submission') {
    return 'acceptance';
  }
  if (kind === 'boarding-decision') {
    return 'boarding';
  }
  return 'enroute';
}

function textOf(fact: Fact): { situation: string; action: string } {
  const writer = TEXT_OF[fact.kind];
  if (!writer) {
    return { situation: 'Событие рейса', action: 'Факт зафиксирован' };
  }
  return writer(fact.detail);
}

function betterOf(fact: Fact, verdict: Verdict): string | null {
  if (verdict === 'worse') {
    return incorrectHint(fact);
  }
  if (verdict === 'missed') {
    return MISSED_HINT[fact.kind] ?? GENERIC_HINT;
  }
  return null;
}

function incorrectHint(fact: Fact): string {
  if (fact.kind === 'boarding-decision') {
    return boardingIncorrect(fact.detail);
  }
  return INCORRECT_HINT[fact.kind] ?? GENERIC_HINT;
}

function competencyDelta(facts: readonly Fact[]): Partial<Record<Competency, number>> {
  const total: Partial<Record<Competency, number>> = {};
  for (const fact of facts) {
    addSkills(total, skillsOf(fact));
  }
  return total;
}

function skillsOf(fact: Fact): Partial<Record<Competency, number>> {
  const names = FACT_COMPETENCIES[fact.kind];
  if (!names) {
    return {};
  }
  const magnitude = SKILL_BY_VERDICT[mapVerdict(fact.verdict)];
  const skills: Partial<Record<Competency, number>> = {};
  for (const name of names) {
    skills[name] = magnitude;
  }
  return skills;
}

function factCounts(facts: readonly Fact[]): RunSummary['facts'] {
  let incidents = 0;
  let prevented = 0;
  let complaints = 0;
  let interventions = 0;
  for (const fact of facts) {
    if (isCriticalHazard(fact)) {
      incidents += 1;
    }
    if (isPrevented(fact)) {
      prevented += 1;
    }
    if (fact.kind === 'service-request' && fact.verdict === 'missed') {
      complaints += 1;
    }
    if (fact.kind === 'emergency-brake' && fact.detail.activated === true) {
      interventions += 1;
    }
  }
  return { prevented, incidents, complaints, interventions };
}

function isCriticalHazard(fact: Fact): boolean {
  return (fact.kind === 'fire' || fact.kind === 'pressure') && fact.detail.critical === true;
}

function isPrevented(fact: Fact): boolean {
  return (fact.kind === 'fire' || fact.kind === 'pressure') && fact.verdict === 'correct';
}

function journalText(detail: Detail): { situation: string; action: string } {
  return { situation: 'Приёмка: журнал вагона', action: journalAction(detail) };
}

function journalAction(detail: Detail): string {
  if (detail.falseReport === true) {
    return 'Отмечена неисправность без проверки';
  }
  if (detail.missedProblem === true) {
    return 'Реальная неисправность не внесена в журнал';
  }
  if (detail.accepted === true) {
    return 'Журнал принят';
  }
  if (detail.accepted === false) {
    return 'Журнал не принят';
  }
  return 'Запись в журнале проверена';
}

function boardingText(detail: Detail): { situation: string; action: string } {
  const passenger = detailString(detail, 'passengerId');
  const situation = passenger ? `Посадка пассажира ${passenger}` : 'Посадка пассажира';
  const expected = boardingWord(detailString(detail, 'expected'));
  const actual = boardingWord(detailString(detail, 'actual'));
  if (!expected || !actual) {
    return { situation, action: 'Решение о посадке' };
  }
  return { situation, action: `Фактически: ${actual}. Ожидалось: ${expected}` };
}

function boardingIncorrect(detail: Detail): string {
  const expected = detailString(detail, 'expected');
  const actual = detailString(detail, 'actual');
  if (expected === 'reject' && actual === 'admit') {
    return 'Не допускать пассажира без права на посадку';
  }
  if (expected === 'admit' && actual === 'reject') {
    return 'Допускать пассажира, если посадка разрешена';
  }
  return 'Сверить допуск с правилами посадки';
}

function boardingWord(value: string | null): string | null {
  if (value === 'admit') {
    return 'допустить';
  }
  if (value === 'reject') {
    return 'отказать';
  }
  return null;
}

const SERVICE_CLASS: Record<string, string> = {
  basic: 'базовый',
  comfort: 'комфорт',
  business: 'бизнес',
};

function serviceText(detail: Detail): { situation: string; action: string } {
  const serviceClass = detailString(detail, 'serviceClass');
  const label = serviceClass ? SERVICE_CLASS[serviceClass] : undefined;
  const passenger = detailString(detail, 'passengerId');
  const classPart = label ? `, ${label}` : '';
  const who = passenger ? `, пассажир ${passenger}` : '';
  return {
    situation: `Запрос обслуживания${classPart}${who}`,
    action: serviceAction(detail),
  };
}

function serviceAction(detail: Detail): string {
  if (detail.timedOut === true) {
    return 'Запрос не закрыт в срок';
  }
  if (detail.timedOut === false) {
    return 'Запрос обслужен';
  }
  return 'Запрос зафиксирован';
}

function fireText(detail: Detail): { situation: string; action: string } {
  const id = detailString(detail, 'incidentId');
  const base =
    detail.critical === true ? 'Пожар перешёл в критическое состояние' : 'Возгорание в вагоне';
  return {
    situation: id ? `${base}, ${id}` : base,
    action: extinguishedAction(detail),
  };
}

function extinguishedAction(detail: Detail): string {
  if (detail.extinguished === true) {
    return 'Очаг потушен';
  }
  if (detail.extinguished === false) {
    return 'Очаг не потушен';
  }
  return 'Состояние очага не зафиксировано';
}

function pressureText(detail: Detail): { situation: string; action: string } {
  const id = detailString(detail, 'incidentId');
  const critical = detail.critical === true;
  const base = critical ? 'Давление достигло критического уровня' : 'Отклонение давления';
  return {
    situation: id ? `${base}, ${id}` : base,
    action: critical ? 'Давление критическое' : 'Давление вне критического уровня',
  };
}

function brakeText(detail: Detail): { situation: string; action: string } {
  return {
    situation: detail.hazardActive === true ? 'На маршруте активна опасность' : 'Стоп-кран',
    action: brakeAction(detail),
  };
}

function brakeAction(detail: Detail): string {
  if (detail.activated === true) {
    return 'Стоп-кран приведён в действие';
  }
  if (detail.sealRemoved === true) {
    return 'Пломба снята, кран не приведён';
  }
  return 'Стоп-кран не приведён';
}

function detailString(detail: Detail, key: string): string | null {
  const value = detail[key];
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value;
}

function reactionMs(reactionUs: number | undefined): number | null {
  if (reactionUs === undefined || !Number.isFinite(reactionUs)) {
    return null;
  }
  return Math.round(reactionUs / 1000);
}

function roundedDelta(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}
