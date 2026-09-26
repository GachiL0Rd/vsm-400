import type { EdgeDefinition, GridRoute, GridWorld } from './grid-world';
import { assertSimTimeUs, type SimTimeUs } from './sim-time';

export type EntityId = string;

export interface SpatialWorldOptions {
  readonly grid: GridWorld;
  /** Multiplies effective edge cost to get a whole number of microseconds. */
  readonly microsecondsPerCostUnit: number;
  readonly objectAnchorIds?: readonly string[];
}

export interface CellSample {
  readonly kind: 'cell';
  readonly cellId: string;
}

export interface MovingSample {
  readonly kind: 'moving';
  readonly edgeId: string;
  readonly fromCellId: string;
  readonly toCellId: string;
  readonly startedAt: SimTimeUs;
  readonly arrivesAt: SimTimeUs;
  /** 0 at the start instant, approaching 1 before the completion instant. */
  readonly progress: number;
}

export interface AttachedSample {
  readonly kind: 'attached';
  readonly anchorId: string;
}

export type SpatialSample = CellSample | MovingSample | AttachedSample;

export interface MovementReservation {
  readonly entityId: EntityId;
  readonly edgeId: string;
  readonly fromCellId: string;
  readonly toCellId: string;
  readonly startedAt: SimTimeUs;
  readonly arrivesAt: SimTimeUs;
  readonly cost: number;
}

export interface SpatialWorld {
  readonly time: SimTimeUs;
  readonly microsecondsPerCostUnit: number;
  addEntity(id: EntityId, cellId: string): void;
  attach(entityId: EntityId, anchorId: string): void;
  detach(entityId: EntityId, cellId: string): void;
  startMovement(entityId: EntityId, edgeId: string, at: SimTimeUs): MovementReservation;
  cancelMovement(entityId: EntityId, at: SimTimeUs): void;
  materialize(time: SimTimeUs): void;
  positionAt(entityId: EntityId, time: SimTimeUs): SpatialSample;
  entitiesAt(cellId: string): readonly EntityId[];
  entitiesOnEdge(edgeId: string): readonly EntityId[];
  entitiesAttachedTo(anchorId: string): readonly EntityId[];
  route(from: string, to: string): GridRoute | null;
}

interface CellPlace {
  readonly kind: 'cell';
  readonly cellId: string;
}

interface MovingPlace {
  readonly kind: 'moving';
  readonly edgeId: string;
  readonly fromCellId: string;
  readonly toCellId: string;
  readonly startedAt: SimTimeUs;
  readonly arrivesAt: SimTimeUs;
  readonly cost: number;
}

interface AttachedPlace {
  readonly kind: 'attached';
  readonly anchorId: string;
}

type Place = CellPlace | MovingPlace | AttachedPlace;

interface StoredEntity {
  readonly id: EntityId;
  place: Place;
}

export function createSpatialWorld(options: SpatialWorldOptions): SpatialWorld {
  return new SpatialRuntime(options);
}

class SpatialRuntime implements SpatialWorld {
  readonly microsecondsPerCostUnit: number;
  private timeUs: SimTimeUs = 0;
  private readonly grid: GridWorld;
  private readonly cells = new Map<
    string,
    { readonly capacity: number; readonly multiplier: number }
  >();
  private readonly edges = new Map<string, EdgeDefinition>();
  private readonly objectAnchors: ReadonlySet<string>;
  private readonly entities = new Map<EntityId, StoredEntity>();
  private readonly cellIndex = new Map<string, Set<EntityId>>();
  private readonly edgeIndex = new Map<string, Set<EntityId>>();
  private readonly attachmentIndex = new Map<string, Set<EntityId>>();

  constructor(options: SpatialWorldOptions) {
    this.microsecondsPerCostUnit = assertPositiveInteger(
      options.microsecondsPerCostUnit,
      'microsecondsPerCostUnit',
    );
    this.grid = options.grid;
    for (const cell of options.grid.cells) {
      this.cells.set(cell.id, {
        capacity: cell.capacity,
        multiplier: cell.movementSpeedMultiplier ?? 1,
      });
      this.cellIndex.set(cell.id, new Set());
    }
    for (const edge of options.grid.edges) this.edges.set(edge.id, edge);
    this.objectAnchors = validateAnchors(options.objectAnchorIds);
  }

  get time(): SimTimeUs {
    return this.timeUs;
  }

  addEntity(id: EntityId, cellId: string): void {
    const entityId = assertId(id, 'Entity id');
    if (this.entities.has(entityId)) throw new RangeError(`Duplicate entity id ${entityId}`);
    this.requireCell(cellId);
    if (this.cellCount(cellId) >= this.cellCapacity(cellId)) {
      throw new RangeError(`Cell ${cellId} is full`);
    }
    this.entities.set(entityId, { id: entityId, place: { kind: 'cell', cellId } });
    bucket(this.cellIndex, cellId).add(entityId);
  }

  attach(entityId: EntityId, anchorId: string): void {
    const entity = this.requireEntity(entityId);
    if (entity.place.kind !== 'cell') throw new RangeError('Only a cell occupant can attach');
    const anchor = assertId(anchorId, 'Anchor id');
    if (anchor === entity.id) throw new RangeError('Entity cannot attach to itself');
    if (!this.entities.has(anchor) && !this.objectAnchors.has(anchor)) {
      throw new RangeError(`Unknown anchor ${anchor}`);
    }
    if (this.anchorChainContains(anchor, entity.id)) {
      throw new RangeError('Attachment would cycle');
    }
    bucket(this.cellIndex, entity.place.cellId).delete(entity.id);
    entity.place = { kind: 'attached', anchorId: anchor };
    bucket(this.attachmentIndex, anchor).add(entity.id);
  }

  detach(entityId: EntityId, cellId: string): void {
    const entity = this.requireEntity(entityId);
    if (entity.place.kind !== 'attached') throw new RangeError('Entity is not attached');
    this.requireCell(cellId);
    if (this.cellCount(cellId) >= this.cellCapacity(cellId)) {
      throw new RangeError(`Cell ${cellId} is full`);
    }
    bucket(this.attachmentIndex, entity.place.anchorId).delete(entity.id);
    entity.place = { kind: 'cell', cellId };
    bucket(this.cellIndex, cellId).add(entity.id);
  }

  startMovement(entityId: EntityId, edgeId: string, at: SimTimeUs): MovementReservation {
    this.materialize(at);
    const entity = this.requireEntity(entityId);
    if (entity.place.kind !== 'cell') throw new RangeError('Entity is not waiting in a cell');
    const edge = this.edges.get(edgeId);
    if (edge === undefined) throw new RangeError(`Unknown edge ${edgeId}`);
    if (entity.place.cellId !== edge.from) {
      throw new RangeError('Entity is not at the directed edge origin');
    }
    if (!edge.traversable) throw new RangeError(`Edge ${edge.id} is not traversable`);
    const duration = movementDuration(
      edge,
      this.cellMultiplier(edge.to),
      this.microsecondsPerCostUnit,
    );
    const arrivesAt = addTime(at, duration);
    if (this.cellCount(edge.to) >= this.cellCapacity(edge.to)) {
      throw new RangeError(`Destination cell ${edge.to} is full`);
    }
    if (this.edgeCount(edge.id) >= edge.transitionCapacity) {
      throw new RangeError(`Transition ${edge.id} is full`);
    }

    bucket(this.cellIndex, edge.from).delete(entity.id);
    const place: MovingPlace = {
      kind: 'moving',
      edgeId: edge.id,
      fromCellId: edge.from,
      toCellId: edge.to,
      startedAt: at,
      arrivesAt,
      cost: duration / this.microsecondsPerCostUnit,
    };
    entity.place = place;
    bucket(this.edgeIndex, edge.id).add(entity.id);
    return {
      entityId: entity.id,
      edgeId: edge.id,
      fromCellId: edge.from,
      toCellId: edge.to,
      startedAt: at,
      arrivesAt,
      cost: place.cost,
    };
  }

  cancelMovement(entityId: EntityId, at: SimTimeUs): void {
    this.materialize(at);
    const entity = this.requireEntity(entityId);
    if (entity.place.kind !== 'moving') throw new RangeError('Entity is not moving');
    const origin = entity.place.fromCellId;
    if (this.cellCount(origin) >= this.cellCapacity(origin)) {
      throw new RangeError(`Origin cell ${origin} is full`);
    }
    bucket(this.edgeIndex, entity.place.edgeId).delete(entity.id);
    entity.place = { kind: 'cell', cellId: origin };
    bucket(this.cellIndex, origin).add(entity.id);
  }

  materialize(time: SimTimeUs): void {
    const target = assertSimTimeUs(time);
    if (target < this.timeUs) throw new RangeError('Spatial time must not move backwards');
    const due = [...this.entities.values()]
      .filter((entity): entity is StoredEntity & { place: MovingPlace } => {
        return entity.place.kind === 'moving' && entity.place.arrivesAt <= target;
      })
      .sort((left, right) => {
        if (left.place.arrivesAt !== right.place.arrivesAt) {
          return left.place.arrivesAt - right.place.arrivesAt;
        }
        return compareIds(left.id, right.id);
      });
    for (const entity of due) this.completeMovement(entity);
    this.timeUs = target;
  }

  positionAt(entityId: EntityId, time: SimTimeUs): SpatialSample {
    const at = assertSimTimeUs(time);
    const entity = this.requireEntity(entityId);
    if (entity.place.kind !== 'moving') {
      return sampleOf(entity.place);
    }
    if (at < entity.place.startedAt) throw new RangeError('Time is before this movement');
    if (at >= entity.place.arrivesAt) {
      return { kind: 'cell', cellId: entity.place.toCellId };
    }
    const duration = entity.place.arrivesAt - entity.place.startedAt;
    const elapsed = at - entity.place.startedAt;
    return {
      kind: 'moving',
      edgeId: entity.place.edgeId,
      fromCellId: entity.place.fromCellId,
      toCellId: entity.place.toCellId,
      startedAt: entity.place.startedAt,
      arrivesAt: entity.place.arrivesAt,
      progress: elapsed / duration,
    };
  }

  entitiesAt(cellId: string): readonly EntityId[] {
    this.requireCell(cellId);
    return sortedIds(this.cellIndex.get(cellId));
  }

  entitiesOnEdge(edgeId: string): readonly EntityId[] {
    if (!this.edges.has(edgeId)) throw new RangeError(`Unknown edge ${edgeId}`);
    return sortedIds(this.edgeIndex.get(edgeId));
  }

  entitiesAttachedTo(anchorId: string): readonly EntityId[] {
    const anchor = assertId(anchorId, 'Anchor id');
    if (!this.entities.has(anchor) && !this.objectAnchors.has(anchor)) {
      throw new RangeError(`Unknown anchor ${anchor}`);
    }
    return sortedIds(this.attachmentIndex.get(anchor));
  }

  route(from: string, to: string): GridRoute | null {
    return this.grid.route(from, to, {
      cellOccupancy: countsRecord(this.cells.keys(), (cellId) => this.cellCount(cellId)),
      edgeOccupancy: countsRecord(this.edges.keys(), (edgeId) => this.edgeCount(edgeId)),
    });
  }

  private completeMovement(entity: StoredEntity): void {
    if (entity.place.kind !== 'moving') return;
    const destination = entity.place.toCellId;
    bucket(this.edgeIndex, entity.place.edgeId).delete(entity.id);
    entity.place = { kind: 'cell', cellId: destination };
    bucket(this.cellIndex, destination).add(entity.id);
  }

  private cellCount(cellId: string): number {
    let count = this.cellIndex.get(cellId)?.size ?? 0;
    for (const entity of this.entities.values()) {
      if (entity.place.kind === 'moving' && entity.place.toCellId === cellId) count += 1;
    }
    return count;
  }

  private edgeCount(edgeId: string): number {
    return this.edgeIndex.get(edgeId)?.size ?? 0;
  }

  private cellCapacity(cellId: string): number {
    return this.cells.get(cellId)?.capacity ?? 0;
  }

  private cellMultiplier(cellId: string): number {
    return this.cells.get(cellId)?.multiplier ?? 1;
  }

  private requireCell(cellId: string): void {
    if (!this.cells.has(cellId)) throw new RangeError(`Unknown cell ${cellId}`);
  }

  private requireEntity(entityId: EntityId): StoredEntity {
    const entity = this.entities.get(assertId(entityId, 'Entity id'));
    if (entity === undefined) throw new RangeError(`Unknown entity ${entityId}`);
    return entity;
  }

  private anchorChainContains(anchorId: string, entityId: EntityId): boolean {
    let current = anchorId;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      if (current === entityId) return true;
      seen.add(current);
      const anchor = this.entities.get(current);
      if (anchor?.place.kind !== 'attached') return false;
      current = anchor.place.anchorId;
    }
    return false;
  }
}

function movementDuration(
  edge: EdgeDefinition,
  destinationMultiplier: number,
  microsecondsPerCostUnit: number,
): SimTimeUs {
  const effectiveCost = edge.cost / destinationMultiplier;
  const product = effectiveCost * microsecondsPerCostUnit;
  const rounded = Math.round(product);
  const wholeMicroseconds =
    Number.isSafeInteger(rounded) && Math.abs(product - rounded) <= 0.000001 && rounded > 0;
  if (!wholeMicroseconds) {
    throw new RangeError(
      'Movement duration must be a positive safe integer number of microseconds',
    );
  }
  return rounded;
}

function addTime(start: SimTimeUs, duration: SimTimeUs): SimTimeUs {
  const sum = start + duration;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError('Movement completion time exceeds the safe integer range');
  }
  return assertSimTimeUs(sum);
}

function sampleOf(place: CellPlace | AttachedPlace): SpatialSample {
  if (place.kind === 'cell') return { kind: 'cell', cellId: place.cellId };
  return { kind: 'attached', anchorId: place.anchorId };
}

function countsRecord(
  ids: Iterable<string>,
  count: (id: string) => number,
): Record<string, number> {
  const record: Record<string, number> = {};
  for (const id of ids) {
    const value = count(id);
    if (value > 0) record[id] = value;
  }
  return record;
}

function bucket(index: Map<string, Set<EntityId>>, key: string): Set<EntityId> {
  const existing = index.get(key);
  if (existing !== undefined) return existing;
  const created = new Set<EntityId>();
  index.set(key, created);
  return created;
}

function sortedIds(ids: ReadonlySet<EntityId> | undefined): EntityId[] {
  if (ids === undefined) return [];
  return [...ids].sort(compareIds);
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateAnchors(ids: readonly string[] | undefined): Set<string> {
  const anchors = new Set<string>();
  if (ids === undefined) return anchors;
  for (const id of ids) {
    const anchor = assertId(id, 'Object anchor id');
    if (anchors.has(anchor)) throw new RangeError(`Duplicate object anchor ${anchor}`);
    anchors.add(anchor);
  }
  return anchors;
}

function assertId(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertPositiveInteger(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}
