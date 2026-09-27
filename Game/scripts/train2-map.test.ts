import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadLevelDefinition } from '../src/simulation/level.ts';
import { loadScenarioDefinition } from '../src/simulation/scenario.ts';
import { parseXml } from './tiled-xml.ts';
import {
  assertTrain2OutputsMatch,
  buildTrain2,
  gameRootFromScripts,
  readTiledProperties,
  type Train2Artifacts,
} from './train2-map.ts';

type LoadedLevel = ReturnType<typeof loadLevelDefinition>;

const gameRoot = gameRootFromScripts();

describe('train2 map generator', () => {
  it('reads tiled property values', () => {
    const element = parseXml(`<properties>
      <property name="n" type="int" value="2"/>
      <property name="f" type="float" value="0.5"/>
      <property name="b" type="bool" value="false"/>
      <property name="s" value="door"/>
    </properties>`);
    expect(readTiledProperties(element)).toEqual([
      { name: 'n', type: 'int', value: 2 },
      { name: 'f', type: 'float', value: 0.5 },
      { name: 'b', type: 'bool', value: false },
      { name: 's', type: 'string', value: 'door' },
    ]);
  });

  it('builds a schema-valid level from the tiled map', () => {
    const built = buildTrain2(gameRoot);
    const level = loadLevelDefinition(built.level);
    expectReferences(built, level);
    expectTopology(built, level);
  });

  it('writes a finite tiled map and matches the committed files', () => {
    const built = buildTrain2(gameRoot);
    expect(built.map).toMatchObject({
      type: 'map',
      orientation: 'orthogonal',
      infinite: false,
      width: 96,
      height: 16,
      tilewidth: 64,
      tileheight: 64,
      properties: [
        { name: 'originX', type: 'int', value: -16 },
        { name: 'originY', type: 'int', value: 0 },
      ],
    });
    expect(built.map.tilesets.map((tileset) => tileset.firstgid)).toEqual([1, 49, 97]);
    for (const tileset of built.map.tilesets) {
      expect(tileset.image.endsWith('.png')).toBe(true);
      expect('source' in tileset).toBe(false);
    }
    expect(built.map.layers.map((layer) => [layer.name, layer.type, layer.visible])).toEqual([
      ['Void', 'tilelayer', true],
      ['Station', 'tilelayer', true],
      ['ExteriorShell', 'tilelayer', true],
      ['InteriorWall', 'tilelayer', true],
      ['Floor', 'tilelayer', true],
      ['FarSeats', 'tilelayer', true],
      ['Furniture', 'tilelayer', true],
      ['NearSeats', 'tilelayer', true],
      ['Accents', 'tilelayer', true],
      ['WalkableZones', 'objectgroup', false],
      ['PassengerSeats', 'objectgroup', false],
      ['InteractionAnchors', 'objectgroup', false],
      ['Collision', 'objectgroup', false],
    ]);
    const voidLayer = built.map.layers[0];
    if (voidLayer === undefined || voidLayer.type !== 'tilelayer')
      throw new Error('missing Void layer');
    expect(voidLayer.data).toHaveLength(96 * 16);
    expect(voidLayer.data[10]).toBe(49);
    assertTrain2OutputsMatch(gameRoot);
  });
});

function expectReferences(built: Train2Artifacts, level: LoadedLevel): void {
  const scenario = loadScenarioDefinition(
    JSON.parse(readFileSync(`${gameRoot}/content/vsm-train2-01/scenario.json`, 'utf8')),
    level,
  );
  expect(built.counts).toEqual({ cells: 212, edges: 548, seats: 56 });
  expect(level.definition.id).toBe('vsm-train2-01');
  expect(level.defaultActiveRegionIds).toEqual(['carriage-main', 'platform-origin']);
  expect(scenario.definition.levelId).toBe(level.definition.id);
  expect(level.anchor('platform.acceptance-desk').cellId).toBe('platform-origin.x-3y8');
  expect(level.anchor('carriage.entry-door').cellId).toBe('carriage.x7y8');
  expect(level.anchor('carriage.emergency-brake').cellId).toBe('carriage.x9y8');
  expect(level.anchor('carriage.extinguisher-1').cellId).toBe('carriage.x67y8');
  expect(level.anchor('carriage.climate-control').cellId).toBe('carriage.x74y8');
  expect(level.anchor('carriage.driver-comms').cellId).toBe('carriage.x74y8');
  expect(level.anchor('carriage.service-point').cellId).toBe('carriage.x69y8');
  expect(level.definition.failureLocations).toEqual([
    { id: 'fire.cabin', cellId: 'carriage.x39y8', kinds: ['fire'] },
    { id: 'pressure.entry', cellId: 'carriage.x7y8', kinds: ['pressure-leak'] },
  ]);
  expect(level.definition.sanitationLocations).toEqual([
    {
      id: 'sanitation.entry',
      cellId: 'carriage.x7y8',
      visualIds: ['sanitation.stain', 'sanitation.trash'],
    },
    { id: 'sanitation.service', cellId: 'carriage.x66y8', visualIds: ['sanitation.stain'] },
  ]);
}

function expectTopology(built: Train2Artifacts, level: LoadedLevel): void {
  const cells = new Set(level.grid.cells.map((cell) => cell.id));
  for (const anchor of level.definition.anchors) expect(cells.has(anchor.cellId)).toBe(true);
  for (const object of level.definition.objects) expect(cells.has(object.cellId)).toBe(true);
  for (const seat of built.seatTiles) {
    expect(cells.has(`carriage.seat.${seat.name}`)).toBe(true);
    expect(built.solidTiles.has(`${seat.x},${seat.y}`)).toBe(true);
  }
  for (const cell of level.definition.grid.cells) {
    if (!built.solidTiles.has(`${cell.x},${cell.y}`)) continue;
    expect(cell.id.startsWith('carriage.seat.')).toBe(true);
  }
  expectSeatRoutes(built, level);
  expect(level.grid.edges.filter((edge) => edge.id.endsWith(':door'))).toHaveLength(4);
  expect(edgeCost(level, 'carriage.seat.bay_01_far_L->carriage.x11y8')).toBe(0.25);
  expect(edgeCost(level, 'carriage.seat.bay_01_near_L->carriage.x11y8')).toBe(0.5);
  expect(edgeCost(level, 'platform-origin.x-1y8->carriage.x7y8:door')).toBe(2);
}

function expectSeatRoutes(built: Train2Artifacts, level: LoadedLevel): void {
  const constraints = level.constraintsFor(['carriage-main', 'platform-origin']);
  const seatEdges = new Map<string, number>();
  for (const edge of level.grid.edges) countSeatEdge(level, edge, seatEdges);
  for (const seat of built.seatTiles) {
    expect(seatEdges.get(`carriage.seat.${seat.name}`)).toBe(1);
    expect(
      level.grid.route('platform-origin.x-1y8', `carriage.seat.${seat.name}`, constraints),
    ).not.toBeNull();
  }
}

function countSeatEdge(
  level: LoadedLevel,
  edge: LoadedLevel['grid']['edges'][number],
  seatEdges: Map<string, number>,
): void {
  const fromSeat = edge.from.startsWith('carriage.seat.');
  const toSeat = edge.to.startsWith('carriage.seat.');
  if (fromSeat) seatEdges.set(edge.from, (seatEdges.get(edge.from) ?? 0) + 1);
  if (fromSeat || toSeat) return;
  if (regionOf(level, edge.from) !== regionOf(level, edge.to)) {
    expect(edge.id.endsWith(':door')).toBe(true);
  }
}

function edgeCost(level: LoadedLevel, id: string): number | undefined {
  return level.grid.edges.find((edge) => edge.id === id)?.cost;
}

function regionOf(level: LoadedLevel, cellId: string): string {
  const region = level.definition.regions.find((candidate) => candidate.cellIds.includes(cellId));
  if (region === undefined) throw new Error(`Cell ${cellId} has no region`);
  return region.id;
}
