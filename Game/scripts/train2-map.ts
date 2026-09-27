import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  type LevelDefinition,
  levelDefinitionSchema,
  loadLevelDefinition,
} from '../src/simulation/level.ts';
import {
  elementChildren,
  parseXml,
  requiredAttribute,
  textContent,
  type XmlElement,
} from './tiled-xml.ts';

const BINDINGS_RELATIVE = 'content/vsm-train2-01/map-bindings.json';
const LEVEL_RELATIVE = 'content/vsm-train2-01/level.json';

const idSchema = z.string().min(1);
const tileSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
  })
  .strict();

export const mapBindingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.string().min(1),
    tileSize: z.number().int().positive(),
    levelId: idSchema,
    levelVersion: idSchema,
    movementCostPerTile: z.number().positive(),
    transitionCapacity: z.number().int().nonnegative(),
    fireTransferWeight: z.number().nonnegative(),
    pressureTransferWeight: z.number().nonnegative(),
    capacities: z
      .object({
        platform: z.number().int().nonnegative(),
        carriage: z.number().int().nonnegative(),
        seat: z.number().int().nonnegative(),
      })
      .strict(),
    anchorSnapRule: z.string().min(1),
    doorLinkRule: z.string().min(1),
    seatAccess: z
      .object({
        aisleY: z.number().int(),
        zoneLayer: idSchema,
        seatLayer: idSchema,
        anchorLayer: idSchema,
        solidLayer: idSchema,
        solidType: idSchema,
      })
      .strict(),
    regions: z
      .array(
        z
          .object({
            id: idSchema,
            defaultActive: z.boolean(),
            publicVisualId: idSchema,
            zones: z.array(idSchema).min(1),
            includeSeats: z.boolean(),
            cellIdPrefix: z.string().regex(/^[A-Za-z0-9_.-]+$/),
            capacity: z.enum(['platform', 'carriage']),
          })
          .strict(),
      )
      .min(1),
    anchors: z.array(z.object({ id: idSchema, tmxObject: idSchema }).strict()).min(1),
    objects: z
      .array(
        z
          .object({
            id: idSchema,
            kind: idSchema,
            anchorId: idSchema,
            publicVisualId: idSchema,
          })
          .strict(),
      )
      .min(1),
    failureLocations: z
      .array(
        z
          .object({
            id: idSchema,
            tmxObject: idSchema,
            kinds: z.array(idSchema).min(1),
          })
          .strict(),
      )
      .min(1),
    sanitationLocations: z
      .array(
        z.discriminatedUnion('placement', [
          z
            .object({
              id: idSchema,
              placement: z.literal('tmx-object'),
              tmxObject: idSchema,
              visualIds: z.array(idSchema).min(1),
              note: z.string().min(1).optional(),
            })
            .strict(),
          z
            .object({
              id: idSchema,
              placement: z.literal('nearest-zone-tile'),
              zone: idSchema,
              toTmxObject: idSchema,
              visualIds: z.array(idSchema).min(1),
              note: z.string().min(1).optional(),
            })
            .strict(),
        ]),
      )
      .min(1),
    doorLinks: z
      .array(
        z
          .object({
            fromRegionId: idSchema,
            fromTile: tileSchema,
            toTmxObject: idSchema,
          })
          .strict(),
      )
      .min(1),
    clientMap: z
      .object({
        originX: z.number().int(),
        originY: z.number().int(),
        maxXExclusive: z.number().int(),
        maxYExclusive: z.number().int(),
        voidLayerName: idSchema,
        output: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type MapBindings = z.infer<typeof mapBindingsSchema>;

export interface TiledProperty {
  readonly name: string;
  readonly type: string;
  readonly value: string | number | boolean;
}

export interface Train2Counts {
  readonly cells: number;
  readonly edges: number;
  readonly seats: number;
}

export interface Train2Artifacts {
  readonly level: LevelDefinition;
  readonly map: FiniteTiledMap;
  readonly levelPath: string;
  readonly mapPath: string;
  readonly counts: Train2Counts;
  readonly seatTiles: readonly SeatTile[];
  readonly solidTiles: ReadonlySet<string>;
}

interface SeatTile {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

interface ZoneCell {
  readonly id: string;
  readonly regionId: string;
  readonly x: number;
  readonly y: number;
  readonly capacity: number;
  readonly defaultActive: boolean;
}

interface LevelCell {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly capacity: number;
  readonly regionId: string;
}

interface LevelEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly traversable: true;
  readonly cost: number;
  readonly transitionCapacity: number;
  readonly fireTransferWeight: number;
  readonly pressureTransferWeight: number;
}

interface EdgeShared {
  readonly transitionCapacity: number;
  readonly fireTransferWeight: number;
  readonly pressureTransferWeight: number;
}

interface Chunk {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly gids: readonly number[];
}

interface TiledObject {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly rotation: number;
  readonly visible: boolean;
  readonly point: boolean;
  readonly gid: number | undefined;
  readonly properties: readonly TiledProperty[];
}

interface TileLayer {
  readonly kind: 'tile';
  readonly id: number;
  readonly name: string;
  readonly visible: boolean;
  readonly chunks: readonly Chunk[];
}

interface ObjectLayer {
  readonly kind: 'object';
  readonly id: number;
  readonly name: string;
  readonly objects: readonly TiledObject[];
}

type ParsedLayer = TileLayer | ObjectLayer;

interface ParsedMap {
  readonly version: string;
  readonly tiledversion: string;
  readonly orientation: string;
  readonly renderorder: string;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly infinite: boolean;
  readonly nextlayerid: number;
  readonly nextobjectid: number;
  readonly properties: readonly TiledProperty[];
  readonly tilesets: readonly { readonly firstgid: number; readonly source: string }[];
  readonly layers: readonly ParsedLayer[];
}

interface EmbeddedTileset {
  readonly name: string;
  readonly firstgid: number;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly columns: number;
  readonly tilecount: number;
  readonly imagewidth: number;
  readonly imageheight: number;
  readonly image: string;
  readonly margin: 0;
  readonly spacing: 0;
}

interface FiniteTileLayer {
  readonly id: number;
  readonly name: string;
  readonly type: 'tilelayer';
  readonly x: 0;
  readonly y: 0;
  readonly width: number;
  readonly height: number;
  readonly opacity: 1;
  readonly visible: true;
  readonly data: readonly number[];
}

interface FiniteObjectLayer {
  readonly id: number;
  readonly name: string;
  readonly type: 'objectgroup';
  readonly x: 0;
  readonly y: 0;
  readonly opacity: 1;
  readonly visible: false;
  readonly objects: readonly ExportedObject[];
}

interface ExportedObject {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly visible: boolean;
  readonly point?: true;
  readonly gid?: number;
  readonly properties?: readonly TiledProperty[];
}

export interface FiniteTiledMap {
  readonly type: 'map';
  readonly version: string;
  readonly tiledversion: string;
  readonly orientation: 'orthogonal';
  readonly renderorder: string;
  readonly compressionlevel: -1;
  readonly width: number;
  readonly height: number;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly infinite: false;
  readonly nextlayerid: number;
  readonly nextobjectid: number;
  readonly properties: readonly {
    readonly name: string;
    readonly type: 'int';
    readonly value: number;
  }[];
  readonly tilesets: readonly EmbeddedTileset[];
  readonly layers: readonly (FiniteTileLayer | FiniteObjectLayer)[];
}

export class Train2MapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Train2MapError';
  }
}

export function gameRootFromScripts(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function readTiledProperties(element: XmlElement): TiledProperty[] {
  return elementChildren(element, new Set(['property'])).map((property) => {
    if (elementChildren(property).length > 0) {
      throw new Train2MapError(`<property> in <${element.name}> has nested markup`);
    }
    const name = requiredAttribute(property, 'name');
    const type = property.attributes.type ?? 'string';
    const raw = requiredAttribute(property, 'value');
    return { name, type, value: propertyValue(type, raw, name) };
  });
}

export function buildTrain2(gameRoot: string): Train2Artifacts {
  const bindings = readBindings(gameRoot);
  const tmxPath = resolveInside(gameRoot, gameRoot, bindings.source);
  const tiled = parseMap(tmxPath);
  assertMapContract(tiled, bindings);
  const seats = readSeats(tiled, bindings);
  const solids = readSolids(tiled, bindings);
  const zoneCells = buildZoneCells(tiled, bindings, seats, solids);
  const level = buildLevel(bindings, tiled, seats, zoneCells);
  const map = buildFiniteMap(gameRoot, tmxPath, tiled, bindings);
  const levelPath = path.join(gameRoot, LEVEL_RELATIVE);
  const mapPath = resolveInside(gameRoot, gameRoot, bindings.clientMap.output);
  return {
    level,
    map,
    levelPath,
    mapPath,
    counts: {
      cells: level.grid.cells.length,
      edges: level.grid.edges.length,
      seats: seats.length,
    },
    seatTiles: seats,
    solidTiles: solids,
  };
}

export function writeTrain2(gameRoot: string): Train2Artifacts {
  const built = buildTrain2(gameRoot);
  mkdirSync(path.dirname(built.levelPath), { recursive: true });
  mkdirSync(path.dirname(built.mapPath), { recursive: true });
  writeFileSync(built.levelPath, serializeJson(built.level));
  writeFileSync(built.mapPath, serializeJson(built.map));
  return built;
}

export function assertTrain2OutputsMatch(gameRoot: string): void {
  const built = buildTrain2(gameRoot);
  assertFileMatches(built.levelPath, serializeJson(built.level));
  assertFileMatches(built.mapPath, serializeJson(built.map));
}

function readBindings(gameRoot: string): MapBindings {
  const file = path.join(gameRoot, BINDINGS_RELATIVE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch (error) {
    throw new Train2MapError(`Cannot read map bindings ${file}: ${errorText(error)}`);
  }
  const result = mapBindingsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Train2MapError(`Invalid map bindings: ${result.error.message}`);
  }
  const seatRegions = result.data.regions.filter((region) => region.includeSeats);
  if (seatRegions.length !== 1 || seatRegions[0]?.cellIdPrefix !== 'carriage') {
    throw new Train2MapError('Exactly one region may include seats, with cell id prefix carriage');
  }
  return result.data;
}

function parseMap(tmxPath: string): ParsedMap {
  const root = parseXml(readFileSync(tmxPath, 'utf8'));
  if (root.name !== 'map') throw new Train2MapError('TMX root must be <map>');
  const tilesets: { firstgid: number; source: string }[] = [];
  const layers: ParsedLayer[] = [];
  let properties: TiledProperty[] = [];
  for (const child of elementChildren(
    root,
    new Set(['tileset', 'layer', 'objectgroup', 'properties']),
  )) {
    if (child.name === 'tileset') {
      tilesets.push({
        firstgid: integerAttribute(child, 'firstgid'),
        source: requiredAttribute(child, 'source'),
      });
      continue;
    }
    if (child.name === 'properties') {
      if (properties.length > 0) throw new Train2MapError('Duplicate <properties> on <map>');
      properties = readTiledProperties(child);
      continue;
    }
    if (child.name === 'layer') layers.push(parseTileLayer(child));
    else layers.push(parseObjectLayer(child));
  }
  return {
    version: requiredAttribute(root, 'version'),
    tiledversion: requiredAttribute(root, 'tiledversion'),
    orientation: requiredAttribute(root, 'orientation'),
    renderorder: requiredAttribute(root, 'renderorder'),
    tilewidth: integerAttribute(root, 'tilewidth'),
    tileheight: integerAttribute(root, 'tileheight'),
    infinite: flagAttribute(root, 'infinite', false),
    nextlayerid: integerAttribute(root, 'nextlayerid'),
    nextobjectid: integerAttribute(root, 'nextobjectid'),
    properties,
    tilesets,
    layers,
  };
}

function parseTileLayer(element: XmlElement): TileLayer {
  const data = singleChild(element, 'data');
  if ((data.attributes.encoding ?? 'csv') !== 'csv') {
    throw new Train2MapError(`Layer ${requiredAttribute(element, 'name')} is not CSV`);
  }
  const chunks = elementChildren(data, new Set(['chunk'])).map((chunk) => {
    const width = integerAttribute(chunk, 'width');
    const height = integerAttribute(chunk, 'height');
    if (width <= 0 || height <= 0) throw new Train2MapError('Chunk size must be positive');
    return {
      x: integerAttribute(chunk, 'x'),
      y: integerAttribute(chunk, 'y'),
      width,
      height,
      gids: parseCsv(
        textContent(chunk),
        width * height,
        `chunk ${chunk.attributes.x},${chunk.attributes.y}`,
      ),
    };
  });
  return {
    kind: 'tile',
    id: integerAttribute(element, 'id'),
    name: requiredAttribute(element, 'name'),
    visible: flagAttribute(element, 'visible', true),
    chunks,
  };
}

function parseObjectLayer(element: XmlElement): ObjectLayer {
  return {
    kind: 'object',
    id: integerAttribute(element, 'id'),
    name: requiredAttribute(element, 'name'),
    objects: elementChildren(element, new Set(['object'])).map(parseObject),
  };
}

function parseObject(element: XmlElement): TiledObject {
  const children = elementChildren(element, new Set(['point', 'properties']));
  const points = children.filter((child) => child.name === 'point');
  const propertyElements = children.filter((child) => child.name === 'properties');
  if (points.length > 1 || propertyElements.length > 1) {
    throw new Train2MapError(
      `Object ${element.attributes.name ?? element.attributes.id} is ambiguous`,
    );
  }
  const properties =
    propertyElements[0] === undefined ? [] : readTiledProperties(propertyElements[0]);
  const width = optionalNumberAttribute(element, 'width');
  const height = optionalNumberAttribute(element, 'height');
  return {
    id: integerAttribute(element, 'id'),
    name: requiredAttribute(element, 'name'),
    type: element.attributes.type ?? '',
    x: numberAttribute(element, 'x'),
    y: numberAttribute(element, 'y'),
    width,
    height,
    rotation: optionalNumberAttribute(element, 'rotation') ?? 0,
    visible: flagAttribute(element, 'visible', true),
    point: points.length === 1,
    gid: optionalIntegerAttribute(element, 'gid'),
    properties,
  };
}

function assertMapContract(tiled: ParsedMap, bindings: MapBindings): void {
  if (tiled.orientation !== 'orthogonal') throw new Train2MapError('Map must be orthogonal');
  if (!tiled.infinite)
    throw new Train2MapError('Source map must be infinite so chunks keep negative coordinates');
  if (tiled.tilewidth !== bindings.tileSize || tiled.tileheight !== bindings.tileSize) {
    throw new Train2MapError(`Map tile size must be ${bindings.tileSize}`);
  }
  assertCrop(tiled, bindings);
}

function assertCrop(tiled: ParsedMap, bindings: MapBindings): void {
  const { originX, originY, maxXExclusive, maxYExclusive, voidLayerName } = bindings.clientMap;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let sawChunk = false;
  for (const layer of tileLayers(tiled)) {
    for (const chunk of layer.chunks) {
      sawChunk = true;
      minX = Math.min(minX, chunk.x);
      minY = Math.min(minY, chunk.y);
      maxX = Math.max(maxX, chunk.x + chunk.width);
      if (chunk.x < originX || chunk.y < originY || chunk.x + chunk.width > maxXExclusive) {
        throw new Train2MapError(
          `Chunk (${chunk.x}, ${chunk.y}) is outside the declared finite bounds`,
        );
      }
    }
  }
  if (!sawChunk || minX !== originX || minY !== originY || maxX !== maxXExclusive) {
    throw new Train2MapError(`Chunk bounds ${minX}…${maxX}, y ${minY} do not match the bindings`);
  }
  for (const layer of tileLayers(tiled)) {
    if (layer.name === voidLayerName) continue;
    for (const chunk of layer.chunks) {
      chunk.gids.forEach((gid, index) => {
        const worldY = chunk.y + Math.floor(index / chunk.width);
        if (worldY >= maxYExclusive && gid !== 0) {
          throw new Train2MapError(
            `Layer ${layer.name} has a tile at y ${worldY}, so the Void padding cannot be cropped`,
          );
        }
      });
    }
  }
}

function buildZoneCells(
  tiled: ParsedMap,
  bindings: MapBindings,
  seats: readonly SeatTile[],
  solids: ReadonlySet<string>,
): ZoneCell[] {
  const zones = objectsByLayer(tiled, bindings.seatAccess.zoneLayer);
  const seatTiles = new Set(seats.map((seat) => tileKey(seat.x, seat.y)));
  const cells: ZoneCell[] = [];
  for (const region of bindings.regions) {
    const seen = new Set<string>();
    for (const zoneName of region.zones) {
      const zone = zones.find((object) => object.name === zoneName);
      if (zone === undefined) throw new Train2MapError(`Missing walkable zone ${zoneName}`);
      const zoneCells = zoneRegionCells(
        region,
        rectangleTiles(zone, bindings.tileSize),
        seen,
        solids,
        seatTiles,
        bindings,
      );
      for (const cell of zoneCells) cells.push(cell);
    }
  }
  return cells;
}

function zoneRegionCells(
  region: MapBindings['regions'][number],
  tiles: readonly TilePoint[],
  seen: Set<string>,
  solids: ReadonlySet<string>,
  seatTiles: ReadonlySet<string>,
  bindings: MapBindings,
): ZoneCell[] {
  const cells: ZoneCell[] = [];
  for (const tile of tiles) {
    const key = tileKey(tile.x, tile.y);
    if (seen.has(key)) throw new Train2MapError(`Zone tile ${key} repeats in ${region.id}`);
    seen.add(key);
    if (solids.has(key) || (region.includeSeats && seatTiles.has(key))) continue;
    cells.push({
      id: zoneCellId(region.cellIdPrefix, tile.x, tile.y),
      regionId: region.id,
      x: tile.x,
      y: tile.y,
      capacity: bindings.capacities[region.capacity],
      defaultActive: region.defaultActive,
    });
  }
  return cells;
}

function buildLevel(
  bindings: MapBindings,
  tiled: ParsedMap,
  seats: readonly SeatTile[],
  zoneCells: readonly ZoneCell[],
): LevelDefinition {
  const seatRegion = bindings.regions.find((region) => region.includeSeats);
  if (seatRegion === undefined) throw new Train2MapError('Seat region is missing');
  const snapped = new Map(
    bindings.anchors.map((anchor) => [
      anchor.id,
      snapObject(anchor.tmxObject, tiled, bindings, zoneCells),
    ]),
  );
  const seatCells: LevelCell[] = seats.map((seat) => ({
    id: `carriage.seat.${seat.name}`,
    x: seat.x,
    y: seat.y,
    capacity: bindings.capacities.seat,
    regionId: seatRegion.id,
  }));
  const cells: LevelCell[] = [
    ...zoneCells.map((cell) => ({
      id: cell.id,
      x: cell.x,
      y: cell.y,
      capacity: cell.capacity,
      regionId: cell.regionId,
    })),
    ...seatCells,
  ];
  const shared: EdgeShared = {
    transitionCapacity: bindings.transitionCapacity,
    fireTransferWeight: bindings.fireTransferWeight,
    pressureTransferWeight: bindings.pressureTransferWeight,
  };
  const edges = [
    ...neighbourEdges(zoneCells, bindings.movementCostPerTile, shared),
    ...seatAccessEdges(seats, zoneCells, seatRegion.id, bindings, shared),
    ...doorEdges(bindings, tiled, zoneCells, shared),
  ];
  const level: LevelDefinition = {
    schemaVersion: 1,
    id: bindings.levelId,
    version: bindings.levelVersion,
    regions: byId(
      bindings.regions.map((region) => ({
        id: region.id,
        cellIds: cells
          .filter((cell) => cell.regionId === region.id)
          .map((cell) => cell.id)
          .sort(compareIds),
        defaultActive: region.defaultActive,
        publicVisualId: region.publicVisualId,
      })),
    ),
    grid: {
      cells: byId(cells).map((cell) => ({
        id: cell.id,
        x: cell.x,
        y: cell.y,
        capacity: cell.capacity,
      })),
      edges: byId(edges),
    },
    anchors: byId([...snapped].map(([id, cell]) => ({ id, cellId: cell.id }))),
    objects: byId(
      bindings.objects.map((object) => {
        const anchor = snapped.get(object.anchorId);
        if (anchor === undefined)
          throw new Train2MapError(`Object ${object.id} has no anchor ${object.anchorId}`);
        return {
          id: object.id,
          kind: object.kind,
          cellId: anchor.id,
          anchorId: object.anchorId,
          publicVisualId: object.publicVisualId,
        };
      }),
    ),
    failureLocations: byId(
      bindings.failureLocations.map((location) => ({
        id: location.id,
        cellId: snapObject(location.tmxObject, tiled, bindings, zoneCells).id,
        kinds: [...location.kinds],
      })),
    ),
    sanitationLocations: byId(
      bindings.sanitationLocations.map((location) => ({
        id: location.id,
        cellId: sanitationCell(location, tiled, bindings, zoneCells).id,
        visualIds: [...location.visualIds],
      })),
    ),
  };
  levelDefinitionSchema.parse(level);
  loadLevelDefinition(level);
  return level;
}

function sanitationCell(
  location: MapBindings['sanitationLocations'][number],
  tiled: ParsedMap,
  bindings: MapBindings,
  zoneCells: readonly ZoneCell[],
): ZoneCell {
  if (location.placement === 'tmx-object') {
    return snapObject(location.tmxObject, tiled, bindings, zoneCells);
  }
  const region = uniqueRegion(bindings, location.zone);
  const target = pointTile(
    namedObject(tiled, bindings.seatAccess.anchorLayer, location.toTmxObject),
    bindings.tileSize,
  );
  const candidates = rectangleTiles(
    namedObject(tiled, bindings.seatAccess.zoneLayer, location.zone),
    bindings.tileSize,
  )
    .map((tile) =>
      zoneCells.find(
        (cell) => cell.regionId === region.id && cell.x === tile.x && cell.y === tile.y,
      ),
    )
    .filter((cell): cell is ZoneCell => cell !== undefined);
  return nearest(candidates, target, `zone ${location.zone}`);
}

function doorEdges(
  bindings: MapBindings,
  tiled: ParsedMap,
  zoneCells: readonly ZoneCell[],
  shared: EdgeShared,
): LevelEdge[] {
  const edges: LevelEdge[] = [];
  for (const link of bindings.doorLinks) {
    const from = zoneCells.find(
      (cell) =>
        cell.regionId === link.fromRegionId &&
        cell.x === link.fromTile.x &&
        cell.y === link.fromTile.y,
    );
    if (from === undefined) {
      throw new Train2MapError(
        `Door tile (${link.fromTile.x}, ${link.fromTile.y}) is missing in ${link.fromRegionId}`,
      );
    }
    const to = snapObject(link.toTmxObject, tiled, bindings, zoneCells);
    if (from.regionId === to.regionId)
      throw new Train2MapError(`Door link ${from.id} stays inside one region`);
    // The nose is not a walkable zone, so this edge is the only platform/carriage connection.
    const tiles = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    const cost = tileCost(tiles, bindings.movementCostPerTile);
    edges.push(makeEdge(`${from.id}->${to.id}:door`, from.id, to.id, cost, shared));
    edges.push(makeEdge(`${to.id}->${from.id}:door`, to.id, from.id, cost, shared));
  }
  return edges;
}

function seatAccessEdges(
  seats: readonly SeatTile[],
  zoneCells: readonly ZoneCell[],
  regionId: string,
  bindings: MapBindings,
  shared: EdgeShared,
): LevelEdge[] {
  const aisleY = bindings.seatAccess.aisleY;
  const edges: LevelEdge[] = [];
  for (const seat of seats) {
    const aisle = zoneCells.find(
      (cell) => cell.regionId === regionId && cell.x === seat.x && cell.y === aisleY,
    );
    if (aisle === undefined) {
      throw new Train2MapError(`Seat ${seat.name} has no aisle cell at (${seat.x}, ${aisleY})`);
    }
    // Near seats skip the solid frame on the row between the cushion and the aisle.
    const cost = tileCost(Math.abs(seat.y - aisle.y), bindings.movementCostPerTile);
    const seatId = `carriage.seat.${seat.name}`;
    edges.push(makeEdge(`${seatId}->${aisle.id}`, seatId, aisle.id, cost, shared));
    edges.push(makeEdge(`${aisle.id}->${seatId}`, aisle.id, seatId, cost, shared));
  }
  return edges;
}

function neighbourEdges(
  cells: readonly ZoneCell[],
  perTile: number,
  shared: EdgeShared,
): LevelEdge[] {
  const index = new Map(cells.map((cell) => [`${cell.regionId}:${cell.x}:${cell.y}`, cell]));
  const edges: LevelEdge[] = [];
  for (const cell of cells) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const neighbor = index.get(`${cell.regionId}:${cell.x + dx}:${cell.y + dy}`);
      if (neighbor === undefined) continue;
      edges.push(makeEdge(`${cell.id}->${neighbor.id}`, cell.id, neighbor.id, perTile, shared));
    }
  }
  return edges;
}

function snapObject(
  name: string,
  tiled: ParsedMap,
  bindings: MapBindings,
  zoneCells: readonly ZoneCell[],
): ZoneCell {
  const tile = pointTile(
    namedObject(tiled, bindings.seatAccess.anchorLayer, name),
    bindings.tileSize,
  );
  // Zone tiles only. Same-tile ties prefer the default-active region, then the smaller cell id.
  return nearest(zoneCells, tile, name);
}

function nearest(candidates: readonly ZoneCell[], tile: TilePoint, label: string): ZoneCell {
  let best: ZoneCell | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.x - tile.x) + Math.abs(candidate.y - tile.y);
    if (best === undefined || betterSnap(candidate, distance, best, bestDistance)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best === undefined) throw new Train2MapError(`No zone cell for ${label}`);
  return best;
}

function betterSnap(
  next: ZoneCell,
  nextDistance: number,
  best: ZoneCell,
  bestDistance: number,
): boolean {
  if (nextDistance !== bestDistance) return nextDistance < bestDistance;
  if (next.y !== best.y) return next.y > best.y;
  if (next.x !== best.x) return next.x < best.x;
  if (next.defaultActive !== best.defaultActive) return next.defaultActive;
  return next.id < best.id;
}

function readSeats(tiled: ParsedMap, bindings: MapBindings): SeatTile[] {
  const seats = objectsByLayer(tiled, bindings.seatAccess.seatLayer).map((object) => {
    if (!object.point) throw new Train2MapError(`Seat ${object.name} is not a point`);
    const tile = pointTile(object, bindings.tileSize);
    return { name: object.name, x: tile.x, y: tile.y };
  });
  const names = new Set<string>();
  for (const seat of seats) {
    if (names.has(seat.name)) throw new Train2MapError(`Duplicate seat ${seat.name}`);
    names.add(seat.name);
  }
  return seats.sort((left, right) => compareIds(left.name, right.name));
}

function readSolids(tiled: ParsedMap, bindings: MapBindings): Set<string> {
  const tiles = new Set<string>();
  for (const object of objectsByLayer(tiled, bindings.seatAccess.solidLayer)) {
    if (object.type !== bindings.seatAccess.solidType) continue;
    for (const tile of rectangleTiles(object, bindings.tileSize))
      tiles.add(tileKey(tile.x, tile.y));
  }
  if (tiles.size === 0) throw new Train2MapError('Collision layer has no seat solids');
  return tiles;
}

function buildFiniteMap(
  gameRoot: string,
  tmxPath: string,
  tiled: ParsedMap,
  bindings: MapBindings,
): FiniteTiledMap {
  const width = bindings.clientMap.maxXExclusive - bindings.clientMap.originX;
  const height = bindings.clientMap.maxYExclusive - bindings.clientMap.originY;
  if (width <= 0 || height <= 0) throw new Train2MapError('Finite map size must be positive');
  const authored = tiled.properties.filter(
    (property) => property.name !== 'originX' && property.name !== 'originY',
  );
  if (authored.length !== tiled.properties.length) {
    throw new Train2MapError('TMX already defines originX or originY');
  }
  const layers: (FiniteTileLayer | FiniteObjectLayer)[] = [];
  for (const layer of tiled.layers) {
    if (layer.kind === 'tile') {
      if (!layer.visible) {
        if (layerHasGid(layer))
          throw new Train2MapError(`Hidden layer ${layer.name} still has tiles`);
        continue;
      }
      layers.push({
        id: layer.id,
        name: layer.name,
        type: 'tilelayer',
        x: 0,
        y: 0,
        width,
        height,
        opacity: 1,
        visible: true,
        data: flattenLayer(layer, bindings.clientMap, width, height),
      });
      continue;
    }
    layers.push({
      id: layer.id,
      name: layer.name,
      type: 'objectgroup',
      x: 0,
      y: 0,
      opacity: 1,
      visible: false,
      objects: layer.objects.map(exportObject),
    });
  }
  return {
    type: 'map',
    version: tiled.version,
    tiledversion: tiled.tiledversion,
    orientation: 'orthogonal',
    renderorder: tiled.renderorder,
    compressionlevel: -1,
    width,
    height,
    tilewidth: tiled.tilewidth,
    tileheight: tiled.tileheight,
    infinite: false,
    nextlayerid: tiled.nextlayerid,
    nextobjectid: tiled.nextobjectid,
    properties: [
      { name: 'originX', type: 'int', value: bindings.clientMap.originX },
      { name: 'originY', type: 'int', value: bindings.clientMap.originY },
      ...authoredProperties(authored),
    ],
    tilesets: tiled.tilesets.map((tileset) => embedTileset(gameRoot, tmxPath, tileset)),
    layers,
  };
}

function authoredProperties(
  properties: readonly TiledProperty[],
): { readonly name: string; readonly type: 'int'; readonly value: number }[] {
  return properties.map((property) => {
    if (property.type !== 'int' || typeof property.value !== 'number') {
      throw new Train2MapError(
        `Map property ${property.name} must be an int to keep the finite map homogeneous`,
      );
    }
    return { name: property.name, type: 'int', value: property.value };
  });
}

function embedTileset(
  gameRoot: string,
  tmxPath: string,
  reference: { readonly firstgid: number; readonly source: string },
): EmbeddedTileset {
  const file = resolveInside(gameRoot, tmxPath, reference.source);
  const root = parseXml(readFileSync(file, 'utf8'));
  if (root.name !== 'tileset') throw new Train2MapError(`${reference.source} is not a tileset`);
  const children = elementChildren(root, new Set(['image', 'grid']));
  const image = children.find((child) => child.name === 'image');
  if (image === undefined) throw new Train2MapError(`${reference.source} has no image`);
  const tilewidth = integerAttribute(root, 'tilewidth');
  const tileheight = integerAttribute(root, 'tileheight');
  const columns = integerAttribute(root, 'columns');
  const tilecount = integerAttribute(root, 'tilecount');
  const imagewidth = integerAttribute(image, 'width');
  const imageheight = integerAttribute(image, 'height');
  if (imagewidth % tilewidth !== 0 || imageheight % tileheight !== 0) {
    throw new Train2MapError(`${reference.source} image size is not a whole number of tiles`);
  }
  const imageColumns = imagewidth / tilewidth;
  const imageRows = imageheight / tileheight;
  if (imageColumns !== columns || imageColumns * imageRows !== tilecount) {
    throw new Train2MapError(`${reference.source} columns/tilecount do not match the image`);
  }
  return {
    name: requiredAttribute(root, 'name'),
    firstgid: reference.firstgid,
    tilewidth,
    tileheight,
    columns,
    tilecount,
    imagewidth,
    imageheight,
    image: path.basename(requiredAttribute(image, 'source')),
    margin: 0,
    spacing: 0,
  };
}

function flattenLayer(
  layer: TileLayer,
  bounds: MapBindings['clientMap'],
  width: number,
  height: number,
): number[] {
  const data = Array.from({ length: width * height }, () => 0);
  for (const chunk of layer.chunks) {
    for (let index = 0; index < chunk.gids.length; index += 1) {
      const gid = chunk.gids[index];
      if (gid === undefined) throw new Train2MapError(`Missing gid ${index} on ${layer.name}`);
      writeFiniteGid(data, layer.name, bounds, width, height, chunk, index, gid);
    }
  }
  return data;
}

function writeFiniteGid(
  data: number[],
  layerName: string,
  bounds: MapBindings['clientMap'],
  width: number,
  height: number,
  chunk: Chunk,
  index: number,
  gid: number,
): void {
  const worldX = chunk.x + (index % chunk.width);
  const worldY = chunk.y + Math.floor(index / chunk.width);
  if (worldY >= bounds.maxYExclusive) return;
  const localX = worldX - bounds.originX;
  const localY = worldY - bounds.originY;
  if (localX < 0 || localY < 0 || localX >= width || localY >= height) {
    throw new Train2MapError(
      `Tile (${worldX}, ${worldY}) on ${layerName} is outside the finite map`,
    );
  }
  const offset = localY * width + localX;
  const current = data[offset];
  if (current === undefined) throw new Train2MapError(`Missing finite tile ${offset}`);
  if (current !== 0 && gid !== 0 && current !== gid) {
    throw new Train2MapError(
      `Overlapping chunks disagree on ${layerName} at (${worldX}, ${worldY})`,
    );
  }
  if (gid !== 0) data[offset] = gid;
}

function exportObject(object: TiledObject): ExportedObject {
  return {
    id: object.id,
    name: object.name,
    type: object.type,
    x: object.x,
    y: object.y,
    width: object.width ?? 0,
    height: object.height ?? 0,
    rotation: object.rotation,
    visible: object.visible,
    ...(object.point ? { point: true as const } : {}),
    ...(object.gid === undefined ? {} : { gid: object.gid }),
    ...(object.properties.length === 0 ? {} : { properties: object.properties }),
  };
}

function rectangleTiles(object: TiledObject, tileSize: number): TilePoint[] {
  if (
    object.width === undefined ||
    object.height === undefined ||
    object.width <= 0 ||
    object.height <= 0
  ) {
    throw new Train2MapError(`Object ${object.name} is not a positive rectangle`);
  }
  const x0 = tileIndex(object.x, tileSize);
  const y0 = tileIndex(object.y, tileSize);
  const x1 = Math.ceil((object.x + object.width) / tileSize);
  const y1 = Math.ceil((object.y + object.height) / tileSize);
  const tiles: TilePoint[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) tiles.push({ x, y });
  }
  if (tiles.length === 0) throw new Train2MapError(`Object ${object.name} covers no tiles`);
  return tiles;
}

function pointTile(object: TiledObject, tileSize: number): TilePoint {
  return { x: tileIndex(object.x, tileSize), y: tileIndex(object.y, tileSize) };
}

function tileIndex(pixel: number, tileSize: number): number {
  const tile = Math.floor(pixel / tileSize);
  if (!Number.isSafeInteger(tile))
    throw new Train2MapError(`Tile index for ${pixel} is out of range`);
  return tile;
}

function namedObject(tiled: ParsedMap, layerName: string, objectName: string): TiledObject {
  const found = objectsByLayer(tiled, layerName).filter((object) => object.name === objectName);
  const object = found[0];
  if (object === undefined) throw new Train2MapError(`Missing ${objectName} on ${layerName}`);
  if (found.length > 1) throw new Train2MapError(`Duplicate ${objectName} on ${layerName}`);
  return object;
}

function objectsByLayer(tiled: ParsedMap, layerName: string): readonly TiledObject[] {
  const layer = tiled.layers.find(
    (candidate) => candidate.kind === 'object' && candidate.name === layerName,
  );
  if (layer === undefined || layer.kind !== 'object')
    throw new Train2MapError(`Missing object layer ${layerName}`);
  return layer.objects;
}

function uniqueRegion(bindings: MapBindings, zone: string): MapBindings['regions'][number] {
  const matches = bindings.regions.filter((region) => region.zones.includes(zone));
  const region = matches[0];
  if (region === undefined || matches.length !== 1) {
    throw new Train2MapError(`Zone ${zone} must belong to exactly one region`);
  }
  return region;
}

function tileLayers(tiled: ParsedMap): TileLayer[] {
  return tiled.layers.filter((layer): layer is TileLayer => layer.kind === 'tile');
}

function layerHasGid(layer: TileLayer): boolean {
  return layer.chunks.some((chunk) => chunk.gids.some((gid) => gid !== 0));
}

function zoneCellId(prefix: string, x: number, y: number): string {
  return `${prefix}.x${x}y${y}`;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function makeEdge(
  id: string,
  from: string,
  to: string,
  cost: number,
  shared: EdgeShared,
): LevelEdge {
  if (!(cost > 0) || !Number.isFinite(cost))
    throw new Train2MapError(`Edge ${id} has an invalid cost`);
  return {
    id,
    from,
    to,
    traversable: true,
    cost,
    transitionCapacity: shared.transitionCapacity,
    fireTransferWeight: shared.fireTransferWeight,
    pressureTransferWeight: shared.pressureTransferWeight,
  };
}

function tileCost(tiles: number, perTile: number): number {
  if (!Number.isInteger(tiles) || tiles <= 0)
    throw new Train2MapError('Edge length must be a positive tile count');
  return tiles * perTile;
}

function singleChild(element: XmlElement, name: string): XmlElement {
  const children = elementChildren(element, new Set([name]));
  const child = children[0];
  if (child === undefined || children.length !== 1) {
    throw new Train2MapError(`<${element.name}> must contain one <${name}>`);
  }
  return child;
}

function propertyValue(type: string, raw: string, name: string): string | number | boolean {
  if (type === 'int') return integerText(raw, name);
  if (type === 'float') return numberText(raw, name);
  if (type === 'bool') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Train2MapError(`Property ${name} is not a bool`);
  }
  return raw;
}

function integerAttribute(element: XmlElement, name: string): number {
  return integerText(requiredAttribute(element, name), `${element.name}@${name}`);
}

function optionalIntegerAttribute(element: XmlElement, name: string): number | undefined {
  const raw = element.attributes[name];
  if (raw === undefined) return undefined;
  return integerText(raw, `${element.name}@${name}`);
}

function numberAttribute(element: XmlElement, name: string): number {
  return numberText(requiredAttribute(element, name), `${element.name}@${name}`);
}

function optionalNumberAttribute(element: XmlElement, name: string): number | undefined {
  const raw = element.attributes[name];
  if (raw === undefined) return undefined;
  return numberText(raw, `${element.name}@${name}`);
}

function flagAttribute(element: XmlElement, name: string, fallback: boolean): boolean {
  const raw = element.attributes[name];
  if (raw === undefined) return fallback;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  throw new Train2MapError(`${element.name}@${name} is not a flag`);
}

function integerText(raw: string, label: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Train2MapError(`${label} is not an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Train2MapError(`${label} is out of range`);
  return value;
}

function numberText(raw: string, label: string): number {
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw)) throw new Train2MapError(`${label} is not a number`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Train2MapError(`${label} is out of range`);
  return value;
}

function parseCsv(text: string, count: number, label: string): number[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Train2MapError(`${label} is empty`);
  const parts = trimmed.split(',');
  if (parts[parts.length - 1]?.trim() === '') parts.pop();
  if (parts.length !== count) {
    throw new Train2MapError(`${label} has ${parts.length} tiles, expected ${count}`);
  }
  return parts.map((part, index) => {
    const token = part.trim();
    if (!/^\d+$/.test(token))
      throw new Train2MapError(`${label} gid ${index} is not an unsigned integer`);
    return integerText(token, `${label} gid ${index}`);
  });
}

function byId<T extends { readonly id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => compareIds(left.id, right.id));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveInside(root: string, fromFile: string, relativePath: string): string {
  if (path.isAbsolute(relativePath))
    throw new Train2MapError(`Path must be relative: ${relativePath}`);
  const start = path.extname(fromFile) === '' ? fromFile : path.dirname(fromFile);
  const resolved = path.resolve(start, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Train2MapError(`Path escapes the Game module: ${relativePath}`);
  }
  return resolved;
}

function assertFileMatches(file: string, expected: string): void {
  let actual: string;
  try {
    actual = readFileSync(file, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Train2MapError(`Missing ${file}. Run npm run map:build.`);
    }
    throw error;
  }
  if (actual === expected) return;
  throw new Train2MapError(
    `${file} differs from the generator at character ${firstDifference(actual, expected)}. Run npm run map:build.`,
  );
}

function firstDifference(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return length;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
