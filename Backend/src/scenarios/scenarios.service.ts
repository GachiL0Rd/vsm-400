import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SCENARIO_PUBLISHED, type ScenarioPublishedPayload } from '../common/events';
import type { ScenarioGraph } from '../engine/schema';
import { ScenarioGraphSchema } from '../engine/schema';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { graphChecksum } from './checksum';
import type { CatalogItem, ScenarioDetail, ScenarioStatusView } from './dto';
import { assertPlayableGraph } from './graph-check';
import { loadScenarioGraphs } from './load-content';
import { parseIncomingGraph } from './parse-graph';
import { nextVersionNumber, planVersion } from './sync-plan';

export type SyncStats = {
  scenarios: number;
  createdVersions: number;
};

export type ScenarioVersionView = {
  scenarioId: string;
  version: number;
  checksum: string;
  graph: ScenarioGraph;
};

type ScenarioMeta = {
  title: string;
  category: string;
  carClasses: ScenarioGraph['carClasses'];
  difficulty: number;
  competencies: ScenarioGraph['competencies'];
  currentVersion: number;
};

@Injectable()
export class ScenariosService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScenariosService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const stats = await this.syncFromContent();
    this.logger.log(`Сценарии: ${stats.scenarios}, новых версий: ${stats.createdVersions}`);
  }

  async syncFromContent(): Promise<SyncStats> {
    const graphs = loadScenarioGraphs();
    for (const graph of graphs) {
      assertPlayableGraph(graph);
    }
    let createdVersions = 0;
    const published: ScenarioPublishedPayload[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const graph of graphs) {
        const version = await syncGraph(tx, graph);
        if (version !== null) {
          createdVersions += 1;
          published.push({ scenarioId: graph.id, version });
        }
      }
    });
    for (const payload of published) {
      await this.emitPublished(payload);
    }
    return { scenarios: graphs.length, createdVersions };
  }

  async getCatalog(): Promise<CatalogItem[]> {
    const rows = await this.prisma.scenario.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { id: 'asc' },
    });
    const items: CatalogItem[] = [];
    for (const row of rows) {
      const stored = await this.readVersion(row.id, row.currentVersion);
      items.push(toCatalog(row, stored.graph, stored.version));
    }
    return items;
  }

  async getById(id: string): Promise<ScenarioDetail> {
    const row = await this.prisma.scenario.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Сценарий не найден');
    }
    const stored = await this.readVersion(row.id, row.currentVersion);
    return {
      ...toCatalog(row, stored.graph, stored.version),
      status: row.status,
      graph: stored.graph,
    };
  }

  async getVersion(id: string, version: number): Promise<ScenarioVersionView> {
    return this.readVersion(id, version);
  }

  /** Редактор сохраняет снимок всегда: одинаковый граф тоже новая версия. */
  async saveGraph(id: string, raw: unknown, actorId: string): Promise<ScenarioDetail> {
    const graph = parseIncomingGraph(id, raw);
    assertPlayableGraph(graph);
    const checksum = graphChecksum(graph);
    let announced: number | null = null;
    await this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true } });
      if (!actor) {
        throw new NotFoundException('Пользователь не найден');
      }
      const latest = await tx.scenarioVersion.findFirst({
        where: { scenarioId: id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = nextVersionNumber(latest);
      const meta = scenarioMeta(graph, version);
      const existing = await tx.scenario.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!existing) {
        await tx.scenario.create({
          data: { id, ...meta, status: 'DRAFT' },
        });
      } else {
        await tx.scenario.update({ where: { id }, data: meta });
        if (existing.status === 'PUBLISHED') {
          announced = version;
        }
      }
      await tx.scenarioVersion.create({
        data: {
          scenarioId: id,
          version,
          checksum,
          graph: graph as Prisma.InputJsonValue,
          createdById: actorId,
        },
      });
    });
    if (announced !== null) {
      await this.emitPublished({ scenarioId: id, version: announced });
    }
    return this.getById(id);
  }

  async setStatus(id: string, status: ScenarioStatusView['status']): Promise<ScenarioStatusView> {
    try {
      const updated = await this.prisma.scenario.update({
        where: { id },
        data: { status },
        select: { id: true, status: true, currentVersion: true },
      });
      if (updated.status === 'PUBLISHED') {
        await this.emitPublished({ scenarioId: updated.id, version: updated.currentVersion });
      }
      return { id: updated.id, status: updated.status };
    } catch (error) {
      if (isMissingRow(error)) {
        throw new NotFoundException('Сценарий не найден');
      }
      throw error;
    }
  }

  private async emitPublished(payload: ScenarioPublishedPayload): Promise<void> {
    await this.events.emitAsync(SCENARIO_PUBLISHED, payload);
  }

  private async readVersion(id: string, version: number): Promise<ScenarioVersionView> {
    const row = await this.prisma.scenarioVersion.findUnique({
      where: { scenarioId_version: { scenarioId: id, version } },
    });
    if (!row) {
      throw new NotFoundException('Версия сценария не найдена');
    }
    return {
      scenarioId: row.scenarioId,
      version: row.version,
      checksum: row.checksum,
      graph: parseStoredGraph(row.graph),
    };
  }
}

function scenarioMeta(graph: ScenarioGraph, version: number): ScenarioMeta {
  return {
    title: graph.title,
    category: graph.category,
    carClasses: graph.carClasses,
    difficulty: graph.difficulty,
    competencies: graph.competencies,
    currentVersion: version,
  };
}

function toCatalog(
  row: {
    id: string;
    title: string;
    category: string;
    carClasses: ScenarioGraph['carClasses'];
    difficulty: number;
    competencies: ScenarioGraph['competencies'];
  },
  graph: ScenarioGraph,
  version: number,
): CatalogItem {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    carClasses: row.carClasses,
    difficulty: row.difficulty,
    competencies: row.competencies,
    version,
    stage: graph.stage,
  };
}

function parseStoredGraph(value: unknown): ScenarioGraph {
  const parsed = ScenarioGraphSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Граф сценария в базе не прошёл схему');
  }
  return parsed.data;
}

type SyncClient = Pick<Prisma.TransactionClient, 'scenario' | 'scenarioVersion'>;

/**
 * Файл из content — источник каталога. Совпадение checksum не плодит версию,
 * но статус снова PUBLISHED: архив методиста не переживает рестарт.
 */
async function syncGraph(tx: SyncClient, graph: ScenarioGraph): Promise<number | null> {
  const latest = await tx.scenarioVersion.findFirst({
    where: { scenarioId: graph.id },
    orderBy: { version: 'desc' },
    select: { version: true, checksum: true },
  });
  const plan = planVersion(latest, graph);
  if (plan.kind === 'same') {
    await tx.scenario.updateMany({
      where: { id: graph.id, status: { not: 'PUBLISHED' } },
      data: { status: 'PUBLISHED' },
    });
    return null;
  }
  const meta = scenarioMeta(graph, plan.version);
  await tx.scenario.upsert({
    where: { id: graph.id },
    create: { id: graph.id, ...meta, status: 'PUBLISHED' },
    update: { ...meta, status: 'PUBLISHED' },
  });
  await tx.scenarioVersion.create({
    data: {
      scenarioId: graph.id,
      version: plan.version,
      checksum: plan.checksum,
      graph: graph as Prisma.InputJsonValue,
    },
  });
  return plan.version;
}

function isMissingRow(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as { code?: unknown };
  return record.code === 'P2025';
}
