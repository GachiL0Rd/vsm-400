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
import { type AssessmentResult, AssessmentRuntime } from './assessment';
import type { AssessmentConfig } from './assessment-config';
import { BASELINE_ACTION_CONTENT } from './baseline-content';
import {
  createEntityStore,
  type EntityId,
  type EntityState,
  type EntityStore,
  type TraitGrantRule,
} from './entity-store';
import { EventQueue, type ScheduledEvent } from './event-queue';
import { type CellFieldState, createFieldWorld, type FieldWorld } from './field-world';
import {
  type AcceptanceJournalEdit,
  type AcceptanceJournalState,
  acceptanceJournalHasCriticalProblem,
  acceptanceJournalIsComplete,
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

export interface EmergencyBrakeState {
  readonly seal: 'intact' | 'broken';
  readonly activated: boolean;
}

export type PassengerBoardingDecision = 'pending' | 'admit' | 'reject';

export interface ClimateObservation {
  readonly connection: 'connected' | 'disconnected';
  readonly temperatureC: number;
  readonly pressureKPa: number;
  readonly smokeDetected: boolean;
  readonly updatedAt: SimTimeUs;
}

export interface GameAttemptSnapshot {
  readonly time: SimTimeUs;
  readonly rootSeed: number;
  readonly phase: AttemptPhase;
  readonly activeRegionIds: readonly string[];
  readonly entities: readonly EntityState[];
  readonly items: ItemSnapshot;
  readonly fields: readonly CellFieldState[];
  readonly climate: ClimateObservation;
  readonly emergencyBrake: EmergencyBrakeState;
  readonly boardingDecisions: readonly {
    readonly passengerId: EntityId;
    readonly decision: PassengerBoardingDecision;
  }[];
  readonly termination: AttemptTermination | null;
}

export interface GameAttemptOptions {
  readonly rootSeed: number;
  readonly level?: LoadedLevel;
  readonly scenario?: LoadedScenario;
  readonly actionContent?: ActionContent;
  readonly assessmentConfig?: AssessmentConfig;
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
  | { readonly kind: 'leave-stop'; readonly stopIndex: number }
  | { readonly kind: 'incident-start'; readonly incidentId: string }
  | { readonly kind: 'pressure-stage'; readonly incidentId: string; readonly stageIndex: number }
  | { readonly kind: 'field-step' };

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
  readonly fields: FieldWorld;
  readonly actions: ActionRuntime;
  readonly catalog: ActionCatalog;
  readonly random: SimulationRandom;

  private readonly assessmentRuntime: AssessmentRuntime;

  private readonly queue = new EventQueue<AttemptEvent>();
  private readonly activeRegions = new Set<string>();
  private readonly activePassengers = new Set<EntityId>();
  private readonly pendingBoarding = new Set<EntityId>();
  private readonly boardingDecisions = new Map<
    EntityId,
    Exclude<PassengerBoardingDecision, 'pending'>
  >();
  private readonly platformRegionIds: ReadonlySet<string>;
  private readonly fixedRegionIds: readonly string[];
  private phaseState: AttemptPhase = { kind: 'pre-departure' };
  private preDepartureReady = false;
  private routeEndAt: SimTimeUs | null = null;
  private departureAt: SimTimeUs | null = null;
  private originStopLeaveDueAt: SimTimeUs | null = null;
  private terminationState: AttemptTermination | null = null;
  private climateObservation: ClimateObservation = {
    connection: 'connected',
    temperatureC: 22,
    pressureKPa: 101.3,
    smokeDetected: false,
    updatedAt: 0,
  };
  private activePressureIncidentId: string | null = null;
  private emergencyBrakeState: EmergencyBrakeState = { seal: 'intact', activated: false };

  constructor(options: GameAttemptOptions) {
    this.level = options.level ?? BASELINE_LEVEL;
    this.scenario = options.scenario ?? BASELINE_SCENARIO;
    this.assessmentRuntime = new AssessmentRuntime(options.assessmentConfig);
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
        scheduleReplacing: (at, key) => {
          const event = this.queue.scheduleReplacing(at, { kind: 'trait-expiry', key }, key);
          if (event.generation === null) throw new RangeError('Expiry generation is missing');
          return event.generation;
        },
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
    this.fields = createFieldWorld(this.level.grid, fieldDefinition(this.level));
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

  assessmentResult(): AssessmentResult {
    if (this.terminationState === null) throw new RangeError('Attempt is not finished');
    return this.assessmentRuntime.result(this.terminationState);
  }

  snapshot(): GameAttemptSnapshot {
    return {
      time: this.time,
      rootSeed: this.random.rootSeed,
      phase: this.phaseState,
      activeRegionIds: [...this.activeRegions].sort(compareIds),
      entities: this.entities.list(),
      items: this.items.snapshot(),
      fields: this.fields.snapshot(),
      climate: this.climateObservation,
      emergencyBrake: this.emergencyBrakeState,
      boardingDecisions: this.scenario.passengerIds.map((passengerId) => ({
        passengerId,
        decision: this.boardingDecision(passengerId),
      })),
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
    const capped = this.routeEndAt === null ? requested : Math.min(requested, this.routeEndAt);
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

  takeJournal(): AcceptanceJournalState {
    this.requirePreDeparture();
    return this.items.takeJournal(this.playerId);
  }

  editJournal(edit: AcceptanceJournalEdit): AcceptanceJournalState {
    this.requirePreDeparture();
    return this.items.editJournal(this.playerId, edit);
  }

  returnJournal(): AcceptanceJournalState {
    this.requirePreDeparture();
    const current = this.items.snapshot().journal;
    requireJournalReadyForSubmission(current);
    const returned = this.items.returnJournal(this.playerId);
    const criticalProblem = acceptanceJournalHasCriticalProblem(returned);
    this.assessmentRuntime.recordJournalSubmission({
      sanitation: returned.sanitation,
      criticalProblem,
    });
    if (criticalProblem) {
      this.signal('critical-predeparture-fault');
      return returned;
    }
    this.preDepartureReady = true;
    if (this.time >= this.scenario.definition.preDeparture.durationUs) {
      this.enterOriginStop(this.time);
    }
    return returned;
  }

  boardingDecision(passengerId: EntityId): PassengerBoardingDecision {
    if (this.pendingBoarding.has(passengerId)) return 'pending';
    return this.boardingDecisions.get(passengerId) ?? 'pending';
  }

  decidePassengerBoarding(
    passengerId: EntityId,
    decision: Exclude<PassengerBoardingDecision, 'pending'>,
  ): PassengerBoardingDecision {
    this.requireRunning();
    if (this.phaseState.kind !== 'origin-stop') {
      throw new RangeError('Passenger boarding decisions are only available at the origin stop');
    }
    if (!this.pendingBoarding.has(passengerId)) {
      throw new RangeError(`Passenger ${passengerId} is not waiting for a boarding decision`);
    }
    const player = this.entities.get(this.playerId);
    const passenger = this.entities.get(passengerId);
    if (player.position.kind !== 'cell' || passenger.position.kind !== 'cell') {
      throw new RangeError('Player and passenger must be in cells for document inspection');
    }
    this.requireCellInteractionRange(player.position.cellId, passenger.position.cellId);
    this.pendingBoarding.delete(passengerId);
    this.boardingDecisions.set(passengerId, decision);
    const passengerDefinition = this.scenario.passenger(passengerId);
    this.assessmentRuntime.recordBoardingDecision(
      passengerId,
      passengerDefinition.expectedBoardingDecision,
      decision,
    );

    if (decision === 'admit') {
      const definition = passengerDefinition;
      this.spatial.removeEntity(passengerId);
      this.entities.setPosition(passengerId, { kind: 'cell', cellId: definition.seatCellId });
      this.spatial.addEntity(passengerId, definition.seatCellId);
      this.activePassengers.add(passengerId);
      this.applyNpcDecision(passengerId, this.time);
    } else {
      this.spatial.removeEntity(passengerId);
      this.entities.remove(passengerId);
    }

    if (
      this.pendingBoarding.size === 0 &&
      this.originStopLeaveDueAt !== null &&
      this.time >= this.originStopLeaveDueAt
    ) {
      this.leaveOriginStop(this.time);
    }
    return decision;
  }

  inspectExtinguisher() {
    this.requireRunning();
    return this.items.inspectExtinguisher(this.playerId);
  }

  takeExtinguisher() {
    this.requireRunning();
    return this.items.takeExtinguisher(this.playerId);
  }

  returnExtinguisher() {
    this.requireRunning();
    return this.items.returnExtinguisher(this.playerId);
  }

  prepareExtinguisher() {
    this.requireRunning();
    return this.items.prepareExtinguisher(this.playerId);
  }

  useExtinguisher(targetId: string): ItemEvent {
    this.requireRunning();
    const cellId = fireCellId(targetId);
    const player = this.entities.get(this.playerId);
    if (player.position.kind !== 'cell') throw new RangeError('Player must be in a cell');
    this.requireCellInteractionRange(player.position.cellId, cellId);
    const fire = this.fields.snapshot().find((cell) => cell.cellId === cellId);
    if (fire === undefined || fire.fire <= 0) throw new RangeError('Fire target is not active');
    const event = this.items.useExtinguisher(this.playerId, targetId);
    this.fields.setFireSource(cellId, 0);
    this.fields.reduceFire(cellId, 5);
    this.assessmentRuntime.recordFireExtinguished(this.time);
    return event;
  }

  inspectEmergencyBrake(): EmergencyBrakeState {
    this.requireRunning();
    return this.emergencyBrakeState;
  }

  removeEmergencyBrakeSeal(): EmergencyBrakeState {
    this.requireRunning();
    if (this.phaseState.kind !== 'travel') {
      throw new RangeError('Emergency brake seal can only be removed while travelling');
    }
    if (this.emergencyBrakeState.activated) {
      throw new RangeError('Emergency brake is already activated');
    }
    this.emergencyBrakeState = { ...this.emergencyBrakeState, seal: 'broken' };
    this.assessmentRuntime.recordEmergencySealRemoved();
    return this.emergencyBrakeState;
  }

  activateEmergencyBrake(): AttemptTermination {
    this.requireRunning();
    if (this.phaseState.kind !== 'travel') {
      throw new RangeError('Emergency brake can only be activated while travelling');
    }
    if (this.emergencyBrakeState.seal !== 'broken') {
      throw new RangeError('Emergency brake seal must be removed before activation');
    }
    if (this.emergencyBrakeState.activated) {
      throw new RangeError('Emergency brake is already activated');
    }
    this.emergencyBrakeState = { seal: 'broken', activated: true };
    this.assessmentRuntime.recordEmergencyActivation(this.hasActiveSafetyIncident());
    const termination = this.signal('emergency-brake-used');
    if (termination === null)
      throw new RangeError('Emergency brake terminal rule is not configured');
    return termination;
  }

  inspectClimate(): ClimateObservation {
    this.requireRunning();
    return this.climateObservation;
  }

  refreshClimate(): ClimateObservation {
    this.requireRunning();
    this.climateObservation = this.measureClimate(this.time);
    return this.climateObservation;
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
    const targetBefore = this.entities.get(targetId);
    const waitingAction = targetBefore.currentAction;
    const event = this.items.giveConsumable(this.playerId, targetId);
    this.actions.handleExternalEvent(event, this.time);
    this.advanceTo(this.time);
    if (
      waitingAction !== undefined &&
      (waitingAction.actionId === 'request-food' || waitingAction.actionId === 'request-drink')
    ) {
      const passenger = this.scenario.passenger(targetId);
      this.assessmentRuntime.recordServiceResolution(
        passenger.serviceClass,
        this.time - waitingAction.startedAt,
      );
    }
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
        const currentBefore = this.entities.get(event.event.entityId).currentAction;
        const result = this.actions.apply(event.event, scheduled.at);
        if (
          result.status === 'finished' &&
          result.outcome === 'timeout' &&
          currentBefore !== undefined &&
          (currentBefore.actionId === 'request-food' || currentBefore.actionId === 'request-drink')
        ) {
          const passenger = this.scenario.passenger(result.entityId);
          this.assessmentRuntime.recordServiceTimeout(passenger.serviceClass);
        }
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
      case 'incident-start':
        this.startIncident(event.incidentId, scheduled.at);
        return;
      case 'pressure-stage':
        this.applyPressureStage(event.incidentId, event.stageIndex, scheduled.at);
        return;
      case 'field-step':
        this.stepFields(scheduled.at);
        return;
    }
  }

  private enterOriginStop(at: SimTimeUs): void {
    if (this.phaseState.kind !== 'pre-departure' || !this.preDepartureReady) return;
    if (this.routeEndAt === null) {
      const remainingAfterPreDeparture =
        this.scenario.normalEndTimeUs - this.scenario.definition.preDeparture.durationUs;
      this.routeEndAt = addTime(at, assertSimTimeUs(remainingAfterPreDeparture));
    }
    const origin = this.scenario.definition.originStop;
    if (origin === undefined) {
      this.beginTravel(0, at);
      return;
    }
    this.phaseState = { kind: 'origin-stop' };
    this.setTravelRegions(origin.platformRegionId);
    this.stageOriginPassengerFlow(origin.passengerFlow);
    this.originStopLeaveDueAt = addTime(at, origin.dwellUs);
    this.queue.schedule(this.originStopLeaveDueAt, { kind: 'leave-origin-stop' });
  }

  private leaveOriginStop(at: SimTimeUs): void {
    if (this.phaseState.kind !== 'origin-stop' || this.pendingBoarding.size > 0) return;
    if (
      this.originStopLeaveDueAt !== null &&
      this.routeEndAt !== null &&
      at > this.originStopLeaveDueAt
    ) {
      this.routeEndAt = addTime(this.routeEndAt, assertSimTimeUs(at - this.originStopLeaveDueAt));
    }
    this.originStopLeaveDueAt = null;
    this.departureAt = at;
    for (const incident of this.scenario.definition.incidents) {
      this.queue.schedule(addTime(at, incident.startAfterDepartureUs), {
        kind: 'incident-start',
        incidentId: incident.id,
      });
    }
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

  private startIncident(incidentId: string, at: SimTimeUs): void {
    const incident = this.scenario.definition.incidents.find((item) => item.id === incidentId);
    if (incident === undefined) return;
    if (incident.kind === 'fire') {
      this.startFire(incidentId, at);
      return;
    }
    this.activePressureIncidentId = incident.id;
    for (let index = 0; index < incident.stages.length; index += 1) {
      const stage = incident.stages[index];
      if (stage === undefined) continue;
      this.queue.schedule(addTime(at, stage.afterStartUs), {
        kind: 'pressure-stage',
        incidentId: incident.id,
        stageIndex: index,
      });
    }
  }

  private startFire(incidentId: string, at: SimTimeUs): void {
    const incident = this.scenario.definition.incidents.find((item) => item.id === incidentId);
    if (incident === undefined || incident.kind !== 'fire') return;
    const location = this.level.definition.failureLocations.find(
      (item) => item.id === incident.failureLocationId,
    );
    if (location === undefined)
      throw new RangeError(`Unknown fire location ${incident.failureLocationId}`);
    this.assessmentRuntime.recordFireStarted(at);
    this.fields.setFireSource(location.cellId, incident.sourcePerSecond);
    const events = this.fields.addFire(location.cellId, incident.initialFire);
    this.handleFieldEvents(events);
    if (this.terminationState === null) {
      this.queue.schedule(addTime(at, secondsToFieldStepUs(1)), { kind: 'field-step' });
    }
  }

  private applyPressureStage(incidentId: string, stageIndex: number, at: SimTimeUs): void {
    const incident = this.scenario.definition.incidents.find((item) => item.id === incidentId);
    if (incident === undefined || incident.kind !== 'pressure-leak') return;
    const stage = incident.stages[stageIndex];
    if (stage === undefined) return;
    const location = this.level.definition.failureLocations.find(
      (item) => item.id === incident.failureLocationId,
    );
    if (location === undefined)
      throw new RangeError(`Unknown pressure location ${incident.failureLocationId}`);
    const sourceCell = this.level.grid.cells.find((cell) => cell.id === location.cellId);
    if (sourceCell === undefined)
      throw new RangeError(`Unknown pressure source cell ${location.cellId}`);
    for (const cell of this.level.grid.cells) {
      if (!cell.id.startsWith('carriage.')) continue;
      const distanceM = Math.hypot(cell.x - sourceCell.x, cell.y - sourceCell.y) * 0.5;
      const pressureLoss = Math.max(
        0,
        stage.pressureLossAtSourceKPa - incident.attenuationKPaPerMeter * distanceM,
      );
      this.fields.setPressure(cell.id, pressureLoss);
    }
    this.updatePressureExposureTraits(incident, sourceCell.x, sourceCell.y, at);
    const measured = this.measureClimate(at);
    if (measured.pressureKPa <= incident.criticalCabinPressureKPa) {
      this.assessmentRuntime.recordPressureCritical();
      this.signal('pressure-critical');
    }
  }

  private refreshPressureExposure(at: SimTimeUs): void {
    if (this.activePressureIncidentId === null) return;
    const incident = this.scenario.definition.incidents.find(
      (item) => item.id === this.activePressureIncidentId,
    );
    if (incident === undefined || incident.kind !== 'pressure-leak') return;
    const location = this.level.definition.failureLocations.find(
      (item) => item.id === incident.failureLocationId,
    );
    if (location === undefined) return;
    const sourceCell = this.level.grid.cells.find((cell) => cell.id === location.cellId);
    if (sourceCell === undefined) return;
    this.updatePressureExposureTraits(incident, sourceCell.x, sourceCell.y, at);
  }

  private updatePressureExposureTraits(
    incident: Extract<
      (typeof this.scenario.definition.incidents)[number],
      { kind: 'pressure-leak' }
    >,
    sourceX: number,
    sourceY: number,
    at: SimTimeUs,
  ): void {
    for (const entity of this.entities.list()) {
      if (entity.position.kind !== 'cell') continue;
      const entityCellId = entity.position.cellId;
      const cell = this.level.grid.cells.find((item) => item.id === entityCellId);
      if (cell === undefined) continue;
      const distanceM = Math.hypot(cell.x - sourceX, cell.y - sourceY) * 0.5;
      this.setEnvironmentalTrait(
        entity.id,
        'pressure-whistle',
        distanceM <= incident.whistleDistanceM,
        at,
      );
      this.setEnvironmentalTrait(
        entity.id,
        'ears-blocked',
        distanceM <= incident.earsBlockedDistanceM,
        at,
      );
    }
  }

  private setEnvironmentalTrait(
    entityId: EntityId,
    traitId: string,
    enabled: boolean,
    at: SimTimeUs,
  ): void {
    const entity = this.entities.get(entityId);
    const has = entity.traits.includes(traitId);
    if (enabled && !has) this.entities.grantTrait(entityId, traitId, at);
    if (!enabled && has) this.entities.removeTrait(entityId, traitId);
  }

  private measureClimate(at: SimTimeUs): ClimateObservation {
    const carriageCells = new Set(
      this.level.definition.regions.find((region) => region.id === 'carriage-main')?.cellIds ?? [],
    );
    const values = this.fields.snapshot().filter((field) => carriageCells.has(field.cellId));
    const count = Math.max(1, values.length);
    const averageFire = values.reduce((sum, field) => sum + field.fire, 0) / count;
    const averagePressureLoss = values.reduce((sum, field) => sum + field.pressure, 0) / count;
    const pressureIncident =
      this.activePressureIncidentId === null
        ? null
        : this.scenario.definition.incidents.find(
            (item) => item.id === this.activePressureIncidentId,
          );
    const basePressure =
      pressureIncident?.kind === 'pressure-leak' ? pressureIncident.baseCabinPressureKPa : 101.3;
    return {
      connection: 'connected',
      temperatureC: roundSensor(22 + averageFire * 6),
      pressureKPa: roundSensor(Math.max(0, basePressure - averagePressureLoss)),
      smokeDetected: averageFire >= 0.05,
      updatedAt: at,
    };
  }

  private stepFields(at: SimTimeUs): void {
    const events = this.fields.step(1);
    this.handleFieldEvents(events);
    if (this.terminationState !== null) return;
    const active = this.fields.snapshot().some((cell) => cell.fire > 0 || cell.fireSource > 0);
    if (active) this.queue.schedule(addTime(at, secondsToFieldStepUs(1)), { kind: 'field-step' });
  }

  private handleFieldEvents(_events: readonly unknown[]): void {
    const fields = new Map(this.fields.snapshot().map((field) => [field.cellId, field]));
    for (const incident of this.scenario.definition.incidents) {
      if (incident.kind !== 'fire') continue;
      const location = this.level.definition.failureLocations.find(
        (item) => item.id === incident.failureLocationId,
      );
      if (location === undefined) continue;
      const field = fields.get(location.cellId);
      if (field !== undefined && field.fire >= incident.criticalFire) {
        this.assessmentRuntime.recordFireCritical();
        this.signal('fire-unsalvageable');
        return;
      }
    }
  }

  private stageOriginPassengerFlow(flow: {
    readonly boardPassengerIds: readonly string[];
    readonly leavePassengerIds: readonly string[];
  }): void {
    if (flow.leavePassengerIds.length > 0) {
      throw new RangeError('Origin passenger flow cannot remove passengers before departure');
    }
    for (const passengerId of [...flow.boardPassengerIds].sort(compareIds)) {
      if (this.activePassengers.has(passengerId) || this.pendingBoarding.has(passengerId)) {
        throw new RangeError(`Passenger ${passengerId} is already present`);
      }
      const passenger = this.scenario.passenger(passengerId);
      const traits = [passenger.serviceClass, ...passenger.traits];
      this.entities.addPassenger({
        id: passenger.id,
        position: { kind: 'cell', cellId: passenger.boardingCellId },
        traits,
      });
      this.spatial.addEntity(passenger.id, passenger.boardingCellId);
      this.pendingBoarding.add(passenger.id);
    }
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
    this.refreshPressureExposure(this.time);
  }

  private hasActiveSafetyIncident(): boolean {
    if (this.activePressureIncidentId !== null) return true;
    return this.fields.snapshot().some((cell) => cell.fire > 0 || cell.fireSource > 0);
  }

  private requireInteractionRange(actorId: EntityId, targetId: EntityId): void {
    const actor = this.entities.get(actorId);
    const target = this.entities.get(targetId);
    if (actor.position.kind !== 'cell' || target.position.kind !== 'cell') {
      throw new RangeError('Interaction requires entities to be in cells');
    }
    this.requireCellInteractionRange(actor.position.cellId, target.position.cellId);
  }

  private requireCellInteractionRange(actorCellId: string, targetCellId: string): void {
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

  private requirePreDeparture(): void {
    this.requireRunning();
    if (this.phaseState.kind !== 'pre-departure') {
      throw new RangeError('Acceptance journal is only available during pre-departure');
    }
  }

  private requireRunning(): void {
    if (this.terminationState !== null) throw new RangeError('Attempt is finished');
  }
}

function requireJournalReadyForSubmission(journal: AcceptanceJournalState): void {
  if (!acceptanceJournalIsComplete(journal)) {
    throw new RangeError('Acceptance journal checklist is incomplete');
  }
  if (!journal.accepted) throw new RangeError('Acceptance journal is not accepted');
}

function fireCellId(targetId: string): string {
  const prefix = 'fire:';
  if (!targetId.startsWith(prefix) || targetId.length === prefix.length) {
    throw new RangeError('Extinguisher target is not a fire');
  }
  return targetId.slice(prefix.length);
}

function roundSensor(value: number): number {
  return Math.round(value * 10) / 10;
}

function secondsToFieldStepUs(seconds: number): SimTimeUs {
  return assertSimTimeUs(seconds * 1_000_000);
}

function fieldDefinition(level: LoadedLevel) {
  const carriageCells = new Set(
    level.definition.regions.find((region) => region.id === 'carriage-main')?.cellIds ?? [],
  );
  return {
    cells: level.grid.cells.map((cell) => ({
      cellId: cell.id,
      flammability: carriageCells.has(cell.id) ? 0.7 : 0,
      growth: carriageCells.has(cell.id) ? 0.035 : 0,
      decay: 0.01,
      permeability: 1,
      leak: 0.05,
      initialFuel: carriageCells.has(cell.id) ? 1 : 0,
      burnRate: carriageCells.has(cell.id) ? 0.01 : 0,
      spreadFuelScale: 0.5,
      spreadGateThreshold: 0.5,
      spreadGain: 0.04,
    })),
  };
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
