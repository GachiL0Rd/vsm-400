import { describe, expect, it } from 'vitest';
import {
  type CellDefinition,
  createGridWorld,
  type EdgeDefinition,
  type GridDefinition,
} from './grid-world';

function cell(
  id: string,
  x: number,
  y: number,
  capacity = 2,
  movementSpeedMultiplier?: number,
): CellDefinition {
  if (movementSpeedMultiplier === undefined) return { id, x, y, capacity };
  return { id, x, y, capacity, movementSpeedMultiplier };
}

function edge(
  id: string,
  from: string,
  to: string,
  cost: number,
  patch?: Partial<Omit<EdgeDefinition, 'id' | 'from' | 'to' | 'cost'>>,
): EdgeDefinition {
  return {
    id,
    from,
    to,
    traversable: patch?.traversable ?? true,
    cost,
    transitionCapacity: patch?.transitionCapacity ?? 2,
    fireTransferWeight: patch?.fireTransferWeight ?? 0,
    pressureTransferWeight: patch?.pressureTransferWeight ?? 0,
  };
}

const square: GridDefinition = {
  cells: [cell('a', 0, 0), cell('b', 1, 0), cell('c', 0, 1), cell('d', 1, 1)],
  edges: [
    edge('ab', 'a', 'b', 1),
    edge('bd', 'b', 'd', 10),
    edge('ac', 'a', 'c', 2),
    edge('cd', 'c', 'd', 2),
  ],
};

describe('grid world', () => {
  it('routes only along declared directed edges', () => {
    const world = createGridWorld({
      cells: [cell('a', 0, 0), cell('b', 1, 0)],
      edges: [edge('door', 'a', 'b', 3, { fireTransferWeight: 0.5, pressureTransferWeight: 0.25 })],
    });

    expect(world.edges.map((item) => item.id)).toEqual(['door']);
    expect(world.route('a', 'b')).toEqual({ cells: ['a', 'b'], edgeIds: ['door'], cost: 3 });
    expect(world.route('b', 'a')).toBeNull();
  });

  it('prefers the lower movement cost, including the destination speed multiplier', () => {
    const byCost = createGridWorld(square);
    expect(byCost.route('a', 'd')).toEqual({
      cells: ['a', 'c', 'd'],
      edgeIds: ['ac', 'cd'],
      cost: 4,
    });

    const spedUp = createGridWorld({
      cells: [cell('a', 0, 0), cell('b', 1, 0), cell('c', 0, 1, 2, 4), cell('d', 1, 1)],
      edges: [
        edge('ab', 'a', 'b', 5),
        edge('bd', 'b', 'd', 1),
        edge('ac', 'a', 'c', 8),
        edge('cd', 'c', 'd', 1),
      ],
    });
    expect(spedUp.route('a', 'd')?.cells).toEqual(['a', 'c', 'd']);
    expect(spedUp.route('a', 'd')?.cost).toBe(3);
  });

  it('omits a dynamically blocked edge or cell and a full transition or cell', () => {
    const world = createGridWorld(square);

    expect(world.route('a', 'd', { blockedEdgeIds: ['ac', 'cd'] })?.cells).toEqual(['a', 'b', 'd']);
    expect(world.route('a', 'd', { blockedCellIds: ['c'] })?.cells).toEqual(['a', 'b', 'd']);
    expect(world.route('a', 'd', { edgeOccupancy: { ab: 2 } })?.edgeIds).toEqual(['ac', 'cd']);
    expect(world.route('a', 'd', { cellOccupancy: { b: 2 } })?.cells).toEqual(['a', 'c', 'd']);

    const closed = createGridWorld({
      cells: square.cells,
      edges: square.edges.map((item) =>
        item.id === 'ac' ? { ...item, traversable: false } : item,
      ),
    });
    expect(closed.route('a', 'd')?.edgeIds).not.toContain('ac');
  });

  it('breaks equal-cost ties by stable edge id order', () => {
    const world = createGridWorld({
      cells: [cell('a', 0, 0), cell('b', 1, 0), cell('c', 0, 1), cell('d', 1, 1)],
      edges: [
        edge('cd', 'c', 'd', 1),
        edge('ac', 'a', 'c', 1),
        edge('bd', 'b', 'd', 1),
        edge('ab', 'a', 'b', 1),
      ],
    });

    expect(world.route('a', 'd')).toEqual({
      cells: ['a', 'b', 'd'],
      edgeIds: ['ab', 'bd'],
      cost: 2,
    });
    expect(world.route('a', 'd')).toEqual(world.route('a', 'd'));
  });

  it('returns no route when the cells are disconnected or the target cannot be entered', () => {
    const world = createGridWorld({
      cells: [cell('a', 0, 0), cell('b', 1, 0, 1), cell('z', 5, 5)],
      edges: [edge('ab', 'a', 'b', 1, { transitionCapacity: 1 })],
    });

    expect(world.route('a', 'z')).toBeNull();
    expect(world.route('a', 'b', { blockedEdgeIds: ['ab'] })).toBeNull();
    expect(world.route('a', 'b', { cellOccupancy: { b: 1 } })).toBeNull();
    expect(world.route('a', 'a', { cellOccupancy: { a: 9 } })).toEqual({
      cells: ['a'],
      edgeIds: [],
      cost: 0,
    });
    expect(() => world.route('a', 'missing')).toThrow(RangeError);
  });

  it('keeps validated topology stable when authoring data changes later', () => {
    const destination = { id: 'b', x: 1, y: 0, capacity: 1 };
    const transition = {
      id: 'ab',
      from: 'a',
      to: 'b',
      traversable: true,
      cost: 2,
      transitionCapacity: 1,
      fireTransferWeight: 0,
      pressureTransferWeight: 0,
    };
    const world = createGridWorld({ cells: [cell('a', 0, 0), destination], edges: [transition] });
    destination.capacity = 0;
    transition.cost = 100;
    transition.traversable = false;

    expect(world.route('a', 'b')).toEqual({ cells: ['a', 'b'], edgeIds: ['ab'], cost: 2 });
    expect(world.cells[1]?.capacity).toBe(1);
    expect(world.edges[0]?.traversable).toBe(true);
  });

  it('rejects duplicate ids, missing endpoints, and invalid numbers', () => {
    const cells = [cell('a', 0, 0), cell('b', 1, 0)];
    expect(() => createGridWorld({ cells: [cell('a', 0, 0), cell('a', 1, 1)], edges: [] })).toThrow(
      RangeError,
    );
    expect(() =>
      createGridWorld({ cells, edges: [edge('ab', 'a', 'b', 1), edge('ab', 'b', 'a', 1)] }),
    ).toThrow(RangeError);
    expect(() => createGridWorld({ cells, edges: [edge('gone', 'a', 'missing', 1)] })).toThrow(
      RangeError,
    );
    expect(() => createGridWorld({ cells: [cell('a', 0, 0, -1)], edges: [] })).toThrow(RangeError);
    expect(() => createGridWorld({ cells, edges: [edge('ab', 'a', 'b', 0)] })).toThrow(RangeError);
    expect(() =>
      createGridWorld({
        cells,
        edges: [edge('ab', 'a', 'b', 1, { fireTransferWeight: -0.1 })],
      }),
    ).toThrow(RangeError);
    expect(() =>
      createGridWorld({ cells: [cell('a', Number.NaN, 0), cell('b', 1, 0)], edges: [] }),
    ).toThrow(RangeError);
    expect(() =>
      createGridWorld({ cells: [cell('a', 0, 0, 1, 0), cell('b', 1, 0)], edges: [] }),
    ).toThrow(RangeError);
    expect(() => worldWithBadCapacity()).toThrow(RangeError);
  });
});

function worldWithBadCapacity() {
  return createGridWorld({
    cells: [cell('a', 0, 0), cell('b', 1, 0)],
    edges: [edge('ab', 'a', 'b', 1, { transitionCapacity: -1 })],
  });
}
