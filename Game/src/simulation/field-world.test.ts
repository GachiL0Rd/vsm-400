import { describe, expect, it } from 'vitest';
import { type CellFieldMaterial, createFieldWorld } from './field-world';
import { createGridWorld, type EdgeDefinition } from './grid-world';

function cell(id: string, x: number): { id: string; x: number; y: number; capacity: number } {
  return { id, x, y: 0, capacity: 1 };
}

function link(
  id: string,
  from: string,
  to: string,
  fire: number,
  pressure: number,
): EdgeDefinition {
  return {
    id,
    from,
    to,
    traversable: true,
    cost: 1,
    transitionCapacity: 1,
    fireTransferWeight: fire,
    pressureTransferWeight: pressure,
  };
}

function material(cellId: string, patch: Partial<CellFieldMaterial> = {}): CellFieldMaterial {
  return {
    cellId,
    flammability: 0,
    growth: 0,
    decay: 0,
    permeability: 1,
    leak: 0,
    ...patch,
  };
}

function twoCells(edges: EdgeDefinition[]) {
  return createGridWorld({
    cells: [cell('a', 0), cell('b', 1)],
    edges,
  });
}

describe('field world', () => {
  it('transfers fire only along a directed edge and uses the previous stencil', () => {
    const directed = createFieldWorld(twoCells([link('ab', 'a', 'b', 0.25, 0)]), {
      cells: [material('a', { initialFire: 4 }), material('b')],
    });
    directed.step();
    expect(directed.snapshot().map((cell) => cell.fire)).toEqual([4, 1]);
    directed.step();
    expect(directed.snapshot().map((cell) => cell.fire)).toEqual([4, 2]);

    const mutual = createFieldWorld(
      twoCells([link('ab', 'a', 'b', 0.5, 0), link('ba', 'b', 'a', 0.5, 0)]),
      { cells: [material('a', { initialFire: 4 }), material('b', { initialFire: 1 })] },
    );
    mutual.step();
    expect(mutual.snapshot().map((cell) => cell.fire)).toEqual([4.5, 3]);
  });

  it('grows and damps fire from material coefficients and a local source', () => {
    const grid = createGridWorld({ cells: [cell('a', 0)], edges: [] });
    const growing = createFieldWorld(grid, {
      cells: [material('a', { initialFire: 1, flammability: 1, growth: 0.5 })],
    });
    growing.step();
    expect(growing.snapshot()[0]?.fire).toBe(1.5);

    const damping = createFieldWorld(grid, {
      cells: [material('a', { initialFire: 1, decay: 0.25 })],
    });
    damping.step();
    expect(damping.snapshot()[0]?.fire).toBe(0.75);

    const clamped = createFieldWorld(grid, {
      cells: [material('a', { fireSource: 0.5, decay: 1 })],
    });
    clamped.step();
    expect(clamped.snapshot()[0]?.fire).toBe(0);

    const sourced = createFieldWorld(grid, { cells: [material('a')] });
    sourced.setFireSource('a', 0.5);
    sourced.step();
    expect(sourced.snapshot()[0]?.fire).toBe(0.5);
  });

  it('burns finite fuel with dt and gates neighbour spread from remaining fuel', () => {
    const fields = createFieldWorld(twoCells([link('ab', 'a', 'b', 1, 0)]), {
      cells: [
        material('a', {
          initialFire: 1,
          initialFuel: 1,
          burnRate: 0.2,
          growth: 0.2,
          flammability: 1,
        }),
        material('b', {
          initialFuel: 0.2,
          spreadFuelScale: 1,
          spreadGateThreshold: 0.5,
          spreadGain: 0.5,
        }),
      ],
    });

    fields.step(2);
    expect(fields.snapshot()[0]).toMatchObject({ fuel: 0.6, fire: 1.4 });
    expect(fields.snapshot()[1]?.fire).toBeCloseTo(0.3);
  });

  it('applies pressure permeability, leak, and a runtime door scale', () => {
    const fields = createFieldWorld(twoCells([link('ab', 'a', 'b', 0, 1)]), {
      cells: [
        material('a', { initialPressure: 4 }),
        material('b', { permeability: 0.5, leak: 0.5, pressureThreshold: 1 }),
      ],
    });

    const opened = fields.step();
    expect(fields.snapshot()[1]?.pressure).toBe(1.5);
    expect(opened).toEqual([
      { field: 'pressure', cellId: 'b', direction: 'reached', value: 1.5, step: 1 },
    ]);

    fields.setEdgeTransferScale('ab', { pressure: 0 });
    fields.step();
    expect(fields.snapshot()[1]?.pressure).toBe(1);
    expect(fields.step()).toEqual([
      { field: 'pressure', cellId: 'b', direction: 'cleared', value: 0.5, step: 3 },
    ]);

    fields.setEdgeTransferScale('ab', { pressure: 1 });
    fields.step();
    expect(fields.snapshot()[1]?.pressure).toBe(2);
  });

  it('emits each threshold crossing once, in cell and field order', () => {
    const grid = createGridWorld({
      cells: [cell('b', 1), cell('a', 0)],
      edges: [],
    });
    const fields = createFieldWorld(grid, {
      cells: [
        material('b', {
          fireSource: 1,
          pressureSource: 1,
          fireThreshold: 1,
          pressureThreshold: 1,
        }),
        material('a', {
          fireSource: 1,
          pressureSource: 1,
          fireThreshold: 1,
          pressureThreshold: 1,
        }),
      ],
    });

    expect(fields.step().map((event) => `${event.cellId}:${event.field}`)).toEqual([
      'a:fire',
      'a:pressure',
      'b:fire',
      'b:pressure',
    ]);
    expect(fields.step()).toEqual([]);

    expect(fields.reduceFire('a', 2)).toEqual([
      { field: 'fire', cellId: 'a', direction: 'cleared', value: 0, step: 2 },
    ]);
    expect(fields.reduceFire('a', 1)).toEqual([]);
  });

  it('rejects unknown cells, duplicate materials, and negative coefficients', () => {
    const grid = twoCells([]);
    expect(() => createFieldWorld(grid, { cells: [material('a')] })).toThrow(RangeError);
    expect(() =>
      createFieldWorld(grid, { cells: [material('a'), material('a'), material('b')] }),
    ).toThrow(RangeError);
    expect(() => createFieldWorld(grid, { cells: [material('a'), material('missing')] })).toThrow(
      RangeError,
    );
    expect(() =>
      createFieldWorld(grid, { cells: [material('a', { decay: -1 }), material('b')] }),
    ).toThrow(RangeError);
    expect(() =>
      createFieldWorld(grid, {
        cells: [material('a', { initialFire: Number.NaN }), material('b')],
      }),
    ).toThrow(RangeError);

    const linked = twoCells([link('ab', 'a', 'b', 0, 0)]);
    const fields = createFieldWorld(linked, { cells: [material('a'), material('b')] });
    expect(() => fields.setEdgeTransferScale('missing', { fire: 0 })).toThrow(RangeError);
    expect(() => fields.setEdgeTransferScale('ab', {})).toThrow(RangeError);
    expect(() => fields.setFireSource('a', -0.2)).toThrow(RangeError);
    expect(() => fields.reduceFire('a', Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects a mixed invalid edge update without partially changing its scale', () => {
    const fields = createFieldWorld(twoCells([link('ab', 'a', 'b', 1, 0)]), {
      cells: [material('a', { initialFire: 1 }), material('b')],
    });
    expect(() => fields.setEdgeTransferScale('ab', { fire: 0, pressure: Number.NaN })).toThrow(
      RangeError,
    );
    fields.step();
    expect(fields.snapshot()[1]?.fire).toBe(1);
  });

  it('keeps the prior snapshot if a step would overflow a field value', () => {
    const fields = createFieldWorld(createGridWorld({ cells: [cell('a', 0)], edges: [] }), {
      cells: [material('a', { initialFire: Number.MAX_VALUE, flammability: 1, growth: 1 })],
    });
    const before = fields.snapshot();
    expect(() => fields.step()).toThrow(RangeError);
    expect(fields.snapshot()).toEqual(before);
    expect(fields.stepCount).toBe(0);
  });
});

// Direct pressure assignment is used by distance-based pressure incidents rather
// than the stencil pressure transport model.
describe('direct pressure profile', () => {
  it('sets one cell pressure and emits threshold crossings', () => {
    const grid = createGridWorld({ cells: [cell('a', 0)], edges: [] });
    const fields = createFieldWorld(grid, {
      cells: [material('a', { pressureThreshold: 2 })],
    });

    expect(fields.setPressure('a', 3)).toEqual([
      { field: 'pressure', cellId: 'a', direction: 'reached', value: 3, step: 0 },
    ]);
    expect(fields.snapshot()[0]?.pressure).toBe(3);
    expect(fields.setPressure('a', 1)).toEqual([
      { field: 'pressure', cellId: 'a', direction: 'cleared', value: 1, step: 0 },
    ]);
  });
});
