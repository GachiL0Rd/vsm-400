import type { CurrentAction, EntityId, EntityStore, ItemId } from './entity-store';

export type CheckState = 'unset' | 'ok' | 'problem';
export type SanitationCheckState = 'unset' | 'clean' | 'issue';
export type JournalField = 'communication' | 'extinguisher' | 'climate' | 'emergencyBrake';
export type ExtinguisherPressure = 'low' | 'normal' | 'high';
export type ExtinguisherDamage = 'none' | 'scratch' | 'dent';
export type ConsumableKind = 'food' | 'drink';

export interface ItemWorldConfig {
  readonly journal: {
    readonly id: ItemId;
    readonly homeAnchorId: string;
    readonly homeCellId: string;
  };
  readonly extinguisher: {
    readonly id: ItemId;
    readonly mountAnchorId: string;
    readonly mountCellId: string;
    readonly pressure: ExtinguisherPressure;
    readonly bodyDamage: ExtinguisherDamage;
  };
  readonly servicePoint: {
    readonly id: string;
    readonly cellId: string;
  };
}

/** Player-edited document. Checklist values are not copied from the world. */
export interface AcceptanceJournalState {
  readonly id: ItemId;
  readonly kind: 'acceptance-journal';
  readonly location: 'anchor' | 'held';
  readonly holderId?: EntityId;
  readonly homeAnchorId: string;
  readonly homeCellId: string;
  readonly communication: CheckState;
  readonly extinguisher: CheckState;
  readonly climate: CheckState;
  readonly emergencyBrake: CheckState;
  readonly sanitation: SanitationCheckState;
  readonly note: string;
  readonly accepted: boolean;
  readonly submitted: boolean;
}

export interface ExtinguisherState {
  readonly id: ItemId;
  readonly kind: 'extinguisher';
  readonly location: 'mounted' | 'held' | 'world';
  readonly holderId?: EntityId;
  readonly mountAnchorId: string;
  readonly mountCellId: string;
  readonly pin: 'present' | 'removed';
  readonly seal: 'intact' | 'broken';
  readonly pressure: ExtinguisherPressure;
  readonly bodyDamage: ExtinguisherDamage;
  readonly used: boolean;
}

export interface ConsumableState {
  readonly id: ItemId;
  readonly kind: ConsumableKind;
  readonly location: 'held' | 'given';
  readonly holderId?: EntityId;
  readonly givenToId?: EntityId;
  readonly servicePointId: string;
}

export interface ItemGiven {
  readonly type: 'item-given';
  readonly giverId: EntityId;
  readonly targetId: EntityId;
  readonly itemId: ItemId;
  readonly itemKind: ConsumableKind;
  readonly waitingActionGeneration: number | null;
}

export interface ExtinguisherUsed {
  readonly type: 'extinguisher-used';
  readonly holderId: EntityId;
  readonly itemId: ItemId;
  readonly targetId: string;
}

export type ItemEvent = ItemGiven | ExtinguisherUsed;

export interface ItemSnapshot {
  readonly journal: AcceptanceJournalState;
  readonly extinguisher: ExtinguisherState;
  readonly consumables: readonly ConsumableState[];
}

export interface ItemStore {
  snapshot(): ItemSnapshot;
  takeJournal(actorId: EntityId): AcceptanceJournalState;
  setJournalEntry(
    actorId: EntityId,
    field: JournalField,
    value: CheckState,
  ): AcceptanceJournalState;
  setJournalSanitation(actorId: EntityId, value: SanitationCheckState): AcceptanceJournalState;
  setJournalNote(actorId: EntityId, note: string): AcceptanceJournalState;
  markJournalAccepted(actorId: EntityId): AcceptanceJournalState;
  returnJournal(actorId: EntityId): AcceptanceJournalState;
  inspectExtinguisher(actorId: EntityId): ExtinguisherState;
  takeExtinguisher(actorId: EntityId): ExtinguisherState;
  returnExtinguisher(actorId: EntityId): ExtinguisherState;
  prepareExtinguisher(actorId: EntityId): ExtinguisherState;
  useExtinguisher(actorId: EntityId, targetId: string): ExtinguisherUsed;
  takeFood(actorId: EntityId): ConsumableState;
  takeDrink(actorId: EntityId): ConsumableState;
  giveConsumable(actorId: EntityId, targetId: EntityId): ItemGiven;
}

interface MutableJournal {
  location: 'anchor' | 'held';
  holderId?: EntityId;
  communication: CheckState;
  extinguisher: CheckState;
  climate: CheckState;
  emergencyBrake: CheckState;
  sanitation: SanitationCheckState;
  note: string;
  accepted: boolean;
  submitted: boolean;
}

interface MutableExtinguisher {
  location: 'mounted' | 'held' | 'world';
  holderId?: EntityId;
  pin: 'present' | 'removed';
  seal: 'intact' | 'broken';
  used: boolean;
}

interface MutableConsumable {
  readonly id: ItemId;
  readonly kind: ConsumableKind;
  location: 'held' | 'given';
  holderId?: EntityId;
  givenToId?: EntityId;
}

export function createItemStore(entities: EntityStore, config: ItemWorldConfig): ItemStore {
  return new ItemRuntime(entities, cloneConfig(validateConfig(config)));
}

export function itemGivenMatchesWaitingAction(event: ItemGiven, action: CurrentAction): boolean {
  if (action.phase.kind !== 'waiting') return false;
  const expected = event.itemKind === 'drink' ? 'request-drink' : 'request-food';
  return action.actionId === expected && event.waitingActionGeneration === action.generation;
}

class ItemRuntime implements ItemStore {
  private readonly journal: MutableJournal;
  private readonly extinguisher: MutableExtinguisher;
  private readonly consumables = new Map<ItemId, MutableConsumable>();
  private foodCount = 0;
  private drinkCount = 0;

  constructor(
    private readonly entities: EntityStore,
    private readonly config: ItemWorldConfig,
  ) {
    this.journal = {
      location: 'anchor',
      communication: 'unset',
      extinguisher: 'unset',
      climate: 'unset',
      emergencyBrake: 'unset',
      sanitation: 'unset',
      note: '',
      accepted: false,
      submitted: false,
    };
    this.extinguisher = {
      location: 'mounted',
      pin: 'present',
      seal: 'intact',
      used: false,
    };
  }

  snapshot(): ItemSnapshot {
    return {
      journal: this.journalState(),
      extinguisher: this.extinguisherState(),
      consumables: [...this.consumables.values()]
        .sort((left, right) => compareIds(left.id, right.id))
        .map((item) => this.consumableState(item)),
    };
  }

  takeJournal(actorId: EntityId): AcceptanceJournalState {
    this.precheck(() => {
      this.requirePlayerAt(actorId, this.config.journal.homeCellId);
      if (this.journal.location !== 'anchor') throw new RangeError('Journal is not at its anchor');
      this.requireFreeHand(actorId);
    });
    return this.commit(actorId, this.config.journal.id, () => {
      this.journal.location = 'held';
      this.journal.holderId = actorId;
    }).journal;
  }

  setJournalEntry(
    actorId: EntityId,
    field: JournalField,
    value: CheckState,
  ): AcceptanceJournalState {
    this.precheck(() => {
      this.requireHolder(actorId, this.config.journal.id);
      if (!isJournalField(field) || !isCheckState(value)) {
        throw new RangeError('Journal entry is invalid');
      }
    });
    this.journal[field] = value;
    return this.journalState();
  }

  setJournalSanitation(actorId: EntityId, value: SanitationCheckState): AcceptanceJournalState {
    this.precheck(() => {
      this.requireHolder(actorId, this.config.journal.id);
      if (!isSanitation(value)) throw new RangeError('Sanitation entry is invalid');
    });
    this.journal.sanitation = value;
    return this.journalState();
  }

  setJournalNote(actorId: EntityId, note: string): AcceptanceJournalState {
    this.precheck(() => {
      this.requireHolder(actorId, this.config.journal.id);
      if (typeof note !== 'string') throw new RangeError('Journal note must be a string');
    });
    this.journal.note = note;
    return this.journalState();
  }

  markJournalAccepted(actorId: EntityId): AcceptanceJournalState {
    this.precheck(() => this.requireHolder(actorId, this.config.journal.id));
    this.journal.accepted = true;
    return this.journalState();
  }

  returnJournal(actorId: EntityId): AcceptanceJournalState {
    this.precheck(() => {
      this.requireHolder(actorId, this.config.journal.id);
      this.requirePlayerAt(actorId, this.config.journal.homeCellId);
    });
    return this.release(actorId, () => {
      this.journal.location = 'anchor';
      delete this.journal.holderId;
      this.journal.submitted = true;
    }).journal;
  }

  inspectExtinguisher(actorId: EntityId): ExtinguisherState {
    this.precheck(() => this.requireExtinguisherAccess(actorId));
    return this.extinguisherState();
  }

  takeExtinguisher(actorId: EntityId): ExtinguisherState {
    this.precheck(() => {
      this.requirePlayerAt(actorId, this.config.extinguisher.mountCellId);
      if (this.extinguisher.location !== 'mounted') {
        throw new RangeError('Extinguisher is not mounted');
      }
      this.requireFreeHand(actorId);
    });
    return this.commit(actorId, this.config.extinguisher.id, () => {
      this.extinguisher.location = 'held';
      this.extinguisher.holderId = actorId;
    }).extinguisher;
  }

  returnExtinguisher(actorId: EntityId): ExtinguisherState {
    this.precheck(() => {
      this.requireHolder(actorId, this.config.extinguisher.id);
      this.requirePlayerAt(actorId, this.config.extinguisher.mountCellId);
    });
    return this.release(actorId, () => {
      this.extinguisher.location = 'mounted';
      delete this.extinguisher.holderId;
    }).extinguisher;
  }

  prepareExtinguisher(actorId: EntityId): ExtinguisherState {
    this.precheck(() => {
      this.requireHolder(actorId, this.config.extinguisher.id);
      if (this.extinguisher.pin !== 'present')
        throw new RangeError('Extinguisher pin is already removed');
    });
    this.extinguisher.pin = 'removed';
    this.extinguisher.seal = 'broken';
    return this.extinguisherState();
  }

  useExtinguisher(actorId: EntityId, targetId: string): ExtinguisherUsed {
    this.precheck(() => {
      this.requireHolder(actorId, this.config.extinguisher.id);
      if (this.extinguisher.pin !== 'removed' || this.extinguisher.seal !== 'broken') {
        throw new RangeError('Extinguisher is not prepared');
      }
      if (this.extinguisher.used) throw new RangeError('Extinguisher is already used');
      if (typeof targetId !== 'string' || targetId.length === 0) {
        throw new RangeError('Extinguisher target is required');
      }
    });
    this.extinguisher.used = true;
    return {
      type: 'extinguisher-used',
      holderId: actorId,
      itemId: this.config.extinguisher.id,
      targetId,
    };
  }

  takeFood(actorId: EntityId): ConsumableState {
    return this.takeConsumable(actorId, 'food');
  }

  takeDrink(actorId: EntityId): ConsumableState {
    return this.takeConsumable(actorId, 'drink');
  }

  giveConsumable(actorId: EntityId, targetId: EntityId): ItemGiven {
    const actor = this.requirePlayer(actorId);
    const heldId = actor.heldItemId;
    const item = heldId === undefined ? undefined : this.consumables.get(heldId);
    const target = this.entities.get(targetId);
    this.precheck(() => {
      if (item === undefined || item.location !== 'held' || item.holderId !== actorId) {
        throw new RangeError('Player is not holding food or drink');
      }
      if (target.kind !== 'passenger')
        throw new RangeError('Food and drink are given to a passenger');
      this.requireSameCell(actorId, targetId);
    });
    if (item === undefined) throw new RangeError('Player is not holding food or drink');
    const waiting = target.currentAction;
    const expectedAction = item.kind === 'drink' ? 'request-drink' : 'request-food';
    const waitingActionGeneration =
      waiting !== undefined &&
      waiting.phase.kind === 'waiting' &&
      waiting.actionId === expectedAction
        ? waiting.generation
        : null;
    const event: ItemGiven = {
      type: 'item-given',
      giverId: actorId,
      targetId,
      itemId: item.id,
      itemKind: item.kind,
      waitingActionGeneration,
    };
    this.release(actorId, () => {
      item.location = 'given';
      delete item.holderId;
      item.givenToId = targetId;
    });
    return event;
  }

  private takeConsumable(actorId: EntityId, kind: ConsumableKind): ConsumableState {
    this.precheck(() => {
      this.requirePlayerAt(actorId, this.config.servicePoint.cellId);
      this.requireFreeHand(actorId);
    });
    const id = this.nextConsumableId(kind);
    const created: MutableConsumable = {
      id,
      kind,
      location: 'held',
      holderId: actorId,
    };
    this.commit(actorId, id, () => {
      this.consumables.set(id, created);
      if (kind === 'food') this.foodCount += 1;
      else this.drinkCount += 1;
    });
    return this.consumableState(created);
  }

  private nextConsumableId(kind: ConsumableKind): ItemId {
    const number = (kind === 'food' ? this.foodCount : this.drinkCount) + 1;
    return `${kind}-${number}`;
  }

  private commit(actorId: EntityId, itemId: ItemId, mutate: () => void): ItemSnapshot {
    const before = this.clone();
    mutate();
    try {
      this.entities.setHeldItem(actorId, itemId);
    } catch (error) {
      this.restore(before);
      throw error;
    }
    return this.snapshot();
  }

  private release(actorId: EntityId, mutate: () => void): ItemSnapshot {
    const before = this.clone();
    mutate();
    try {
      this.entities.clearHeldItem(actorId);
    } catch (error) {
      this.restore(before);
      throw error;
    }
    return this.snapshot();
  }

  private precheck(check: () => void): void {
    check();
  }

  private requirePlayer(actorId: EntityId) {
    const actor = this.entities.get(actorId);
    if (actor.kind !== 'player') throw new RangeError('Only the player handles these items');
    return actor;
  }

  private requirePlayerAt(actorId: EntityId, cellId: string) {
    const actor = this.requirePlayer(actorId);
    if (actor.position.kind !== 'cell' || actor.position.cellId !== cellId) {
      throw new RangeError('Player is not at the item');
    }
    return actor;
  }

  private requireSameCell(actorId: EntityId, targetId: EntityId): void {
    const actor = this.requirePlayer(actorId);
    const target = this.entities.get(targetId);
    if (actor.position.kind !== 'cell' || target.position.kind !== 'cell') {
      throw new RangeError('Player is not beside the passenger');
    }
    if (actor.position.cellId !== target.position.cellId) {
      throw new RangeError('Player is not beside the passenger');
    }
  }

  private requireFreeHand(actorId: EntityId): void {
    if (this.requirePlayer(actorId).heldItemId !== undefined) {
      throw new RangeError('Player already holds an item');
    }
  }

  private requireHolder(actorId: EntityId, itemId: ItemId): void {
    if (this.requirePlayer(actorId).heldItemId !== itemId) {
      throw new RangeError('Player is not holding that item');
    }
  }

  private requireExtinguisherAccess(actorId: EntityId): void {
    const actor = this.requirePlayer(actorId);
    if (actor.heldItemId === this.config.extinguisher.id) return;
    this.requirePlayerAt(actorId, this.config.extinguisher.mountCellId);
  }

  private journalState(): AcceptanceJournalState {
    return {
      id: this.config.journal.id,
      kind: 'acceptance-journal',
      location: this.journal.location,
      ...(this.journal.holderId === undefined ? {} : { holderId: this.journal.holderId }),
      homeAnchorId: this.config.journal.homeAnchorId,
      homeCellId: this.config.journal.homeCellId,
      communication: this.journal.communication,
      extinguisher: this.journal.extinguisher,
      climate: this.journal.climate,
      emergencyBrake: this.journal.emergencyBrake,
      sanitation: this.journal.sanitation,
      note: this.journal.note,
      accepted: this.journal.accepted,
      submitted: this.journal.submitted,
    };
  }

  private extinguisherState(): ExtinguisherState {
    return {
      id: this.config.extinguisher.id,
      kind: 'extinguisher',
      location: this.extinguisher.location,
      ...(this.extinguisher.holderId === undefined ? {} : { holderId: this.extinguisher.holderId }),
      mountAnchorId: this.config.extinguisher.mountAnchorId,
      mountCellId: this.config.extinguisher.mountCellId,
      pin: this.extinguisher.pin,
      seal: this.extinguisher.seal,
      pressure: this.config.extinguisher.pressure,
      bodyDamage: this.config.extinguisher.bodyDamage,
      used: this.extinguisher.used,
    };
  }

  private consumableState(item: MutableConsumable): ConsumableState {
    return {
      id: item.id,
      kind: item.kind,
      location: item.location,
      ...(item.holderId === undefined ? {} : { holderId: item.holderId }),
      ...(item.givenToId === undefined ? {} : { givenToId: item.givenToId }),
      servicePointId: this.config.servicePoint.id,
    };
  }

  private clone(): Snapshot {
    return {
      journal: { ...this.journal },
      extinguisher: { ...this.extinguisher },
      consumables: new Map(
        [...this.consumables].map(([id, item]) => [
          id,
          {
            id: item.id,
            kind: item.kind,
            location: item.location,
            ...(item.holderId === undefined ? {} : { holderId: item.holderId }),
            ...(item.givenToId === undefined ? {} : { givenToId: item.givenToId }),
          },
        ]),
      ),
      foodCount: this.foodCount,
      drinkCount: this.drinkCount,
    };
  }

  private restore(snapshot: Snapshot): void {
    Object.assign(this.journal, snapshot.journal);
    if (snapshot.journal.holderId === undefined) delete this.journal.holderId;
    Object.assign(this.extinguisher, snapshot.extinguisher);
    if (snapshot.extinguisher.holderId === undefined) delete this.extinguisher.holderId;
    this.consumables.clear();
    for (const [id, item] of snapshot.consumables) this.consumables.set(id, { ...item });
    this.foodCount = snapshot.foodCount;
    this.drinkCount = snapshot.drinkCount;
  }
}

interface Snapshot {
  readonly journal: MutableJournal;
  readonly extinguisher: MutableExtinguisher;
  readonly consumables: Map<ItemId, MutableConsumable>;
  readonly foodCount: number;
  readonly drinkCount: number;
}

function validateConfig(config: ItemWorldConfig): ItemWorldConfig {
  const journalId = assertId(config.journal.id, 'Journal id');
  const extinguisherId = assertId(config.extinguisher.id, 'Extinguisher id');
  const servicePointId = assertId(config.servicePoint.id, 'Service point id');
  if (new Set([journalId, extinguisherId, servicePointId]).size !== 3) {
    throw new RangeError('Item ids must be unique');
  }
  assertId(config.journal.homeAnchorId, 'Journal anchor id');
  assertId(config.journal.homeCellId, 'Journal cell id');
  assertId(config.extinguisher.mountAnchorId, 'Extinguisher anchor id');
  assertId(config.extinguisher.mountCellId, 'Extinguisher cell id');
  assertId(config.servicePoint.cellId, 'Service point cell id');
  if (!isPressure(config.extinguisher.pressure))
    throw new RangeError('Extinguisher pressure is invalid');
  if (!isDamage(config.extinguisher.bodyDamage))
    throw new RangeError('Extinguisher damage is invalid');
  assertNotGeneratedId(journalId);
  assertNotGeneratedId(extinguisherId);
  return config;
}

function cloneConfig(config: ItemWorldConfig): ItemWorldConfig {
  return {
    journal: {
      id: config.journal.id,
      homeAnchorId: config.journal.homeAnchorId,
      homeCellId: config.journal.homeCellId,
    },
    extinguisher: {
      id: config.extinguisher.id,
      mountAnchorId: config.extinguisher.mountAnchorId,
      mountCellId: config.extinguisher.mountCellId,
      pressure: config.extinguisher.pressure,
      bodyDamage: config.extinguisher.bodyDamage,
    },
    servicePoint: {
      id: config.servicePoint.id,
      cellId: config.servicePoint.cellId,
    },
  };
}

function assertNotGeneratedId(id: string): void {
  if (/^(?:food|drink)-[1-9]\d*$/.test(id)) {
    throw new RangeError(`Item id ${id} is reserved for generated food and drink`);
  }
}

function isJournalField(value: string): value is JournalField {
  return (
    value === 'communication' ||
    value === 'extinguisher' ||
    value === 'climate' ||
    value === 'emergencyBrake'
  );
}

function isCheckState(value: string): value is CheckState {
  return value === 'unset' || value === 'ok' || value === 'problem';
}

function isSanitation(value: string): value is SanitationCheckState {
  return value === 'unset' || value === 'clean' || value === 'issue';
}

function isPressure(value: string): value is ExtinguisherPressure {
  return value === 'low' || value === 'normal' || value === 'high';
}

function isDamage(value: string): value is ExtinguisherDamage {
  return value === 'none' || value === 'scratch' || value === 'dent';
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
