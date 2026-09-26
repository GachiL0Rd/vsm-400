import { assertSimTimeUs, type SimTimeUs } from './sim-time';

export const SERVICE_CLASS_TRAITS = ['basic', 'comfort', 'business'] as const;
export type ServiceClassTrait = (typeof SERVICE_CLASS_TRAITS)[number];
export type EntityKind = 'player' | 'passenger';
export type EntityId = string;
export type TraitId = string;
export type ItemId = string;

export type EntityPosition =
  | { readonly kind: 'cell'; readonly cellId: string }
  | {
      readonly kind: 'edge';
      readonly edgeId: string;
      readonly fromCellId: string;
      readonly toCellId: string;
    }
  | { readonly kind: 'path'; readonly pathId: string };

export interface CurrentAction {
  readonly actionId: string;
  readonly generation: number;
  readonly startedAt: SimTimeUs;
  readonly targetId?: string;
  readonly phase:
    | { readonly kind: 'running'; readonly completesAt: SimTimeUs }
    | { readonly kind: 'waiting'; readonly timeoutAt?: SimTimeUs };
}

/**
 * Server entity record. Traits are hidden simulation state, not a client view.
 * Grant time and expiry generation stay off this object.
 */
export interface EntityState {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly position: EntityPosition;
  readonly traits: readonly TraitId[];
  readonly heldItemId?: ItemId;
  readonly currentAction?: CurrentAction;
}

export interface NewEntity {
  readonly id: EntityId;
  readonly position: EntityPosition;
  readonly traits: readonly TraitId[];
  readonly heldItemId?: ItemId;
  readonly currentAction?: CurrentAction;
}

/** Flat selector. This is not a CSS parser. */
export type EntitySelector =
  | { readonly op: 'kind'; readonly kind: EntityKind }
  | { readonly op: 'id'; readonly id: EntityId }
  | { readonly op: 'trait'; readonly traitId: TraitId }
  | { readonly op: 'not'; readonly selector: EntitySelector }
  | { readonly op: 'all'; readonly selectors: readonly EntitySelector[] }
  | { readonly op: 'any'; readonly selectors: readonly EntitySelector[] };

export interface TraitGrantRule {
  readonly id: TraitId;
  readonly rejectIf?: readonly EntitySelector[];
}

/**
 * Attempt-wide expiry hook. The store does not own a queue or a clock.
 * `key` comes from `traitExpiryKey` and is safe for composite entity/trait ids.
 */
export interface TraitExpiryScheduler {
  schedule(at: SimTimeUs, key: string): void;
  generation(key: string): number;
  setGeneration(key: string, generation: number): void;
}

export interface EntityStore {
  addPlayer(input: NewEntity): EntityState;
  addPassenger(input: NewEntity): EntityState;
  get(id: EntityId): EntityState;
  list(): readonly EntityState[];
  grantTrait(
    entityId: EntityId,
    traitId: TraitId,
    at: SimTimeUs,
    lifetime?: SimTimeUs,
  ): EntityState;
  removeTrait(entityId: EntityId, traitId: TraitId): EntityState;
  setServiceClass(passengerId: EntityId, serviceClass: ServiceClassTrait): EntityState;
  setHeldItem(entityId: EntityId, itemId: ItemId): EntityState;
  clearHeldItem(entityId: EntityId): EntityState;
  setCurrentAction(entityId: EntityId, action: CurrentAction): EntityState;
  clearCurrentAction(entityId: EntityId): EntityState;
  setPosition(entityId: EntityId, position: EntityPosition): EntityState;
  select(selector: EntitySelector): readonly EntityId[];
  /** Called by the attempt event loop when a trait-expiry event is extracted. */
  applyTraitExpiry(key: string, generation: number | null): void;
}

interface TraitTiming {
  readonly entityId: EntityId;
  readonly traitId: TraitId;
  readonly grantedAt: SimTimeUs;
  readonly generation: number;
  readonly expiresAt: SimTimeUs;
}

interface StoredEntity {
  readonly id: EntityId;
  readonly kind: EntityKind;
  position: EntityPosition;
  traits: TraitId[];
  heldItemId?: ItemId;
  currentAction?: CurrentAction;
}

/** Length-prefixed so entity and trait ids cannot collide inside one generation key. */
export function traitExpiryKey(entityId: EntityId, traitId: TraitId): string {
  return `trait-expiry/${encodeId(entityId)}/${encodeId(traitId)}`;
}

export function createEntityStore(
  scheduler: TraitExpiryScheduler,
  rules: readonly TraitGrantRule[] = [],
): EntityStore {
  return new EntityRuntime(scheduler, rules);
}

class EntityRuntime implements EntityStore {
  private readonly entities = new Map<EntityId, StoredEntity>();
  private readonly timing = new Map<string, TraitTiming>();
  private readonly rejectIf = new Map<TraitId, readonly EntitySelector[]>();

  constructor(
    private readonly scheduler: TraitExpiryScheduler,
    rules: readonly TraitGrantRule[],
  ) {
    for (const rule of rules) {
      const id = assertId(rule.id, 'Trait id');
      if (this.rejectIf.has(id)) throw new RangeError(`Duplicate trait rule ${id}`);
      for (const selector of rule.rejectIf ?? []) validateSelector(selector);
      this.rejectIf.set(id, rule.rejectIf ?? []);
    }
  }

  addPlayer(input: NewEntity): EntityState {
    return this.add(input, 'player');
  }

  addPassenger(input: NewEntity): EntityState {
    return this.add(input, 'passenger');
  }

  get(id: EntityId): EntityState {
    return toState(this.require(id));
  }

  list(): readonly EntityState[] {
    return [...this.entities.values()]
      .sort((left, right) => compareIds(left.id, right.id))
      .map(toState);
  }

  grantTrait(
    entityId: EntityId,
    traitId: TraitId,
    at: SimTimeUs,
    lifetime?: SimTimeUs,
  ): EntityState {
    const grantedAt = assertSimTimeUs(at);
    const entity = this.require(entityId);
    const trait = assertId(traitId, 'Trait id');
    const duration = lifetime === undefined ? undefined : assertLifetime(lifetime);
    this.assertClassGrant(entity, trait, duration);

    if (entity.traits.includes(trait)) {
      if (duration === undefined) return toState(entity);
      this.scheduleExpiry(entity, trait, grantedAt, duration);
      return toState(entity);
    }

    this.assertRejected(entity, trait);
    if (duration !== undefined) this.scheduleExpiry(entity, trait, grantedAt, duration);
    entity.traits = sortTraits([...entity.traits, trait]);
    return toState(entity);
  }

  removeTrait(entityId: EntityId, traitId: TraitId): EntityState {
    const entity = this.require(entityId);
    const trait = assertId(traitId, 'Trait id');
    if (!entity.traits.includes(trait)) return toState(entity);
    if (entity.kind === 'passenger' && isServiceClass(trait)) {
      throw new RangeError('Passenger service class cannot be removed directly');
    }
    this.invalidateExpiry(entity.id, trait);
    entity.traits = entity.traits.filter((item) => item !== trait);
    return toState(entity);
  }

  setServiceClass(passengerId: EntityId, serviceClass: ServiceClassTrait): EntityState {
    const entity = this.require(passengerId);
    if (entity.kind !== 'passenger') throw new RangeError('Only a passenger has a service class');
    if (!isServiceClass(serviceClass))
      throw new RangeError(`Unknown service class ${serviceClass}`);
    const current = serviceClassOf(entity.traits);
    if (current === serviceClass) return toState(entity);
    this.invalidateExpiry(entity.id, current);
    entity.traits = sortTraits([
      ...entity.traits.filter((trait) => !isServiceClass(trait)),
      serviceClass,
    ]);
    return toState(entity);
  }

  setHeldItem(entityId: EntityId, itemId: ItemId): EntityState {
    const entity = this.require(entityId);
    const item = assertId(itemId, 'Item id');
    if (entity.heldItemId !== undefined && entity.heldItemId !== item) {
      throw new RangeError('Entity already holds an item');
    }
    entity.heldItemId = item;
    return toState(entity);
  }

  clearHeldItem(entityId: EntityId): EntityState {
    const entity = this.require(entityId);
    delete entity.heldItemId;
    return toState(entity);
  }

  setCurrentAction(entityId: EntityId, action: CurrentAction): EntityState {
    const entity = this.require(entityId);
    if (entity.currentAction !== undefined) {
      throw new RangeError('Entity already has a current action');
    }
    entity.currentAction = validateAction(action);
    return toState(entity);
  }

  clearCurrentAction(entityId: EntityId): EntityState {
    const entity = this.require(entityId);
    delete entity.currentAction;
    return toState(entity);
  }

  setPosition(entityId: EntityId, position: EntityPosition): EntityState {
    const entity = this.require(entityId);
    entity.position = validatePosition(position);
    return toState(entity);
  }

  select(selector: EntitySelector): readonly EntityId[] {
    validateSelector(selector);
    return [...this.entities.values()]
      .filter((entity) => matches(entity, selector))
      .map((entity) => entity.id)
      .sort(compareIds);
  }

  applyTraitExpiry(key: string, generation: number | null): void {
    const timing = this.timing.get(key);
    if (timing === undefined || generation !== timing.generation) return;
    const entity = this.entities.get(timing.entityId);
    this.timing.delete(key);
    if (entity === undefined) return;
    entity.traits = entity.traits.filter((trait) => trait !== timing.traitId);
  }

  private add(input: NewEntity, kind: EntityKind): EntityState {
    const id = assertId(input.id, 'Entity id');
    if (this.entities.has(id)) throw new RangeError(`Duplicate entity id ${id}`);
    const traits = sortTraits(input.traits.map((trait) => assertId(trait, 'Trait id')));
    assertUnique(traits, 'Trait id');
    assertClassInvariant(kind, traits);
    const entity: StoredEntity = {
      id,
      kind,
      position: validatePosition(input.position),
      traits,
    };
    for (const trait of traits) this.assertRejected(entity, trait);
    if (input.heldItemId !== undefined) entity.heldItemId = assertId(input.heldItemId, 'Item id');
    if (input.currentAction !== undefined) {
      entity.currentAction = validateAction(input.currentAction);
    }
    this.entities.set(id, entity);
    return toState(entity);
  }

  private scheduleExpiry(
    entity: StoredEntity,
    traitId: TraitId,
    at: SimTimeUs,
    lifetime: SimTimeUs,
  ): void {
    const expiresAt = addTime(at, lifetime);
    const key = traitExpiryKey(entity.id, traitId);
    const generation = this.bumpExpiry(key);
    this.scheduler.schedule(expiresAt, key);
    this.timing.set(key, {
      entityId: entity.id,
      traitId,
      grantedAt: at,
      generation,
      expiresAt,
    });
  }

  private invalidateExpiry(entityId: EntityId, traitId: TraitId): void {
    const key = traitExpiryKey(entityId, traitId);
    if (this.timing.has(key) || this.scheduler.generation(key) > 0) this.bumpExpiry(key);
    this.timing.delete(key);
  }

  private bumpExpiry(key: string): number {
    const next = this.scheduler.generation(key) + 1;
    if (!Number.isSafeInteger(next)) {
      throw new RangeError('Trait expiry generation exceeded the safe integer range');
    }
    this.scheduler.setGeneration(key, next);
    return next;
  }

  private assertClassGrant(
    entity: StoredEntity,
    traitId: TraitId,
    lifetime: SimTimeUs | undefined,
  ): void {
    if (!isServiceClass(traitId)) return;
    if (lifetime !== undefined) throw new RangeError('Service class traits do not expire');
    if (entity.kind !== 'passenger') throw new RangeError('Player cannot have a service class');
    const current = serviceClassOf(entity.traits);
    if (current !== traitId) throw new RangeError('Passenger already has a service class');
  }

  private assertRejected(entity: StoredEntity, traitId: TraitId): void {
    const rules = this.rejectIf.get(traitId) ?? [];
    if (rules.some((selector) => matches(entity, selector))) {
      throw new RangeError(`Trait ${traitId} is rejected for ${entity.id}`);
    }
  }

  private require(entityId: EntityId): StoredEntity {
    const entity = this.entities.get(assertId(entityId, 'Entity id'));
    if (entity === undefined) throw new RangeError(`Unknown entity ${entityId}`);
    return entity;
  }
}

function toState(entity: StoredEntity): EntityState {
  const state: EntityState = {
    id: entity.id,
    kind: entity.kind,
    position: entity.position,
    traits: [...entity.traits],
  };
  if (entity.heldItemId !== undefined) {
    return entity.currentAction === undefined
      ? { ...state, heldItemId: entity.heldItemId }
      : { ...state, heldItemId: entity.heldItemId, currentAction: entity.currentAction };
  }
  if (entity.currentAction !== undefined) return { ...state, currentAction: entity.currentAction };
  return state;
}

export function matchesEntitySelector(
  entity: Pick<EntityState, 'id' | 'kind' | 'traits'>,
  selector: EntitySelector,
): boolean {
  return matches(entity, selector);
}

export function validateEntitySelector(selector: EntitySelector): void {
  validateSelector(selector);
}

function matches(
  entity: Pick<EntityState, 'id' | 'kind' | 'traits'>,
  selector: EntitySelector,
): boolean {
  switch (selector.op) {
    case 'kind':
      return entity.kind === selector.kind;
    case 'id':
      return entity.id === selector.id;
    case 'trait':
      return entity.traits.includes(selector.traitId);
    case 'not':
      return !matches(entity, selector.selector);
    case 'all':
      return selector.selectors.every((item) => matches(entity, item));
    case 'any':
      return selector.selectors.some((item) => matches(entity, item));
    default:
      return false;
  }
}

function validateSelector(selector: EntitySelector): void {
  switch (selector.op) {
    case 'kind':
      if (selector.kind !== 'player' && selector.kind !== 'passenger') {
        throw new RangeError('Selector kind is invalid');
      }
      return;
    case 'id':
      assertId(selector.id, 'Selector id');
      return;
    case 'trait':
      assertId(selector.traitId, 'Selector trait');
      return;
    case 'not':
      validateSelector(selector.selector);
      return;
    case 'all':
    case 'any':
      if (!Array.isArray(selector.selectors)) throw new RangeError('Selector list is invalid');
      for (const item of selector.selectors) validateSelector(item);
      return;
    default:
      throw new RangeError('Selector is invalid');
  }
}

function assertClassInvariant(kind: EntityKind, traits: readonly TraitId[]): void {
  const classes = traits.filter(isServiceClass);
  if (kind === 'player' && classes.length > 0) {
    throw new RangeError('Player cannot have a service class');
  }
  if (kind === 'passenger' && classes.length !== 1) {
    throw new RangeError('Passenger requires exactly one service class');
  }
}

function serviceClassOf(traits: readonly TraitId[]): ServiceClassTrait {
  const classes = traits.filter(isServiceClass);
  if (classes.length !== 1) throw new RangeError('Passenger requires exactly one service class');
  return classes[0] as ServiceClassTrait;
}

function isServiceClass(traitId: string): traitId is ServiceClassTrait {
  return traitId === 'basic' || traitId === 'comfort' || traitId === 'business';
}

function validatePosition(position: EntityPosition): EntityPosition {
  switch (position.kind) {
    case 'cell':
      return { kind: 'cell', cellId: assertId(position.cellId, 'Cell id') };
    case 'edge':
      return {
        kind: 'edge',
        edgeId: assertId(position.edgeId, 'Edge id'),
        fromCellId: assertId(position.fromCellId, 'Cell id'),
        toCellId: assertId(position.toCellId, 'Cell id'),
      };
    case 'path':
      return { kind: 'path', pathId: assertId(position.pathId, 'Path id') };
    default:
      throw new RangeError('Entity position is invalid');
  }
}

function validateAction(action: CurrentAction): CurrentAction {
  const actionId = assertId(action.actionId, 'Action id');
  if (!Number.isSafeInteger(action.generation) || action.generation < 0) {
    throw new RangeError('Action generation must be a nonnegative safe integer');
  }
  const startedAt = assertSimTimeUs(action.startedAt);
  if (action.phase.kind === 'running') {
    const completesAt = assertSimTimeUs(action.phase.completesAt);
    if (completesAt < startedAt) {
      throw new RangeError('Running action cannot complete before it starts');
    }
    return baseAction(actionId, action.generation, startedAt, action.targetId, {
      kind: 'running',
      completesAt,
    });
  }
  if (action.phase.kind === 'waiting') {
    if (action.phase.timeoutAt === undefined) {
      return baseAction(actionId, action.generation, startedAt, action.targetId, {
        kind: 'waiting',
      });
    }
    const timeoutAt = assertSimTimeUs(action.phase.timeoutAt);
    if (timeoutAt < startedAt) {
      throw new RangeError('Waiting action cannot time out before it starts');
    }
    return baseAction(actionId, action.generation, startedAt, action.targetId, {
      kind: 'waiting',
      timeoutAt,
    });
  }
  throw new RangeError('Action phase is invalid');
}

function baseAction(
  actionId: string,
  generation: number,
  startedAt: SimTimeUs,
  targetId: string | undefined,
  phase: CurrentAction['phase'],
): CurrentAction {
  const action: CurrentAction = { actionId, generation, startedAt, phase };
  if (targetId === undefined) return action;
  return { ...action, targetId: assertId(targetId, 'Action target id') };
}

function sortTraits(traits: readonly TraitId[]): TraitId[] {
  return [...traits].sort(compareIds);
}

function assertUnique(sorted: readonly string[], label: string): void {
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      throw new RangeError(`Duplicate ${label} ${sorted[index] ?? ''}`);
    }
  }
}

function assertLifetime(lifetime: SimTimeUs): SimTimeUs {
  const value = assertSimTimeUs(lifetime);
  if (value <= 0) throw new RangeError('Trait lifetime must be a positive simulation duration');
  return value;
}

function addTime(start: SimTimeUs, duration: SimTimeUs): SimTimeUs {
  const sum = start + duration;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError('Trait expiry exceeds the safe integer range');
  }
  return assertSimTimeUs(sum);
}

function encodeId(id: string): string {
  return `${id.length}:${id}`;
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
