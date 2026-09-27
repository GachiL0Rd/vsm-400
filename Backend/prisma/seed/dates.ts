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

const HOURS = [7, 8, 10, 12, 14, 16, 18, 20] as const;
const MINUTES = [5, 12, 18, 27, 36, 44, 51] as const;

/**
 * История за spanDays, хвост — streak подряд суток до «сейчас».
 * Часы чередуются: утро, день, вечер, не одна и та же минута.
 */
export function personaInstants(
  now: Date,
  count: number,
  spanDays: number,
  streak: number,
): Date[] {
  if (count < 1 || streak < 0 || streak > count || spanDays < streak) {
    throw new Error(`Плохое расписание: ${count} рейсов, серия ${streak}, окно ${spanDays}`);
  }
  const anchor = new Date(now.getTime() - 45 * 60 * 1000);
  const endDay = moscowYmd(anchor);
  const tail = streakInstants(endDay, anchor, streak);
  const early = earlyInstants(endDay, count - streak, spanDays, streak);
  const all = early.concat(tail);
  all.sort((left, right) => left.getTime() - right.getTime());
  return all.map((instant) =>
    instant.getTime() >= now.getTime() ? new Date(now.getTime() - 20 * 60 * 1000) : instant,
  );
}

function streakInstants(endDay: string, anchor: Date, streak: number): Date[] {
  const instants: Date[] = [];
  for (let back = streak - 1; back >= 1; back -= 1) {
    instants.push(atClock(addDays(endDay, -back), back));
  }
  if (streak > 0) {
    instants.push(anchor);
  }
  return instants;
}

function earlyInstants(endDay: string, count: number, spanDays: number, streak: number): Date[] {
  if (count === 0) {
    return [];
  }
  const pool = eachDay(addDays(endDay, -spanDays), addDays(endDay, -(streak + 1)));
  if (count > pool.length) {
    throw new Error(`Не хватает дней истории: нужно ${count}, есть ${pool.length}`);
  }
  const instants: Date[] = [];
  const used = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    let slot = count === 1 ? 0 : Math.round((index * (pool.length - 1)) / (count - 1));
    while (used.has(slot) && slot < pool.length - 1) {
      slot += 1;
    }
    used.add(slot);
    const ymd = pool[slot];
    if (!ymd) {
      throw new Error('Слот даты пуст');
    }
    instants.push(atClock(ymd, index));
  }
  return instants;
}

function atClock(ymd: string, salt: number): Date {
  const hour = HOURS[Math.abs(salt) % HOURS.length] ?? 9;
  const minute = MINUTES[Math.abs(salt) % MINUTES.length] ?? 10;
  return atMoscow(ymd, hour, minute);
}
