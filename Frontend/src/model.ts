// Модель данных кабинета. Поля Run/Achievement совместимы с API из
// feature/cabinet (Server/src/schemas.ts) и расширены тем, что нужно экранам.

export type CompetencyId =
  | 'safety'
  | 'procedure'
  | 'detection'
  | 'reaction'
  | 'service'
  | 'escalation';

export const COMPETENCIES: readonly { id: CompetencyId; title: string }[] = [
  { id: 'safety', title: 'Безопасность' },
  { id: 'procedure', title: 'Процедуры' },
  { id: 'detection', title: 'Обнаружение' },
  { id: 'reaction', title: 'Реакция' },
  { id: 'service', title: 'Сервис' },
  { id: 'escalation', title: 'Эскалация' },
];

export type Competencies = Record<CompetencyId, number>;

/** Ниже — компетенция считается проседающей. */
export const WEAK_SCORE = 50;

export interface Profile {
  callsign: string;
  position: string;
  brigade: string;
  depot: string;
  level: number;
  points: number;
  levelFrom: number;
  levelTo: number;
  streakDays: number;
  expiring: { points: number; at: string } | null;
  competencies: Competencies;
  /** Изменение за последние 5 рейсов. */
  trend: Competencies;
  /** Почему компетенция проседает — вывод по истории рейсов. */
  weakNote: Partial<Record<CompetencyId, string>>;
}

export interface Stats {
  runs: number;
  completed: number;
  incidents: number;
  terminated: number;
  defectsFound: number;
  missedChecks: number;
  avgReactionSec: number;
  escalationsCorrect: number;
  escalationsTotal: number;
  /** Ошибки, после которых ничего не случилось. В оценке учтены. */
  luckyViolations: number;
}

export type RunOutcome = 'completed' | 'incident' | 'terminated';

export const OUTCOME_TITLES: Record<RunOutcome, string> = {
  completed: 'Без происшествий',
  incident: 'Инцидент',
  terminated: 'Рейс прерван',
};

export type Stage = 'acceptance' | 'boarding' | 'enroute' | 'stop' | 'handover';

export const STAGE_TITLES: Record<Stage, string> = {
  acceptance: 'Приёмка',
  boarding: 'Посадка',
  enroute: 'В пути',
  stop: 'Остановка',
  handover: 'Сдача',
};

export type Verdict = 'best' | 'ok' | 'worse' | 'missed';

export interface Decision {
  id: string;
  /** Игровое время. */
  time: string;
  stage: Stage;
  situation: string;
  action: string;
  verdict: Verdict;
  loyalty: number;
  safety: number;
  reactionSec?: number;
  /** Что случилось дальше в этом рейсе. */
  consequence?: string;
  /** Ошибка без последствий: повезло, но в оценке учтено. */
  lucky?: boolean;
  better?: string;
  basis?: string;
}

export interface Run {
  id: string;
  train: string;
  route: string;
  car: number;
  carClass: string;
  finishedAt: string;
  playMinutes: number;
  outcome: RunOutcome;
  outcomeNote: string;
  loyalty: number;
  safety: number;
  points: number;
  competencyDelta: Partial<Competencies>;
  facts: { prevented: number; incidents: number; complaints: number; interventions: number };
  decisions: Decision[];
}

export interface NextShift {
  train: string;
  from: string;
  /** «из Москвы» */
  fromGenitive: string;
  to: string;
  car: number;
  carClass: string;
  departure: string;
  stops: string[];
  focus: CompetencyId[];
}

export interface Achievement {
  code: string;
  title: string;
  description: string;
  earnedAt: string | null;
  progress?: { value: number; total: number };
}

export type Scope = 'brigade' | 'depot' | 'company';

export interface LeaderRow {
  rank: number;
  callsign: string;
  points: number;
  /** Сдвиг позиции за сутки: + вверх. */
  move: number;
  me?: boolean;
}

export interface Leaderboard {
  season: string;
  endsAt: string;
  total: number;
  rows: LeaderRow[];
}

export type NoticeKind =
  | 'expiring'
  | 'scenario'
  | 'challenge'
  | 'overtaken'
  | 'advice'
  | 'achievement';

export interface Notice {
  id: string;
  kind: NoticeKind;
  title: string;
  text: string;
  at: string;
  unread: boolean;
  link?: string;
}
