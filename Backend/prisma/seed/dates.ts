const MOSCOW = 'Europe/Moscow';

export function moscowYmd(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map((part) => Number(part));
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return utc.toISOString().slice(0, 10);
}

export function atMoscow(ymd: string, hour: number, minute: number): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${ymd}T${hh}:${mm}:00+03:00`);
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/**
 * Шесть подряд московских суток, последняя — час назад.
 * День перед серией пустой: серия становится ровно 6, не длиннее.
 */
export function demoInstants(now: Date, total: number): Date[] {
  if (total < 10 || total > 40) {
    throw new Error(`Число рейсов demo вне 10..40: ${total}`);
  }
  const anchor = new Date(now.getTime() - 60 * 60 * 1000);
  const endDay = moscowYmd(anchor);
  const tail = streakInstants(endDay, anchor);
  const early = earlyInstants(endDay, total - tail.length);
  const all = early.concat(tail);
  all.sort((left, right) => left.getTime() - right.getTime());
  return all;
}

function streakInstants(endDay: string, anchor: Date): Date[] {
  const instants: Date[] = [];
  for (let back = 5; back >= 0; back -= 1) {
    const ymd = addDays(endDay, -back);
    if (back === 0) {
      instants.push(anchor);
      continue;
    }
    instants.push(atMoscow(ymd, 11, 10 + back));
  }
  return instants;
}

function earlyInstants(endDay: string, count: number): Date[] {
  const pool = eachDay(addDays(endDay, -41), addDays(endDay, -8)).filter(
    (_ymd, index) => index % 6 !== 5,
  );
  if (count > pool.length) {
    throw new Error('Не хватает дней для ранней истории demo');
  }
  const instants: Date[] = [];
  const used = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    let slot = Math.floor((index * pool.length) / count);
    while (used.has(slot) && slot < pool.length) {
      slot += 1;
    }
    used.add(slot);
    const ymd = pool[slot];
    if (!ymd) {
      throw new Error('Слот даты demo пуст');
    }
    instants.push(atMoscow(ymd, 8 + (index % 8), (index * 7) % 50));
  }
  return instants;
}

/** 4–6 недель назад, равномерно, чтобы дыры были короче срока баллов. */
export function spreadInstants(
  pickDay: (days: readonly string[]) => string,
  pickHour: () => number,
  pickMinute: () => number,
  count: number,
  now: Date,
  spanDays: number,
): Date[] {
  const anchor = new Date(now.getTime() - 60 * 60 * 1000);
  const endDay = moscowYmd(anchor);
  const days = eachDay(addDays(endDay, -spanDays), endDay);
  const instants: Date[] = [];
  for (let index = 0; index < count; index += 1) {
    const ymd = pickDay(days);
    let instant = atMoscow(ymd, pickHour(), pickMinute());
    if (instant.getTime() >= now.getTime()) {
      instant = new Date(now.getTime() - 45 * 60 * 1000);
    }
    instants.push(instant);
  }
  instants.sort((left, right) => left.getTime() - right.getTime());
  return instants;
}
