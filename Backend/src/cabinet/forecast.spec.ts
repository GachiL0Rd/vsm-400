import { describe, expect, it } from 'vitest';
import { applyScores, brigadeRank, weakestCompetencies } from './competencies';
import {
  addCalendarDays,
  forecastShift,
  formatHm,
  moscowDate,
  stationGenitive,
  upcomingShiftDate,
} from './forecast';

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

  it('если сегодняшний слот уже прошёл, дата прогноза — завтра', () => {
    const morning = new Date('2026-09-26T02:00:00.000Z');
    const date = upcomingShiftDate('user-1', morning);
    expect(date === '2026-09-26' || date === '2026-09-27').toBe(true);
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
