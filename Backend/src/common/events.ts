import type { RunOutcome } from '../engine/schema';
import type { RunSummary } from '../engine/types';
import type { Grade } from '../generated/prisma/client';

/** Доменное событие завершения рейса. Подписчики фазы прогрессии слушают это имя. */
export const RUN_COMPLETED = 'run.completed' as const;

export type RunCompletedPayload = {
  runId: string;
  userId: string;
  sessionId: string;
  summary: RunSummary;
  suspicious: boolean;
};

/** Рейс уже записан в леджер. Рейтинг и уведомления слушают это, а не сырой run.completed. */
export const RUN_RECORDED = 'run.recorded' as const;

export type RunRecordedPayload = {
  runId: string;
  userId: string;
  /** null, если учётку ещё не привязали к бригаде — в рейтинг бригады такое не идёт. */
  brigadeId: string | null;
  depotId: string | null;
  points: number;
  outcome: RunOutcome;
  suspicious: boolean;
};

export const ACHIEVEMENT_GRANTED = 'achievement.granted' as const;

export type AchievementGrantedPayload = {
  userId: string;
  code: string;
  title: string;
  bonusPoints: number;
};

export const PROMOTION_RECOMMENDED = 'promotion.recommended' as const;

export type PromotionRecommendedPayload = {
  recommendationId: string;
  userId: string;
  fromGrade: Grade;
  toGrade: Grade;
};

export const ASSIGNMENT_CREATED = 'assignment.created' as const;

export type AssignmentCreatedPayload = {
  assignmentId: string;
  userId: string;
  /** null, если назначение создала не учётка. */
  assignedById: string | null;
  scenarioIds: string[];
};

/** Новая версия сценария стала опубликованной. */
export const SCENARIO_PUBLISHED = 'scenario.published' as const;

export type ScenarioPublishedPayload = {
  scenarioId: string;
  version: number;
};
