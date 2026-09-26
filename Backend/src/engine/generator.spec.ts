import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePlainYaml } from '../../test/fixtures/plain-yaml';
import { routeName } from '../../test/fixtures/route-name';
import { contentFile } from '../rules/content-file';
import { type CatalogEntry, generateShift } from './generator';
import { createRng } from './rng';
import { type Routes, RoutesSchema } from './routes';
import type { CarClass, Competency, Stage } from './schema';

const ALL: CarClass[] = ['ECONOMY', 'FAMILY', 'BUSINESS', 'FIRST'];

function entry(
  id: string,
  stage: Stage,
  competencies: Competency[],
  carClasses: CarClass[] = ALL,
  version = 1,
): CatalogEntry {
  return {
    id,
    version,
    carClasses,
    competencies,
    difficulty: 2,
    stage,
    params: { occupancy: { min: 40, max: 90 } },
  };
}

function loadRoutes(): Routes {
  const text = readFileSync(contentFile('routes.yaml'), 'utf8');
  return RoutesSchema.parse(parsePlainYaml(text));
}

describe('routes.yaml', () => {
  it('разбирает кавычки с двоеточием и вложенные списки', () => {
    expect(parsePlainYaml('departures:\n  - "06:20"\n')).toEqual({ departures: ['06:20'] });
    expect(parsePlainYaml('cars:\n  - car: 1\n    class: ECONOMY\n')).toEqual({
      cars: [{ car: 1, class: 'ECONOMY' }],
    });
  });

  it('описывает поезд 7xx, четыре класса и остановки', () => {
    const routes = loadRoutes();
    expect(routes.trainPrefix).toBe('ВСМ');
    expect(routes.trainNumberMin).toBe(701);
    expect(routes.trainNumberMax).toBe(799);
    expect(routes.cars).toEqual([
      { car: 1, class: 'ECONOMY' },
      { car: 2, class: 'ECONOMY' },
      { car: 3, class: 'FAMILY' },
      { car: 4, class: 'FAMILY' },
      { car: 5, class: 'BUSINESS' },
      { car: 6, class: 'BUSINESS' },
      { car: 7, class: 'FIRST' },
      { car: 8, class: 'FIRST' },
    ]);
    expect(routes.directions.map((item) => routeName(item.from, item.to))).toEqual([
      routeName('Москва', 'Санкт-Петербург'),
      routeName('Санкт-Петербург', 'Москва'),
    ]);
    expect(routes.directions[0]?.stops).toEqual(['Тверь', 'Вышний Волочёк', 'Бологое', 'Чудово']);
    expect(routes.directions[1]?.stops).toContain('Бологое');
  });
});

describe('generateShift', () => {
  const routes = loadRoutes();
  const catalog = [
    entry('acc', 'acceptance', ['procedure']),
    entry('board', 'boarding', ['service']),
    entry('en-safe', 'enroute', ['safety', 'reaction']),
    entry('en-proc', 'enroute', ['procedure']),
    entry('stop', 'stop', ['detection']),
    entry('hand', 'handover', ['escalation']),
    entry('first-only', 'enroute', ['safety'], ['FIRST'], 4),
    entry('floaty', 'stop', ['service']),
  ];
  catalog[7] = {
    ...entry('floaty', 'stop', ['service']),
    params: { load: { min: 0.25, max: 0.75 } },
  };

  it('детерминирован и рисует поезд, маршрут и вагон из справочника', () => {
    const seed = Buffer.alloc(32, 9);
    const opts = { count: 4, focus: ['safety'] as Competency[], assigned: ['acc'] };
    const left = generateShift(createRng(seed), catalog, opts, routes);
    const right = generateShift(createRng(Buffer.from(seed)), catalog, opts, routes);
    expect(left).toEqual(right);
    expect(left.train).toMatch(/^ВСМ 7\d\d$/);
    expect(left.departure).toMatch(/^\d{2}:\d{2}$/);
    expect(routes.departures).toContain(left.departure);
    expect(left.route).toBe(routeName(left.fromStation, left.toStation));
    const direction = routes.directions.find((item) => item.from === left.fromStation);
    expect(left.stops).toEqual(direction?.stops);
    const car = routes.cars.find((item) => item.car === left.car);
    expect(car?.class).toBe(left.carClass);
    expect(left.scenarios).toHaveLength(4);
    const ids = left.scenarios.map((item) => item.scenarioId);
    expect(new Set(ids).size).toBe(ids.length);
    let previous = Number.NEGATIVE_INFINITY;
    for (const scenario of left.scenarios) {
      expect(scenario.params.gameTimeMin).toBeGreaterThan(previous);
      previous = scenario.params.gameTimeMin ?? 0;
      expect(scenario.params.nodeStepMin).toBe(routes.nodeStepMin);
      expect(scenario.params.scenarioTotal).toBe(4);
      const source = catalog.find((item) => item.id === scenario.scenarioId);
      const occupancy = source?.params?.occupancy;
      if (occupancy && scenario.params.occupancy !== undefined) {
        expect(scenario.params.occupancy).toBeGreaterThanOrEqual(occupancy.min);
        expect(scenario.params.occupancy).toBeLessThanOrEqual(occupancy.max);
        expect(Number.isInteger(scenario.params.occupancy)).toBe(true);
      }
    }
    const floats = generateShift(
      createRng(seed),
      catalog,
      { count: 5, assigned: ['floaty'] },
      routes,
    );
    const floated = floats.scenarios.find((item) => item.scenarioId === 'floaty');
    expect(floated?.params.load).toBeGreaterThanOrEqual(0.25);
    expect(floated?.params.load).toBeLessThanOrEqual(0.75);
    expect(floated?.version).toBe(1);
  });

  it('разные seed не склеиваются в один план', () => {
    const plans = [1, 2, 3, 4, 5].map((byte) => {
      const seed = Buffer.alloc(32, 9);
      seed[0] = byte;
      return generateShift(createRng(seed), catalog, { count: 4 }, routes);
    });
    const keys = new Set(
      plans.map((item) => `${item.train}|${item.departure}|${item.car}|${item.route}`),
    );
    expect(keys.size).toBeGreaterThan(1);
  });

  it('сначала assigned, потом focus, чужой класс не берёт без назначения', () => {
    const seed = Buffer.alloc(32, 3);
    const narrow = [
      entry('a', 'enroute', ['procedure']),
      entry('f', 'enroute', ['safety']),
      entry('o', 'enroute', ['service']),
    ];
    const ordered = generateShift(
      createRng(seed),
      narrow,
      { count: 3, assigned: ['missing', 'a', 'a'], focus: ['safety'], carClass: 'ECONOMY' },
      routes,
    );
    expect(ordered.scenarios.map((item) => item.scenarioId)).toEqual(['a', 'f', 'o']);

    const mixed = [
      entry('x', 'acceptance', ['procedure'], ['FIRST'], 4),
      entry('f-board', 'boarding', ['safety']),
      entry('g-route', 'enroute', ['safety']),
      entry('o-stop', 'stop', ['procedure']),
    ];
    const picked = generateShift(
      createRng(seed),
      mixed,
      { count: 3, assigned: ['x'], focus: ['safety'], carClass: 'ECONOMY' },
      routes,
    );
    expect(picked.carClass).toBe('ECONOMY');
    expect(picked.scenarios.map((item) => item.scenarioId)).toEqual(['x', 'f-board', 'g-route']);
    expect(picked.scenarios[0]?.version).toBe(4);

    const economyOnly = generateShift(
      createRng(seed),
      mixed,
      { count: 3, focus: ['safety'], carClass: 'ECONOMY' },
      routes,
    );
    expect(economyOnly.scenarios.map((item) => item.scenarioId)).toEqual([
      'f-board',
      'g-route',
      'o-stop',
    ]);
    expect(economyOnly.scenarios.map((item) => item.scenarioId)).not.toContain('x');
  });

  it('держит длину 3..5 и сортирует стадии', () => {
    const seed = Buffer.alloc(32, 11);
    const auto = generateShift(createRng(seed), catalog, {}, routes);
    expect(auto.scenarios.length).toBeGreaterThanOrEqual(3);
    expect(auto.scenarios.length).toBeLessThanOrEqual(5);
    const order = ['acceptance', 'boarding', 'enroute', 'stop', 'handover'];
    let rank = -1;
    for (const scenario of auto.scenarios) {
      const source = catalog.find((item) => item.id === scenario.scenarioId);
      const next = order.indexOf(source?.stage ?? '');
      expect(next).toBeGreaterThanOrEqual(rank);
      rank = next;
    }
    const first = generateShift(createRng(seed), catalog, { carClass: 'FIRST', count: 3 }, routes);
    expect(first.carClass).toBe('FIRST');
    expect([7, 8]).toContain(first.car);
    expect(generateShift(createRng(seed), [], { count: 3 }, routes).scenarios).toEqual([]);
    expect(() => generateShift(createRng(seed), catalog, { count: 3 }, {})).toThrow();
  });
});
