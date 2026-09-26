import type { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, expect, it } from 'vitest';
import { SCENARIO_PUBLISHED } from '../common/events';
import type { PrismaService } from '../prisma/prisma.service';
import { ScenariosService } from './scenarios.service';

describe('публикация сценария', () => {
  it('emit только когда статус стал PUBLISHED', async () => {
    const emits: { name: string; payload: unknown }[] = [];
    const events = {
      emitAsync: async (name: string, payload: unknown) => {
        emits.push({ name, payload });
        return [];
      },
    };
    let status = 'DRAFT';
    const prisma = {
      scenario: {
        update: async ({ data }: { data: { status: string } }) => {
          status = data.status;
          return { id: 'ride-unwell', status, currentVersion: 4 };
        },
      },
    };
    const service = new ScenariosService(
      prisma as unknown as PrismaService,
      events as unknown as EventEmitter2,
    );

    await service.setStatus('ride-unwell', 'ARCHIVED');
    expect(emits).toEqual([]);
    await service.setStatus('ride-unwell', 'PUBLISHED');
    expect(emits).toEqual([
      {
        name: SCENARIO_PUBLISHED,
        payload: { scenarioId: 'ride-unwell', version: 4 },
      },
    ]);
  });
});
