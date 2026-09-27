import type { Competency } from '../generated/prisma/client';
import { COMPETENCY_ORDER, isCompetency } from '../notifications/competency-label';

export function lowestAverage(
  rows: readonly { competency: Competency; value: number }[],
): Competency | null {
  const buckets = new Map<Competency, { total: number; count: number }>();
  for (const row of rows) {
    if (!Number.isFinite(row.value)) {
      continue;
    }
    const bucket = buckets.get(row.competency) ?? { total: 0, count: 0 };
    bucket.total += row.value;
    bucket.count += 1;
    buckets.set(row.competency, bucket);
  }
  let best: { competency: Competency; average: number } | null = null;
  for (const competency of COMPETENCY_ORDER) {
    const bucket = buckets.get(competency);
    if (!bucket || bucket.count === 0) {
      continue;
    }
    const average = bucket.total / bucket.count;
    if (!best || average < best.average) {
      best = { competency, average };
    }
  }
  return best?.competency ?? null;
}

export function runMatchesTheme(
  theme: Competency,
  scenarioCompetencies: readonly (readonly Competency[])[],
  delta: unknown,
): boolean {
  for (const list of scenarioCompetencies) {
    if (list.includes(theme)) {
      return true;
    }
  }
  if (!delta || typeof delta !== 'object') {
    return false;
  }
  const value = (delta as Record<string, unknown>)[theme];
  return typeof value === 'number' && Number.isFinite(value);
}

export function readThemeCompetency(meta: unknown): Competency | null {
  if (!meta || typeof meta !== 'object' || !('competency' in meta)) {
    return null;
  }
  const value = (meta as { competency: unknown }).competency;
  return isCompetency(value) ? value : null;
}

const THEME: Record<string, string> = {
  Безопасность: 'посадка, пожар, давление и стоп-кран',
  Процедуры: 'журнал приёмки и решение о посадке',
  Обнаружение: 'журнал приёмки без пропуска и без ложной отметки',
  Реакция: 'тушение пожара до критического и удержание давления',
  Сервис: 'запросы еды и воды в срок',
  Эскалация: 'удержание давления и стоп-кран только при опасности',
};

export function challengeText(title: string): string {
  const theme = THEME[title];
  if (!theme) {
    return `Неделя ${title}. Бригады депо соревнуются до воскресенья.`;
  }
  return `Неделя ${title}: ${theme}. Бригады депо соревнуются до воскресенья.`;
}
