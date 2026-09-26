import { describe, expect, it } from 'vitest';
import type { Season } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { seasonWindow } from './season-window';
import { SeasonsService } from './seasons.service';

describe('SeasonsService.current', () => {
  it('создаёт сезон недели один раз', async () => {
    const rows: Season[] = [];
    const api = {
      season: {
        findUnique: async ({ where }: { where: { startsAt: Date } }) =>
          rows.find((row) => row.startsAt.getTime() === where.startsAt.getTime()) ?? null,
        create: async ({ data }: { data: { title: string; startsAt: Date; endsAt: Date } }) => {
          const row = { id: `s${rows.length + 1}`, ...data } as Season;
          rows.push(row);
          return row;
        },
      },
      $executeRaw: async () => 0,
    };
    const prisma = {
      ...api,
      $transaction: async (fn: (tx: typeof api) => Promise<Season>) => fn(api),
    };
    const service = new SeasonsService(prisma as unknown as PrismaService);
    const at = new Date('2026-09-26T12:00:00+03:00');
    const first = await service.current(at);
    const second = await service.current(at);
    expect(rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(first.title).toBe('Сезон 39');
    expect(first.startsAt.toISOString()).toBe(seasonWindow(at).startsAt.toISOString());
    expect(first.endsAt.toISOString()).toBe(seasonWindow(at).endsAt.toISOString());
  });
});
