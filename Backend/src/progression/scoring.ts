import type { RunSummary } from '../engine/types';
import type { ScoringParams } from '../rules/rules.schema';

/**
 * В журнале нет длины таймера узла, только reactionMs.
 * 15 с — timer из примера сценария в SPEC §5. От него же половина для «Холодной головы».
 */
export const REFERENCE_TIMER_MS = 15_000;

/**
 * rules.yaml и RulesService не задают k.
 * Дельты навыков в сценарии обычно 1–3: k=8 даёт цель 58–74
 * и упирается в 100 только на длинной серии. Центр 50 — нейтраль шкалы.
 */
export const COMPETENCY_TARGET_K = 8;

export const NEUTRAL_COMPETENCY = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function competencyTarget(delta: number): number {
  return clamp(NEUTRAL_COMPETENCY + delta * COMPETENCY_TARGET_K, 0, 100);
}

/** value_new = value + α·(target − value), target = clamp(50 + delta·k). */
export function ewmaCompetency(previous: number, delta: number, alpha: number): number {
  const base = Number.isFinite(previous) ? previous : NEUTRAL_COMPETENCY;
  const target = competencyTarget(delta);
  return base + alpha * (target - base);
}

/**
 * Доля неиспользованного таймера.
 * Успевшее решение: clamp(1 − reactionMs / 15с, 0, 1). Timeout: 0.
 * Нет ни реакции, ни timeout — бонус за скорость не начисляется.
 */
export function unusedTimerShare(summary: RunSummary): number {
  const parts: number[] = [];
  for (const decision of summary.decisions) {
    if (decision.reactionMs === null) {
      continue;
    }
    const left = 1 - decision.reactionMs / REFERENCE_TIMER_MS;
    parts.push(clamp(left, 0, 1));
  }
  const timeouts = Number.isFinite(summary.timeouts) ? Math.max(0, summary.timeouts) : 0;
  for (let index = 0; index < timeouts; index += 1) {
    parts.push(0);
  }
  if (parts.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const part of parts) {
    sum += part;
  }
  return sum / parts.length;
}

/**
 * Успешный рейс:
 * round((loyalty + safety) / 2 × difficultyMult + speedBonusMax × доля − timeoutPenalty × timeouts).
 * Провал по безопасности (рейс прерван порогом) — фикс failPoints, формула не применяется.
 * Отрицательный итог режется до 0: в леджер не кладём долг за медленный рейс.
 */
export function computePoints(
  summary: RunSummary,
  difficulty: 1 | 2 | 3,
  rules: ScoringParams,
): number {
  if (summary.outcome === 'terminated') {
    return rules.failPoints;
  }
  const base = ((summary.loyalty + summary.safety) / 2) * rules.difficultyMult[difficulty];
  const raw =
    base +
    rules.speedBonusMax * unusedTimerShare(summary) -
    rules.timeoutPenalty * summary.timeouts;
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.round(raw));
}
