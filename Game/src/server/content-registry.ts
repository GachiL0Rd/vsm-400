import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { type ActionContent, loadActionContent } from '../simulation/action-decision.ts';
import {
  type AssessmentConfig,
  BASELINE_ASSESSMENT_CONFIG,
  parseAssessmentConfig,
} from '../simulation/assessment-config.ts';
import { BASELINE_ACTION_CONTENT } from '../simulation/baseline-content.ts';
import { GameAttempt } from '../simulation/game-attempt.ts';
import { BASELINE_LEVEL, type LoadedLevel, loadLevelDefinition } from '../simulation/level.ts';
import {
  BASELINE_SCENARIO,
  type LoadedScenario,
  loadScenarioDefinition,
} from '../simulation/scenario.ts';
import type { SessionMode } from './types.ts';

export interface ResolvedGameContent {
  readonly gameLevelId: string;
  readonly gameLevelVersion: string;
  readonly simulationCompatibilityVersion: string;
  createAttempt(rootSeed: number, mode: SessionMode): GameAttempt;
}

export interface GameContentRegistry {
  resolve(gameLevelId: string): ResolvedGameContent;
}

interface LoadedBundle {
  readonly gameLevelId: string;
  readonly gameLevelVersion: string;
  readonly simulationCompatibilityVersion: string;
  readonly level: LoadedLevel;
  readonly scenario: LoadedScenario;
  readonly actions: ActionContent;
  readonly assessment: AssessmentConfig;
}

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  bundles: z
    .array(
      z.object({
        gameLevelId: z.string().min(1),
        gameLevelVersion: z.string().min(1),
        simulationCompatibilityVersion: z.string().min(1),
        level: z.string().min(1),
        scenario: z.string().min(1),
        actions: z.string().min(1),
        assessment: z.string().min(1),
      }),
    )
    .min(1),
});

export class FileGameContentRegistry implements GameContentRegistry {
  private readonly bundles: ReadonlyMap<string, LoadedBundle>;

  constructor(contentDirectory: string) {
    const root = resolve(contentDirectory);
    const manifest = manifestSchema.parse(readJsonFile(resolveInside(root, 'manifest.json')));
    const bundles = new Map<string, LoadedBundle>();
    for (const entry of manifest.bundles) {
      if (bundles.has(entry.gameLevelId)) {
        throw new RangeError(`Duplicate gameLevelId ${entry.gameLevelId} in content manifest`);
      }
      const level = loadLevelDefinition(readJsonFile(resolveInside(root, entry.level)));
      const scenario = loadScenarioDefinition(
        readJsonFile(resolveInside(root, entry.scenario)),
        level,
      );
      const actions = readJsonFile(resolveInside(root, entry.actions)) as ActionContent;
      loadActionContent(actions);
      const assessment = parseAssessmentConfig(readJsonFile(resolveInside(root, entry.assessment)));
      if (level.definition.id !== scenario.definition.levelId) {
        throw new RangeError(`Content bundle ${entry.gameLevelId} has mismatched Level/Scenario`);
      }
      bundles.set(entry.gameLevelId, {
        gameLevelId: entry.gameLevelId,
        gameLevelVersion: entry.gameLevelVersion,
        simulationCompatibilityVersion: entry.simulationCompatibilityVersion,
        level,
        scenario,
        actions,
        assessment,
      });
    }
    this.bundles = bundles;
  }

  resolve(gameLevelId: string): ResolvedGameContent {
    const bundle = this.bundles.get(gameLevelId);
    if (bundle === undefined) throw new RangeError(`Unknown game level ${gameLevelId}`);
    return resolvedBundle(bundle);
  }
}

/** In-code fixture retained for simulation/server tests and compatibility. */
export class BaselineContentRegistry implements GameContentRegistry {
  resolve(gameLevelId: string): ResolvedGameContent {
    if (gameLevelId !== 'vsm-baseline-01') {
      throw new RangeError(`Unknown game level ${gameLevelId}`);
    }
    return resolvedBundle({
      gameLevelId,
      gameLevelVersion: 'vsm-baseline-01',
      simulationCompatibilityVersion: '0.1.0',
      level: BASELINE_LEVEL,
      scenario: BASELINE_SCENARIO,
      actions: BASELINE_ACTION_CONTENT,
      assessment: BASELINE_ASSESSMENT_CONFIG,
    });
  }
}

function resolvedBundle(bundle: LoadedBundle): ResolvedGameContent {
  return {
    gameLevelId: bundle.gameLevelId,
    gameLevelVersion: bundle.gameLevelVersion,
    simulationCompatibilityVersion: bundle.simulationCompatibilityVersion,
    createAttempt: (rootSeed) =>
      new GameAttempt({
        rootSeed,
        level: bundle.level,
        scenario: bundle.scenario,
        actionContent: bundle.actions,
        assessmentConfig: bundle.assessment,
      }),
  };
}

function readJsonFile(path: string): unknown {
  const file = statSync(path, { throwIfNoEntry: false });
  if (file === undefined || !file.isFile()) throw new Error(`Content file does not exist: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Failed to parse content JSON ${path}`, { cause: error });
  }
}

function resolveInside(root: string, configuredPath: string): string {
  if (isAbsolute(configuredPath)) {
    throw new Error(`Content manifest paths must be relative: ${configuredPath}`);
  }
  const path = resolve(root, configuredPath);
  const pathRelativeToRoot = relative(root, path);
  if (pathRelativeToRoot === '..' || pathRelativeToRoot.startsWith(`..${sep}`)) {
    throw new Error(`Content manifest path escapes content directory: ${configuredPath}`);
  }
  return path;
}
