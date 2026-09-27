import { describe, expect, it } from 'vitest';
import { loadScenarioGraphs } from '../scenarios/load-content';

describe('llm в сценариях', () => {
  it('включает пул только у трёх рейсов', () => {
    const graphs = loadScenarioGraphs();
    const enabled = graphs.filter((graph) => graph.llm?.enabled).map((graph) => graph.id);
    expect(enabled.sort()).toEqual(['ride-one-seat', 'ride-pressure', 'ride-unwell']);
    for (const graph of graphs.filter((item) => item.llm?.enabled)) {
      expect(graph.llm?.mode).toBe('pool');
      expect(graph.llm?.keep?.length).toBeGreaterThan(0);
      expect(graph.llm?.forbid).toEqual(['medications', 'numbers', 'names', 'new-facts']);
      expect(graph.llm?.personas?.length).toBeGreaterThan(1);
    }
  });
});
