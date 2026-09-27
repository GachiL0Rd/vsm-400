import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { RoutesSchema } from '../engine/routes';
import { contentFile } from '../rules/content-file';
import { applyScores, brigadeRank, weakestCompetencies } from './competencies';
import {
  addCalendarDays,
  carAtOffset,
  carClassLabel,
  forecastShift,
  formatHm,
  moscowDate,
  stationGenitive,
  upcomingShiftDate,
} from './forecast';

function routesBook() {
  return RoutesSchema.parse(parse(readFileSync(contentFile('routes.yaml'), 'utf8')));
}

describe('прогноз смены', () => {
  it('userId и дата фиксируют рейс', () => {
    const focus = ['safety', 'procedure'] as const;
    const left = forecastShift('user-1', '2026-09-26', focus);
    const right = forecastShift('user-1', '2026-09-26', focus);
    expect(left).toEqual(right);
    expect(left.departure).toMatch(/^\d{2}:\d{2}$/);
    expect(left.train).toMatch(/^ВСМ \d{3}$/);
    expect(left.stops.length).toBeGreaterThan(0);
    expect(['Москвы', 'Санкт-Петербурга']).toContain(left.fromGenitive);
    expect(left.departureAt).toBe(new Date(`2026-09-26T${left.departure}:00+03:00`).toISOString());
  });

  it('маршрут, слот и класс вагона берутся из routes.yaml', () => {
    const book = routesBook();
    const shift = forecastShift('user-1', '2026-09-26', ['safety']);
    const direction = book.directions.find((item) => item.from === shift.from);
    const car = book.cars.find((item) => item.car === shift.car);
    const number = Number(shift.train.slice(book.trainPrefix.length + 1));
    expect(book.departures).toContain(shift.departure);
    expect(direction?.to).toBe(shift.to);
    expect(direction?.stops).toEqual(shift.stops);
    expect(car).toBeTruthy();
    if (!car) {
      return;
    }
    expect(shift.carClass).toBe(carClassLabel(car.class));
    expect(number).toBeGreaterThanOrEqual(book.trainNumberMin);
    expect(number).toBeLessThanOrEqual(book.trainNumberMax);
    expect(shift.stops).toEqual(
      expect.arrayContaining(['Тверь', 'Вышний Волочёк', 'Бологое', 'Чудово']),
    );
  });

  it('соседний вагон назначения берёт класс из той же строки yaml', () => {
    const book = routesBook();
    const first = book.cars[0];
    const second = book.cars[1];
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    if (!first || !second) {
      return;
    }
    expect(carAtOffset(first.car, 1)).toEqual({ car: second.car, carClass: second.class });
  });

  it('другой день тоже стабилен', () => {
    const focus = ['escalation', 'reaction'] as const;
    expect(forecastShift('user-1', '2026-09-27', focus)).toEqual(
      forecastShift('user-1', '2026-09-27', focus),
    );
  });

  it('часы Москвы и падеж станции', () => {
    expect(formatHm(new Date('2026-10-01T06:30:00.000Z'))).toBe('09:30');
    expect(moscowDate(new Date('2026-10-01T06:30:00.000Z'))).toBe('2026-10-01');
    expect(stationGenitive('Москва')).toBe('Москвы');
    expect(stationGenitive('Казань')).toBe('Казань');
    expect(addCalendarDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('прогноз на ближайший ещё не наступивший слот, не на прошедший сегодня', () => {
    const beforeFirst = new Date('2026-09-26T01:00:00.000Z');
    const afterLast = new Date('2026-09-26T19:00:00.000Z');
    expect(upcomingShiftDate('user-1', beforeFirst)).toBe('2026-09-26');
    expect(upcomingShiftDate('user-1', afterLast)).toBe('2026-09-27');
    const next = forecastShift('user-1', upcomingShiftDate('user-1', afterLast), ['safety']);
    expect(new Date(next.departureAt).getTime()).toBeGreaterThan(afterLast.getTime());
  });
});

describe('компетенции', () => {
  it('пустая история — 50, слабые две первые по возрастанию', () => {
    const scores = applyScores([{ competency: 'escalation', value: 43.4 }]);
    expect(scores.reaction).toBe(50);
    expect(scores.escalation).toBe(43);
    expect(weakestCompetencies(scores, 2)).toEqual(['escalation', 'safety']);
  });

  it('место в бригаде: баллы по убыванию, ничья по позывному', () => {
    const members = [
      { id: 'b', callsign: 'BBBB', points: 10 },
      { id: 'a', callsign: 'AAAA', points: 10 },
      { id: 'c', callsign: 'CCCC', points: 3 },
    ];
    expect(brigadeRank(members, 'a')).toEqual({ rank: 1, size: 3 });
    expect(brigadeRank(members, 'b').rank).toBe(2);
  });
});
