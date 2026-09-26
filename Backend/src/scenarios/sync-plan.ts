import type { ScenarioGraph } from '../engine/schema';
import { graphChecksum } from './checksum';

export type VersionPlan = { kind: 'same' } | { kind: 'insert'; version: number; checksum: string };

/** Новая версия только когда канонический граф отличается от последней. */
export function planVersion(
  latest: { version: number; checksum: string } | null,
  graph: ScenarioGraph,
): VersionPlan {
  const checksum = graphChecksum(graph);
  if (latest?.checksum === checksum) {
    return { kind: 'same' };
  }
  return { kind: 'insert', version: (latest?.version ?? 0) + 1, checksum };
}

export function nextVersionNumber(latest: { version: number } | null): number {
  return (latest?.version ?? 0) + 1;
}
