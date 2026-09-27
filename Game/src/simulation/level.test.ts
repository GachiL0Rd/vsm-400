import { describe, expect, it } from 'vitest';
import { BASELINE_LEVEL, BASELINE_LEVEL_DEFINITION, loadLevelDefinition } from './level';

describe('level definition', () => {
  it('loads the baseline level and toggles platform reachability through region constraints', () => {
    expect(BASELINE_LEVEL.definition.id).toBe('demo-carriage');
    expect(BASELINE_LEVEL.defaultActiveRegionIds).toEqual(['carriage-main', 'platform-origin']);
    expect(BASELINE_LEVEL.anchor('platform.acceptance-desk').cellId).toBe('platform-origin.desk');
    expect(BASELINE_LEVEL.object('extinguisher').kind).toBe('extinguisher');

    const preDeparture = BASELINE_LEVEL.grid.route(
      'platform-origin.desk',
      'carriage.cabin',
      BASELINE_LEVEL.constraintsFor(['carriage-main', 'platform-origin']),
    );
    expect(preDeparture?.cells).toEqual([
      'platform-origin.desk',
      'platform-origin.door',
      'carriage.entry',
      'carriage.cabin',
    ]);

    expect(
      BASELINE_LEVEL.grid.route(
        'platform-standard.wait',
        'carriage.cabin',
        BASELINE_LEVEL.constraintsFor(['carriage-main', 'platform-origin']),
      ),
    ).toBeNull();

    expect(
      BASELINE_LEVEL.grid.route(
        'platform-standard.wait',
        'carriage.cabin',
        BASELINE_LEVEL.constraintsFor(['carriage-main', 'platform-standard']),
      )?.cells,
    ).toEqual([
      'platform-standard.wait',
      'platform-standard.door',
      'carriage.entry',
      'carriage.cabin',
    ]);
  });

  it('rejects invalid references and overlapping regions before an attempt starts', () => {
    expect(() =>
      loadLevelDefinition({
        ...BASELINE_LEVEL_DEFINITION,
        anchors: [{ id: 'bad', cellId: 'missing' }],
      }),
    ).toThrow(RangeError);

    expect(() =>
      loadLevelDefinition({
        ...BASELINE_LEVEL_DEFINITION,
        regions: [
          ...BASELINE_LEVEL_DEFINITION.regions,
          { id: 'duplicate-owner', cellIds: ['carriage.entry'], defaultActive: false },
        ],
      }),
    ).toThrow(RangeError);
  });

  it('keeps the loaded definition immutable from source mutations', () => {
    const mutable = JSON.parse(JSON.stringify(BASELINE_LEVEL_DEFINITION)) as {
      regions: Array<{ id: string }>;
      grid: { cells: Array<{ capacity: number }> };
    };
    const loaded = loadLevelDefinition(mutable);
    const firstRegion = mutable.regions[0];
    const firstCell = mutable.grid.cells[0];
    if (firstRegion === undefined || firstCell === undefined)
      throw new Error('Baseline fixture is empty');
    firstRegion.id = 'changed';
    firstCell.capacity = 99;
    expect(loaded.definition.regions[0]?.id).toBe('carriage-main');
    expect(loaded.definition.grid.cells[0]?.capacity).toBe(3);
  });
});
