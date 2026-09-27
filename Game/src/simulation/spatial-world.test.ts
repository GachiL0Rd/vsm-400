import { describe, expect, it } from 'vitest';
import { createGridWorld, type EdgeDefinition } from './grid-world';
import { createSpatialWorld, type SpatialWorld } from './spatial-world';

function link(
  id: string,
  from: string,
  to: string,
  cost: number,
  transitionCapacity = 1,
): EdgeDefinition {
  return {
    id,
    from,
    to,
    traversable: true,
    cost,
    transitionCapacity,
    fireTransferWeight: 0,
    pressureTransferWeight: 0,
  };
}

function world(edges: EdgeDefinition[], capacity = { a: 2, b: 1, c: 2 }): SpatialWorld {
  return createSpatialWorld({
    microsecondsPerCostUnit: 1_000,
    grid: createGridWorld({
      cells: [
        { id: 'a', x: 0, y: 0, capacity: capacity.a },
        { id: 'b', x: 1, y: 0, capacity: capacity.b },
        { id: 'c', x: 2, y: 0, capacity: capacity.c },
      ],
      edges,
    }),
    objectAnchorIds: ['seat'],
  });
}

describe('spatial world', () => {
  it('reserves destination and transition capacity until cancel or exact completion', () => {
    const spatial = world([link('ab', 'a', 'b', 2), link('bc', 'b', 'c', 2)]);
    spatial.addEntity('p2', 'a');
    spatial.addEntity('p1', 'a');
    const movement = spatial.startMovement('p1', 'ab', 0);

    expect(movement.arrivesAt).toBe(2_000);
    expect(spatial.entitiesAt('a')).toEqual(['p2']);
    expect(spatial.entitiesOnEdge('ab')).toEqual(['p1']);
    expect(() => spatial.startMovement('p2', 'ab', 0)).toThrow(RangeError);
    expect(spatial.route('a', 'b')).toBeNull();
    expect(spatial.entitiesOnEdge('ab')).toEqual(['p1']);

    spatial.cancelMovement('p1', 500);
    expect(spatial.entitiesAt('a')).toEqual(['p1', 'p2']);
    expect(spatial.entitiesOnEdge('ab')).toEqual([]);
    expect(spatial.route('a', 'b')?.edgeIds).toEqual(['ab']);

    spatial.startMovement('p2', 'ab', 500);
    spatial.materialize(2_499);
    expect(spatial.entitiesOnEdge('ab')).toEqual(['p2']);
    spatial.materialize(2_500);
    expect(spatial.entitiesAt('b')).toEqual(['p2']);
    expect(spatial.entitiesOnEdge('ab')).toEqual([]);
    expect(() => spatial.startMovement('p1', 'ab', 2_500)).toThrow(RangeError);
    expect(spatial.route('a', 'b')).toBeNull();

    spatial.startMovement('p2', 'bc', 2_500);
    expect(spatial.route('a', 'b')?.edgeIds).toEqual(['ab']);
    spatial.materialize(4_500);
    expect(spatial.entitiesAt('b')).toEqual([]);
    expect(spatial.entitiesAt('c')).toEqual(['p2']);
  });

  it('materializes progress along the directed edge and completes only at arrival', () => {
    const spatial = world([link('ab', 'a', 'b', 2)], { a: 1, b: 2, c: 1 });
    spatial.addEntity('mover', 'a');
    spatial.addEntity('resident', 'b');
    expect(() => spatial.startMovement('resident', 'ab', 0)).toThrow(RangeError);
    expect(spatial.route('b', 'a')).toBeNull();

    const started = spatial.startMovement('mover', 'ab', 1_000);
    expect(started.fromCellId).toBe('a');
    expect(started.toCellId).toBe('b');
    expect(spatial.positionAt('mover', 1_000)).toMatchObject({ kind: 'moving', progress: 0 });
    expect(spatial.positionAt('mover', 2_000)).toMatchObject({ kind: 'moving', progress: 0.5 });
    expect(spatial.positionAt('mover', started.arrivesAt)).toEqual({ kind: 'cell', cellId: 'b' });
    spatial.materialize(2_999);
    const beforeArrival = spatial.positionAt('mover', 2_999);
    expect(beforeArrival.kind).toBe('moving');
    if (beforeArrival.kind === 'moving') {
      expect(beforeArrival.progress).toBeGreaterThan(0.999);
      expect(beforeArrival.progress).toBeLessThan(1);
    }
    expect(spatial.entitiesAt('b')).toEqual(['resident']);

    spatial.materialize(started.arrivesAt);
    expect(spatial.time).toBe(started.arrivesAt);
    expect(spatial.positionAt('mover', started.arrivesAt)).toEqual({ kind: 'cell', cellId: 'b' });
    expect(spatial.entitiesAt('b')).toEqual(['mover', 'resident']);
    expect(spatial.entitiesOnEdge('ab')).toEqual([]);
    expect(() => spatial.materialize(started.arrivesAt - 1)).toThrow(RangeError);
  });

  it('rejects a full destination without taking the transition', () => {
    const spatial = world([link('ab', 'a', 'b', 1, 2)]);
    spatial.addEntity('held', 'b');
    spatial.addEntity('waiting', 'a');

    expect(() => spatial.startMovement('waiting', 'ab', 0)).toThrow(RangeError);
    expect(spatial.entitiesAt('a')).toEqual(['waiting']);
    expect(spatial.entitiesAt('b')).toEqual(['held']);
    expect(spatial.entitiesOnEdge('ab')).toEqual([]);
    expect(spatial.route('a', 'b')).toBeNull();
  });

  it('lists cell, edge, and attachment occupants in entity id order', () => {
    const spatial = world([link('ab', 'a', 'b', 1, 2)], { a: 3, b: 3, c: 1 });
    spatial.addEntity('c', 'a');
    spatial.addEntity('a', 'a');
    spatial.addEntity('b', 'a');
    expect(spatial.entitiesAt('a')).toEqual(['a', 'b', 'c']);

    spatial.attach('b', 'seat');
    spatial.attach('c', 'a');
    expect(spatial.entitiesAt('a')).toEqual(['a']);
    expect(spatial.entitiesAttachedTo('seat')).toEqual(['b']);
    expect(spatial.entitiesAttachedTo('a')).toEqual(['c']);

    spatial.addEntity('m', 'a');
    spatial.startMovement('m', 'ab', 0);
    spatial.startMovement('a', 'ab', 0);
    expect(spatial.entitiesOnEdge('ab')).toEqual(['a', 'm']);
  });

  it('rejects unsafe timing configuration and a non-integer movement duration', () => {
    const grid = createGridWorld({
      cells: [
        { id: 'a', x: 0, y: 0, capacity: 1 },
        { id: 'b', x: 1, y: 0, capacity: 1 },
      ],
      edges: [link('ab', 'a', 'b', 0.1)],
    });
    expect(() => createSpatialWorld({ grid, microsecondsPerCostUnit: 0 })).toThrow(RangeError);
    expect(() => createSpatialWorld({ grid, microsecondsPerCostUnit: 1.5 })).toThrow(RangeError);
    expect(() => createSpatialWorld({ grid, microsecondsPerCostUnit: -1_000 })).toThrow(RangeError);

    const spatial = createSpatialWorld({ grid, microsecondsPerCostUnit: 1 });
    spatial.addEntity('mover', 'a');
    expect(() => spatial.startMovement('mover', 'ab', 0)).toThrow(RangeError);
    expect(spatial.entitiesAt('a')).toEqual(['mover']);
  });
});
