import type { Competency } from '../generated/prisma/client';

/** Порядок осей кабинета. При равенстве средних тема недели берёт более раннюю. */
export const COMPETENCY_ORDER = [
  'safety',
  'procedure',
  'detection',
  'reaction',
  'service',
  'escalation',
] as const satisfies readonly Competency[];

/** Подписи как в кабинете. Склонение не подставляем: в тексте имя стоит как ярлык. */
export const COMPETENCY_TITLES: Record<Competency, string> = {
  safety: 'Безопасность',
  procedure: 'Процедуры',
  detection: 'Обнаружение',
  reaction: 'Реакция',
  service: 'Сервис',
  escalation: 'Эскалация',
};

export function competencyTitle(id: Competency): string {
  return COMPETENCY_TITLES[id];
}

export function isCompetency(value: unknown): value is Competency {
  return typeof value === 'string' && (COMPETENCY_ORDER as readonly string[]).includes(value);
}
