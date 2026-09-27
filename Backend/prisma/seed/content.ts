import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { AchievementEntry } from '../../src/achievements/achievement.schema';
import { loadAchievements } from '../../src/achievements/load-achievements';
import type { CatalogEntry } from '../../src/engine/generator';
import { type Routes, RoutesSchema } from '../../src/engine/routes';
import type { ScenarioGraph } from '../../src/engine/schema';
import { contentFile } from '../../src/rules/content-file';
import type { ScoringParams } from '../../src/rules/rules.schema';
import { loadScenarioGraphs } from '../../src/scenarios/load-content';

export type PlayContext = {
  catalog: CatalogEntry[];
  graphs: ScenarioGraph[];
  routes: Routes;
  scoring: ScoringParams;
  achievements: AchievementEntry[];
};

export function loadRoutes(): Routes {
  const file = contentFile('routes.yaml');
  let raw: unknown;
  try {
    raw = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не прочитать маршруты ${file}: ${message}`);
  }
  return RoutesSchema.parse(raw);
}

export function catalogOf(
  graphs: readonly ScenarioGraph[],
  versions: ReadonlyMap<string, number>,
): CatalogEntry[] {
  const catalog: CatalogEntry[] = [];
  for (const graph of graphs) {
    catalog.push({
      id: graph.id,
      version: versions.get(graph.id) ?? 1,
      carClasses: graph.carClasses,
      competencies: graph.competencies,
      difficulty: graph.difficulty,
      stage: graph.stage,
      ...(graph.params ? { params: graph.params } : {}),
    });
  }
  return catalog;
}

export function loadGraphs(): ScenarioGraph[] {
  return loadScenarioGraphs();
}

export function loadAchievementEntries(): AchievementEntry[] {
  return loadAchievements().achievements;
}
