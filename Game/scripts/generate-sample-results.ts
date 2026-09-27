import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FileGameContentRegistry,
  type ResolvedGameContent,
} from '../src/server/content-registry.ts';
import { finishedGameResultSchema } from '../src/server/finished-game-result.schema.ts';
import type { FinishedGameResult } from '../src/server/types.ts';
import type { ActionContent } from '../src/simulation/action-decision.ts';
import type { AssessmentFact } from '../src/simulation/assessment.ts';
import { parseAssessmentConfig } from '../src/simulation/assessment-config.ts';
import type { CurrentAction } from '../src/simulation/entity-store.ts';
import { GameAttempt } from '../src/simulation/game-attempt.ts';
import type { AcceptanceJournalEdit, CheckState } from '../src/simulation/item-store.ts';
import { loadLevelDefinition } from '../src/simulation/level.ts';
import { loadScenarioDefinition, type ScenarioDefinition } from '../src/simulation/scenario.ts';

const ATTEMPT_PLACEHOLDER = 'placeholder';
const LEVEL_ID = 'vsm-train2-01';
const FIRE_CELL = 'carriage.x39y8';
const SECOND_US = 1_000_000;
const LATE_SERVICE_US = 100 * SECOND_US;
const DUTY_STEP_US = 5 * SECOND_US;
const WALK_LIMIT_US = 180 * SECOND_US;
const MAX_DUTY_STEPS = 20_000;

const CELLS = {
  desk: 'platform-origin.x-3y8',
  boarding: 'platform-origin.x-2y8',
  extinguisher: 'carriage.x67y8',
  service: 'carriage.x69y8',
  fire: 'carriage.x40y8',
  brake: 'carriage.x9y8',
} as const;

const PASSENGERS = ['passenger-1', 'passenger-2', 'passenger-3'] as const;
type PassengerId = (typeof PASSENGERS)[number];
type BoardingDecision = 'admit' | 'reject';
type BoardingPlan = Readonly<Record<PassengerId, BoardingDecision>>;
type ServiceMode = 'fast' | 'late' | 'ignore';
type FireMode = 'fast' | 'ignore';
type BrakeMode = 'none' | 'false' | 'hazard';

const CORRECT_BOARDING: BoardingPlan = {
  'passenger-1': 'admit',
  'passenger-2': 'admit',
  'passenger-3': 'reject',
};

const AISLE: Readonly<Record<PassengerId, string>> = {
  'passenger-1': 'carriage.x15y8',
  'passenger-2': 'carriage.x33y8',
  'passenger-3': 'carriage.x49y8',
};

const FALSE_JOURNAL_FIELDS = [
  'extinguisher',
  'climate',
  'communication',
  'emergencyBrake',
] as const satisfies readonly (keyof AcceptanceJournalEdit)[];

interface RunPlan {
  readonly seed: number;
  readonly label: string;
  readonly journal: AcceptanceJournalEdit;
  readonly breakExtinguisher: boolean;
  readonly boarding: BoardingPlan;
  readonly service: ServiceMode;
  readonly fire: FireMode;
  readonly brake: BrakeMode;
  readonly pressureCritical: boolean;
  readonly serviceTimeouts: number;
}

interface DutyState {
  fireHandled: boolean;
  falseBrakeDone: boolean;
  timeoutsLeft: number;
  skipping: { readonly passengerId: PassengerId; readonly startedAt: number } | null;
}

interface ServiceRequest {
  readonly passengerId: PassengerId;
  readonly actionId: 'request-food' | 'request-drink';
  readonly startedAt: number;
  readonly timeoutAt?: number;
}

interface SampleContent {
  readonly resolved: ResolvedGameContent;
  readonly level: ReturnType<typeof loadLevelDefinition>;
  readonly actions: ActionContent;
  readonly assessment: ReturnType<typeof parseAssessmentConfig>;
  readonly scenario: ScenarioDefinition;
}

/**
 * Plays scripted policies through the authoritative `vsm-train2-01` attempt and
 * returns `FinishedGameResult` bodies. `attemptId` is a placeholder: Platform
 * replaces it when the body is recorded as a live finish.
 */
export function generateSampleResults(): FinishedGameResult[] {
  const content = loadSampleContent();
  const results = buildPlans().map((plan) => playPlan(content, plan));
  for (const result of results) finishedGameResultSchema.parse(result);
  assertSampleCoverage(results);
  return results;
}

export function serializeSampleResults(results: readonly FinishedGameResult[]): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}

function loadSampleContent(): SampleContent {
  const contentDirectory = fileURLToPath(new URL('../content/', import.meta.url));
  const registry = new FileGameContentRegistry(contentDirectory);
  const resolved = registry.resolve(LEVEL_ID);
  const level = loadLevelDefinition(readJson('level.json'));
  const scenario = loadScenarioDefinition(readJson('scenario.json'), level).definition;
  const actions = readJson('actions.json') as ActionContent;
  const assessment = parseAssessmentConfig(readJson('assessment.json'));
  return { resolved, level, actions, assessment, scenario };
}

function readJson(name: string): unknown {
  const url = new URL(`../content/${LEVEL_ID}/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

function playPlan(content: SampleContent, plan: RunPlan): FinishedGameResult {
  try {
    const attempt = createAttempt(content, plan);
    if (plan.breakExtinguisher) breakExtinguisher(attempt);
    if (attempt.termination === null) submitJournal(attempt, plan.journal);
    if (attempt.termination === null) boardPassengers(attempt, plan.boarding);
    if (attempt.termination === null) walkTo(attempt, CELLS.service);
    if (attempt.termination === null) runDuty(attempt, plan);
    return toFinishedResult(attempt, content.resolved, plan.label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Sample ${plan.label} (seed ${plan.seed}) failed: ${message}`, {
      cause: error,
    });
  }
}

function createAttempt(content: SampleContent, plan: RunPlan): GameAttempt {
  if (!plan.pressureCritical) {
    return content.resolved.createAttempt(plan.seed, { kind: 'live' });
  }
  const scenario = loadScenarioDefinition(
    { ...content.scenario, incidents: [criticalPressureIncident()] },
    content.level,
  );
  return new GameAttempt({
    rootSeed: plan.seed,
    level: content.level,
    scenario,
    actionContent: content.actions,
    assessmentConfig: content.assessment,
  });
}

function criticalPressureIncident(): ScenarioDefinition['incidents'][number] {
  return {
    id: 'entry-pressure-leak',
    kind: 'pressure-leak',
    startAfterDepartureUs: 60 * SECOND_US,
    failureLocationId: 'pressure.entry',
    baseCabinPressureKPa: 101.3,
    attenuationKPaPerMeter: 0,
    whistleDistanceM: 1.5,
    earsBlockedDistanceM: 1,
    criticalCabinPressureKPa: 80,
    stages: [{ afterStartUs: 0, pressureLossAtSourceKPa: 30 }],
  };
}

function submitJournal(attempt: GameAttempt, journal: AcceptanceJournalEdit): void {
  walkTo(attempt, CELLS.desk);
  attempt.takeJournal();
  attempt.editJournal(journal);
  attempt.returnJournal();
}

function breakExtinguisher(attempt: GameAttempt): void {
  walkTo(attempt, CELLS.extinguisher);
  attempt.takeExtinguisher();
  attempt.prepareExtinguisher();
  attempt.returnExtinguisher();
  walkTo(attempt, CELLS.desk);
}

function boardPassengers(attempt: GameAttempt, boarding: BoardingPlan): void {
  const originAt = attempt.scenario.definition.preDeparture.durationUs;
  if (attempt.time < originAt) attempt.advanceTo(originAt);
  if (attempt.phase.kind !== 'origin-stop') {
    throw new Error(`Expected origin stop, got ${attempt.phase.kind}`);
  }
  walkTo(attempt, CELLS.boarding);
  for (const passengerId of PASSENGERS) {
    attempt.decidePassengerBoarding(passengerId, boarding[passengerId]);
  }
}

function runDuty(attempt: GameAttempt, plan: RunPlan): void {
  const state: DutyState = {
    fireHandled: false,
    falseBrakeDone: false,
    timeoutsLeft: plan.serviceTimeouts,
    skipping: null,
  };
  for (let step = 0; step < MAX_DUTY_STEPS && attempt.termination === null; step += 1) {
    if (applyBrake(attempt, plan, state)) continue;
    if (applyFire(attempt, plan, state)) continue;
    if (applyService(attempt, plan, state)) continue;
    if (!advanceDuty(attempt)) {
      throw new Error(`Simulation time stalled at ${attempt.time}`);
    }
  }
  if (attempt.termination === null) throw new Error('Duty loop exceeded its step budget');
}

function applyBrake(attempt: GameAttempt, plan: RunPlan, state: DutyState): boolean {
  if (plan.brake === 'none' || attempt.phase.kind !== 'travel') return false;
  if (plan.brake === 'false') {
    if (state.falseBrakeDone || cabinFire(attempt) > 0) return false;
    state.falseBrakeDone = true;
    pullBrake(attempt);
    return true;
  }
  if (cabinFire(attempt) <= 0) return false;
  pullBrake(attempt);
  return true;
}

function applyFire(attempt: GameAttempt, plan: RunPlan, state: DutyState): boolean {
  if (plan.fire !== 'fast' || state.fireHandled || cabinFire(attempt) <= 0) return false;
  state.fireHandled = true;
  extinguishFire(attempt);
  return true;
}

function applyService(attempt: GameAttempt, plan: RunPlan, state: DutyState): boolean {
  if (plan.service === 'ignore' || attempt.termination !== null) return false;
  const request = findServiceRequest(attempt);
  if (request === null) {
    noteSkippedRequestEnded(state);
    return false;
  }
  if (shouldLetRequestTimeout(state, request)) return false;
  if (plan.service === 'late' && waitForLateService(attempt, request)) return true;
  deliverService(attempt, request);
  return true;
}

function noteSkippedRequestEnded(state: DutyState): void {
  if (state.skipping === null) return;
  state.skipping = null;
  state.timeoutsLeft -= 1;
}

function shouldLetRequestTimeout(state: DutyState, request: ServiceRequest): boolean {
  if (state.timeoutsLeft <= 0) return false;
  const sameSkip =
    state.skipping !== null &&
    state.skipping.passengerId === request.passengerId &&
    state.skipping.startedAt === request.startedAt;
  if (sameSkip) return true;
  noteSkippedRequestEnded(state);
  if (state.timeoutsLeft <= 0) return false;
  state.skipping = { passengerId: request.passengerId, startedAt: request.startedAt };
  return true;
}

function waitForLateService(attempt: GameAttempt, request: ServiceRequest): boolean {
  const due = request.startedAt + LATE_SERVICE_US;
  if (attempt.time >= due) return false;
  const timeoutAt = request.timeoutAt ?? due;
  const target = Math.min(due, Math.max(attempt.time, timeoutAt - SECOND_US));
  if (target <= attempt.time) return false;
  attempt.advanceTo(target);
  return true;
}

function findServiceRequest(attempt: GameAttempt): ServiceRequest | null {
  const waiting: ServiceRequest[] = [];
  for (const entity of attempt.entities.list()) {
    const request = serviceRequestFrom(entity.id, entity.currentAction);
    if (request !== null) waiting.push(request);
  }
  waiting.sort(compareRequests);
  return waiting[0] ?? null;
}

function serviceRequestFrom(
  entityId: string,
  action: CurrentAction | undefined,
): ServiceRequest | null {
  if (action === undefined) return null;
  if (action.actionId !== 'request-food' && action.actionId !== 'request-drink') return null;
  if (!isPassengerId(entityId)) return null;
  const timeoutAt = action.phase.kind === 'waiting' ? action.phase.timeoutAt : undefined;
  return {
    passengerId: entityId,
    actionId: action.actionId,
    startedAt: action.startedAt,
    ...(timeoutAt === undefined ? {} : { timeoutAt }),
  };
}

function compareRequests(left: ServiceRequest, right: ServiceRequest): number {
  if (left.startedAt !== right.startedAt) return left.startedAt - right.startedAt;
  return left.passengerId < right.passengerId ? -1 : left.passengerId > right.passengerId ? 1 : 0;
}

function deliverService(attempt: GameAttempt, request: ServiceRequest): void {
  if (attempt.termination !== null) return;
  releaseExtinguisher(attempt);
  if (!stillRequesting(attempt, request)) return;
  walkTo(attempt, CELLS.service);
  if (attempt.termination !== null || !stillRequesting(attempt, request)) return;
  if (request.actionId === 'request-food') attempt.takeFood();
  else attempt.takeDrink();
  walkTo(attempt, AISLE[request.passengerId]);
  if (attempt.termination !== null) return;
  if (!passengerPresent(attempt, request.passengerId)) return;
  attempt.giveHeldItem(request.passengerId);
}

function stillRequesting(attempt: GameAttempt, request: ServiceRequest): boolean {
  if (!passengerPresent(attempt, request.passengerId)) return false;
  const action = attempt.entities.get(request.passengerId).currentAction;
  return action?.actionId === request.actionId;
}

function passengerPresent(attempt: GameAttempt, passengerId: PassengerId): boolean {
  return attempt.entities.list().some((entity) => entity.id === passengerId);
}

function releaseExtinguisher(attempt: GameAttempt): void {
  if (attempt.entities.get(attempt.playerId).heldItemId !== 'extinguisher') return;
  walkTo(attempt, CELLS.extinguisher);
  attempt.returnExtinguisher();
}

function extinguishFire(attempt: GameAttempt): void {
  if (attempt.termination !== null || cabinFire(attempt) <= 0) return;
  walkTo(attempt, CELLS.extinguisher);
  const extinguisher = attempt.snapshot().items.extinguisher;
  if (extinguisher.location === 'mounted') attempt.takeExtinguisher();
  if (attempt.snapshot().items.extinguisher.pin === 'present') attempt.prepareExtinguisher();
  walkTo(attempt, CELLS.fire);
  if (attempt.termination !== null || cabinFire(attempt) <= 0) return;
  attempt.useExtinguisher(`fire:${FIRE_CELL}`);
}

function pullBrake(attempt: GameAttempt): void {
  if (attempt.termination !== null || attempt.phase.kind !== 'travel') return;
  if (attempt.inspectEmergencyBrake().seal === 'intact') attempt.removeEmergencyBrakeSeal();
  if (attempt.termination !== null || attempt.inspectEmergencyBrake().activated) return;
  attempt.activateEmergencyBrake();
}

function cabinFire(attempt: GameAttempt): number {
  const field = attempt.snapshot().fields.find((item) => item.cellId === FIRE_CELL);
  return field?.fire ?? 0;
}

function advanceDuty(attempt: GameAttempt): boolean {
  const before = attempt.time;
  attempt.advanceTo(before + DUTY_STEP_US);
  if (attempt.termination !== null || attempt.time !== before) return true;
  attempt.advanceTo(attempt.scenario.normalEndTimeUs);
  return attempt.termination !== null || attempt.time !== before;
}

function walkTo(attempt: GameAttempt, cellId: string): void {
  if (attempt.termination !== null) return;
  const start = ensureCell(attempt);
  if (start === cellId) return;
  attempt.movePlayerTo(cellId);
  const limit = attempt.time + WALK_LIMIT_US;
  while (attempt.termination === null && attempt.time < limit) {
    const position = attempt.playerPosition();
    if (position.kind === 'cell' && position.cellId === cellId) return;
    attempt.advanceTo(Math.min(limit, attempt.time + 250_000));
  }
  const position = attempt.playerPosition();
  if (position.kind === 'cell' && position.cellId === cellId) return;
  if (attempt.termination !== null) return;
  throw new Error(`Player did not reach ${cellId} from ${start}`);
}

function ensureCell(attempt: GameAttempt): string {
  const limit = attempt.time + WALK_LIMIT_US;
  while (attempt.termination === null && attempt.time < limit) {
    const position = attempt.playerPosition();
    if (position.kind === 'cell') return position.cellId;
    attempt.advanceTo(Math.min(limit, attempt.time + 250_000));
  }
  const position = attempt.playerPosition();
  if (position.kind === 'cell') return position.cellId;
  throw new Error('Player is not standing in a cell');
}

function toFinishedResult(
  attempt: GameAttempt,
  content: ResolvedGameContent,
  label: string,
): FinishedGameResult {
  const termination = attempt.termination;
  if (termination === null) throw new Error(`${label} did not finish`);
  const assessment = attempt.assessmentResult();
  return {
    attemptId: ATTEMPT_PLACEHOLDER,
    content: {
      gameLevelId: content.gameLevelId,
      gameLevelVersion: content.gameLevelVersion,
      simulationCompatibilityVersion: content.simulationCompatibilityVersion,
    },
    rootSeed: String(attempt.snapshot().rootSeed),
    userInputs: [],
    achievements: {
      setVersion: assessment.achievements.setVersion,
      ids: [...assessment.achievements.ids],
    },
    termination: {
      kind: termination.kind,
      outcomeId: termination.kind === 'route-completed' ? 'route-completed' : termination.outcomeId,
    },
    scores: {
      safety: assessment.scores.safety,
      customerSatisfaction: assessment.scores.customerSatisfaction,
    },
    assessment: {
      setVersion: assessment.achievements.setVersion,
      durationUs: termination.at,
      facts: assessment.facts.map(plainFact),
    },
  };
}

function plainFact(fact: AssessmentFact): AssessmentFact {
  const plain: AssessmentFact = {
    id: fact.id,
    kind: fact.kind,
    at: fact.at,
    verdict: fact.verdict,
    scoreDelta: {
      safety: fact.scoreDelta.safety,
      customerSatisfaction: fact.scoreDelta.customerSatisfaction,
    },
    detail: { ...fact.detail },
  };
  if (fact.reactionUs === undefined) return plain;
  return { ...plain, reactionUs: fact.reactionUs };
}

function assertSampleCoverage(results: readonly FinishedGameResult[]): void {
  if (results.length < 40 || results.length > 60) {
    throw new Error(`Expected 40–60 sample results, got ${results.length}`);
  }
  const facts = results.flatMap((result) => result.assessment?.facts ?? []);
  requireMember(
    facts.map((fact) => fact.kind),
    [
      'journal-submission',
      'boarding-decision',
      'service-request',
      'fire',
      'pressure',
      'emergency-brake',
    ],
    'fact kind',
  );
  requireMember(
    facts.map((fact) => fact.verdict),
    ['correct', 'late', 'incorrect', 'missed'],
    'verdict',
  );
  requireMember(
    results.map((result) => result.termination.outcomeId),
    ['route-completed', 'wagon-unsalvageable', 'route-safely-interrupted'],
    'outcome',
  );
  requireFact(
    facts,
    'critical pressure',
    (fact) => fact.kind === 'pressure' && fact.verdict === 'missed',
  );
  requireFact(facts, 'missed fire', (fact) => fact.kind === 'fire' && fact.verdict === 'missed');
  requireFact(facts, 'fast fire', (fact) => fact.kind === 'fire' && fact.verdict === 'correct');
  requireFact(
    facts,
    'false journal',
    (fact) => fact.kind === 'journal-submission' && fact.detail.falseReport === true,
  );
  requireFact(
    facts,
    'missed fault',
    (fact) => fact.kind === 'journal-submission' && fact.detail.missedProblem === true,
  );
  requireFact(
    facts,
    'unsafe admit',
    (fact) =>
      fact.kind === 'boarding-decision' &&
      fact.detail.actual === 'admit' &&
      fact.detail.expected === 'reject',
  );
  requireFact(
    facts,
    'wrong reject',
    (fact) =>
      fact.kind === 'boarding-decision' &&
      fact.detail.actual === 'reject' &&
      fact.detail.expected === 'admit',
  );
  requireFact(
    facts,
    'late service',
    (fact) => fact.kind === 'service-request' && fact.verdict === 'late',
  );
  requireFact(
    facts,
    'timed out service',
    (fact) => fact.kind === 'service-request' && fact.verdict === 'missed',
  );
  requireFact(
    facts,
    'false brake',
    (fact) =>
      fact.kind === 'emergency-brake' &&
      fact.detail.activated === true &&
      fact.detail.hazardActive === false,
  );
  requireFact(
    facts,
    'safe stop',
    (fact) =>
      fact.kind === 'emergency-brake' &&
      fact.verdict === 'correct' &&
      fact.detail.hazardActive === true,
  );
}

function requireMember<T>(values: readonly T[], expected: readonly T[], label: string): void {
  const present = new Set(values);
  for (const item of expected) {
    if (!present.has(item)) throw new Error(`Sample set is missing ${label} ${String(item)}`);
  }
}

function requireFact(
  facts: readonly AssessmentFact[],
  label: string,
  predicate: (fact: AssessmentFact) => boolean,
): void {
  if (!facts.some(predicate)) throw new Error(`Sample set is missing ${label}`);
}

function buildPlans(): RunPlan[] {
  const plans: RunPlan[] = [];
  for (let index = 0; index < 8; index += 1) {
    plans.push(
      basePlan(`careful-${index}`, 1_100 + index, {
        sanitation: index % 3 === 2 ? 'issue' : 'clean',
        service: 'fast',
        fire: 'fast',
      }),
    );
  }
  for (let index = 0; index < 6; index += 1) {
    plans.push(basePlan(`rushed-late-${index}`, 2_100 + index, { service: 'late', fire: 'fast' }));
  }
  for (let index = 0; index < 5; index += 1) {
    plans.push(
      basePlan(`rushed-timeout-${index}`, 3_100 + index, {
        service: 'fast',
        fire: 'fast',
        serviceTimeouts: 2,
      }),
    );
  }
  for (let index = 0; index < 5; index += 1) {
    plans.push(
      basePlan(`unsafe-admit-${index}`, 4_100 + index, {
        boarding: boarding({ 'passenger-3': 'admit' }),
        service: 'fast',
        fire: 'fast',
      }),
    );
  }
  for (let index = 0; index < 5; index += 1) {
    const rejected: PassengerId = index % 2 === 0 ? 'passenger-1' : 'passenger-2';
    plans.push(
      basePlan(`wrong-reject-${index}`, 5_100 + index, {
        boarding: boarding({ [rejected]: 'reject' }),
        service: 'fast',
        fire: 'fast',
      }),
    );
  }
  for (let index = 0; index < FALSE_JOURNAL_FIELDS.length; index += 1) {
    const field = FALSE_JOURNAL_FIELDS[index] ?? 'extinguisher';
    plans.push(
      basePlan(`false-journal-${field}`, 6_100 + index, {
        journalField: field,
        service: 'ignore',
        fire: 'ignore',
      }),
    );
  }
  pushHazardPlans(plans);
  return plans;
}

function pushHazardPlans(plans: RunPlan[]): void {
  for (let index = 0; index < 4; index += 1) {
    plans.push(
      basePlan(`missed-fault-${index}`, 7_100 + index, {
        breakExtinguisher: true,
        service: 'fast',
        fire: 'fast',
      }),
    );
  }
  for (let index = 0; index < 4; index += 1) {
    plans.push(
      basePlan(`fire-missed-${index}`, 8_100 + index, { service: 'fast', fire: 'ignore' }),
    );
  }
  for (let index = 0; index < 4; index += 1) {
    plans.push(
      basePlan(`pressure-critical-${index}`, 9_100 + index, {
        service: 'fast',
        fire: 'ignore',
        pressureCritical: true,
      }),
    );
  }
  for (let index = 0; index < 4; index += 1) {
    plans.push(
      basePlan(`false-brake-${index}`, 10_100 + index, {
        service: 'fast',
        fire: 'ignore',
        brake: 'false',
      }),
    );
  }
  for (let index = 0; index < 5; index += 1) {
    plans.push(
      basePlan(`safe-stop-${index}`, 11_100 + index, {
        service: 'fast',
        fire: 'ignore',
        brake: 'hazard',
      }),
    );
  }
}

function basePlan(
  label: string,
  seed: number,
  options: {
    readonly sanitation?: AcceptanceJournalEdit['sanitation'];
    readonly journalField?: (typeof FALSE_JOURNAL_FIELDS)[number];
    readonly breakExtinguisher?: boolean;
    readonly boarding?: BoardingPlan;
    readonly service: ServiceMode;
    readonly fire: FireMode;
    readonly brake?: BrakeMode;
    readonly pressureCritical?: boolean;
    readonly serviceTimeouts?: number;
  },
): RunPlan {
  return {
    seed,
    label,
    journal: journalEdit(options.sanitation ?? 'clean', options.journalField),
    breakExtinguisher: options.breakExtinguisher ?? false,
    boarding: options.boarding ?? CORRECT_BOARDING,
    service: options.service,
    fire: options.fire,
    brake: options.brake ?? 'none',
    pressureCritical: options.pressureCritical ?? false,
    serviceTimeouts: options.serviceTimeouts ?? 0,
  };
}

function journalEdit(
  sanitation: AcceptanceJournalEdit['sanitation'],
  problem: (typeof FALSE_JOURNAL_FIELDS)[number] | undefined,
): AcceptanceJournalEdit {
  return {
    communication: marked(problem, 'communication'),
    extinguisher: marked(problem, 'extinguisher'),
    climate: marked(problem, 'climate'),
    emergencyBrake: marked(problem, 'emergencyBrake'),
    sanitation,
    note: problem === undefined ? '' : 'Отметка не подтвердилась осмотром',
    accepted: true,
  };
}

function marked(
  problem: (typeof FALSE_JOURNAL_FIELDS)[number] | undefined,
  field: (typeof FALSE_JOURNAL_FIELDS)[number],
): CheckState {
  return problem === field ? 'problem' : 'ok';
}

function boarding(overrides: Partial<BoardingPlan>): BoardingPlan {
  return {
    'passenger-1': overrides['passenger-1'] ?? CORRECT_BOARDING['passenger-1'],
    'passenger-2': overrides['passenger-2'] ?? CORRECT_BOARDING['passenger-2'],
    'passenger-3': overrides['passenger-3'] ?? CORRECT_BOARDING['passenger-3'],
  };
}

function isPassengerId(value: string): value is PassengerId {
  return PASSENGERS.some((passengerId) => passengerId === value);
}

function main(): void {
  const json = serializeSampleResults(generateSampleResults());
  const target = fileURLToPath(
    new URL('../../Backend/prisma/seed/fixtures/game-results.json', import.meta.url),
  );
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, json);
  process.stdout.write(`Wrote ${target}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main();
}
