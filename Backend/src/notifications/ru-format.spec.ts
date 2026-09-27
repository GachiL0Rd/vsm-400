import { describe, expect, it } from 'vitest';
import { expiryTitle, formatDayMonth, pointsWord } from './ru-format';

describe('русские даты и баллы', () => {
  it('день и месяц в Europe/Moscow', () => {
    expect(formatDayMonth(new Date('2026-09-28T21:00:00.000Z'))).toBe('29 сентября');
    expect(formatDayMonth(new Date('2026-09-28T20:59:59.000Z'))).toBe('28 сентября');
  });

  it('склоняет баллы и глагол списания', () => {
    expect(pointsWord(1)).toBe('балл');
    expect(pointsWord(2)).toBe('балла');
    expect(pointsWord(5)).toBe('баллов');
    expect(pointsWord(11)).toBe('баллов');
    expect(pointsWord(21)).toBe('балл');
    expect(expiryTitle(120, new Date('2026-09-29T09:00:00+03:00'))).toBe(
      '120 баллов спишутся 29 сентября',
    );
    expect(expiryTitle(1, new Date('2026-09-29T09:00:00+03:00'))).toBe(
      '1 балл спишется 29 сентября',
    );
  });
});
