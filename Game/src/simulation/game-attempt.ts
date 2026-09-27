import {
  type ActionCatalog,
  type ActionContent,
  type DecisionContext,
  loadActionContent,
} from './action-decision';
import {
  type ActionRuntime,
  type ActionRuntimeEvent,
  actionGenerationKey,
  createActionRuntime,
  createConsumeTraitActionHandler,
  createRequestItemActionHandler,
  createWaitActionHandler,
} from './action-runtime';
import { BASELINE_ACTION_CONTENT } from './baseline-content';
import {
  createEntityStore,
  type EntityId,
  type EntityState,
  type EntityStore,
  type TraitGrantRule,
} from './entity-store';
import { EventQueue, type ScheduledEvent } from './event-queue';
import {
  createItemStore,
  type ItemEvent,
  type ItemSnapshot,
  type ItemStore,
  type ItemWorldConfig,
} from './item-store';
import { BASELINE_LEVEL, type LoadedLevel } from './level';
import { createSimulationRandom, type SimulationRandom } from './random';
import { BASELINE_SCENARIO, type LoadedScenario } from './scenario';
import { assertSimTimeUs, type SimTimeUs } from './sim-time';
import {
  createSpatialWorld,
  type MovementReservation,
  type SpatialSample,
  type SpatialWorld,
} from './spatial-world';

export type AttemptPhase =
  | { readonly kind: 'pre-departure' }
  | { readonly kind: 'origin-stop' }
  | { readonly kind: 'travel'; readonly nextStopIndex: number }
  | { readonly kind: 'stop'; readonly stopIndex: number; readonly stopId: string }
  | { readonly kind: 'finished' };

export type AttemptTermination =
  | { readonly kind: 'route-completed'; readonly at: SimTimeUs }
  | {
      readonly kind: 'terminal-rule';
      readonly at: SimTimeUs;
      readonly ruleId: string;
      readonly outcomeId: string;
    };

export interface GameAttemptSnapshot {
  readonly time: SimTimeUs;
  readonly rootSeed: number;
  readonly phase: AttemptPhase;
  readonly activeRegionIds: readonly string[];
  readonly entities: readonly EntityState[];
  readonly items: ItemSnapshot;
  readonly termination: AttemptTermination | null;
}

export interface GameAttemptOptions {
  readonly rootSeed: number;
  readonly level?: LoadedLevel;
  readonly scenario?: LoadedScenario;
  readonly actionContent?: ActionContent;
  readonly playerId?: EntityId;
  readonly microsecondsPerMovementCost?: number;
}

type AttemptEvent =
  | { readonly kind: 'action'; readonly event: ActionRuntimeEvent }
  | { readonly kind: 'trait-expiry'; readonly key: string }
  | { readonly kind: 'npc-decision'; readonly entityId: EntityId }
  | { readonly kind: 'movement-complete'; readonly entityId: EntityId }
  | { readonly kind: 'enter-origin-stop' }
  | { readonly kind: 'leave-origin-stop' }
  | { readonly kind: 'arrive-stop'; readonly stopIndex: number }
  | { readonly kind: 'leave-stop'; readonly stopIndex: number };

/**
 * First authoritative attempt runtime. Transport and public projection are
 * intentionally outside this type.
 */
export class GameAttempt {
  readonly level: LoadedLevel;
  readonly scenario: LoadedScenario;
  readonly playerId: EntityId;
  readonly entities: EntityStore;
  readonly spatial: SpatialWorld;
  readonly items: ItemStore;
  readonly actions: ActionRuntime;
  readonly catalog: ActionCatalog;
  readonly random: SimulationRandom;

  private readonly queue = new EventQueue<AttemptEvent>();
  private readonly activeRegions = new Set<string>();
  private readonly activePassengers = new Set<EntityId>();
  private readonly platformRegionIds: ReadonlySet<string>;
  private readonly fixedRegionIds: readonly string[];
  private phaseState: AttemptPhase = { kind: 'pre-departure' };
  private departureAt: SimTimeUs | null = null;
  private terminationState: AttemptTermination | null = null;

  constructor(options: GameAttemptOptions) {
    this.level = options.level ?? BASELINE_LEVEL;
    this.scenario = options.scenario ?? BASELINE_SCENARIO;
    assertScenarioMatchesLevel(this.scenario, this.level);
    this.playerId = options.playerId ?? 'player';
    this.random = createSimulationRandom(options.rootSeed);

    const content: ActionContent = options.actionContent ?? BASELINE_ACTION_CONTENT;
    this.catalog = loadActionContent(content);
    const traitRules: TraitGrantRule[] = content.traits.map((trait) => ({
      id: trait.id,
      ...(trait.rejectIf === undefined ? {} : { rejectIf: trait.rejectIf }),
    }));

    this.entities = createEntityStore(
      {
        schedule: (at, key) => this.queue.schedule(at, { kind: 'trait-expiry', key }, key),
        generation: (key) => this.queue.generation(key),
        setGeneration: (key, generation) => this.queue.setGeneration(key, generation),
      },
      traitRules,
    );

    this.spatial = createSpatialWorld({
      grid: this.level.grid,
      objectAnchorIds: this.level.definition.anchors.map((anchor) => anchor.id),
      microsecondsPerCostUnit: options.microsecondsPerMovementCost ?? 1_000_000,
    });
    this.items = createItemStore(this.entities, itemConfig(this.level, this.scenario));
    this.actions = createActionRuntime({
      catalog: this.catalog,
      entities: this.entities,
      scheduler: {
        schedule: (at, event, generationKey) =>
          this.queue.schedule(at, { kind: 'action', event }, generationKey),
        generation: (key) => this.queue.generation(key),
        setGeneration: (key, generation) => this.queue.setGeneration(key, generation),
      },
      handlers: {
        wait: createWaitActionHandler(),
        'request-item': createRequestItemActionHandler(),
        'consume-item': createConsumeTraitActionHandler(),
      },
    });

    this.platformRegionIds = new Set(platformRegions(this.scenario));
    this.fixedRegionIds = this.level.defaultActiveRegionIds.filter(
      (id) => !this.platformRegionIds.has(id),
    );
    for (const id of this.level.defaultActiveRegionIds) this.activeRegions.add(id);

    const startCell = this.level.anchor(
      this.scenario.definition.preDeparture.journalHomeAnchorId,
    ).cellId;
    this.entities.addPlayer({
      id: this.playerId,
      position: { kind: 'cell', cellId: startCell },
      traits: [],
    });
    this.spatial.addEntity(this.playerId, startCell);
    this.queue.schedule(this.scenario.definition.preDeparture.durationUs, {
      kind: 'enter-origin-stop',
    });
  }

  get time(): SimTimeUs {
    return this.queue.currentTime;
  }

  get phase(): AttemptPhase {
    return this.phaseState;
  }

  get termination(): AttemptTermination | null {
    return this.terminationState;
  }

  snapshot(): GameAttemptSnapshot {
    return {
      time: this.time,
      rootSeed: this.random.rootSeed,
      phase: this.phaseState,
      activeRegionIds: [...this.activeRegions].sort(compareIds),
      entities: this.entities.list(),
      items: this.items.snapshot(),
      termination: this.terminationState,
    };
  }

  advanceTo(target: SimTimeUs): void {
    const requested = assertSimTimeUs(target);
    if (requested < this.time) throw new RangeError('Attempt time cannot move backwards');
    if (this.terminationState !== null) {
      if (requested !== this.time) throw new RangeError('Finished attempt cannot advance');
      return;
    }
    const capped = Math.min(requested, this.scenario.normalEndTimeUs);
    this.queue.advanceTo(
      capped,
      (at) => this.spatial.materialize(at),
      (event) => this.apply(event),
    );
  }

  movePlayer(edgeId: string): MovementReservation {
    this.requireRunning();
    const blocked = new Set(
      this.level.constraintsFor([...this.activeRegions]).blockedEdgeIds ?? [],
    );
    if (blocked.has(edgeId)) throw new RangeError(`Edge ${edgeId} belongs to an inactive region`);
    const reservation = this.spatial.startMovement(this.playerId, edgeId, this.time);
    this.entities.setPosition(this.playerId, {
      kind: 'edge',
      edgeId: reservation.edgeId,
      fromCellId: reservation.fromCellId,
      toCellId: reservation.toCellId,
    });
    this.queue.schedule(reservation.arrivesAt, {
      kind: 'movement-complete',
      entityId: this.playerId,
    });
    return reservation;
  }

  playerPosition(): SpatialSample {
    return this.spatial.positionAt(this.playerId, this.time);
  }

  takeDrink(): void {
    this.requireRunning();
    this.items.takeDrink(this.playerId);
  }

  takeFood(): void {
    this.requireRunning();
    this.items.takeFood(this.playerId);
  }

  giveHeldItem(targetId: EntityId): ItemEvent {
    this.requireRunning();
    this.requireInteractionRange(this.playerId, targetId);
    const event = this.items.giveConsumable(this.playerId, targetId);
    this.actions.handleExternalEvent(event, this.time);
    this.advanceTo(this.time);
    return event;
  }

  signal(signal: string): AttemptTermination | null {
    this.requireRunning();
    const rule = this.scenario.terminalRuleForSignal(signal);
    if (rule === null) return null;
    this.terminationState = {
      kind: 'terminal-rule',
      at: this.time,
      ruleId: rule.id,
      outcomeId: rule.outcomeId,
    };
    this.phaseState = { kind: 'finished' };
    return this.terminationState;
  }

  private apply(scheduled: ScheduledEvent<AttemptEvent>): void {
    if (this.terminationState !== null) return;
    const event = scheduled.payload;
    switch (event.kind) {
      case 'action': {
        const result = this.actions.apply(event.event, scheduled.at);
        if (result.status === 'finished' && this.activePassengers.has(result.entityId)) {
          this.scheduleNpcDecision(result.entityId, scheduled.at);
        }
        return;
      }
      case 'trait-expiry':
        this.entities.applyTraitExpiry(event.key, scheduled.generation);
        return;
      case 'npc-decision':
        this.applyNpcDecision(event.entityId, scheduled.at);
        return;
      case 'movement-complete':
        this.finishMovement(event.entityId, scheduled.at);
        return;
      case 'enter-origin-stop':
        this.enterOriginStop(scheduled.at);
        return;
      case 'leave-origin-stop':
        this.leaveOriginStop(scheduled.at);
        return;
      case 'arrive-stop':
        this.arriveStop(event.stopIndex, scheduled.at);
        return;
      case 'leave-stop':
        this.leaveStop(event.stopIndex, scheduled.at);
        return;
    }
  }

  private enterOriginStop(at: SimTimeUs): void {
    const origin = this.scenario.definition.originStop;
    if (origin === undefined) {
      this.beginTravel(0, at);
      return;
    }
    this.phaseState = { kind: 'origin-stop' };
    this.setTravelRegions(origin.platformRegionId);
    this.applyPassengerFlow(origin.passengerFlow, at);
    this.queue.schedule(addTime(at, origin.dwellUs), { kind: 'leave-origin-stop' });
  }

  private leaveOriginStop(at: SimTimeUs): void {
    this.departureAt = at;
    this.beginTravel(0, at);
  }

  private beginTravel(stopIndex: number, at: SimTimeUs): void {
    const stop = this.scenario.definition.route.stops[stopIndex];
    if (stop === undefined) {
      this.finishRoute(at);
      return;
    }
    this.setTravelRegions();
    this.phaseState = { kind: 'travel', nextStopIndex: stopIndex };
    this.queue.schedule(addTime(at, stop.travelBeforeUs), { kind: 'arrive-stop', stopIndex });
  }

  private arriveStop(stopIndex: number, at: SimTimeUs): void {
    const stop = this.requireStop(stopIndex);
    this.phaseState = { kind: 'stop', stopIndex, stopId: stop.id };
    this.setTravelRegions(stop.platformRegionId);
    this.applyPassengerFlow(stop.passengerFlow, at);
    this.queue.schedule(addTime(at, stop.dwellUs), { kind: 'leave-stop', stopIndex });
  }

  private leaveStop(stopIndex: number, at: SimTimeUs): void {
    this.beginTravel(stopIndex + 1, at);
  }

  private finishRoute(at: SimTimeUs): void {
    this.terminationState = { kind: 'route-completed', at };
    this.phaseState = { kind: 'finished' };
  }

  private applyPassengerFlow(
    flow: {
      readonly boardPassengerIds: readonly string[];
      readonly leavePassengerIds: readonly string[];
    },
    at: SimTimeUs,
  ): void {
    for (const passengerId of [...flow.leavePassengerIds].sort(compareIds)) {
      if (!this.activePassengers.has(passengerId)) continue;
      this.invalidatePassengerAction(passengerId);
      this.spatial.removeEntity(passengerId);
      this.entities.remove(passengerId);
      this.activePassengers.delete(passengerId);
    }
    for (const passengerId of [...flow.boardPassengerIds].sort(compareIds)) {
      if (this.activePassengers.has(passengerId)) {
        throw new RangeError(`Passenger ${passengerId} is already aboard`);
      }
      const passenger = this.scenario.passenger(passengerId);
      const traits = [passenger.serviceClass, ...passenger.traits];
      this.entities.addPassenger({
        id: passenger.id,
        position: { kind: 'cell', cellId: passenger.seatCellId },
        traits,
      });
      this.spatial.addEntity(passenger.id, passenger.seatCellId);
      this.activePassengers.add(passenger.id);
      this.scheduleNpcDecision(passenger.id, at);
    }
  }

  private applyNpcDecision(entityId: EntityId, at: SimTimeUs): void {
    if (!this.activePassengers.has(entityId)) return;
    const entity = this.entities.get(entityId);
    if (entity.currentAction !== undefined) return;
    const context = this.decisionContext(entity, at);
    const decision = this.catalog.chooseNpcAction(this.random, entity, context);
    if (decision.status !== 'chosen') return;
    const result = this.actions.start({
      actorId: entity.id,
      actionId: decision.actionId,
      now: at,
      decisionContext: context,
    });
    if (result.status === 'finished') this.scheduleNpcDecision(entity.id, at);
  }

  private decisionContext(entity: EntityState, at: SimTimeUs): DecisionContext {
    return {
      now: at,
      routeTime: this.departureAt === null ? 0 : at - this.departureAt,
      traitGrantedAt: this.entities.traitGrantedAt(entity.id),
    };
  }

  private scheduleNpcDecision(entityId: EntityId, at: SimTimeUs): void {
    this.queue.schedule(at, { kind: 'npc-decision', entityId });
  }

  private finishMovement(entityId: EntityId, at: SimTimeUs): void {
    const position = this.spatial.positionAt(entityId, at);
    if (position.kind !== 'cell') throw new RangeError('Movement did not materialize to a cell');
    this.entities.setPosition(entityId, { kind: 'cell', cellId: position.cellId });
  }

  private requireInteractionRange(actorId: EntityId, targetId: EntityId): void {
    const actor = this.entities.get(actorId);
    const target = this.entities.get(targetId);
    if (actor.position.kind !== 'cell' || target.position.kind !== 'cell') {
      throw new RangeError('Interaction requires entities to be in cells');
    }
    const actorCellId = actor.position.cellId;
    const targetCellId = target.position.cellId;
    if (actorCellId === targetCellId) return;
    const blocked = new Set(
      this.level.constraintsFor([...this.activeRegions]).blockedEdgeIds ?? [],
    );
    const adjacent = this.level.grid.edges.some((edge) => {
      if (!edge.traversable || blocked.has(edge.id)) return false;
      return (
        (edge.from === actorCellId && edge.to === targetCellId) ||
        (edge.from === targetCellId && edge.to === actorCellId)
      );
    });
    if (!adjacent) throw new RangeError('Target is outside interaction range');
  }

  private invalidatePassengerAction(entityId: EntityId): void {
    const key = actionGenerationKey(entityId);
    const next = this.queue.generation(key) + 1;
    if (!Number.isSafeInteger(next)) throw new RangeError('Action generation overflow');
    this.queue.setGeneration(key, next);
  }

  private setTravelRegions(platformRegionId?: string): void {
    this.activeRegions.clear();
    for (const id of this.fixedRegionIds) this.activeRegions.add(id);
    if (platformRegionId !== undefined) this.activeRegions.add(platformRegionId);
  }

  private requireStop(index: number) {
    const stop = this.scenario.definition.route.stops[index];
    if (stop === undefined) throw new RangeError(`Unknown scenario stop index ${index}`);
    return stop;
  }

  private requireRunning(): void {
    if (this.terminationState !== null) throw new RangeError('Attempt is finished');
  }
}

function itemConfig(level: LoadedLevel, scenario: LoadedScenario): ItemWorldConfig {
  const journal = level.object(scenario.definition.preDeparture.journalObjectId);
  const extinguisher = findObject(level, 'extinguisher');
  const servicePoint = findObject(level, 'service-point');
  if (journal.anchorId === undefined) throw new RangeError('Acceptance journal requires an anchor');
  if (extinguisher.anchorId === undefined)
    throw new RangeError('Extinguisher requires a mount anchor');
  return {
    journal: {
      id: journal.id,
      homeAnchorId: journal.anchorId,
      homeCellId: journal.cellId,
    },
    extinguisher: {
      id: extinguisher.id,
      mountAnchorId: extinguisher.anchorId,
      mountCellId: extinguisher.cellId,
      pressure: 'normal',
      bodyDamage: 'none',
    },
    servicePoint: { id: servicePoint.id, cellId: servicePoint.cellId },
  };
}

function findObject(level: LoadedLevel, kind: string) {
  const object = level.definition.objects.find((candidate) => candidate.kind === kind);
  if (object === undefined) throw new RangeError(`Level requires object kind ${kind}`);
  return object;
}

function platformRegions(scenario: LoadedScenario): readonly string[] {
  const ids = new Set<string>([scenario.definition.preDeparture.platformRegionId]);
  if (scenario.definition.originStop !== undefined)
    ids.add(scenario.definition.originStop.platformRegionId);
  for (const stop of scenario.definition.route.stops) ids.add(stop.platformRegionId);
  return [...ids].sort(compareIds);
}

function assertScenarioMatchesLevel(scenario: LoadedScenario, level: LoadedLevel): void {
  if (
    scenario.definition.levelId !== level.definition.id ||
    scenario.definition.levelVersion !== level.definition.version
  ) {
    throw new RangeError('Scenario and Level are incompatible');
  }
}

function addTime(left: SimTimeUs, right: SimTimeUs): SimTimeUs {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new RangeError('Simulation time overflow');
  return assertSimTimeUs(total);
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
