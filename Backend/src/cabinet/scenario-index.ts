import type { Competency } from '../engine/schema';
import type { PrismaService } from '../prisma/prisma.service';

export type ScenarioFacts = {
  competencies: Competency[];
  graph: unknown;
};

export async function loadScenarioIndex(
  prisma: PrismaService,
  ids: readonly string[],
): Promise<Map<string, ScenarioFacts>> {
  const map = new Map<string, ScenarioFacts>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return map;
  }
  const scenarios = await prisma.scenario.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      competencies: true,
      currentVersion: true,
      versions: { select: { version: true, graph: true } },
    },
  });
  for (const scenario of scenarios) {
    const current = scenario.versions.find((item) => item.version === scenario.currentVersion);
    map.set(scenario.id, {
      competencies: scenario.competencies,
      graph: current?.graph,
    });
  }
  return map;
}
