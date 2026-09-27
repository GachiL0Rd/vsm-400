/**
 * Один запуск крона на реплики: SET NX PX на имя крона и метку окна.
 * Окно — календарный слот МСК, не id процесса. Повтор в том же окне пропускается.
 * Истечение ключа не лечит упавший запуск: следующий слот — новая метка.
 */
export type CronLockClient = {
  set: (
    key: string,
    value: string,
    expiry: 'PX',
    ttlMs: number,
    mode: 'NX',
  ) => Promise<string | null>;
};

export function cronLockKey(name: string, window: string): string {
  return `cron:${name}:${window}`;
}

export function cronWindow(now: Date, grain: 'day' | 'minute'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value;
    return value && value.length > 0 ? value : '00';
  };
  const day = `${pick('year')}-${pick('month')}-${pick('day')}`;
  if (grain === 'day') {
    return day;
  }
  return `${day}T${pick('hour')}:${pick('minute')}`;
}

export async function acquireCronLock(
  redis: CronLockClient,
  name: string,
  window: string,
  ttlMs: number,
): Promise<boolean> {
  const result = await redis.set(cronLockKey(name, window), '1', 'PX', ttlMs, 'NX');
  return result === 'OK';
}
