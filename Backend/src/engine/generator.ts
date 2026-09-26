import { parseClock } from './clock';
import { EngineError } from './errors';
import { PARAM_GAME_TIME_MIN, PARAM_NODE_STEP_MIN, PARAM_SCENARIO_TOTAL } from './params';
import type { Rng } from './rng';
import { type Routes, RoutesSchema } from './routes';
import type { CarClass, Competency, Stage } from './schema';
import type { ShiftPlan } from './types';

export type CatalogEntry = {
  id: string;
  version: number;
  carClasses: readonly CarClass[];
  competencies: readonly Competency[];
  difficulty: number;
  stage: Stage;
  params?: Readonly<Record<string, { min: number; max: number }>>;
};

export type GenerateShiftOptions = {
  carClass?: CarClass;
  focus?: readonly Competency[];
  assigned?: readonly string[];
  count?: number;
};

/** В ShiftPlan нет времени отправления — оно нужно смене и часам узлов. */
export type GeneratedShift = ShiftPlan & {
  departure: string;
};

/**
 * Порядок RNG фиксирован: вагон, направление, отправление, номер поезда,
 * длина смены, пулы сценариев, параметры по порядку узлов и ключей.
 * Одинаковый seed и каталог дают один план.
 */
export function generateShift(
  rng: Rng,
  catalog: readonly CatalogEntry[],
  opts: GenerateShiftOptions | undefined,
  routesInput: unknown,
): GeneratedShift {
  const routes = RoutesSchema.parse(routesInput);
  const options = opts ?? {};
  const picked = chooseCar(rng, routes, options.carClass);
  const direction = rng.pick(routes.directions);
  const departure = rng.pick(routes.departures);
  const number = rng.int(routes.trainNumberMin, routes.trainNumberMax);
  const count = resolveCount(rng, options.count);
  const selected = selectScenarios(rng, catalog, picked.class, options, count);
  const ordered = sortByStage(selected, routes.stageOrder);
  return {
    train: `${routes.trainPrefix} ${number}`,
    route: `${direction.from}${'\u2014'}${direction.to}`,
    fromStation: direction.from,
    toStation: direction.to,
    stops: direction.stops.slice(),
    car: picked.car,
    carClass: picked.class,
    departure,
    scenarios: assignParams(rng, ordered, routes, departure),
  };
}

function chooseCar(
  rng: Rng,
  routes: Routes,
  carClass: CarClass | undefined,
): { car: number; class: CarClass } {
  const pool =
    carClass === undefined ? routes.cars : routes.cars.filter((item) => item.class === carClass);
  if (pool.length === 0) {
    throw new EngineError('CAR_CLASS_EMPTY');
  }
  const picked = rng.pick(pool);
  return { car: picked.car, class: picked.class };
}

function resolveCount(rng: Rng, count: number | undefined): number {
  if (count === undefined) {
    return rng.int(3, 5);
  }
  const whole = Math.trunc(count);
  if (whole < 3) {
    return 3;
  }
  if (whole > 5) {
    return 5;
  }
  return whole;
}

function selectScenarios(
  rng: Rng,
  catalog: readonly CatalogEntry[],
  carClass: CarClass,
  opts: GenerateShiftOptions,
  count: number,
): CatalogEntry[] {
  const chosen: CatalogEntry[] = [];
  const seen = new Set<string>();
  takeAssigned(catalog, opts.assigned ?? [], chosen, seen, count);
  if (chosen.length < count) {
    const focus = opts.focus ?? [];
    const pool = catalog.filter(
      (entry) => !seen.has(entry.id) && acceptsClass(entry, carClass) && intersects(entry, focus),
    );
    takeShuffled(rng, pool, chosen, seen, count);
  }
  if (chosen.length < count) {
    const pool = catalog.filter((entry) => !seen.has(entry.id) && acceptsClass(entry, carClass));
    takeShuffled(rng, pool, chosen, seen, count);
  }
  if (chosen.length < count) {
    const pool = catalog.filter((entry) => !seen.has(entry.id));
    takeShuffled(rng, pool, chosen, seen, count);
  }
  return chosen;
}

function takeAssigned(
  catalog: readonly CatalogEntry[],
  assigned: readonly string[],
  chosen: CatalogEntry[],
  seen: Set<string>,
  count: number,
): void {
  for (const id of assigned) {
    if (chosen.length >= count) {
      return;
    }
    const entry = catalog.find((item) => item.id === id);
    if (!entry || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    chosen.push(entry);
  }
}

function takeShuffled(
  rng: Rng,
  pool: readonly CatalogEntry[],
  chosen: CatalogEntry[],
  seen: Set<string>,
  count: number,
): void {
  if (chosen.length >= count || pool.length === 0) {
    return;
  }
  for (const entry of rng.shuffle(pool)) {
    if (chosen.length >= count) {
      return;
    }
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    chosen.push(entry);
  }
}

function acceptsClass(entry: CatalogEntry, carClass: CarClass): boolean {
  return entry.carClasses.includes(carClass);
}

function intersects(entry: CatalogEntry, focus: readonly Competency[]): boolean {
  if (focus.length === 0) {
    return false;
  }
  for (const competency of entry.competencies) {
    if (focus.includes(competency)) {
      return true;
    }
  }
  return false;
}

function sortByStage(entries: readonly CatalogEntry[], order: readonly Stage[]): CatalogEntry[] {
  const copy = entries.slice();
  copy.sort((left, right) => stageRank(left.stage, order) - stageRank(right.stage, order));
  return copy;
}

function stageRank(stage: Stage, order: readonly Stage[]): number {
  const index = order.indexOf(stage);
  return index === -1 ? order.length : index;
}

function assignParams(
  rng: Rng,
  ordered: readonly CatalogEntry[],
  routes: Routes,
  departure: string,
): ShiftPlan['scenarios'] {
  const result: ShiftPlan['scenarios'] = [];
  const departureMin = parseClock(departure) ?? 6 * 60;
  const seenStage = new Map<Stage, number>();
  let lastMinute = Number.NEGATIVE_INFINITY;
  for (const entry of ordered) {
    const params = rollParams(rng, entry.params);
    const duplicate = seenStage.get(entry.stage) ?? 0;
    seenStage.set(entry.stage, duplicate + 1);
    const offset = routes.stageClockOffsetMin[entry.stage];
    let minute = departureMin + offset + duplicate * routes.sameStageGapMin;
    if (minute <= lastMinute) {
      minute = lastMinute + routes.sameStageGapMin;
    }
    lastMinute = minute;
    params[PARAM_GAME_TIME_MIN] = minute;
    params[PARAM_NODE_STEP_MIN] = routes.nodeStepMin;
    params[PARAM_SCENARIO_TOTAL] = ordered.length;
    result.push({ scenarioId: entry.id, version: entry.version, params });
  }
  return result;
}

function rollParams(rng: Rng, ranges: CatalogEntry['params']): Record<string, number> {
  const params: Record<string, number> = {};
  const keys = Object.keys(ranges ?? {}).sort();
  for (const key of keys) {
    const range = ranges?.[key];
    if (!range) {
      continue;
    }
    params[key] = rollParam(rng, range);
  }
  return params;
}

function rollParam(rng: Rng, range: { min: number; max: number }): number {
  if (Number.isInteger(range.min) && Number.isInteger(range.max)) {
    return rng.int(range.min, range.max);
  }
  return range.min + rng.nextFloat() * (range.max - range.min);
}
