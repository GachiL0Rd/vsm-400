import type { Grade } from '../generated/prisma/client';

const dayMonth = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Moscow',
});

const GRADE_LABEL: Record<Grade, string> = {
  TRAINEE: 'стажёр',
  CONDUCTOR: 'проводник',
  CONDUCTOR_SENIOR: 'старший проводник',
  INSTRUCTOR: 'инструктор',
};

export const EXPIRY_HINT = 'Баллы сохранятся, если до этой даты пройти хотя бы один рейс.';

export function formatDayMonth(instant: Date): string {
  return dayMonth.format(instant);
}

export function pointsWord(amount: number): string {
  const value = Math.abs(Math.trunc(amount));
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return 'балл';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'балла';
  }
  return 'баллов';
}

export function expiryTitle(amount: number, expiresAt: Date): string {
  const abs = Math.abs(Math.trunc(amount));
  const verb = abs % 10 === 1 && abs % 100 !== 11 ? 'спишется' : 'спишутся';
  return `${abs} ${pointsWord(abs)} ${verb} ${formatDayMonth(expiresAt)}`;
}

export function gradeLabel(grade: Grade): string {
  return GRADE_LABEL[grade];
}
