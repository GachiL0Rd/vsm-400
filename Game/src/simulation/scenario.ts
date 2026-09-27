import { z } from 'zod';
import type { LoadedLevel } from './level';
import { BASELINE_LEVEL } from './level';
import { type SimTimeUs, secondsToSimTimeUs } from './sim-time';

const idSchema = z.string().min(1);
const versionSchema = z.string().min(1);
const simTimeSchema = z.number().int().nonnegative();
const serviceClassSchema = z.enum(['basic', 'comfort', 'business']);

const passengerSchema = z.object({
  id: idSchema,
  serviceClass: serviceClassSchema,
  traits: z.array(idSchema).default([]),
  seatCellId: idSchema,
  appearanceId: idSchema.optional(),
});

const passengerFlowSchema = z.object({
  boardPassengerIds: z.array(idSchema).default([]),
  leavePassengerIds: z.array(idSchema).default([]),
});

const stopSchema = z.object({
  id: idSchema,
  travelBeforeUs: simTimeSchema,
  dwellUs: simTimeSchema,
  platformRegionId: idSchema,
  passengerFlow: passengerFlowSchema.default({ boardPassengerIds: [], leavePassengerIds: [] }),
});

const serviceWindowSchema = z.object({
  id: idSchema,
  startAfterDepartureUs: simTimeSchema,
  endAfterDepartureUs: simTimeSchema,
  passengerTraits: z.array(idSchema).default([]),
  services: z.array(idSchema).min(1),
});

const terminalRuleSchema = z.object({
  id: idSchema,
  signal: idSchema,
  outcomeId: idSchema,
});

const fireIncidentSchema = z.object({
  id: idSchema,
  kind: z.literal('fire'),
  startAfterDepartureUs: simTimeSchema,
  failureLocationId: idSchema,
  initialFire: z.number().nonnegative(),
  sourcePerSecond: z.number().nonnegative(),
  criticalFire: z.number().positive(),
});

const pressureLeakIncidentSchema = z.object({
  id: idSchema,
  kind: z.literal('pressure-leak'),
  startAfterDepartureUs: simTimeSchema,
  failureLocationId: idSchema,
  baseCabinPressureKPa: z.number().positive(),
  attenuationKPaPerMeter: z.number().nonnegative(),
  whistleDistanceM: z.number().nonnegative(),
  earsBlockedDistanceM: z.number().nonnegative(),
  criticalCabinPressureKPa: z.number().positive(),
  stages: z
    .array(
      z.object({
        afterStartUs: simTimeSchema,
        pressureLossAtSourceKPa: z.number().nonnegative(),
      }),
    )
    .min(1),
});

const incidentSchema = z.discriminatedUnion('kind', [
  fireIncidentSchema,
  pressureLeakIncidentSchema,
]);

export const scenarioDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  version: versionSchema,
  levelId: idSchema,
  levelVersion: versionSchema,
  preDeparture: z.object({
    durationUs: simTimeSchema,
    platformRegionId: idSchema,
    journalObjectId: idSchema,
    journalHomeAnchorId: idSchema,
  }),
  originStop: z
    .object({
      dwellUs: simTimeSchema,
      platformRegionId: idSchema,
      passengerFlow: passengerFlowSchema.default({ boardPassengerIds: [], leavePassengerIds: [] }),
    })
    .optional(),
  route: z.object({
    stops: z.array(stopSchema),
  }),
  passengers: z.array(passengerSchema),
  servicePlan: z.object({ windows: z.array(serviceWindowSchema) }).default({ windows: [] }),
  incidents: z.array(incidentSchema).default([]),
  terminalRules: z.array(terminalRuleSchema).default([]),
});

export type ScenarioDefinition = z.infer<typeof scenarioDefinitionSchema>;
export type ScenarioPassengerDefinition = ScenarioDefinition['passengers'][number];
export type ScenarioStopDefinition = ScenarioDefinition['route']['stops'][number];
export type TerminalRuleDefinition = ScenarioDefinition['terminalRules'][number];
export type ScenarioIncidentDefinition = ScenarioDefinition['incidents'][number];

export interface LoadedScenario {
  readonly definition: ScenarioDefinition;
  readonly passengerIds: readonly string[];
  readonly normalEndTimeUs: SimTimeUs;
  passenger(id: string): ScenarioPassengerDefinition;
  terminalRuleForSignal(signal: string): TerminalRuleDefinition | null;
}

export function loadScenarioDefinition(input: unknown, level: LoadedLevel): LoadedScenario {
  const parsed = scenarioDefinitionSchema.parse(input);
  validateScenarioReferences(parsed, level);
  const definition = deepFreeze(structuredClone(parsed));
  return new ScenarioContent(definition);
}

class ScenarioContent implements LoadedScenario {
  readonly passengerIds: readonly string[];
  readonly normalEndTimeUs: SimTimeUs;
  private readonly passengers: ReadonlyMap<string, ScenarioPassengerDefinition>;
  private readonly rulesBySignal: ReadonlyMap<string, TerminalRuleDefinition>;

  constructor(readonly definition: ScenarioDefinition) {
    this.passengers = new Map(definition.passengers.map((passenger) => [passenger.id, passenger]));
    this.passengerIds = Object.freeze([...this.passengers.keys()].sort(compareIds));
    this.rulesBySignal = new Map(definition.terminalRules.map((rule) => [rule.signal, rule]));
    this.normalEndTimeUs = computeNormalEndTime(definition);
  }

  passenger(id: string): ScenarioPassengerDefinition {
    const passenger = this.passengers.get(id);
    if (passenger === undefined) throw new RangeError(`Unknown scenario passenger ${id}`);
    return passenger;
  }

  terminalRuleForSignal(signal: string): TerminalRuleDefinition | null {
    return this.rulesBySignal.get(signal) ?? null;
  }
}

export const BASELINE_SCENARIO_DEFINITION = {
  schemaVersion: 1,
  id: 'demo-route',
  version: '1.0.0',
  levelId: 'demo-carriage',
  levelVersion: '1.0.0',
  preDeparture: {
    durationUs: secondsToSimTimeUs(5 * 60),
    platformRegionId: 'platform-origin',
    journalObjectId: 'acceptance-journal',
    journalHomeAnchorId: 'platform.acceptance-desk',
  },
  originStop: {
    dwellUs: secondsToSimTimeUs(30 * 60),
    platformRegionId: 'platform-origin',
    passengerFlow: {
      boardPassengerIds: ['passenger-1', 'passenger-2', 'passenger-3'],
      leavePassengerIds: [],
    },
  },
  route: {
    stops: [
      {
        id: 'stop-1',
        travelBeforeUs: secondsToSimTimeUs(60 * 60),
        dwellUs: secondsToSimTimeUs(2 * 60),
        platformRegionId: 'platform-standard',
        passengerFlow: {
          boardPassengerIds: [],
          leavePassengerIds: ['passenger-1'],
        },
      },
      {
        id: 'stop-final',
        travelBeforeUs: secondsToSimTimeUs(18 * 60),
        dwellUs: 0,
        platformRegionId: 'platform-standard',
        passengerFlow: {
          boardPassengerIds: [],
          leavePassengerIds: ['passenger-2', 'passenger-3'],
        },
      },
    ],
  },
  passengers: [
    {
      id: 'passenger-1',
      serviceClass: 'basic',
      traits: ['awake'],
      seatCellId: 'carriage.seat-1',
      appearanceId: 'passenger.demo-1',
    },
    {
      id: 'passenger-2',
      serviceClass: 'comfort',
      traits: ['awake', 'hungry'],
      seatCellId: 'carriage.seat-2',
      appearanceId: 'passenger.demo-2',
    },
    {
      id: 'passenger-3',
      serviceClass: 'business',
      traits: ['awake', 'thirsty', 'impatient'],
      seatCellId: 'carriage.seat-3',
      appearanceId: 'passenger.demo-3',
    },
  ],
  incidents: [
    {
      id: 'cabin-fire',
      kind: 'fire',
      startAfterDepartureUs: secondsToSimTimeUs(10 * 60),
      failureLocationId: 'fire.cabin',
      initialFire: 0.35,
      sourcePerSecond: 0.015,
      criticalFire: 2.5,
    },
    {
      id: 'entry-pressure-leak',
      kind: 'pressure-leak',
      startAfterDepartureUs: secondsToSimTimeUs(35 * 60),
      failureLocationId: 'pressure.entry',
      baseCabinPressureKPa: 101.3,
      attenuationKPaPerMeter: 5,
      whistleDistanceM: 1.5,
      earsBlockedDistanceM: 1.0,
      criticalCabinPressureKPa: 80,
      stages: [
        { afterStartUs: 0, pressureLossAtSourceKPa: 4 },
        { afterStartUs: secondsToSimTimeUs(2 * 60), pressureLossAtSourceKPa: 12 },
        { afterStartUs: secondsToSimTimeUs(4 * 60), pressureLossAtSourceKPa: 18 },
      ],
    },
  ],
  servicePlan: {
    windows: [
      {
        id: 'meal-service',
        startAfterDepartureUs: secondsToSimTimeUs(15 * 60),
        endAfterDepartureUs: secondsToSimTimeUs(45 * 60),
        passengerTraits: ['comfort', 'business'],
        services: ['meal', 'drink'],
      },
      {
        id: 'arrival-preparation',
        startAfterDepartureUs: secondsToSimTimeUs(65 * 60),
        endAfterDepartureUs: secondsToSimTimeUs(78 * 60),
        passengerTraits: [],
        services: ['arrival-information'],
      },
    ],
  },
  terminalRules: [
    {
      id: 'emergency-brake',
      signal: 'emergency-brake-used',
      outcomeId: 'route-safely-interrupted',
    },
    {
      id: 'predeparture-critical',
      signal: 'critical-predeparture-fault',
      outcomeId: 'wagon-unserviceable',
    },
    {
      id: 'fire-unsalvageable',
      signal: 'fire-unsalvageable',
      outcomeId: 'wagon-unsalvageable',
    },
    {
      id: 'pressure-critical',
      signal: 'pressure-critical',
      outcomeId: 'wagon-unserviceable',
    },
  ],
} as const;

export const BASELINE_SCENARIO = loadScenarioDefinition(
  BASELINE_SCENARIO_DEFINITION,
  BASELINE_LEVEL,
);

function validateScenarioReferences(definition: ScenarioDefinition, level: LoadedLevel): void {
  validateLevelCompatibility(definition, level);
  validateScenarioRegions(definition, level);
  validatePassengers(definition, level);
  validateFlows(definition);
  validateScenarioIds(definition);
  validateServiceWindows(definition);
  validateIncidents(definition, level);
}

function validateLevelCompatibility(definition: ScenarioDefinition, level: LoadedLevel): void {
  if (
    definition.levelId !== level.definition.id ||
    definition.levelVersion !== level.definition.version
  ) {
    throw new RangeError('Scenario level id/version does not match the loaded Level');
  }
  const journal = level.object(definition.preDeparture.journalObjectId);
  if (journal.kind !== 'acceptance-journal') {
    throw new RangeError('preDeparture journalObjectId must reference an acceptance journal');
  }
  level.anchor(definition.preDeparture.journalHomeAnchorId);
}

function validateScenarioRegions(definition: ScenarioDefinition, level: LoadedLevel): void {
  const regionIds = new Set(level.regionIds);
  requireKnown(regionIds, definition.preDeparture.platformRegionId, 'preDeparture region');
  if (definition.originStop !== undefined) {
    requireKnown(regionIds, definition.originStop.platformRegionId, 'originStop region');
  }
  for (const stop of definition.route.stops) {
    requireKnown(regionIds, stop.platformRegionId, `stop ${stop.id} region`);
  }
}

function validatePassengers(definition: ScenarioDefinition, level: LoadedLevel): void {
  assertUnique(
    definition.passengers.map((item) => item.id),
    'passenger',
  );
  const levelCells = new Set(level.grid.cells.map((cell) => cell.id));
  for (const passenger of definition.passengers) {
    requireKnown(levelCells, passenger.seatCellId, `seat for ${passenger.id}`);
    if (passenger.traits.includes(passenger.serviceClass)) {
      throw new RangeError(`Passenger ${passenger.id} duplicates its service-class trait`);
    }
  }
}

function validateFlows(definition: ScenarioDefinition): void {
  const passengerIds = new Set(definition.passengers.map((item) => item.id));
  const referenced = new Set<string>();
  if (definition.originStop !== undefined) {
    validatePassengerFlow(
      definition.originStop.passengerFlow,
      passengerIds,
      referenced,
      'originStop',
    );
  }
  for (const stop of definition.route.stops) {
    validatePassengerFlow(stop.passengerFlow, passengerIds, referenced, stop.id);
  }
  for (const passengerId of passengerIds) {
    if (!referenced.has(passengerId)) {
      throw new RangeError(`Passenger ${passengerId} never boards in this scenario`);
    }
  }
}

function validateScenarioIds(definition: ScenarioDefinition): void {
  assertUnique(
    definition.route.stops.map((item) => item.id),
    'stop',
  );
  assertUnique(
    definition.servicePlan.windows.map((item) => item.id),
    'service window',
  );
  assertUnique(
    definition.terminalRules.map((item) => item.id),
    'terminal rule',
  );
  assertUnique(
    definition.terminalRules.map((item) => item.signal),
    'terminal signal',
  );
}

function validateIncidents(definition: ScenarioDefinition, level: LoadedLevel): void {
  assertUnique(
    definition.incidents.map((item) => item.id),
    'incident',
  );
  const failures = new Map(level.definition.failureLocations.map((item) => [item.id, item]));
  for (const incident of definition.incidents) validateIncident(incident, failures);
}

function validateIncident(
  incident: ScenarioIncidentDefinition,
  failures: ReadonlyMap<string, LoadedLevel['definition']['failureLocations'][number]>,
): void {
  const location = failures.get(incident.failureLocationId);
  if (location === undefined) {
    throw new RangeError(`Unknown failure location ${incident.failureLocationId}`);
  }
  if (incident.kind === 'fire') {
    if (!location.kinds.includes('fire')) {
      throw new RangeError(`Failure location ${incident.failureLocationId} does not allow fire`);
    }
    return;
  }
  if (!location.kinds.includes('pressure-leak')) {
    throw new RangeError(
      `Failure location ${incident.failureLocationId} does not allow pressure leak`,
    );
  }
  validatePressureStages(incident);
}

function validatePressureStages(
  incident: Extract<ScenarioIncidentDefinition, { kind: 'pressure-leak' }>,
): void {
  let previous = -1;
  for (const stage of incident.stages) {
    if (stage.afterStartUs <= previous) {
      throw new RangeError(`Pressure incident ${incident.id} stages must be strictly ordered`);
    }
    previous = stage.afterStartUs;
  }
}

function validateServiceWindows(definition: ScenarioDefinition): void {
  for (const window of definition.servicePlan.windows) {
    if (!(window.startAfterDepartureUs < window.endAfterDepartureUs)) {
      throw new RangeError(`Service window ${window.id} must have start < end`);
    }
  }
}

function validatePassengerFlow(
  flow: {
    readonly boardPassengerIds: readonly string[];
    readonly leavePassengerIds: readonly string[];
  },
  passengerIds: ReadonlySet<string>,
  referenced: Set<string>,
  label: string,
): void {
  assertUnique(flow.boardPassengerIds, `${label} board passenger`);
  assertUnique(flow.leavePassengerIds, `${label} leave passenger`);
  const leaving = new Set(flow.leavePassengerIds);
  for (const passengerId of flow.boardPassengerIds) {
    requireKnown(passengerIds, passengerId, `${label} boarding passenger`);
    if (leaving.has(passengerId))
      throw new RangeError(`${passengerId} boards and leaves at ${label}`);
    referenced.add(passengerId);
  }
  for (const passengerId of flow.leavePassengerIds) {
    requireKnown(passengerIds, passengerId, `${label} leaving passenger`);
  }
}

function computeNormalEndTime(definition: ScenarioDefinition): SimTimeUs {
  let total = definition.preDeparture.durationUs + (definition.originStop?.dwellUs ?? 0);
  for (const stop of definition.route.stops) total += stop.travelBeforeUs + stop.dwellUs;
  if (!Number.isSafeInteger(total))
    throw new RangeError('Scenario duration exceeds safe simulation time');
  return total;
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
