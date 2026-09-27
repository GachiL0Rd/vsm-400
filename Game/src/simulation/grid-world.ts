import { DirectedGraph } from 'graphology';
import { dijkstra } from 'graphology-shortest-path';

/** JSON-compatible static cell. Capacity is a nonnegative occupant limit. */
export interface CellDefinition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly capacity: number;
  readonly movementSpeedMultiplier?: number;
}

/** Explicit directed transition. A reverse edge is never implied. */
export interface EdgeDefinition {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly traversable: boolean;
  readonly cost: number;
  readonly transitionCapacity: number;
  readonly fireTransferWeight: number;
  readonly pressureTransferWeight: number;
}

export interface GridDefinition {
  readonly cells: readonly CellDefinition[];
  readonly edges: readonly EdgeDefinition[];
}

/** Dynamic passability for one route query. This is not stored occupancy. */
export interface RouteConstraints {
  readonly blockedCellIds?: readonly string[];
  readonly blockedEdgeIds?: readonly string[];
  readonly cellOccupancy?: Readonly<Record<string, number>>;
  readonly edgeOccupancy?: Readonly<Record<string, number>>;
}

export interface GridRoute {
  readonly cells: readonly string[];
  readonly edgeIds: readonly string[];
  /** Sum of edge cost divided by the destination cell movement multiplier. */
  readonly cost: number;
}

export interface GridWorld {
  readonly cells: readonly CellDefinition[];
  readonly edges: readonly EdgeDefinition[];
  route(from: string, to: string, constraints?: RouteConstraints): GridRoute | null;
}

export function createGridWorld(definition: GridDefinition): GridWorld {
  if (!Array.isArray(definition.cells) || !Array.isArray(definition.edges)) {
    throw new RangeError('Grid definition requires cell and edge arrays');
  }
  const cells = new Map<string, CellDefinition>();
  for (const cell of definition.cells) {
    const id = validateCell(cell, cells);
    cells.set(id, Object.freeze({ ...cell }));
  }
  const edges = new Map<string, EdgeDefinition>();
  const edgeByPair = new Map<string, EdgeDefinition>();
  for (const edge of definition.edges) {
    const validated = validateEdge(edge, cells, edges, edgeByPair);
    const snapshot = Object.freeze({ ...validated });
    edges.set(snapshot.id, snapshot);
    edgeByPair.set(pairKey(snapshot.from, snapshot.to), snapshot);
  }
  return new StaticGrid(Object.freeze(sortedValues(cells)), Object.freeze(sortedValues(edges)));
}

class StaticGrid implements GridWorld {
  readonly cells: readonly CellDefinition[];
  readonly edges: readonly EdgeDefinition[];
  private readonly cellById: ReadonlyMap<string, CellDefinition>;
  private readonly edgeById: ReadonlyMap<string, EdgeDefinition>;
  constructor(cells: readonly CellDefinition[], edges: readonly EdgeDefinition[]) {
    this.cells = cells;
    this.edges = edges;
    this.cellById = new Map(cells.map((cell) => [cell.id, cell]));
    this.edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  }

  route(from: string, to: string, constraints?: RouteConstraints): GridRoute | null {
    if (!this.cellById.has(from) || !this.cellById.has(to)) {
      throw new RangeError('Route cell does not exist');
    }
    if (from === to) return { cells: [from], edgeIds: [], cost: 0 };

    const blockedCells = knownIds(constraints?.blockedCellIds, this.cellById, 'cell');
    const blockedEdges = knownIds(constraints?.blockedEdgeIds, this.edgeById, 'edge');
    const cellOccupancy = knownCounts(constraints?.cellOccupancy, this.cellById, 'Cell');
    const edgeOccupancy = knownCounts(constraints?.edgeOccupancy, this.edgeById, 'Edge');
    if (!canEnter(to, this.cellById, blockedCells, cellOccupancy)) return null;

    const { graph, usable } = buildRoutingGraph(
      this.cells,
      this.edges,
      this.cellById,
      from,
      blockedCells,
      blockedEdges,
      cellOccupancy,
      edgeOccupancy,
    );
    const found: unknown = dijkstra.bidirectional(graph, from, to, 'weight');
    return materializeRoute(found, usable, this.cellById);
  }
}

function buildRoutingGraph(
  cells: readonly CellDefinition[],
  edges: readonly EdgeDefinition[],
  cellById: ReadonlyMap<string, CellDefinition>,
  from: string,
  blockedCells: ReadonlySet<string>,
  blockedEdges: ReadonlySet<string>,
  cellOccupancy: ReadonlyMap<string, number>,
  edgeOccupancy: ReadonlyMap<string, number>,
): { readonly graph: DirectedGraph; readonly usable: ReadonlyMap<string, EdgeDefinition> } {
  const graph = new DirectedGraph();
  for (const cell of cells) {
    const enterable = cell.id === from || canEnter(cell.id, cellById, blockedCells, cellOccupancy);
    if (enterable) graph.addNode(cell.id);
  }
  const usable = new Map<string, EdgeDefinition>();
  for (const edge of edges) {
    if (!isUsableEdge(edge, graph, blockedEdges, edgeOccupancy)) continue;
    graph.addDirectedEdgeWithKey(edge.id, edge.from, edge.to, {
      weight: movementWeight(edge, cellById),
    });
    usable.set(pairKey(edge.from, edge.to), edge);
  }
  return { graph, usable };
}

function isUsableEdge(
  edge: EdgeDefinition,
  graph: DirectedGraph,
  blockedEdges: ReadonlySet<string>,
  edgeOccupancy: ReadonlyMap<string, number>,
): boolean {
  return (
    graph.hasNode(edge.from) &&
    graph.hasNode(edge.to) &&
    edge.traversable &&
    !blockedEdges.has(edge.id) &&
    countOf(edgeOccupancy, edge.id) < edge.transitionCapacity
  );
}

function materializeRoute(
  found: unknown,
  usable: ReadonlyMap<string, EdgeDefinition>,
  cellById: ReadonlyMap<string, CellDefinition>,
): GridRoute | null {
  if (!Array.isArray(found)) return null;
  const cells = found.map((node) => {
    if (typeof node !== 'string') throw new RangeError('Route path is incomplete');
    return node;
  });
  const edgeIds: string[] = [];
  let cost = 0;
  for (let index = 1; index < cells.length; index += 1) {
    const source = cells[index - 1];
    const target = cells[index];
    if (source === undefined || target === undefined)
      throw new RangeError('Route path is incomplete');
    const edge = usable.get(pairKey(source, target));
    if (edge === undefined) throw new RangeError('Route edge is missing');
    edgeIds.push(edge.id);
    cost += movementWeight(edge, cellById);
  }
  return { cells, edgeIds, cost };
}

function validateCell(cell: CellDefinition, cells: ReadonlyMap<string, CellDefinition>): string {
  const id = assertId(cell.id, 'Cell id');
  if (cells.has(id)) throw new RangeError(`Duplicate cell id ${id}`);
  assertFiniteNumber(cell.x, 'Cell x');
  assertFiniteNumber(cell.y, 'Cell y');
  assertNonnegativeInteger(cell.capacity, 'Cell capacity');
  if (cell.movementSpeedMultiplier !== undefined) {
    assertPositive(cell.movementSpeedMultiplier, 'Movement speed multiplier');
  }
  return id;
}

function validateEdge(
  edge: EdgeDefinition,
  cells: ReadonlyMap<string, CellDefinition>,
  edges: ReadonlyMap<string, EdgeDefinition>,
  edgeByPair: ReadonlyMap<string, EdgeDefinition>,
): EdgeDefinition {
  const id = assertId(edge.id, 'Edge id');
  if (edges.has(id)) throw new RangeError(`Duplicate edge id ${id}`);
  const from = assertId(edge.from, 'Edge from');
  const to = assertId(edge.to, 'Edge to');
  if (!cells.has(from) || !cells.has(to))
    throw new RangeError(`Edge ${id} references a missing cell`);
  if (from === to) throw new RangeError(`Edge ${id} must connect two different cells`);
  if (edgeByPair.has(pairKey(from, to)))
    throw new RangeError(`Duplicate directed edge from ${from} to ${to}`);
  if (typeof edge.traversable !== 'boolean')
    throw new RangeError(`Edge ${id} traversable must be boolean`);
  assertPositive(edge.cost, 'Edge cost');
  assertNonnegativeInteger(edge.transitionCapacity, 'Transition capacity');
  assertNonnegative(edge.fireTransferWeight, 'Fire transfer weight');
  assertNonnegative(edge.pressureTransferWeight, 'Pressure transfer weight');
  return edge;
}

function canEnter(
  cellId: string,
  cells: ReadonlyMap<string, CellDefinition>,
  blocked: ReadonlySet<string>,
  occupancy: ReadonlyMap<string, number>,
): boolean {
  const cell = cells.get(cellId);
  if (cell === undefined || blocked.has(cellId)) return false;
  return countOf(occupancy, cellId) < cell.capacity;
}

function movementWeight(edge: EdgeDefinition, cells: ReadonlyMap<string, CellDefinition>): number {
  const destination = cells.get(edge.to);
  const multiplier = destination?.movementSpeedMultiplier ?? 1;
  return assertPositive(edge.cost / multiplier, 'Effective movement cost');
}

function knownIds(
  ids: readonly string[] | undefined,
  known: ReadonlyMap<string, unknown>,
  label: string,
): Set<string> {
  const result = new Set<string>();
  if (ids === undefined) return result;
  for (const id of ids) {
    if (!known.has(id)) throw new RangeError(`Unknown ${label} ${id}`);
    result.add(id);
  }
  return result;
}

function knownCounts(
  counts: Readonly<Record<string, number>> | undefined,
  known: ReadonlyMap<string, unknown>,
  label: string,
): Map<string, number> {
  const result = new Map<string, number>();
  if (counts === undefined) return result;
  for (const id of Object.keys(counts).sort()) {
    if (!known.has(id)) throw new RangeError(`Unknown ${label.toLowerCase()} ${id}`);
    const value = counts[id];
    result.set(id, assertNonnegativeInteger(value, `${label} occupancy`));
  }
  return result;
}

function countOf(counts: ReadonlyMap<string, number>, id: string): number {
  return counts.get(id) ?? 0;
}

function pairKey(from: string, to: string): string {
  return `${from.length}:${from}${to}`;
}

function sortedValues<T extends { readonly id: string }>(values: ReadonlyMap<string, T>): T[] {
  return [...values.values()].sort((left, right) => compareIds(left.id, right.id));
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertId(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertFiniteNumber(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
  return value;
}

function assertNonnegative(value: number, label: string): number {
  const finite = assertFiniteNumber(value, label);
  if (finite < 0) throw new RangeError(`${label} must be nonnegative`);
  return finite;
}

function assertPositive(value: number, label: string): number {
  const finite = assertFiniteNumber(value, label);
  if (!(finite > 0)) throw new RangeError(`${label} must be positive`);
  return finite;
}

function assertNonnegativeInteger(value: number | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}
