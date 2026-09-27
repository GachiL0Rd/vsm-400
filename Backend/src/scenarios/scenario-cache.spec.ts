import type { EventEmitter2 } from '@nestjs/event-emitter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScenarioGraph } from '../engine/schema';
import type { PrismaService } from '../prisma/prisma.service';
import { loadScenarioGraphs } from './load-content';
import { CATALOG_TTL_MS, ScenariosService, VERSION_CACHE_LIMIT } from './scenarios.service';

const graph = loadScenarioGraphs()[0];
if (!graph) {
  throw new Error('нет сценария в content');
}

const events = {
  emitAsync: async () => [],
} as unknown as EventEmitter2;

describe('кэш сценариев', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('второй getVersion не читает базу и отдаёт замороженный граф', async () => {
    let reads = 0;
    const service = new ScenariosService(
      {
        scenarioVersion: {
          findUnique: async () => {
            reads += 1;
            return stored(graph, 1);
          },
        },
      } as unknown as PrismaService,
      events,
    );

    const first = await service.getVersion(graph.id, 1);
    const second = await service.getVersion(graph.id, 1);
    expect(reads).toBe(1);
    expect(second).toBe(first);
    expect(Object.isFrozen(second.graph)).toBe(true);
    expect(() => {
      second.graph.title = 'нет';
    }).toThrow(TypeError);
  });

  it('saveGraph сбрасывает каталог', async () => {
    const harness = catalogHarness(graph);
    const first = await harness.service.getCatalog();
    const second = await harness.service.getCatalog();
    expect(harness.catalogReads()).toBe(1);
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);

    await harness.service.saveGraph(graph.id, { ...graph, title: `${graph.title} x` }, 'actor-1');
    expect(harness.createdById()).toBe('actor-1');
    await harness.service.getCatalog();
    expect(harness.catalogReads()).toBe(2);
  });

  it('каталог старше 30 с читается из базы снова', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const harness = catalogHarness(graph);
    await harness.service.getCatalog();
    vi.setSystemTime(CATALOG_TTL_MS - 1);
    await harness.service.getCatalog();
    expect(harness.catalogReads()).toBe(1);
    vi.setSystemTime(CATALOG_TTL_MS);
    await harness.service.getCatalog();
    expect(harness.catalogReads()).toBe(2);
  });

  it('LRU забывает самую старую версию', async () => {
    let reads = 0;
    const service = new ScenariosService(
      {
        scenarioVersion: {
          findUnique: async ({ where }: { where: { scenarioId_version: { version: number } } }) => {
            reads += 1;
            return stored(graph, where.scenarioId_version.version);
          },
        },
      } as unknown as PrismaService,
      events,
    );

    for (let version = 1; version <= VERSION_CACHE_LIMIT + 1; version += 1) {
      await service.getVersion(graph.id, version);
    }
    expect(reads).toBe(VERSION_CACHE_LIMIT + 1);
    await service.getVersion(graph.id, 1);
    expect(reads).toBe(VERSION_CACHE_LIMIT + 2);
    await service.getVersion(graph.id, VERSION_CACHE_LIMIT + 1);
    expect(reads).toBe(VERSION_CACHE_LIMIT + 2);
  });
});

function stored(source: ScenarioGraph, version: number) {
  return {
    scenarioId: source.id,
    version,
    checksum: 'abc',
    graph: source,
  };
}

function catalogHarness(source: ScenarioGraph) {
  let catalogReads = 0;
  let currentVersion = 1;
  let author: string | null = 'unset';
  const row = () => ({
    id: source.id,
    title: source.title,
    category: source.category,
    carClasses: [...source.carClasses],
    difficulty: source.difficulty,
    competencies: [...source.competencies],
    status: 'PUBLISHED' as const,
    currentVersion,
  });
  const prisma = {
    scenario: {
      findMany: async () => {
        catalogReads += 1;
        return [row()];
      },
      findUnique: async () => row(),
      update: async ({ data }: { data: { currentVersion?: number } }) => {
        if (data.currentVersion !== undefined) {
          currentVersion = data.currentVersion;
        }
      },
    },
    scenarioVersion: {
      findUnique: async ({ where }: { where: { scenarioId_version: { version: number } } }) =>
        stored(source, where.scenarioId_version.version),
      findFirst: async () => ({ version: 1 }),
      create: async ({ data }: { data: { createdById: string | null } }) => {
        author = data.createdById;
      },
    },
    user: {
      findUnique: async () => ({ id: 'actor-1' }),
    },
    $transaction: async (run: (tx: unknown) => Promise<void>) => run(prisma),
  };
  return {
    service: new ScenariosService(prisma as unknown as PrismaService, events),
    catalogReads: () => catalogReads,
    createdById: () => author,
  };
}
