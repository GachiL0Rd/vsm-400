import { describe, expect, it } from 'vitest';
import { SEASON_EPOCH_MSK, seasonWindow } from './season-window';

describe('границы сезона МСК', () => {
  it('эпоха — сезон 1, неделя 21–27 сентября 2026 — сезон 39', () => {
    const epoch = seasonWindow(new Date(SEASON_EPOCH_MSK));
    expect(epoch.number).toBe(1);
    expect(epoch.title).toBe('Сезон 1');
    expect(epoch.startsAt.toISOString()).toBe('2025-12-28T21:00:00.000Z');

    const demo = seasonWindow(new Date('2026-09-26T12:00:00+03:00'));
    expect(demo).toMatchObject({ number: 39, title: 'Сезон 39' });
    expect(demo.startsAt.toISOString()).toBe('2026-09-20T21:00:00.000Z');
    expect(demo.endsAt.toISOString()).toBe('2026-09-27T20:59:59.999Z');
  });

  it('воскресенье 23:59:59.999 МСК ещё этот сезон, понедельник 00:00 — следующий', () => {
    const sunday = seasonWindow(new Date('2026-09-27T20:59:59.999Z'));
    const monday = seasonWindow(new Date('2026-09-27T21:00:00.000Z'));
    expect(sunday.number).toBe(39);
    expect(monday.number).toBe(40);
    expect(monday.startsAt.getTime() - sunday.endsAt.getTime()).toBe(1);
  });
});
