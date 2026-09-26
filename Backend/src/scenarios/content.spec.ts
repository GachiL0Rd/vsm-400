import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type DecisionNode, isEndNode, type ScenarioGraph } from '../engine/schema';
import { loadScenarioFile, loadScenarioGraphs, scenariosDir } from './load-content';

const LINE = 140;
const BASIS_PREFIXES = [
  'Ситуации на борту.pdf',
  'ИОТ ВСМ-2026',
  '974_р от 12.05.2026',
  'СТО РЖД 03.014–2026',
];

describe('content/scenarios', () => {
  const graphs = loadScenarioGraphs();

  it('покрывает классы, этапы и категории', () => {
    expect(graphs.length).toBeGreaterThanOrEqual(10);
    expect(new Set(graphs.map((graph) => graph.stage))).toEqual(
      new Set(['acceptance', 'boarding', 'enroute', 'stop', 'handover']),
    );
    expect(new Set(graphs.map((graph) => graph.category))).toEqual(
      new Set(['medical', 'conflict', 'safety', 'technical', 'service', 'security']),
    );
    for (const carClass of ['ECONOMY', 'FAMILY', 'BUSINESS', 'FIRST'] as const) {
      const own = graphs.some(
        (graph) => graph.carClasses.length === 1 && graph.carClasses[0] === carClass,
      );
      expect(own, carClass).toBe(true);
    }
  });

  it('имя файла совпадает с id', () => {
    const dir = scenariosDir();
    const names = readdirSync(dir).filter((name) => name.endsWith('.yaml'));
    expect(names.length).toBe(graphs.length);
    for (const name of names) {
      const graph = loadScenarioFile(path.join(dir, name));
      expect(graph.id).toBe(name.slice(0, -'.yaml'.length));
    }
  });

  it('каждый граф играбелен', () => {
    for (const graph of graphs) {
      assertGraph(graph);
    }
  });
});

function assertGraph(graph: ScenarioGraph): void {
  const nodes = graph.nodes;
  expect(nodes[graph.start], graph.id).toBeTruthy();
  const ids = Object.keys(nodes);
  expect(ids.length).toBeGreaterThanOrEqual(4);
  expect(ids.length).toBeLessThanOrEqual(8);
  const ends = Object.values(nodes).filter(isEndNode);
  expect(ends.length).toBeGreaterThanOrEqual(2);
  expect(ends.length).toBeLessThanOrEqual(3);
  expect(new Set(ends.map((node) => node.end)).size).toBeGreaterThanOrEqual(2);

  const facts = {
    timers: 0,
    conflict: false,
    deviation: false,
    requires: false,
    flags: false,
    variants: false,
  };
  const defined = new Set<string>();
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (isEndNode(node)) {
      expect(node.text.length, `${graph.id}:${nodeId}`).toBeLessThanOrEqual(LINE);
      continue;
    }
    const piece = assertDecision(graph, nodeId, node);
    facts.timers += piece.timers;
    facts.conflict = facts.conflict || piece.conflict;
    facts.deviation = facts.deviation || piece.deviation;
    facts.requires = facts.requires || piece.requires;
    facts.flags = facts.flags || piece.flags;
    facts.variants = facts.variants || piece.variants;
    for (const flag of piece.defined) {
      defined.add(flag);
    }
  }
  expect(facts.timers, graph.id).toBeGreaterThanOrEqual(2);
  expect(facts.conflict, graph.id).toBe(true);
  expect(facts.deviation, graph.id).toBe(true);
  expect(facts.requires, graph.id).toBe(true);
  expect(facts.flags, graph.id).toBe(true);
  expect(facts.variants, graph.id).toBe(true);
  assertFlagsDefined(graph, defined);
  assertReachable(graph);
}

function assertFlagsDefined(graph: ScenarioGraph, defined: Set<string>): void {
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (isEndNode(node)) {
      continue;
    }
    for (const choice of node.choices) {
      for (const flag of choice.requires?.flags ?? []) {
        expect(defined.has(flag), `${graph.id}:${nodeId}:${flag}`).toBe(true);
      }
    }
  }
}

function assertReachable(graph: ScenarioGraph): void {
  const seen = new Set<string>();
  const queue = [graph.start];
  while (queue.length > 0) {
    const nodeId = queue.pop();
    if (!nodeId || seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    const node = graph.nodes[nodeId];
    if (!node || isEndNode(node)) {
      continue;
    }
    for (const choice of node.choices) {
      queue.push(choice.next);
    }
    if (node.onTimeout) {
      queue.push(node.onTimeout.next);
    }
  }
  expect([...seen].sort()).toEqual(Object.keys(graph.nodes).sort());
}

type Piece = {
  timers: number;
  conflict: boolean;
  deviation: boolean;
  requires: boolean;
  flags: boolean;
  variants: boolean;
  defined: string[];
};

function assertDecision(graph: ScenarioGraph, nodeId: string, node: DecisionNode): Piece {
  const where = `${graph.id}:${nodeId}`;
  expect(node.text.length, where).toBeLessThanOrEqual(LINE);
  const piece = emptyPiece();
  assertVariants(graph, node, where, piece);
  const routes = assertChoices(graph, node, where, piece);
  assertTimer(graph, node, where, piece, routes);
  return piece;
}

function assertVariants(
  graph: ScenarioGraph,
  node: DecisionNode,
  where: string,
  piece: Piece,
): void {
  piece.variants = (node.variants?.length ?? 0) > 0;
  for (const variant of node.variants ?? []) {
    expect(variant.text.length, where).toBeLessThanOrEqual(LINE);
    const param = variant.if.param;
    expect(param, where).toBeTruthy();
    expect(graph.params?.[param ?? ''], where).toBeTruthy();
  }
}

function assertChoices(
  graph: ScenarioGraph,
  node: DecisionNode,
  where: string,
  piece: Piece,
): { nexts: string[]; bestNext: string[] } {
  const ids = new Set<string>();
  const nexts: string[] = [];
  const bestNext: string[] = [];
  for (const choice of node.choices) {
    expect(ids.has(choice.id), where).toBe(false);
    ids.add(choice.id);
    expect(graph.nodes[choice.next], `${where}:${choice.id}`).toBeTruthy();
    expect(choice.text.length, `${where}:${choice.id}`).toBeLessThanOrEqual(LINE);
    nexts.push(choice.next);
    if (choice.verdict === 'best') {
      bestNext.push(choice.next);
    }
    assertSuboptimal(where, choice);
    piece.conflict = piece.conflict || isConflict(choice.effects);
    piece.deviation = piece.deviation || choice.deviation === true;
    piece.requires = piece.requires || choice.requires !== undefined;
    if (choice.set) {
      piece.flags = true;
      piece.defined.push(...choice.set);
    }
  }
  return { nexts, bestNext };
}

function assertTimer(
  graph: ScenarioGraph,
  node: DecisionNode,
  where: string,
  piece: Piece,
  routes: { nexts: string[]; bestNext: string[] },
): void {
  if (node.timer == null) {
    expect(node.onTimeout, where).toBeUndefined();
    return;
  }
  piece.timers = 1;
  expect(routes.bestNext.length, where).toBeGreaterThan(0);
  const timeout = node.onTimeout;
  expect(timeout, where).toBeTruthy();
  if (!timeout) {
    return;
  }
  expect(graph.nodes[timeout.next], where).toBeTruthy();
  expect(timeout.consequence, where).toBeTruthy();
  expect((timeout.consequence ?? '').length, where).toBeLessThanOrEqual(LINE);
  expect(routes.nexts, where).not.toContain(timeout.next);
  expect(routes.bestNext, where).not.toContain(timeout.next);
  if (timeout.set) {
    piece.flags = true;
    piece.defined.push(...timeout.set);
  }
}

function assertSuboptimal(where: string, choice: DecisionNode['choices'][number]): void {
  if (choice.verdict !== 'worse' && choice.verdict !== 'ok') {
    return;
  }
  expect(choice.better, `${where}:${choice.id}`).toBeTruthy();
  expect(choice.basis, `${where}:${choice.id}`).toBeTruthy();
  expect((choice.better ?? '').length, choice.better).toBeLessThanOrEqual(LINE);
  expect((choice.basis ?? '').length, choice.basis).toBeLessThanOrEqual(LINE);
  const known = BASIS_PREFIXES.some((prefix) => (choice.basis ?? '').startsWith(prefix));
  expect(known, choice.basis).toBe(true);
}

function isConflict(effects: DecisionNode['choices'][number]['effects']): boolean {
  return (effects?.loyalty ?? 0) > 0 && (effects?.safety ?? 0) < 0;
}

function emptyPiece(): Piece {
  return {
    timers: 0,
    conflict: false,
    deviation: false,
    requires: false,
    flags: false,
    variants: false,
    defined: [],
  };
}
