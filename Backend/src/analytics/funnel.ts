import { ratio } from './ratio';

export type FunnelRow = {
  nodeId: string;
  choiceId: string;
  count: number;
};

export function buildFunnel(scenarioId: string, title: string, rows: readonly FunnelRow[]) {
  const nodes = groupNodes(rows);
  const ordered = [...nodes.entries()];
  ordered.sort(
    (left, right) => right[1].visits - left[1].visits || left[0].localeCompare(right[0]),
  );
  let decisions = 0;
  const view = [];
  for (const [nodeId, node] of ordered) {
    decisions += node.visits;
    node.choices.sort(
      (left, right) => right.count - left.count || left.choiceId.localeCompare(right.choiceId),
    );
    view.push({
      nodeId,
      visits: node.visits,
      timeoutCount: node.timeoutCount,
      timeoutShare: ratio(node.timeoutCount, node.visits),
      choices: node.choices.map((choice) => ({
        choiceId: choice.choiceId,
        count: choice.count,
        share: ratio(choice.count, node.visits),
      })),
    });
  }
  return { scenarioId, title, decisions, nodes: view };
}

function groupNodes(rows: readonly FunnelRow[]) {
  const nodes = new Map<
    string,
    { visits: number; timeoutCount: number; choices: { choiceId: string; count: number }[] }
  >();
  for (const row of rows) {
    const node = ensureNode(nodes, row.nodeId);
    node.visits += row.count;
    if (row.choiceId === 'timeout') {
      node.timeoutCount += row.count;
    }
    node.choices.push({ choiceId: row.choiceId, count: row.count });
  }
  return nodes;
}

function ensureNode(
  nodes: Map<
    string,
    { visits: number; timeoutCount: number; choices: { choiceId: string; count: number }[] }
  >,
  nodeId: string,
) {
  const existing = nodes.get(nodeId);
  if (existing) {
    return existing;
  }
  const created = { visits: 0, timeoutCount: 0, choices: [] };
  nodes.set(nodeId, created);
  return created;
}
