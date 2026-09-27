import type { SessionTextRequestItem } from '../common/events';
import type { Rng } from '../engine/rng';
import { isEndNode, type ScenarioGraph } from '../engine/schema';
import type { ShiftPlan, TextVariant } from '../engine/types';
import type { Prisma } from '../generated/prisma/client';
import { isRecord, toJson } from './state-json';

/**
 * Узлы разных сценариев смены могут называться одинаково.
 * Ключ составной, чтобы планы не затирали друг друга.
 */
export function textPlanKey(scenarioId: string, nodeId: string): string {
  return `${scenarioId}:${nodeId}`;
}

export type StoredTextPlan = {
  nodes: Record<string, string | null>;
  /** Узлы, которые сессия уже показала. Повтор того же узла не меняет текст. */
  shown: readonly string[];
};

export type TextAssembly = {
  textPlan: Record<string, string | null> | null;
  live: SessionTextRequestItem[];
};

type ApprovedQuery = {
  scenarioId: string;
  version: number;
  nodeId: string;
  persona: string;
};

type PlannedNode = ApprovedQuery & { mode: 'pool' | 'live' };

export function llmMode(graph: ScenarioGraph): 'pool' | 'live' | null {
  if (!graph.llm?.enabled) {
    return null;
  }
  return graph.llm.mode === 'live' ? 'live' : 'pool';
}

/** Один fork('persona') на сценарий: метка без счётчика родителя, повтор даёт ту же манеру. */
export function personaOf(rng: Rng, graph: ScenarioGraph): string {
  const personas = graph.llm?.enabled ? graph.llm.personas : undefined;
  if (!personas || personas.length === 0) {
    return '';
  }
  return rng.fork('persona').pick(personas);
}

/** Список сортируется по id: порядок строк из БД на выбор не влияет. */
export function pickApprovedId(
  rng: Rng,
  scenarioId: string,
  nodeId: string,
  ids: readonly string[],
): string | null {
  if (ids.length === 0) {
    return null;
  }
  const sorted = [...ids].sort(byId);
  return rng.fork(`text:${scenarioId}:${nodeId}`).pick(sorted);
}

export function orderRng(rng: Rng, scenarioId: string, nodeId: string, seq: number): Rng {
  return rng.fork(`order:${scenarioId}:${nodeId}:${seq}`);
}

export function readTextPlan(raw: unknown): StoredTextPlan | null {
  if (!isRecord(raw)) {
    return null;
  }
  const nodes: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_')) {
      continue;
    }
    if (value === null || typeof value === 'string') {
      nodes[key] = value;
    }
  }
  const shown: string[] = [];
  const mark = raw._shown;
  if (Array.isArray(mark)) {
    for (const item of mark) {
      if (typeof item === 'string') {
        shown.push(item);
      }
    }
  }
  return { nodes, shown };
}

/**
 * _shown лежит рядом с картой узлов: после закрепления null уже не живой слот,
 * а зафиксированный YAML. Вариант живой сессии ищется по sessionId, не по персоне.
 */
export function writeTextPlan(plan: StoredTextPlan): Prisma.InputJsonValue {
  const body: Record<string, unknown> = { ...plan.nodes };
  if (plan.shown.length > 0) {
    body._shown = [...plan.shown];
  }
  return toJson(body);
}

export function livePinTarget(
  plan: StoredTextPlan | null,
  key: string,
  mode: 'pool' | 'live' | null,
): boolean {
  if (!plan || mode !== 'live' || plan.shown.includes(key)) {
    return false;
  }
  if (!Object.hasOwn(plan.nodes, key)) {
    return false;
  }
  return plan.nodes[key] === null;
}

export function markShown(
  plan: StoredTextPlan,
  key: string,
  variantId: string | null,
): StoredTextPlan {
  const shown = plan.shown.includes(key) ? [...plan.shown] : [...plan.shown, key];
  return { nodes: { ...plan.nodes, [key]: variantId }, shown };
}

export function selectedVariantIds(nodes: Record<string, string | null>): string[] {
  const ids: string[] = [];
  for (const value of Object.values(nodes)) {
    if (typeof value === 'string') {
      ids.push(value);
    }
  }
  return ids;
}

export function payloadVariant(raw: unknown): TextVariant | undefined {
  if (!isRecord(raw) || typeof raw.text !== 'string' || !Array.isArray(raw.choices)) {
    return undefined;
  }
  const choices: { id: string; text: string }[] = [];
  for (const choice of raw.choices) {
    if (!isRecord(choice) || typeof choice.id !== 'string' || typeof choice.text !== 'string') {
      return undefined;
    }
    choices.push({ id: choice.id, text: choice.text });
  }
  return { text: raw.text, choices };
}

export function assembleTextPlan(
  rng: Rng,
  shift: ShiftPlan,
  graphs: readonly ScenarioGraph[],
  approvedIds: (query: ApprovedQuery) => readonly string[],
): TextAssembly {
  const planned = plannedNodes(rng, shift, graphs);
  if (planned.length === 0) {
    return { textPlan: null, live: [] };
  }
  const nodes: Record<string, string | null> = {};
  const live: SessionTextRequestItem[] = [];
  for (const node of planned) {
    const id = pickApprovedId(rng, node.scenarioId, node.nodeId, approvedIds(node));
    nodes[textPlanKey(node.scenarioId, node.nodeId)] = id;
    if (id === null && node.mode === 'live') {
      live.push({
        scenarioId: node.scenarioId,
        version: node.version,
        nodeId: node.nodeId,
        persona: node.persona,
      });
    }
  }
  return { textPlan: nodes, live };
}

export type VariantPicker = (query: ApprovedQuery, rng: Rng) => Promise<string | null>;

/** Выбор id делает VariantPoolService.pick: здесь только сборка плана и live-слотов. */
export async function buildTextPlan(
  rng: Rng,
  shift: ShiftPlan,
  graphs: readonly ScenarioGraph[],
  pick: VariantPicker,
): Promise<TextAssembly> {
  const planned = plannedNodes(rng, shift, graphs);
  if (planned.length === 0) {
    return { textPlan: null, live: [] };
  }
  const nodes: Record<string, string | null> = {};
  const live: SessionTextRequestItem[] = [];
  for (const node of planned) {
    const id = await pick(node, rng.fork(`text:${node.scenarioId}:${node.nodeId}`));
    nodes[textPlanKey(node.scenarioId, node.nodeId)] = id;
    if (id === null && node.mode === 'live') {
      live.push({
        scenarioId: node.scenarioId,
        version: node.version,
        nodeId: node.nodeId,
        persona: node.persona,
      });
    }
  }
  return { textPlan: nodes, live };
}

function plannedNodes(rng: Rng, shift: ShiftPlan, graphs: readonly ScenarioGraph[]): PlannedNode[] {
  const planned: PlannedNode[] = [];
  for (const item of shift.scenarios) {
    const graph = graphs.find((candidate) => candidate.id === item.scenarioId);
    const mode = graph ? llmMode(graph) : null;
    if (!graph || mode === null) {
      continue;
    }
    const persona = personaOf(rng, graph);
    for (const nodeId of choiceNodeIds(graph)) {
      planned.push({
        scenarioId: item.scenarioId,
        version: item.version,
        nodeId,
        persona,
        mode,
      });
    }
  }
  return planned;
}

function choiceNodeIds(graph: ScenarioGraph): string[] {
  const ids: string[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!isEndNode(node)) {
      ids.push(id);
    }
  }
  return ids;
}

function byId(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
