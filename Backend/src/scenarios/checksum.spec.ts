import { describe, expect, it } from 'vitest';
import { canonicalJson, graphChecksum } from './checksum';
import { loadScenarioGraphs } from './load-content';
import { planVersion } from './sync-plan';

describe('checksum сценария', () => {
  it('не зависит от порядка ключей', () => {
    const left = { b: 1, a: { d: 1, c: [2, { z: 1, y: 2 }] } };
    const right = { a: { c: [2, { y: 2, z: 1 }], d: 1 }, b: 1 };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(graphChecksum(left)).toHaveLength(64);
  });

  it('тот же граф не требует новой версии, правка title — требует', () => {
    const graph = loadScenarioGraphs()[0];
    expect(graph).toBeTruthy();
    if (!graph) {
      return;
    }
    const checksum = graphChecksum(graph);
    expect(planVersion({ version: 4, checksum }, graph)).toEqual({ kind: 'same' });
    const edited = { ...graph, title: `${graph.title} 2` };
    const plan = planVersion({ version: 4, checksum }, edited);
    expect(plan).toEqual({
      kind: 'insert',
      version: 5,
      checksum: graphChecksum(edited),
    });
    expect(planVersion(null, graph)).toMatchObject({ kind: 'insert', version: 1 });
  });
});
