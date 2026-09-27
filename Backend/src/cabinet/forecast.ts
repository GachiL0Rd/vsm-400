import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { type Routes, RoutesSchema } from '../engine/routes';
import type { CarClass, Competency } from '../engine/schema';
import { contentFile } from '../rules/content-file';

const MOSCOW = 'Europe/Moscow';

/**
 * Нет формы в справочнике — отдаём название как есть:
 * кабинет ставит его после «из».
 */
const GENITIVE: Record<string, string> = {
  Москва: 'Москвы',
  'Санкт-Петербург': 'Санкт-Петербурга',
  Тверь: 'Твери',
  'Вышний Волочёк': 'Вышнего Волочка',
  Бологое: 'Бологого',
  Чудово: 'Чудова',
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
  departureAt: string;
  focus: Competency[];
};

let cachedRoutes: Routes | undefined;

/** Один yaml на процесс: прогноз и назначение не держат второй список рейсов. */
export function shiftRoutes(): Routes {
  if (cachedRoutes) {
    return cachedRoutes;
  }
  const filePath = contentFile('routes.yaml');
  cachedRoutes = RoutesSchema.parse(parse(readFileSync(filePath, 'utf8')));
  return cachedRoutes;
}

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
 * Поля читаются из разных четвёрок байт, чтобы вагон не повторял направление.
 * Класс берётся из вагона в routes.yaml, отдельно его не крутим.
 */
export function forecastRoute(userId: string, date: string): RouteDraft {
  const routes = shiftRoutes();
  const digest = createHash('sha256').update(`vsm-shift:${userId}:${date}`).digest();
  const direction = pick(routes.directions, digest, 0);
  const span = routes.trainNumberMax - routes.trainNumberMin + 1;
  const number = routes.trainNumberMin + take(digest, 4, span);
  const car = pick(routes.cars, digest, 8);
  const departure = pick(routes.departures, digest, 16);
  return {
    train: `${routes.trainPrefix} ${number}`,
    from: direction.from,
    fromGenitive: stationGenitive(direction.from),
    to: direction.to,
    stops: [...direction.stops],
    car: car.car,
    carClass: car.class,
    departure,
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
    departureAt: moscowDateTime(date, route.departure).toISOString(),
    focus: [...focus],
  };
}

/**
 * Сегодня, если слот этого userId ещё впереди, иначе завтра.
 * Дата кормит forecastRoute: прогноз не остаётся на уже прошедшем сегодняшнем слоте.
 */
export function upcomingShiftDate(userId: string, now: Date): string {
  const today = moscowDate(now);
  const slot = forecastRoute(userId, today).departure;
  if (moscowDateTime(today, slot).getTime() > now.getTime()) {
    return today;
  }
  return addCalendarDays(today, 1);
}

/** Следующие сотрудники в одном назначении получают соседние вагоны и их класс из yaml. */
export function carAtOffset(baseCar: number, index: number): { car: number; carClass: CarClass } {
  const cars = shiftRoutes().cars;
  const start = cars.findIndex((item) => item.car === baseCar);
  const origin = start >= 0 ? start : 0;
  const picked = cars[(origin + index) % cars.length];
  if (!picked) {
    throw new Error('в справочнике нет вагонов');
  }
  return { car: picked.car, carClass: picked.class };
}

function pick<T>(items: readonly T[], digest: Buffer, offset: number): T {
  const item = items[take(digest, offset, items.length)];
  if (item === undefined) {
    throw new Error('пустой справочник рейсов');
  }
  return item;
}

function take(digest: Buffer, offset: number, size: number): number {
  return digest.readUInt32BE(offset) % size;
}
