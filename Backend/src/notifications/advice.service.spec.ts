import { describe, expect, it } from 'vitest';
import { Clock } from '../common/clock';
import type { Competency } from '../generated/prisma/client';
import { NotificationKind } from '../generated/prisma/client';
import { seasonWindow } from '../leaderboard/season-window';
import type { PrismaService } from '../prisma/prisma.service';
import type { RulesService } from '../rules/rules.service';
import { adviceText, recommendScenario } from './advice';
import { AdviceService } from './advice.service';
import type { NotificationsService } from './notifications.service';

class FixedClock extends Clock {
  constructor(private readonly at: Date) {
    super();
  }

  now(): Date {
    return new Date(this.at.getTime());
  }
}

describe('текст совета', () => {
  it('называет компетенцию, балл и сценарий', () => {
    expect(adviceText('escalation', 43, 61, 'Пассажиру плохо')).toBe(
      'Эскалация ниже среднего по депо — 43 из 100 при среднем 61. Потренируйте «Пассажиру плохо».',
    );
  });

  it('предпочитает сценарий класса вагона проводника', () => {
    const title = recommendScenario(
      [
        {
          title: 'Эконом',
          carClasses: ['ECONOMY'],
          competencies: ['escalation'],
        },
        {
          title: 'Бизнес',
          carClasses: ['BUSINESS'],
          competencies: ['escalation'],
        },
      ],
      'escalation',
      ['BUSINESS'],
    );
    expect(title).toBe('Бизнес');
  });
});

describe('AdviceService', () => {
  it('пишет совет только тем, кто ниже порога и среднего депо', async () => {
    const now = new Date('2026-09-26T09:00:00+03:00');
    const notes: { userId: string; text: string; dedupKey?: string; kind: string }[] = [];
    const users = [
      person('weak', 'escalation', 43.2, 'BUSINESS'),
      person('peer', 'escalation', 78.6, 'BUSINESS'),
      person('ok', 'safety', 80, 'ECONOMY'),
    ];
    const scenarios = [
      {
        id: 'econ',
        title: 'Чужой поезд',
        carClasses: ['ECONOMY'],
        competencies: ['escalation'] as Competency[],
      },
      {
        id: 'biz',
        title: 'Пассажиру плохо',
        carClasses: ['BUSINESS'],
        competencies: ['escalation'] as Competency[],
      },
    ];
    const prisma = {
      scenario: { findMany: async () => scenarios },
      user: { findMany: async () => users },
    };
    const notifications = {
      create: async (userId: string, draft: { text: string; dedupKey?: string; kind: string }) => {
        notes.push({ userId, ...draft });
        return { id: 'n' };
      },
    };
    const rules = { weakScore: () => 50 };
    const service = new AdviceService(
      prisma as unknown as PrismaService,
      rules as unknown as RulesService,
      notifications as unknown as NotificationsService,
      new FixedClock(now),
    );

    expect(await service.adviseDue()).toBe(1);
    const week = seasonWindow(now).startsAt.toISOString();
    expect(notes).toEqual([
      {
        userId: 'weak',
        kind: NotificationKind.advice,
        title: 'Эскалация ниже среднего по депо',
        text: 'Эскалация ниже среднего по депо — 43 из 100 при среднем 61. Потренируйте «Пассажиру плохо».',
        dedupKey: `advice:${week}:weak:escalation`,
      },
    ]);
  });
});

function person(
  id: string,
  competency: Competency,
  value: number,
  carClass: 'BUSINESS' | 'ECONOMY',
) {
  return {
    id,
    brigade: { depotId: 'depot-1' },
    competencyScores: [{ competency, value }],
    runs: [{ carClass }],
    assignedShifts: [],
  };
}
