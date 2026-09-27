import type {
  AcceptanceJournalInput,
  ActionOfferMessage,
  AvailableActionView,
  ClimateControlInput,
  CommandResultMessage,
  ExtinguisherInspectionInput,
  GameDeltaMessage,
  GameSnapshotMessage,
  InvokeActionCommand,
  MoveToCommand,
  PublicClockView,
  PublicEntityView,
  PublicGameState,
  PublicTargetRef,
  PublicWorldView,
  QueryActionsCommand,
  SessionModeView,
} from '../common/game-wire';
import {
  acceptanceJournalInputSchema,
  climateControlInputSchema,
  extinguisherInspectionInputSchema,
  GAME_PROTOCOL_VERSION,
} from '../common/game-wire';
import type { EntityId, EntityState } from '../simulation/entity-store';
import type { GameAttempt, GameAttemptSnapshot } from '../simulation/game-attempt';
import {
  type AcceptanceJournalState,
  acceptanceJournalIsComplete,
  type ConsumableKind,
  type ExtinguisherState,
  type ItemSnapshot,
} from '../simulation/item-store';
import type { SimTimeUs } from '../simulation/sim-time';

export type RecordedGameplayCommand =
  | { readonly kind: 'move'; readonly edgeId: string }
  | { readonly kind: 'take-consumable'; readonly itemKind: ConsumableKind }
  | { readonly kind: 'give-held-item'; readonly targetId: EntityId }
  | { readonly kind: 'take-journal' }
  | { readonly kind: 'edit-journal'; readonly value: AcceptanceJournalInput }
  | { readonly kind: 'return-journal' }
  | { readonly kind: 'take-extinguisher' }
  | { readonly kind: 'inspect-extinguisher'; readonly value: ExtinguisherInspectionInput }
  | { readonly kind: 'return-extinguisher' }
  | { readonly kind: 'use-extinguisher'; readonly targetId: string }
  | { readonly kind: 'inspect-climate'; readonly value: ClimateControlInput };

type RuntimeOperation =
  | Exclude<
      RecordedGameplayCommand,
      | { readonly kind: 'edit-journal' }
      | { readonly kind: 'inspect-extinguisher' }
      | { readonly kind: 'inspect-climate' }
    >
  | { readonly kind: 'edit-journal-form' }
  | { readonly kind: 'inspect-extinguisher-form' }
  | { readonly kind: 'inspect-climate-form' };

interface RuntimeAction {
  readonly sortKey: string;
  readonly view: Omit<AvailableActionView, 'handle'>;
  readonly operation: RuntimeOperation;
}

export interface PublicGameProjectionOptions {
  readonly attemptId: string;
  readonly attempt: GameAttempt;
  readonly mode?: SessionModeView;
}

export interface InvokeResult {
  readonly result: CommandResultMessage;
  readonly snapshot?: GameSnapshotMessage;
  readonly delta?: GameDeltaMessage;
  readonly recordedCommand?: RecordedGameplayCommand;
}

/**
 * Stateful serialization gate for one attempt.
 *
 * The object owns public revisions and revision-bound action handles, but no
 * WebSocket or platform lifecycle. Server transport can compose it with a
 * GameSessionWorker without exposing simulation state to the browser.
 */
export class PublicGameProjection {
  readonly attemptId: string;
  readonly attempt: GameAttempt;
  readonly mode: SessionModeView;

  private revisionValue = 0;
  private lastState: PublicGameState | null = null;
  private actionTable = new Map<string, RuntimeOperation>();
  private offerSequence = 0;

  constructor(options: PublicGameProjectionOptions) {
    this.attemptId = assertId(options.attemptId, 'Attempt id');
    this.attempt = options.attempt;
    this.mode = options.mode ?? { kind: 'live' };
  }

  get revision(): number {
    return this.revisionValue;
  }

  snapshot(clock: PublicClockView = DEFAULT_CLOCK): GameSnapshotMessage {
    const state = this.project(clock);
    this.lastState = state;
    return {
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'snapshot',
      state,
    };
  }

  advanceTo(target: SimTimeUs, clock: PublicClockView = DEFAULT_CLOCK): GameDeltaMessage {
    this.attempt.advanceTo(target);
    return this.refresh(clock);
  }

  /**
   * Re-projects current simulation state through the serialization gate.
   * Pure passage of simulation time does not consume a public revision; state
   * changes (including public clock state) do.
   */
  refresh(clock: PublicClockView = DEFAULT_CLOCK): GameDeltaMessage {
    const before = this.lastState ?? this.project(clock);
    const projected = this.project(clock, this.revisionValue);
    if (sameStateIgnoringRevisionAndTime(before, projected)) {
      this.lastState = projected;
      return {
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'delta',
        attemptId: this.attemptId,
        baseRevision: this.revisionValue,
        revision: this.revisionValue,
        changes: projected.timeUs === before.timeUs ? {} : { timeUs: projected.timeUs },
      };
    }

    const baseRevision = this.revisionValue;
    this.bumpRevision();
    const after = this.project(clock);
    const delta = createDelta(before, after, baseRevision, this.revisionValue);
    this.lastState = after;
    return delta;
  }

  moveTo(command: MoveToCommand, clock: PublicClockView = DEFAULT_CLOCK): InvokeResult {
    if (command.knownRevision !== this.revisionValue) {
      return { result: rejected(command.requestId, this.revisionValue, 'stale-revision') };
    }
    const player = this.attempt.entities.get(this.attempt.playerId);
    if (player.position.kind !== 'cell') {
      return {
        result: rejected(
          command.requestId,
          this.revisionValue,
          'action-rejected',
          'Player is moving',
        ),
      };
    }
    const playerCellId = player.position.cellId;
    const edge = this.attempt.level.grid.edges.find(
      (candidate) => candidate.from === playerCellId && candidate.to === command.targetCellId,
    );
    if (edge === undefined) {
      return {
        result: rejected(
          command.requestId,
          this.revisionValue,
          'action-rejected',
          'Target cell is not directly reachable',
        ),
      };
    }
    return this.applyRecordedCommand(command.requestId, { kind: 'move', edgeId: edge.id }, clock);
  }

  queryActions(command: QueryActionsCommand): ActionOfferMessage {
    this.requireRevision(command.knownRevision);
    const snapshot = this.attempt.snapshot();
    const runtime = collectActionsForTarget(this.attempt, snapshot, command.target).sort(
      compareRuntimeActions,
    );
    const offerId = this.offerSequence;
    this.offerSequence += 1;
    const actions = runtime.map((action, index) => {
      const handle = `action/${this.revisionValue}/${offerId}/${index}`;
      this.actionTable.set(handle, action.operation);
      return { handle, ...action.view };
    });
    return {
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'action-offer',
      requestId: command.requestId,
      revision: this.revisionValue,
      target: command.target,
      actions,
    };
  }

  invoke(command: InvokeActionCommand, clock: PublicClockView = DEFAULT_CLOCK): InvokeResult {
    if (command.knownRevision !== this.revisionValue) {
      return { result: rejected(command.requestId, this.revisionValue, 'stale-revision') };
    }
    const template = this.actionTable.get(command.actionHandle);
    if (template === undefined) {
      return { result: rejected(command.requestId, this.revisionValue, 'unknown-action') };
    }
    let operation: RecordedGameplayCommand;
    try {
      operation = resolveOperation(template, command.input);
    } catch (error) {
      return {
        result: rejected(
          command.requestId,
          this.revisionValue,
          'invalid-input',
          errorMessage(error),
        ),
      };
    }

    return this.applyRecordedCommand(command.requestId, operation, clock);
  }

  private applyRecordedCommand(
    requestId: string,
    operation: RecordedGameplayCommand,
    clock: PublicClockView,
  ): InvokeResult {
    const before = this.lastState ?? this.project(clock);
    try {
      this.applyOperation(operation);
    } catch (error) {
      return {
        result: rejected(requestId, this.revisionValue, 'action-rejected', errorMessage(error)),
      };
    }
    const baseRevision = this.revisionValue;
    this.bumpRevision();
    const after = this.project(clock);
    const delta = createDelta(before, after, baseRevision, this.revisionValue);
    this.lastState = after;
    return {
      result: {
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'command-result',
        requestId,
        status: 'accepted',
        revision: this.revisionValue,
      },
      delta,
      snapshot: { protocolVersion: GAME_PROTOCOL_VERSION, type: 'snapshot', state: after },
      recordedCommand: operation,
    };
  }

  private project(clock: PublicClockView, revision = this.revisionValue): PublicGameState {
    const internal = this.attempt.snapshot();
    return {
      attemptId: this.attemptId,
      revision,
      timeUs: internal.time,
      clock,
      mode: this.mode,
      phase: internal.phase,
      termination: internal.termination,
      activeRegionIds: [...internal.activeRegionIds],
      world: projectWorld(this.attempt, internal),
      entities: projectEntities(this.attempt, internal),
    };
  }

  private requireRevision(revision: number): void {
    if (revision !== this.revisionValue) {
      throw new RangeError(`Stale public revision ${revision}; expected ${this.revisionValue}`);
    }
  }

  private applyOperation(operation: RecordedGameplayCommand): void {
    switch (operation.kind) {
      case 'move':
        this.attempt.movePlayer(operation.edgeId);
        return;
      case 'take-consumable':
        if (operation.itemKind === 'drink') this.attempt.takeDrink();
        else this.attempt.takeFood();
        return;
      case 'give-held-item':
        this.attempt.giveHeldItem(operation.targetId);
        return;
      case 'take-journal':
        this.attempt.takeJournal();
        return;
      case 'edit-journal':
        this.attempt.editJournal(operation.value);
        return;
      case 'return-journal':
        this.attempt.returnJournal();
        return;
      case 'take-extinguisher':
        this.attempt.takeExtinguisher();
        return;
      case 'inspect-extinguisher':
        this.attempt.inspectExtinguisher();
        if (operation.value.removePin) this.attempt.prepareExtinguisher();
        return;
      case 'return-extinguisher':
        this.attempt.returnExtinguisher();
        return;
      case 'use-extinguisher':
        this.attempt.useExtinguisher(operation.targetId);
        return;
      case 'inspect-climate':
        this.attempt.inspectClimate();
        if (operation.value.refresh) this.attempt.refreshClimate();
        return;
    }
  }

  private bumpRevision(): void {
    const next = this.revisionValue + 1;
    if (!Number.isSafeInteger(next)) throw new RangeError('Public revision overflow');
    this.revisionValue = next;
    this.actionTable.clear();
    this.offerSequence = 0;
  }
}

const DEFAULT_CLOCK: PublicClockView = Object.freeze({ timeScale: 1, paused: false });

function projectWorld(attempt: GameAttempt, snapshot: GameAttemptSnapshot): PublicWorldView {
  const activeRegionIds = new Set(snapshot.activeRegionIds);
  const cellToRegion = new Map<string, string>();
  const regions = attempt.level.definition.regions
    .filter((region) => activeRegionIds.has(region.id))
    .sort((a, b) => compareIds(a.id, b.id))
    .map((region) => {
      for (const cellId of region.cellIds) cellToRegion.set(cellId, region.id);
      return {
        id: region.id,
        ...(region.publicVisualId === undefined ? {} : { visualId: region.publicVisualId }),
      };
    });
  const activeCells = new Set(cellToRegion.keys());
  const cells = attempt.level.grid.cells
    .filter((cell) => activeCells.has(cell.id))
    .sort((a, b) => compareIds(a.id, b.id))
    .map((cell) => ({
      id: cell.id,
      x: cell.x,
      y: cell.y,
      regionId: requireValue(cellToRegion.get(cell.id), `Region for cell ${cell.id}`),
    }));
  const edges = attempt.level.grid.edges
    .filter((edge) => activeCells.has(edge.from) && activeCells.has(edge.to) && edge.traversable)
    .sort((a, b) => compareIds(a.id, b.id))
    .map((edge) => ({ id: edge.id, fromCellId: edge.from, toCellId: edge.to }));
  const objects = attempt.level.definition.objects
    .filter(
      (object) => activeCells.has(object.cellId) && objectIsVisible(object.id, snapshot.items),
    )
    .filter((object) => object.publicVisualId !== undefined)
    .map((object) => ({
      id: object.id,
      kind: object.kind,
      visualId: requireValue(object.publicVisualId, `Visual id for object ${object.id}`),
      cellId: object.cellId,
    }));
  for (const field of snapshot.fields) {
    if (field.fire <= 0.01 || !activeCells.has(field.cellId)) continue;
    objects.push({
      id: `fire:${field.cellId}`,
      kind: 'fire',
      visualId: 'effect.fire',
      cellId: field.cellId,
    });
  }
  objects.sort((a, b) => compareIds(a.id, b.id));
  return { regions, cells, edges, objects };
}

function projectEntities(attempt: GameAttempt, snapshot: GameAttemptSnapshot): PublicEntityView[] {
  return snapshot.entities.map((entity) => {
    const heldItem =
      entity.heldItemId === undefined ? undefined : heldItemView(entity.heldItemId, snapshot.items);
    return {
      id: entity.id,
      kind: entity.kind,
      appearanceId: appearanceId(attempt, entity),
      position: attempt.spatial.positionAt(entity.id, snapshot.time),
      ...(heldItem === undefined ? {} : { heldItem }),
    };
  });
}

function appearanceId(attempt: GameAttempt, entity: EntityState): string {
  if (entity.kind === 'player') return 'character.conductor.default';
  return attempt.scenario.passenger(entity.id).appearanceId ?? 'character.passenger.default';
}

function heldItemView(itemId: string, items: ItemSnapshot): { id: string; visualId: string } {
  if (itemId === items.journal.id) return { id: itemId, visualId: 'item.acceptance-journal' };
  if (itemId === items.extinguisher.id) return { id: itemId, visualId: 'item.extinguisher' };
  const consumable = items.consumables.find((item) => item.id === itemId);
  if (consumable !== undefined) return { id: itemId, visualId: `item.${consumable.kind}` };
  throw new RangeError(`Held item ${itemId} has no public visual mapping`);
}

function objectIsVisible(objectId: string, items: ItemSnapshot): boolean {
  if (objectId === items.journal.id) return items.journal.location === 'anchor';
  if (objectId === items.extinguisher.id) return items.extinguisher.location !== 'held';
  return true;
}

function collectActionsForTarget(
  attempt: GameAttempt,
  snapshot: GameAttemptSnapshot,
  target: PublicTargetRef,
): RuntimeAction[] {
  if (snapshot.termination !== null) return [];
  const player = snapshot.entities.find((entity) => entity.id === attempt.playerId);
  if (player === undefined || player.position.kind !== 'cell') return [];
  if (target.kind === 'object') {
    return collectObjectActions(attempt, snapshot, player, target.objectId);
  }
  if (target.kind === 'entity')
    return collectEntityActions(attempt, snapshot, player, target.entityId);
  return [];
}

function collectObjectActions(
  attempt: GameAttempt,
  snapshot: GameAttemptSnapshot,
  player: EntityState,
  objectId: string,
): RuntimeAction[] {
  if (player.position.kind !== 'cell') return [];
  if (objectId.startsWith('fire:')) {
    return collectFireActions(attempt, snapshot, player, objectId);
  }
  const object = attempt.level.definition.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) return [];
  switch (object.kind) {
    case 'acceptance-journal':
      return collectJournalObjectActions(snapshot, player, object.id, object.cellId);
    case 'extinguisher':
      return collectExtinguisherObjectActions(snapshot, player, object.id, object.cellId);
    case 'service-point':
      return collectServicePointActions(player, object.id, object.cellId);
    case 'climate-control':
      return collectClimateActions(attempt, snapshot, player, object.id, object.cellId);
    default:
      return [];
  }
}

function collectClimateActions(
  attempt: GameAttempt,
  snapshot: GameAttemptSnapshot,
  player: EntityState,
  objectId: string,
  cellId: string,
): RuntimeAction[] {
  if (player.position.kind !== 'cell') return [];
  if (!withinInteractionRange(attempt, snapshot, player.position.cellId, cellId)) return [];
  const climate = attempt.inspectClimate();
  return [
    {
      sortKey: 'climate/inspect',
      view: {
        uiKind: 'form',
        label: 'Открыть климат-контроль',
        target: { kind: 'object', objectId },
        form: {
          kind: 'climate-control',
          value: { ...climate, canRefresh: climate.connection === 'connected' },
        },
      },
      operation: { kind: 'inspect-climate-form' },
    },
  ];
}

function collectFireActions(
  attempt: GameAttempt,
  snapshot: GameAttemptSnapshot,
  player: EntityState,
  objectId: string,
): RuntimeAction[] {
  if (player.position.kind !== 'cell') return [];
  const cellId = objectId.slice('fire:'.length);
  const fire = snapshot.fields.find((field) => field.cellId === cellId);
  const extinguisher = snapshot.items.extinguisher;
  if (fire === undefined || fire.fire <= 0.01) return [];
  if (
    player.heldItemId !== extinguisher.id ||
    extinguisher.pin !== 'removed' ||
    extinguisher.used
  ) {
    return [];
  }
  if (!withinInteractionRange(attempt, snapshot, player.position.cellId, cellId)) return [];
  return [
    {
      sortKey: `fire/use-extinguisher/${cellId}`,
      view: {
        uiKind: 'interaction',
        label: 'Применить огнетушитель',
        target: { kind: 'object', objectId },
      },
      operation: { kind: 'use-extinguisher', targetId: objectId },
    },
  ];
}

function collectJournalObjectActions(
  snapshot: GameAttemptSnapshot,
  player: EntityState,
  objectId: string,
  cellId: string,
): RuntimeAction[] {
  if (player.position.kind !== 'cell' || snapshot.phase.kind !== 'pre-departure') return [];
  if (snapshot.items.journal.location !== 'anchor' || snapshot.items.journal.submitted) return [];
  if (player.position.cellId !== cellId || player.heldItemId !== undefined) return [];
  return [
    {
      sortKey: 'journal/take',
      view: {
        uiKind: 'interaction',
        label: 'Взять журнал приёмки',
        target: { kind: 'object', objectId },
      },
      operation: { kind: 'take-journal' },
    },
  ];
}

function collectExtinguisherObjectActions(
  snapshot: GameAttemptSnapshot,
  player: EntityState,
  objectId: string,
  cellId: string,
): RuntimeAction[] {
  if (player.position.kind !== 'cell') return [];
  if (snapshot.items.extinguisher.location !== 'mounted' || player.position.cellId !== cellId) {
    return [];
  }
  const target = { kind: 'object' as const, objectId };
  const actions: RuntimeAction[] = [
    extinguisherInspectionAction(snapshot.items.extinguisher, target),
  ];
  if (player.heldItemId === undefined) {
    actions.push({
      sortKey: 'extinguisher/take',
      view: { uiKind: 'interaction', label: 'Взять огнетушитель', target },
      operation: { kind: 'take-extinguisher' },
    });
  }
  return actions;
}

function collectServicePointActions(
  player: EntityState,
  objectId: string,
  cellId: string,
): RuntimeAction[] {
  if (player.position.kind !== 'cell' || player.position.cellId !== cellId) return [];
  if (player.heldItemId !== undefined) return [];
  const target = { kind: 'object' as const, objectId };
  return [
    {
      sortKey: 'service/drink',
      view: { uiKind: 'interaction', label: 'Взять напиток', target },
      operation: { kind: 'take-consumable', itemKind: 'drink' },
    },
    {
      sortKey: 'service/food',
      view: { uiKind: 'interaction', label: 'Взять питание', target },
      operation: { kind: 'take-consumable', itemKind: 'food' },
    },
  ];
}

function collectEntityActions(
  attempt: GameAttempt,
  snapshot: GameAttemptSnapshot,
  player: EntityState,
  targetId: EntityId,
): RuntimeAction[] {
  if (targetId === player.id) return collectPlayerActions(snapshot, player);
  if (player.heldItemId === undefined || player.position.kind !== 'cell') return [];
  const target = snapshot.entities.find((entity) => entity.id === targetId);
  if (target?.kind !== 'passenger' || target.position.kind !== 'cell') return [];
  if (!withinInteractionRange(attempt, snapshot, player.position.cellId, target.position.cellId))
    return [];
  const consumable = snapshot.items.consumables.find((item) => item.id === player.heldItemId);
  if (consumable === undefined || consumable.location !== 'held') return [];
  return [
    {
      sortKey: `give/${target.id}/${consumable.kind}`,
      view: {
        uiKind: 'interaction',
        label: consumable.kind === 'drink' ? 'Передать напиток' : 'Передать питание',
        target: { kind: 'entity', entityId: target.id },
      },
      operation: { kind: 'give-held-item', targetId: target.id },
    },
  ];
}

function collectPlayerActions(snapshot: GameAttemptSnapshot, player: EntityState): RuntimeAction[] {
  const target = { kind: 'entity' as const, entityId: player.id };
  if (player.heldItemId === snapshot.items.extinguisher.id) {
    const actions: RuntimeAction[] = [
      extinguisherInspectionAction(snapshot.items.extinguisher, target),
    ];
    if (
      player.position.kind === 'cell' &&
      player.position.cellId === snapshot.items.extinguisher.mountCellId
    ) {
      actions.push({
        sortKey: 'extinguisher/return',
        view: { uiKind: 'interaction', label: 'Вернуть огнетушитель', target },
        operation: { kind: 'return-extinguisher' },
      });
    }
    return actions;
  }
  if (snapshot.phase.kind !== 'pre-departure' || player.heldItemId !== snapshot.items.journal.id) {
    return [];
  }
  const actions: RuntimeAction[] = [
    {
      sortKey: 'journal/edit',
      view: {
        uiKind: 'form',
        label: 'Редактировать журнал приёмки',
        target,
        form: { kind: 'acceptance-journal', value: journalInput(snapshot.items.journal) },
      },
      operation: { kind: 'edit-journal-form' },
    },
  ];
  if (
    player.position.kind === 'cell' &&
    player.position.cellId === snapshot.items.journal.homeCellId &&
    snapshot.items.journal.accepted &&
    acceptanceJournalIsComplete(snapshot.items.journal)
  ) {
    actions.push({
      sortKey: 'journal/return',
      view: { uiKind: 'interaction', label: 'Сдать журнал приёмки', target },
      operation: { kind: 'return-journal' },
    });
  }
  return actions;
}

function extinguisherInspectionAction(
  extinguisher: ExtinguisherState,
  target: PublicTargetRef,
): RuntimeAction {
  return {
    sortKey: 'extinguisher/inspect',
    view: {
      uiKind: 'form',
      label: 'Осмотреть огнетушитель',
      target,
      form: {
        kind: 'extinguisher-inspection',
        value: {
          pin: extinguisher.pin,
          seal: extinguisher.seal,
          pressure: extinguisher.pressure,
          bodyDamage: extinguisher.bodyDamage,
          used: extinguisher.used,
          canRemovePin: extinguisher.location === 'held' && extinguisher.pin === 'present',
        },
      },
    },
    operation: { kind: 'inspect-extinguisher-form' },
  };
}

function journalInput(journal: AcceptanceJournalState): AcceptanceJournalInput {
  return {
    communication: journal.communication,
    extinguisher: journal.extinguisher,
    climate: journal.climate,
    emergencyBrake: journal.emergencyBrake,
    sanitation: journal.sanitation,
    note: journal.note,
    accepted: journal.accepted,
  };
}

function resolveOperation(template: RuntimeOperation, input: unknown): RecordedGameplayCommand {
  if (template.kind === 'edit-journal-form') {
    return { kind: 'edit-journal', value: acceptanceJournalInputSchema.parse(input) };
  }
  if (template.kind === 'inspect-extinguisher-form') {
    return { kind: 'inspect-extinguisher', value: extinguisherInspectionInputSchema.parse(input) };
  }
  if (template.kind === 'inspect-climate-form') {
    return { kind: 'inspect-climate', value: climateControlInputSchema.parse(input) };
  }
  if (input !== undefined) throw new RangeError('This action does not accept input');
  return template;
}

function withinInteractionRange(
  attempt: GameAttempt,
  snapshot: GameAttemptSnapshot,
  actorCellId: string,
  targetCellId: string,
): boolean {
  if (actorCellId === targetCellId) return true;
  const blocked = new Set(
    attempt.level.constraintsFor(snapshot.activeRegionIds).blockedEdgeIds ?? [],
  );
  return attempt.level.grid.edges.some(
    (edge) =>
      edge.traversable &&
      !blocked.has(edge.id) &&
      ((edge.from === actorCellId && edge.to === targetCellId) ||
        (edge.from === targetCellId && edge.to === actorCellId)),
  );
}

function createDelta(
  before: PublicGameState,
  after: PublicGameState,
  baseRevision: number,
  revision: number,
): GameDeltaMessage {
  const changes: GameDeltaMessage['changes'] = {};
  if (before.timeUs !== after.timeUs) changes.timeUs = after.timeUs;
  if (!sameJson(before.clock, after.clock)) changes.clock = after.clock;
  if (!sameJson(before.phase, after.phase)) changes.phase = after.phase;
  if (!sameJson(before.termination, after.termination)) changes.termination = after.termination;
  if (!sameJson(before.activeRegionIds, after.activeRegionIds)) {
    changes.activeRegionIds = after.activeRegionIds;
  }
  if (!sameJson(before.world, after.world)) changes.world = after.world;
  const entities = diffEntities(before.entities, after.entities);
  if (entities.upsert.length > 0 || entities.removeIds.length > 0) changes.entities = entities;
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'delta',
    attemptId: after.attemptId,
    baseRevision,
    revision,
    changes,
  };
}

function diffEntities(
  before: readonly PublicEntityView[],
  after: readonly PublicEntityView[],
): { upsert: PublicEntityView[]; removeIds: string[] } {
  const previous = new Map(before.map((entity) => [entity.id, entity]));
  const current = new Map(after.map((entity) => [entity.id, entity]));
  const upsert = after.filter((entity) => !sameJson(previous.get(entity.id), entity));
  const removeIds = before
    .filter((entity) => !current.has(entity.id))
    .map((entity) => entity.id)
    .sort(compareIds);
  return { upsert, removeIds };
}

function sameStateIgnoringRevisionAndTime(left: PublicGameState, right: PublicGameState): boolean {
  return sameJson({ ...left, revision: 0, timeUs: 0 }, { ...right, revision: 0, timeUs: 0 });
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareRuntimeActions(left: RuntimeAction, right: RuntimeAction): number {
  return compareIds(left.sortKey, right.sortKey);
}

function rejected(
  requestId: string,
  revision: number,
  code: Extract<CommandResultMessage, { status: 'rejected' }>['code'],
  message: string = code,
): CommandResultMessage {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'command-result',
    requestId,
    status: 'rejected',
    revision,
    code,
    message,
  };
}

function assertId(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RangeError(`${label} is required`);
  return value;
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new RangeError(`${label} is required`);
  return value;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
