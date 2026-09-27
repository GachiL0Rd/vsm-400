const MOSCOW = 'Europe/Moscow';

/**
 * Номер календарного дня в Москве.
 * Сезон и предупреждения в SPEC считаются по МСК, серия дней — тоже, не по UTC-суткам.
 */
export function moscowDay(date: Date): number {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [year, month, day] = formatted.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error('Не разобрать московскую дату');
  }
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Тот же московский день не растит серию. Дыра больше суток сбрасывает её в 1. */
export function nextStreak(previousDays: number, lastRunAt: Date | null, finishedAt: Date): number {
  if (!lastRunAt) {
    return 1;
  }
  const today = moscowDay(finishedAt);
  const previous = moscowDay(lastRunAt);
  if (today === previous) {
    return Math.max(previousDays, 1);
  }
  if (today === previous + 1) {
    return previousDays + 1;
  }
  return 1;
}
