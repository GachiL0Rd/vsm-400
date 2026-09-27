import {
  type DecisionNode,
  isEndNode,
  type ScenarioGraph,
  ScenarioGraphSchema,
} from '../engine/schema';

export type NodeSource = {
  text: string;
  choices: { id: string; text: string }[];
};

export function parseStoredGraph(raw: unknown): ScenarioGraph | null {
  const parsed = ScenarioGraphSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function decisionNodes(graph: ScenarioGraph): { id: string; node: DecisionNode }[] {
  const rows: { id: string; node: DecisionNode }[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!isEndNode(node)) {
      rows.push({ id, node });
    }
  }
  return rows;
}

export function sourceOf(node: DecisionNode): NodeSource {
  return {
    text: node.text,
    choices: node.choices.map((choice) => ({ id: choice.id, text: choice.text })),
  };
}

export function bundleText(source: NodeSource): string {
  return [source.text, ...source.choices.map((choice) => choice.text)].join('\n');
}
