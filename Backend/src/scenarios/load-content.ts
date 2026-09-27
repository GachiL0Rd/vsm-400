import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { ZodError } from 'zod';
import { type ScenarioGraph, ScenarioGraphSchema } from '../engine/schema';
import { contentFile } from '../rules/content-file';

/** Каталог `content/scenarios` рядом со сборкой или от cwd процесса. */
export function scenariosDir(): string {
  return contentFile('scenarios');
}

export function loadScenarioFile(filePath: string): ScenarioGraph {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не прочитать сценарий ${filePath}: ${message}`);
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path.basename(filePath)} не YAML: ${message}`);
  }
  const parsed = ScenarioGraphSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${path.basename(filePath)}: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function loadScenarioGraphs(dir = scenariosDir()): ScenarioGraph[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Нет каталога сценариев ${dir}: ${message}`);
  }
  const files = names.filter((name) => name.endsWith('.yaml')).sort();
  if (files.length === 0) {
    throw new Error(`В ${dir} нет YAML-сценариев`);
  }
  const graphs: ScenarioGraph[] = [];
  const seen = new Set<string>();
  for (const name of files) {
    const graph = loadScenarioFile(path.join(dir, name));
    if (seen.has(graph.id)) {
      throw new Error(`Повтор id сценария: ${graph.id}`);
    }
    seen.add(graph.id);
    graphs.push(graph);
  }
  return graphs;
}

function formatIssues(error: ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => {
      const at = issue.path.map(String).join('.') || 'корень';
      return `${at}: ${issue.message}`;
    })
    .join('; ');
}
