import { type DecisionNode, isEndNode, type ScenarioGraph, type ScenarioNode } from './schema';

export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
};

const WARNING = 'FLAG_NEVER_SET';

type Choice = DecisionNode['choices'][number];

/**
 * Связность уже разобранного графа. Форму ловит ScenarioGraphSchema,
 * здесь — next, старт, финал, таймер без onTimeout и флаги requires.
 */
export function validateScenario(graph: ScenarioGraph): ValidationResult {
  const errors: ValidationIssue[] = [];
  const nodes = graph.nodes;
  checkStart(graph, errors);
  for (const [nodeId, node] of Object.entries(nodes)) {
    checkNode(nodeId, node, nodes, errors);
  }
  checkReachability(graph, errors);
  checkFinales(nodes, errors);
  checkFlags(nodes, errors);
  const ok = errors.every((issue) => issue.code === WARNING);
  return { ok, errors };
}

function checkStart(graph: ScenarioGraph, errors: ValidationIssue[]): void {
  if (graph.nodes[graph.start] === undefined) {
    errors.push({ code: 'START_MISSING', path: 'start', message: 'стартовый узел не найден' });
  }
}

function checkNode(
  nodeId: string,
  node: ScenarioNode,
  nodes: ScenarioGraph['nodes'],
  errors: ValidationIssue[],
): void {
  if (isEndNode(node)) {
    return;
  }
  checkTimer(nodeId, node, errors);
  checkChoices(nodeId, node, nodes, errors);
}

function checkTimer(nodeId: string, node: DecisionNode, errors: ValidationIssue[]): void {
  if (typeof node.timer !== 'number' || node.onTimeout) {
    return;
  }
  errors.push({
    code: 'TIMEOUT_WITHOUT_HANDLER',
    path: `nodes.${nodeId}.onTimeout`,
    message: 'у узла с таймером нет onTimeout',
  });
}

function checkChoices(
  nodeId: string,
  node: DecisionNode,
  nodes: ScenarioGraph['nodes'],
  errors: ValidationIssue[],
): void {
  const seen = new Set<string>();
  for (const choice of node.choices) {
    checkChoice(nodeId, choice, seen, nodes, errors);
  }
  const timeout = node.onTimeout;
  if (!timeout) {
    return;
  }
  if (nodes[timeout.next] !== undefined) {
    return;
  }
  errors.push({
    code: 'NEXT_MISSING',
    path: `nodes.${nodeId}.onTimeout.next`,
    message: 'onTimeout.next не ведёт в узел',
  });
}

function checkChoice(
  nodeId: string,
  choice: Choice,
  seen: Set<string>,
  nodes: ScenarioGraph['nodes'],
  errors: ValidationIssue[],
): void {
  if (seen.has(choice.id)) {
    errors.push({
      code: 'DUPLICATE_CHOICE_ID',
      path: `nodes.${nodeId}.choices.${choice.id}`,
      message: 'id выбора повторяется в узле',
    });
  }
  seen.add(choice.id);
  if (nodes[choice.next] !== undefined) {
    return;
  }
  errors.push({
    code: 'NEXT_MISSING',
    path: `nodes.${nodeId}.choices.${choice.id}.next`,
    message: 'next не ведёт в узел',
  });
}

function checkReachability(graph: ScenarioGraph, errors: ValidationIssue[]): void {
  const seen = walkReachable(graph);
  for (const id of Object.keys(graph.nodes).sort()) {
    if (seen.has(id)) {
      continue;
    }
    errors.push({
      code: 'UNREACHABLE_NODE',
      path: `nodes.${id}`,
      message: 'узел недостижим из start',
    });
  }
}

function walkReachable(graph: ScenarioGraph): Set<string> {
  const seen = new Set<string>();
  if (graph.nodes[graph.start] === undefined) {
    return seen;
  }
  const queue = [graph.start];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head];
    head += 1;
    if (id === undefined || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const node = graph.nodes[id];
    for (const next of outgoing(node)) {
      if (graph.nodes[next] !== undefined && !seen.has(next)) {
        queue.push(next);
      }
    }
  }
  return seen;
}

function outgoing(node: ScenarioNode | undefined): string[] {
  if (!node || isEndNode(node)) {
    return [];
  }
  const nexts = node.choices.map((choice) => choice.next);
  if (node.onTimeout) {
    nexts.push(node.onTimeout.next);
  }
  return nexts;
}

function checkFinales(nodes: ScenarioGraph['nodes'], errors: ValidationIssue[]): void {
  for (const node of Object.values(nodes)) {
    if (isEndNode(node)) {
      return;
    }
  }
  errors.push({ code: 'NO_FINALE', path: 'nodes', message: 'в графе нет финала' });
}

function checkFlags(nodes: ScenarioGraph['nodes'], errors: ValidationIssue[]): void {
  const setFlags = collectSetFlags(nodes);
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (isEndNode(node)) {
      continue;
    }
    for (const choice of node.choices) {
      warnRequires(nodeId, choice, setFlags, errors);
    }
  }
}

function collectSetFlags(nodes: ScenarioGraph['nodes']): Set<string> {
  const flags = new Set<string>();
  for (const node of Object.values(nodes)) {
    if (isEndNode(node)) {
      continue;
    }
    absorb(node.onTimeout?.set, flags);
    for (const choice of node.choices) {
      absorb(choice.set, flags);
    }
  }
  return flags;
}

function absorb(source: readonly string[] | undefined, flags: Set<string>): void {
  if (!source) {
    return;
  }
  for (const flag of source) {
    flags.add(flag);
  }
}

function warnRequires(
  nodeId: string,
  choice: Choice,
  setFlags: Set<string>,
  errors: ValidationIssue[],
): void {
  const required = choice.requires?.flags;
  if (!required) {
    return;
  }
  for (const flag of required) {
    if (setFlags.has(flag)) {
      continue;
    }
    errors.push({
      code: WARNING,
      path: `nodes.${nodeId}.choices.${choice.id}.requires.flags.${flag}`,
      message: `флаг ${flag} нигде не ставится`,
    });
  }
}
