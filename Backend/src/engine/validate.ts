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

type GraphInput = {
  start?: unknown;
  nodes?: unknown;
};

export function validateScenario(graph: GraphInput): ValidationResult {
  const errors: ValidationIssue[] = [];
  const nodes = readNodes(graph, errors);
  if (!nodes) {
    return { ok: false, errors };
  }
  checkStart(graph, nodes, errors);
  for (const [nodeId, node] of Object.entries(nodes)) {
    checkNode(nodeId, node, nodes, errors);
  }
  checkReachability(graph, nodes, errors);
  checkFinales(nodes, errors);
  checkFlags(nodes, errors);
  const ok = errors.every((issue) => issue.code === WARNING);
  return { ok, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNodes(graph: GraphInput, errors: ValidationIssue[]): Record<string, unknown> | null {
  if (!isRecord(graph.nodes)) {
    errors.push({ code: 'GRAPH_INVALID', path: 'nodes', message: 'nodes должен быть объектом' });
    return null;
  }
  return graph.nodes;
}

function checkStart(
  graph: GraphInput,
  nodes: Record<string, unknown>,
  errors: ValidationIssue[],
): void {
  if (typeof graph.start !== 'string' || nodes[graph.start] === undefined) {
    errors.push({ code: 'START_MISSING', path: 'start', message: 'стартовый узел не найден' });
  }
}

function checkNode(
  nodeId: string,
  node: unknown,
  nodes: Record<string, unknown>,
  errors: ValidationIssue[],
): void {
  if (!isRecord(node)) {
    errors.push({
      code: 'GRAPH_INVALID',
      path: `nodes.${nodeId}`,
      message: 'узел должен быть объектом',
    });
    return;
  }
  if (typeof node.end === 'string') {
    checkFinale(nodeId, node, errors);
    return;
  }
  checkTimer(nodeId, node, errors);
  checkChoices(nodeId, node, nodes, errors);
}

function checkFinale(
  nodeId: string,
  node: Record<string, unknown>,
  errors: ValidationIssue[],
): void {
  if (!Array.isArray(node.choices) || node.choices.length === 0) {
    return;
  }
  errors.push({
    code: 'FINALE_HAS_CHOICES',
    path: `nodes.${nodeId}.choices`,
    message: 'финал не содержит выборов',
  });
}

function checkTimer(
  nodeId: string,
  node: Record<string, unknown>,
  errors: ValidationIssue[],
): void {
  if (typeof node.timer !== 'number' || isRecord(node.onTimeout)) {
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
  node: Record<string, unknown>,
  nodes: Record<string, unknown>,
  errors: ValidationIssue[],
): void {
  const choices = Array.isArray(node.choices) ? node.choices : [];
  const seen = new Set<string>();
  for (const choice of choices) {
    checkChoice(nodeId, choice, seen, nodes, errors);
  }
  if (!isRecord(node.onTimeout)) {
    return;
  }
  const next = node.onTimeout.next;
  if (typeof next === 'string' && nodes[next] !== undefined) {
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
  choice: unknown,
  seen: Set<string>,
  nodes: Record<string, unknown>,
  errors: ValidationIssue[],
): void {
  if (!isRecord(choice)) {
    errors.push({
      code: 'GRAPH_INVALID',
      path: `nodes.${nodeId}.choices`,
      message: 'выбор должен быть объектом',
    });
    return;
  }
  const id = typeof choice.id === 'string' ? choice.id : '';
  if (id === '' || seen.has(id)) {
    errors.push({
      code: 'DUPLICATE_CHOICE_ID',
      path: `nodes.${nodeId}.choices.${id || '?'}`,
      message: 'id выбора повторяется в узле',
    });
  }
  if (id !== '') {
    seen.add(id);
  }
  const next = choice.next;
  if (typeof next === 'string' && nodes[next] !== undefined) {
    return;
  }
  errors.push({
    code: 'NEXT_MISSING',
    path: `nodes.${nodeId}.choices.${id || '?'}.next`,
    message: 'next не ведёт в узел',
  });
}

function checkReachability(
  graph: GraphInput,
  nodes: Record<string, unknown>,
  errors: ValidationIssue[],
): void {
  const seen = walkReachable(graph.start, nodes);
  for (const id of Object.keys(nodes).sort()) {
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

function walkReachable(start: unknown, nodes: Record<string, unknown>): Set<string> {
  const seen = new Set<string>();
  if (typeof start !== 'string' || nodes[start] === undefined) {
    return seen;
  }
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head];
    head += 1;
    if (id === undefined || seen.has(id)) {
      continue;
    }
    seen.add(id);
    for (const next of outgoing(nodes[id])) {
      if (nodes[next] !== undefined && !seen.has(next)) {
        queue.push(next);
      }
    }
  }
  return seen;
}

function outgoing(node: unknown): string[] {
  if (!isRecord(node) || typeof node.end === 'string') {
    return [];
  }
  const nexts: string[] = [];
  if (Array.isArray(node.choices)) {
    for (const choice of node.choices) {
      if (isRecord(choice) && typeof choice.next === 'string') {
        nexts.push(choice.next);
      }
    }
  }
  if (isRecord(node.onTimeout) && typeof node.onTimeout.next === 'string') {
    nexts.push(node.onTimeout.next);
  }
  return nexts;
}

function checkFinales(nodes: Record<string, unknown>, errors: ValidationIssue[]): void {
  for (const node of Object.values(nodes)) {
    if (isRecord(node) && typeof node.end === 'string') {
      return;
    }
  }
  errors.push({ code: 'NO_FINALE', path: 'nodes', message: 'в графе нет финала' });
}

function checkFlags(nodes: Record<string, unknown>, errors: ValidationIssue[]): void {
  const setFlags = collectSetFlags(nodes);
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!isRecord(node) || !Array.isArray(node.choices)) {
      continue;
    }
    for (const choice of node.choices) {
      warnRequires(nodeId, choice, setFlags, errors);
    }
  }
}

function collectSetFlags(nodes: Record<string, unknown>): Set<string> {
  const flags = new Set<string>();
  for (const node of Object.values(nodes)) {
    if (!isRecord(node)) {
      continue;
    }
    absorbSet(node.onTimeout, flags);
    if (!Array.isArray(node.choices)) {
      continue;
    }
    for (const choice of node.choices) {
      absorbSet(choice, flags);
    }
  }
  return flags;
}

function absorbSet(source: unknown, flags: Set<string>): void {
  if (!isRecord(source) || !Array.isArray(source.set)) {
    return;
  }
  for (const flag of source.set) {
    if (typeof flag === 'string') {
      flags.add(flag);
    }
  }
}

function warnRequires(
  nodeId: string,
  choice: unknown,
  setFlags: Set<string>,
  errors: ValidationIssue[],
): void {
  if (!isRecord(choice) || !isRecord(choice.requires) || !Array.isArray(choice.requires.flags)) {
    return;
  }
  const choiceId = typeof choice.id === 'string' ? choice.id : '?';
  for (const flag of choice.requires.flags) {
    if (typeof flag !== 'string' || setFlags.has(flag)) {
      continue;
    }
    errors.push({
      code: WARNING,
      path: `nodes.${nodeId}.choices.${choiceId}.requires.flags.${flag}`,
      message: `флаг ${flag} нигде не ставится`,
    });
  }
}
