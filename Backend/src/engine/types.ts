import type { CarClass, Competency, RunOutcome, Stage, Verdict } from './schema';

/** Снимок прогона. Меняет его step(), эта фаза только фиксирует форму. */
export type EngineState = {
  scenarioIndex: number;
  scenarioId: string;
  nodeId: string;
  loyalty: number;
  safety: number;
  politeness: number;
  flags: string[];
  skills: Partial<Record<Competency, number>>;
  params: Record<string, number>;
  seq: number;
  timeouts: number;
  journal: JournalEntry[];
  outcome: RunOutcome | null;
};

export type StepInput = { choiceId: string } | 'timeout';

export type JournalEntry = {
  idx: number;
  gameTime: string;
  stage: Stage;
  scenarioId: string;
  nodeId: string;
  choiceId: string;
  situation: string;
  action: string;
  verdict: Verdict;
  loyaltyDelta: number;
  safetyDelta: number;
  reactionMs: number | null;
  /** Длина таймера узла, секунды. null — узел без таймера. */
  timerSec: number | null;
  consequence: string | null;
  lucky: boolean;
  better: string | null;
  basis: string | null;
  deviation: boolean;
};

export type NodeProgress = {
  /** Номер сценария в смене, с 1. */
  index: number;
  total: number;
};

export type RunSummary = {
  outcome: RunOutcome;
  loyalty: number;
  safety: number;
  politeness: number;
  timeouts: number;
  /** Среднее reactionMs по ходам с реакцией. Timeout не входит. */
  reactionAvgMs: number;
  competencyDelta: Partial<Record<Competency, number>>;
  decisions: JournalEntry[];
  facts: {
    prevented: number;
    incidents: number;
    complaints: number;
    interventions: number;
  };
};

/** Текст и доступные выборы. Эффектов, вердикта и better здесь нет. */
export type NodeView = {
  nodeId: string;
  text: string;
  timerSec: number | null;
  choices: { id: string; text: string }[];
  loyalty: number;
  safety: number;
  seq: number;
  finished: boolean;
  progress: NodeProgress;
};

/**
 * План смены. fromStation/toStation/stops рядом с route:
 * в БД это поля ShiftAssignment, в SPEC маршрут назван одним словом.
 */
export type ShiftPlan = {
  train: string;
  route: string;
  fromStation: string;
  toStation: string;
  stops: string[];
  car: number;
  carClass: CarClass;
  /** Время отправления HH:MM. От него считаются часы узлов. */
  departure: string;
  scenarios: {
    scenarioId: string;
    version: number;
    params: Record<string, number>;
  }[];
};
