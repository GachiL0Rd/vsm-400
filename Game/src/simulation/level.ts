import { z } from 'zod';
import {
  createGridWorld,
  type GridDefinition,
  type GridWorld,
  type RouteConstraints,
} from './grid-world';

const idSchema = z.string().min(1);
const versionSchema = z.string().min(1);
const nonnegativeInt = z.number().int().nonnegative();
const positiveNumber = z.number().positive();

const cellSchema = z.object({
  id: idSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  capacity: nonnegativeInt,
  movementSpeedMultiplier: positiveNumber.optional(),
});

const edgeSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  traversable: z.boolean(),
  cost: positiveNumber,
  transitionCapacity: nonnegativeInt,
  fireTransferWeight: z.number().nonnegative(),
  pressureTransferWeight: z.number().nonnegative(),
});

const regionSchema = z.object({
  id: idSchema,
  cellIds: z.array(idSchema).min(1),
  defaultActive: z.boolean(),
  publicVisualId: idSchema.optional(),
});

const anchorSchema = z.object({
  id: idSchema,
  cellId: idSchema,
});

const objectSchema = z.object({
  id: idSchema,
  kind: idSchema,
  cellId: idSchema,
  anchorId: idSchema.optional(),
  publicVisualId: idSchema.optional(),
});

const failureLocationSchema = z.object({
  id: idSchema,
  cellId: idSchema,
  kinds: z.array(idSchema).min(1),
});

const sanitationLocationSchema = z.object({
  id: idSchema,
  cellId: idSchema,
  visualIds: z.array(idSchema).min(1),
});

export const levelDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  version: versionSchema,
  regions: z.array(regionSchema).min(1),
  grid: z.object({
    cells: z.array(cellSchema).min(1),
    edges: z.array(edgeSchema),
  }),
  anchors: z.array(anchorSchema),
  objects: z.array(objectSchema),
  failureLocations: z.array(failureLocationSchema).default([]),
  sanitationLocations: z.array(sanitationLocationSchema).default([]),
});

export type LevelDefinition = z.infer<typeof levelDefinitionSchema>;
export type LevelRegionDefinition = LevelDefinition['regions'][number];
export type LevelAnchorDefinition = LevelDefinition['anchors'][number];
export type LevelObjectDefinition = LevelDefinition['objects'][number];

export interface LoadedLevel {
  readonly definition: LevelDefinition;
  readonly grid: GridWorld;
  readonly regionIds: readonly string[];
  readonly defaultActiveRegionIds: readonly string[];
  region(id: string): LevelRegionDefinition;
  anchor(id: string): LevelAnchorDefinition;
  object(id: string): LevelObjectDefinition;
  constraintsFor(activeRegionIds: readonly string[]): RouteConstraints;
}

export function loadLevelDefinition(input: unknown): LoadedLevel {
  const parsed = levelDefinitionSchema.parse(input);
  validateLevelReferences(parsed);
  const definition = freezeLevel(parsed);
  return new LevelContent(definition, createGridWorld(definition.grid as GridDefinition));
}

class LevelContent implements LoadedLevel {
  readonly regionIds: readonly string[];
  readonly defaultActiveRegionIds: readonly string[];
  private readonly regions: ReadonlyMap<string, LevelRegionDefinition>;
  private readonly anchors: ReadonlyMap<string, LevelAnchorDefinition>;
  private readonly objects: ReadonlyMap<string, LevelObjectDefinition>;
  private readonly regionByCell: ReadonlyMap<string, string>;
  private readonly edgeById: ReadonlyMap<string, { readonly from: string; readonly to: string }>;

  constructor(
    readonly definition: LevelDefinition,
    readonly grid: GridWorld,
  ) {
    this.regions = new Map(definition.regions.map((region) => [region.id, region]));
    this.anchors = new Map(definition.anchors.map((anchor) => [anchor.id, anchor]));
    this.objects = new Map(definition.objects.map((object) => [object.id, object]));
    this.regionByCell = new Map(
      definition.regions.flatMap((region) =>
        region.cellIds.map((cellId) => [cellId, region.id] as const),
      ),
    );
    this.edgeById = new Map(grid.edges.map((edge) => [edge.id, { from: edge.from, to: edge.to }]));
    this.regionIds = Object.freeze([...this.regions.keys()].sort(compareIds));
    this.defaultActiveRegionIds = Object.freeze(
      definition.regions
        .filter((region) => region.defaultActive)
        .map((region) => region.id)
        .sort(compareIds),
    );
  }

  region(id: string): LevelRegionDefinition {
    return requireFrom(this.regions, id, 'region');
  }

  anchor(id: string): LevelAnchorDefinition {
    return requireFrom(this.anchors, id, 'anchor');
  }

  object(id: string): LevelObjectDefinition {
    return requireFrom(this.objects, id, 'object');
  }

  constraintsFor(activeRegionIds: readonly string[]): RouteConstraints {
    const active = new Set<string>();
    for (const id of activeRegionIds) {
      if (!this.regions.has(id)) throw new RangeError(`Unknown level region ${id}`);
      active.add(id);
    }
    const blockedCellIds = this.grid.cells
      .filter((cell) => !active.has(this.regionByCell.get(cell.id) ?? ''))
      .map((cell) => cell.id)
      .sort(compareIds);
    const blocked = new Set(blockedCellIds);
    const blockedEdgeIds = [...this.edgeById]
      .filter(([, edge]) => blocked.has(edge.from) || blocked.has(edge.to))
      .map(([edgeId]) => edgeId)
      .sort(compareIds);
    return { blockedCellIds, blockedEdgeIds };
  }
}

export const BASELINE_LEVEL_DEFINITION = {
  schemaVersion: 1,
  id: 'demo-carriage',
  version: '1.0.0',
  regions: [
    {
      id: 'carriage-main',
      cellIds: [
        'carriage.entry',
        'carriage.cabin',
        'carriage.service',
        'carriage.seat-1',
        'carriage.seat-2',
        'carriage.seat-3',
      ],
      defaultActive: true,
      publicVisualId: 'region.carriage-main',
    },
    {
      id: 'platform-origin',
      cellIds: ['platform-origin.desk', 'platform-origin.door'],
      defaultActive: true,
      publicVisualId: 'region.platform',
    },
    {
      id: 'platform-standard',
      cellIds: ['platform-standard.wait', 'platform-standard.door'],
      defaultActive: false,
      publicVisualId: 'region.platform',
    },
  ],
  grid: {
    cells: [
      { id: 'carriage.entry', x: 0, y: 0, capacity: 3 },
      { id: 'carriage.cabin', x: 1, y: 0, capacity: 2 },
      { id: 'carriage.service', x: 2, y: 0, capacity: 2 },
      { id: 'carriage.seat-1', x: 1, y: 1, capacity: 1 },
      { id: 'carriage.seat-2', x: 2, y: 1, capacity: 1 },
      { id: 'carriage.seat-3', x: 3, y: 1, capacity: 1 },
      { id: 'platform-origin.desk', x: -2, y: 0, capacity: 3 },
      { id: 'platform-origin.door', x: -1, y: 0, capacity: 3 },
      { id: 'platform-standard.wait', x: -2, y: 0, capacity: 3 },
      { id: 'platform-standard.door', x: -1, y: 0, capacity: 3 },
    ],
    edges: [
      ...bidirectionalEdge('carriage.entry', 'carriage.cabin', 'entry-cabin'),
      ...bidirectionalEdge('carriage.cabin', 'carriage.service', 'cabin-service'),
      ...bidirectionalEdge('carriage.cabin', 'carriage.seat-1', 'cabin-seat-1'),
      ...bidirectionalEdge('carriage.service', 'carriage.seat-2', 'service-seat-2'),
      ...bidirectionalEdge('carriage.service', 'carriage.seat-3', 'service-seat-3'),
      ...bidirectionalEdge('platform-origin.desk', 'platform-origin.door', 'origin-desk-door'),
      ...bidirectionalEdge('platform-origin.door', 'carriage.entry', 'origin-door-entry'),
      ...bidirectionalEdge(
        'platform-standard.wait',
        'platform-standard.door',
        'platform-wait-door',
      ),
      ...bidirectionalEdge('platform-standard.door', 'carriage.entry', 'platform-door-entry'),
    ],
  },
  anchors: [
    { id: 'platform.acceptance-desk', cellId: 'platform-origin.desk' },
    { id: 'carriage.entry-door', cellId: 'carriage.entry' },
    { id: 'carriage.extinguisher-1', cellId: 'carriage.cabin' },
    { id: 'carriage.climate-control', cellId: 'carriage.cabin' },
    { id: 'carriage.emergency-brake', cellId: 'carriage.entry' },
    { id: 'carriage.driver-comms', cellId: 'carriage.cabin' },
    { id: 'carriage.service-point', cellId: 'carriage.service' },
  ],
  objects: [
    {
      id: 'acceptance-journal',
      kind: 'acceptance-journal',
      cellId: 'platform-origin.desk',
      anchorId: 'platform.acceptance-desk',
      publicVisualId: 'item.acceptance-journal',
    },
    {
      id: 'extinguisher',
      kind: 'extinguisher',
      cellId: 'carriage.cabin',
      anchorId: 'carriage.extinguisher-1',
      publicVisualId: 'item.extinguisher',
    },
    {
      id: 'climate-control',
      kind: 'climate-control',
      cellId: 'carriage.cabin',
      anchorId: 'carriage.climate-control',
      publicVisualId: 'object.climate-control',
    },
    {
      id: 'emergency-brake',
      kind: 'emergency-brake',
      cellId: 'carriage.entry',
      anchorId: 'carriage.emergency-brake',
      publicVisualId: 'object.emergency-brake',
    },
    {
      id: 'driver-comms',
      kind: 'driver-comms',
      cellId: 'carriage.cabin',
      anchorId: 'carriage.driver-comms',
      publicVisualId: 'object.driver-comms',
    },
    {
      id: 'service-point',
      kind: 'service-point',
      cellId: 'carriage.service',
      anchorId: 'carriage.service-point',
      publicVisualId: 'object.service-point',
    },
  ],
  failureLocations: [
    { id: 'fire.cabin', cellId: 'carriage.cabin', kinds: ['fire'] },
    { id: 'pressure.entry', cellId: 'carriage.entry', kinds: ['pressure-leak'] },
  ],
  sanitationLocations: [
    {
      id: 'sanitation.entry',
      cellId: 'carriage.entry',
      visualIds: ['sanitation.stain', 'sanitation.trash'],
    },
    {
      id: 'sanitation.service',
      cellId: 'carriage.service',
      visualIds: ['sanitation.stain'],
    },
  ],
} as const satisfies LevelDefinition;

export const BASELINE_LEVEL = loadLevelDefinition(BASELINE_LEVEL_DEFINITION);

function validateLevelReferences(definition: LevelDefinition): void {
  validateTopLevelIds(definition);
  const cells = validateRegions(definition);
  validateAnchorsAndObjects(definition, cells);
  validateLocations(definition, cells);
  // Reuse the authoritative grid validator for edge/cell numeric and topology invariants.
  createGridWorld(definition.grid as GridDefinition);
}

function validateTopLevelIds(definition: LevelDefinition): void {
  assertUnique(
    definition.regions.map((item) => item.id),
    'region',
  );
  assertUnique(
    definition.anchors.map((item) => item.id),
    'anchor',
  );
  assertUnique(
    definition.objects.map((item) => item.id),
    'object',
  );
  assertUnique(
    definition.failureLocations.map((item) => item.id),
    'failure location',
  );
  assertUnique(
    definition.sanitationLocations.map((item) => item.id),
    'sanitation location',
  );
}

function validateRegions(definition: LevelDefinition): ReadonlySet<string> {
  const cells = new Set(definition.grid.cells.map((cell) => cell.id));
  const assigned = new Set<string>();
  for (const region of definition.regions) {
    assertUnique(region.cellIds, `cell in region ${region.id}`);
    for (const cellId of region.cellIds) assignRegionCell(region.id, cellId, cells, assigned);
  }
  for (const cellId of cells) {
    if (!assigned.has(cellId)) throw new RangeError(`Cell ${cellId} does not belong to a region`);
  }
  return cells;
}

function assignRegionCell(
  regionId: string,
  cellId: string,
  cells: ReadonlySet<string>,
  assigned: Set<string>,
): void {
  if (!cells.has(cellId))
    throw new RangeError(`Region ${regionId} references unknown cell ${cellId}`);
  if (assigned.has(cellId)) throw new RangeError(`Cell ${cellId} belongs to multiple regions`);
  assigned.add(cellId);
}

function validateAnchorsAndObjects(definition: LevelDefinition, cells: ReadonlySet<string>): void {
  const anchors = new Set(definition.anchors.map((anchor) => anchor.id));
  for (const anchor of definition.anchors) requireKnown(cells, anchor.cellId, 'anchor cell');
  for (const object of definition.objects) {
    requireKnown(cells, object.cellId, 'object cell');
    if (object.anchorId !== undefined) requireKnown(anchors, object.anchorId, 'object anchor');
  }
}

function validateLocations(definition: LevelDefinition, cells: ReadonlySet<string>): void {
  for (const location of definition.failureLocations) {
    requireKnown(cells, location.cellId, 'failure cell');
  }
  for (const location of definition.sanitationLocations) {
    requireKnown(cells, location.cellId, 'sanitation cell');
  }
}

function freezeLevel(definition: LevelDefinition): LevelDefinition {
  return deepFreeze(structuredClone(definition));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requireKnown(known: ReadonlySet<string>, id: string, label: string): void {
  if (!known.has(id)) throw new RangeError(`Unknown ${label} ${id}`);
}

function requireFrom<T>(map: ReadonlyMap<string, T>, id: string, label: string): T {
  const value = map.get(id);
  if (value === undefined) throw new RangeError(`Unknown level ${label} ${id}`);
  return value;
}

function assertUnique(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new RangeError(`Duplicate ${label} id ${id}`);
    seen.add(id);
  }
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bidirectionalEdge(from: string, to: string, id: string) {
  const base = {
    traversable: true,
    cost: 1,
    transitionCapacity: 2,
    fireTransferWeight: 0.2,
    pressureTransferWeight: 0.5,
  } as const;
  return [
    { id: `${id}:forward`, from, to, ...base },
    { id: `${id}:backward`, from: to, to: from, ...base },
  ] as const;
}
