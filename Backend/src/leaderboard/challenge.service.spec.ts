import { describe, expect, it } from 'vitest';
import { Clock } from '../common/clock';
import type { RunRecordedPayload } from '../common/events';
import { NotificationKind, type Season } from '../generated/prisma/client';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { RulesService } from '../rules/rules.service';
import { ChallengeService } from './challenge.service';
import type { SeasonsService } from './seasons.service';

class FixedClock extends Clock {
  constructor(private readonly at: Date) {
    super();
  }

  now(): Date {
    return new Date(this.at.getTime());
  }
}

class MemoryRedis {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _ex?: 'EX',
    _seconds?: number,
    nx?: 'NX',
  ): Promise<'OK' | null> {
    if (nx === 'NX' && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
}

function recorded(partial: Partial<RunRecordedPayload> = {}): RunRecordedPayload {
  return {
    runId: 'run-1',
    userId: 'u1',
    brigadeId: 'b1',
    depotId: 'depot-1',
    points: 20,
    outcome: 'completed',
    suspicious: false,
    ...partial,
  };
}

describe('челлендж депо', () => {
  const now = new Date('2026-09-21T00:00:00+03:00');
  const season = {
    id: 'season-39',
    title: 'Сезон 39',
    startsAt: now,
    endsAt: new Date('2026-09-27T20:59:59.999Z'),
  } as Season;

  function setup() {
    const notes: { userId: string; text: string; dedupKey?: string; kind: string }[] = [];
    const ledger: { userId: string; amount: number; reason: string; runId: string }[] = [];
    const audits: { target: string; meta: { competency: string } }[] = [];
    const scores = [
      { competency: 'safety' as const, value: 80, user: { brigade: { depotId: 'depot-1' } } },
      { competency: 'escalation' as const, value: 41, user: { brigade: { depotId: 'depot-1' } } },
    ];
    const prisma = {
      depot: { findMany: async () => [{ id: 'depot-1' }] },
      competencyScore: {
        findMany: async () =>
          scores.map((row) => ({ competency: row.competency, value: row.value })),
      },
      auditLog: {
        findFirst: async () => audits[0] ?? null,
        create: async ({ data }: { data: { target: string; meta: { competency: string } } }) => {
          audits.push({ target: data.target, meta: data.meta });
          return data;
        },
      },
      user: { findMany: async () => [{ id: 'u1' }, { id: 'u2' }] },
      run: {
        findUnique: async () => ({
          competencyDelta: { safety: 1 },
          decisions: [{ scenarioId: 'ride-unwell' }],
        }),
      },
      scenario: {
        findMany: async () => [{ competencies: ['escalation'] }],
      },
      pointLedger: {
        findFirst: async () => ledger[0] ?? null,
        create: async ({
          data,
        }: {
          data: { userId: string; amount: number; reason: string; runId: string };
        }) => {
          ledger.push(data);
          return data;
        },
      },
    };
    const notifications = {
      create: async (userId: string, draft: { text: string; dedupKey?: string; kind: string }) => {
        notes.push({ userId, ...draft });
      },
    };
    const service = new ChallengeService(
      prisma as unknown as PrismaService,
      new MemoryRedis() as unknown as RedisService,
      { current: async () => season } as unknown as SeasonsService,
      notifications as unknown as NotificationsService,
      { challengePoints: () => 40, pointsTtlDays: () => 30 } as unknown as RulesService,
      new FixedClock(now),
    );
    return { service, notes, ledger, audits };
  }

  it('в понедельник сообщает бригаде тему самой слабой компетенции', async () => {
    const { service, notes, audits } = setup();
    await service.openDue();
    expect(audits[0]?.meta.competency).toBe('escalation');
    expect(notes.map((row) => row.text)).toEqual([
      'Неделя Эскалация — бригады депо соревнуются до воскресенья',
      'Неделя Эскалация — бригады депо соревнуются до воскресенья',
    ]);
    expect(notes[0]).toMatchObject({
      kind: NotificationKind.challenge,
      dedupKey: 'challenge:season-39:u1',
    });
  });

  it('начисляет CHALLENGE один раз за рейс с компетенцией недели', async () => {
    const { service, ledger } = setup();
    await service.onRunRecorded(recorded());
    await service.onRunRecorded(recorded());
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      userId: 'u1',
      amount: 40,
      reason: 'CHALLENGE',
      runId: 'run-1',
    });
  });

  it('пропускает подозрительный рейс', async () => {
    const { service, ledger } = setup();
    await service.onRunRecorded(recorded({ suspicious: true, runId: 'bad' }));
    expect(ledger).toHaveLength(0);
  });
});
