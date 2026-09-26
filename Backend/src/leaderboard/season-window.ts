/**
 * Сезоны — календарные недели Europe/Moscow.
 * С 2014 у Москвы нет летнего времени, сдвиг всегда +03:00,
 * поэтому границы считаются сдвигом, а не через ICU.
 */
export const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Понедельник эпохи, неделя 1: 29 декабря 2025 (неделя, в которой 1 января 2026).
 * Неделя 21–27 сентября 2026 получается сезоном 39 — как в демо кабинета.
 */
export const SEASON_EPOCH_MSK = Date.parse('2025-12-29T00:00:00+03:00');

export type SeasonWindow = {
  number: number;
  title: string;
  /** Понедельник 00:00:00.000 МСК. */
  startsAt: Date;
  /** Воскресенье 23:59:59.999 МСК: недели стыкуются без дыры. */
  endsAt: Date;
};

type MoscowDate = {
  year: number;
  month: number;
  day: number;
  /** 0 — воскресенье, как у Date.getUTCDay. */
  weekday: number;
};

function moscowDate(instant: Date): MoscowDate {
  const shifted = new Date(instant.getTime() + MOSCOW_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** Полночь календарной даты МСК. Date.UTC сам переносит день/месяц. */
function moscowMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - MOSCOW_OFFSET_MS);
}

export function seasonWindow(instant: Date): SeasonWindow {
  const date = moscowDate(instant);
  const daysFromMonday = date.weekday === 0 ? 6 : date.weekday - 1;
  const startsAt = moscowMidnight(date.year, date.month, date.day - daysFromMonday);
  const endsAt = new Date(startsAt.getTime() + WEEK_MS - 1);
  const number = Math.floor((startsAt.getTime() - SEASON_EPOCH_MSK) / WEEK_MS) + 1;
  return {
    number,
    title: `Сезон ${number}`,
    startsAt,
    endsAt,
  };
}
