import { createHash } from 'node:crypto';
import type { CarClass, Competency } from '../engine/schema';

const MOSCOW = 'Europe/Moscow';

const ROUTES = [
  {
    trains: ['701', '703', '705', '707'],
    from: 'Москва',
    to: 'Санкт-Петербург',
    stops: ['Тверь', 'Бологое'],
  },
  {
    trains: ['702', '704', '708', '712'],
    from: 'Санкт-Петербург',
    to: 'Москва',
    stops: ['Бологое', 'Тверь'],
  },
] as const;

const CLASSES: readonly CarClass[] = ['ECONOMY', 'FAMILY', 'BUSINESS', 'FIRST'];

const DEPARTURES = ['06:40', '09:30', '12:15', '15:48', '18:20', '21:05'] as const;

/**
 * Нет формы в справочнике — отдаём название как есть:
 * кабинет ставит его после «из».
 */
const GENITIVE: Record<string, string> = {
  Москва: 'Москвы',
  'Санкт-Петербург': 'Санкт-Петербурга',
  Тверь: 'Твери',
  Бологое: 'Бологого',
};

export const CAR_CLASS_LABEL: Record<CarClass, string> = {
  ECONOMY: 'Эконом',
  FAMILY: 'Семейный',
  BUSINESS: 'Бизнес',
  FIRST: 'Первый',
};

export type RouteDraft = {
  train: string;
  from: string;
  fromGenitive: string;
  to: string;
  stops: string[];
  car: number;
  carClass: CarClass;
  departure: string;
};

export type ForecastShift = Omit<RouteDraft, 'carClass'> & {
  carClass: string;
  focus: Competency[];
};

export function stationGenitive(name: string): string {
  return GENITIVE[name] ?? name;
}

export function carClassLabel(carClass: CarClass): string {
  return CAR_CLASS_LABEL[carClass];
}

export function moscowDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function formatHm(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: MOSCOW,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

export function moscowDateTime(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+03:00`);
}

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return utc.toISOString().slice(0, 10);
}

/**
 * Один digest на userId и московскую дату.
 * Поля читаются из разных четвёрок байт, чтобы вагон не повторял класс.
 */
export function forecastRoute(userId: string, date: string): RouteDraft {
  const digest = createHash('sha256').update(`vsm-shift:${userId}:${date}`).digest();
  const route = ROUTES[take(digest, 0, ROUTES.length)] ?? ROUTES[0];
  const trainNumber = route.trains[take(digest, 4, route.trains.length)] ?? route.trains[0];
  const carClass = CLASSES[take(digest, 12, CLASSES.length)] ?? 'ECONOMY';
  return {
    train: `ВСМ ${trainNumber}`,
    from: route.from,
    fromGenitive: stationGenitive(route.from),
    to: route.to,
    stops: [...route.stops],
    car: 1 + take(digest, 8, 8),
    carClass,
    departure: DEPARTURES[take(digest, 16, DEPARTURES.length)] ?? '09:30',
  };
}

export function forecastShift(
  userId: string,
  date: string,
  focus: readonly Competency[],
): ForecastShift {
  const route = forecastRoute(userId, date);
  return {
    train: route.train,
    from: route.from,
    fromGenitive: route.fromGenitive,
    to: route.to,
    stops: route.stops,
    car: route.car,
    carClass: carClassLabel(route.carClass),
    departure: route.departure,
    focus: [...focus],
  };
}

/** Сегодня, если слот ещё впереди, иначе завтра. Дата кормит forecastRoute. */
export function upcomingShiftDate(userId: string, now: Date): string {
  const today = moscowDate(now);
  const slot = forecastRoute(userId, today).departure;
  if (moscowDateTime(today, slot).getTime() > now.getTime()) {
    return today;
  }
  return addCalendarDays(today, 1);
}

function take(digest: Buffer, offset: number, size: number): number {
  return digest.readUInt32BE(offset) % size;
}
