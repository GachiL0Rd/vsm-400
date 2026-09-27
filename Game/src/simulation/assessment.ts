import {
  type AssessmentConfig,
  BASELINE_ASSESSMENT_CONFIG,
  serviceClassValue,
} from './assessment-config';
import type { ServiceClassTrait } from './entity-store';
import type { PassengerBoardingDecision } from './game-attempt';
import type { JournalSubmissionFacts } from './journal-truth';
import type { SimTimeUs } from './sim-time';

export interface AssessmentScores {
  readonly safety: number;
  readonly customerSatisfaction: number;
}

export type AssessmentTermination =
  | { readonly kind: 'route-completed'; readonly at?: SimTimeUs }
  | { readonly kind: 'terminal-rule'; readonly outcomeId: string; readonly at?: SimTimeUs };

export type AssessmentFactKind =
  | 'journal-submission'
  | 'boarding-decision'
  | 'service-request'
  | 'fire'
  | 'pressure'
  | 'emergency-brake';

export type AssessmentVerdict = 'correct' | 'late' | 'incorrect' | 'missed';

export interface AssessmentScoreDelta {
  readonly safety: number;
  readonly customerSatisfaction: number;
}

export interface AssessmentFact {
  readonly id: string;
  readonly kind: AssessmentFactKind;
  readonly at: number;
  readonly verdict: AssessmentVerdict;
  readonly scoreDelta: AssessmentScoreDelta;
  readonly reactionUs?: number;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AssessmentResult {
  readonly scores: AssessmentScores;
  readonly achievements: {
    readonly setVersion: string;
    readonly ids: readonly string[];
  };
  readonly facts: readonly AssessmentFact[];
}

export interface JournalAssessmentInput extends JournalSubmissionFacts {
  readonly at: SimTimeUs;
  readonly communication: 'unset' | 'ok' | 'problem';
  readonly extinguisher: 'unset' | 'ok' | 'problem';
  readonly climate: 'unset' | 'ok' | 'problem';
  readonly emergencyBrake: 'unset' | 'ok' | 'problem';
  readonly accepted: boolean;
}

type BoardingDecision = Exclude<PassengerBoardingDecision, 'pending'>;

interface BoardingObservation {
  readonly passengerId: string;
  readonly expected: BoardingDecision;
  readonly actual: BoardingDecision;
  readonly at: SimTimeUs;
}

interface ServiceObservation {
  readonly passengerId?: string;
  readonly serviceClass: ServiceClassTrait;
  readonly responseUs?: number;
  readonly timedOut: boolean;
  readonly at: SimTimeUs;
  readonly index: number;
}

interface FireObservation {
  readonly incidentId: string;
  readonly startedAt: SimTimeUs;
  readonly extinguishedAt: SimTimeUs | null;
  readonly criticalAt: SimTimeUs | null;
}

interface PressureObservation {
  readonly incidentId: string;
  readonly startedAt: SimTimeUs;
  readonly criticalAt: SimTimeUs | null;
}

interface EmergencyObservation {
  readonly sealRemovedAt: SimTimeUs | null;
  readonly activatedAt: SimTimeUs | null;
  readonly hazardActive: boolean;
}

/**
 * Baseline assessment observer. It consumes authoritative facts but never
 * changes simulation state or action availability.
 */
export class AssessmentRuntime {
  constructor(private readonly config: AssessmentConfig = BASELINE_ASSESSMENT_CONFIG) {}

  private readonly boarding = new Map<string, BoardingObservation>();
  private readonly service: ServiceObservation[] = [];
  private readonly fires = new Map<string, FireObservation>();
  private readonly pressures = new Map<string, PressureObservation>();
  private journal: JournalAssessmentInput | null = null;
  private primaryFireId: string | null = null;
  private emergencySealRemovedAt: SimTimeUs | null = null;
  private emergencyActivatedAt: SimTimeUs | null = null;
  private emergencyHazardActive = false;

  recordJournalSubmission(input: JournalAssessmentInput): void {
    this.journal = input;
  }

  recordBoardingDecision(
    passengerId: string,
    expected: BoardingDecision,
    actual: BoardingDecision,
    at: SimTimeUs,
  ): void {
    this.boarding.set(passengerId, { passengerId, expected, actual, at });
  }

  recordServiceResolution(input: {
    readonly passengerId?: string;
    readonly serviceClass: ServiceClassTrait;
    readonly responseUs: number;
    readonly at: SimTimeUs;
  }): void {
    this.pushService({ ...input, timedOut: false });
  }

  recordServiceTimeout(input: {
    readonly passengerId?: string;
    readonly serviceClass: ServiceClassTrait;
    readonly at: SimTimeUs;
  }): void {
    this.pushService({ ...input, timedOut: true });
  }

  recordFireStarted(incidentId: string, at: SimTimeUs): void {
    if (this.fires.has(incidentId)) return;
    if (this.primaryFireId === null) this.primaryFireId = incidentId;
    this.fires.set(incidentId, {
      incidentId,
      startedAt: at,
      extinguishedAt: null,
      criticalAt: null,
    });
  }

  recordFireExtinguished(incidentId: string, at: SimTimeUs): void {
    const existing = this.fires.get(incidentId);
    if (existing === undefined || existing.extinguishedAt !== null) return;
    this.fires.set(incidentId, { ...existing, extinguishedAt: at });
  }

  recordFireCritical(incidentId: string, at: SimTimeUs): void {
    const existing = this.fires.get(incidentId);
    if (existing === undefined) {
      this.fires.set(incidentId, {
        incidentId,
        startedAt: at,
        extinguishedAt: null,
        criticalAt: at,
      });
      return;
    }
    if (existing.criticalAt !== null) return;
    this.fires.set(incidentId, { ...existing, criticalAt: at });
  }

  recordPressureStarted(incidentId: string, at: SimTimeUs): void {
    if (this.pressures.has(incidentId)) return;
    this.pressures.set(incidentId, { incidentId, startedAt: at, criticalAt: null });
  }

  recordPressureCritical(incidentId: string, at: SimTimeUs): void {
    const existing = this.pressures.get(incidentId);
    if (existing === undefined) {
      this.pressures.set(incidentId, { incidentId, startedAt: at, criticalAt: at });
      return;
    }
    if (existing.criticalAt !== null) return;
    this.pressures.set(incidentId, { ...existing, criticalAt: at });
  }

  recordEmergencySealRemoved(at: SimTimeUs): void {
    if (this.emergencySealRemovedAt === null) this.emergencySealRemovedAt = at;
  }

  recordEmergencyActivation(hazardActive: boolean, at: SimTimeUs): void {
    if (this.emergencyActivatedAt !== null) return;
    this.emergencyActivatedAt = at;
    this.emergencyHazardActive = hazardActive;
  }

  result(termination: AssessmentTermination): AssessmentResult {
    const facts = this.factsFor(termination);
    const totals = sumDeltas(facts);
    return {
      scores: {
        safety: clampScore(this.config.startingScore + totals.safety),
        customerSatisfaction: clampScore(this.config.startingScore + totals.customerSatisfaction),
      },
      achievements: {
        setVersion: this.config.setVersion,
        ids: this.achievementIds(),
      },
      facts,
    };
  }

  private pushService(input: {
    readonly passengerId?: string;
    readonly serviceClass: ServiceClassTrait;
    readonly responseUs?: number;
    readonly timedOut: boolean;
    readonly at: SimTimeUs;
  }): void {
    const index = this.service.filter((item) => item.passengerId === input.passengerId).length;
    this.service.push({ ...input, index });
  }

  private factsFor(termination: AssessmentTermination): AssessmentFact[] {
    const built = [
      ...journalFacts(this.journal, this.config),
      ...boardingFacts(this.boarding.values(), this.config),
      ...serviceFacts(this.service, this.config),
      ...fireFacts(this.fires.values(), this.config, termination.at ?? null),
      ...pressureFacts(this.pressures.values(), this.config),
      ...emergencyFacts(this.emergencyObservation(), this.config),
    ];
    return applyPredepartureLift(
      built,
      termination,
      this.journal?.realProblem ?? false,
      this.config,
    ).sort(compareFacts);
  }

  private emergencyObservation(): EmergencyObservation {
    return {
      sealRemovedAt: this.emergencySealRemovedAt,
      activatedAt: this.emergencyActivatedAt,
      hazardActive: this.emergencyHazardActive,
    };
  }

  private achievementIds(): string[] {
    const ids: string[] = [];
    if (allBoardingDecisionsCorrect(this.boarding)) ids.push('documents-perfect');
    const fire = this.primaryFire();
    if (
      fire !== null &&
      isFastFireResponse(fire.startedAt, fire.extinguishedAt, this.config.fastFireResponseUs)
    ) {
      ids.push('fast-fire-response');
    }
    if (this.emergencyActivatedAt !== null && this.emergencyHazardActive) {
      ids.push('safe-emergency-stop');
    }
    if (this.service.length > 0 && this.service.every((item) => !item.timedOut)) {
      ids.push('all-service-requests-resolved');
    }
    if (grantsCleanPredeparture(this.journal)) ids.push('clean-predeparture');
    return ids.sort(compareIds);
  }

  private primaryFire(): FireObservation | null {
    if (this.primaryFireId === null) return null;
    return this.fires.get(this.primaryFireId) ?? null;
  }
}

function journalFacts(
  journal: JournalAssessmentInput | null,
  config: AssessmentConfig,
): AssessmentFact[] {
  if (journal === null) return [];
  return [
    fact({
      id: 'journal-submission',
      kind: 'journal-submission',
      at: journal.at,
      verdict: journalVerdict(journal),
      scoreDelta: journalScore(journal, config),
      detail: {
        communication: journal.communication,
        extinguisher: journal.extinguisher,
        climate: journal.climate,
        emergencyBrake: journal.emergencyBrake,
        sanitation: journal.sanitation,
        accepted: journal.accepted,
        reportedProblem: journal.reportedProblem,
        realProblem: journal.realProblem,
        falseReport: journal.falseReport,
        missedProblem: journal.missedProblem,
      },
    }),
  ];
}

function journalVerdict(input: JournalAssessmentInput): AssessmentVerdict {
  // A real fault left unreported stays missed even if another field was a false report.
  if (input.missedProblem) return 'missed';
  if (input.falseReport) return 'incorrect';
  return 'correct';
}

function journalScore(input: JournalAssessmentInput, config: AssessmentConfig): ScoreDelta {
  return addDeltas([
    input.falseReport ? config.journal.falseCriticalReport : zeroDelta(),
    input.missedProblem ? config.journal.missedCriticalProblem : zeroDelta(),
  ]);
}

function boardingFacts(
  observations: Iterable<BoardingObservation>,
  config: AssessmentConfig,
): AssessmentFact[] {
  return [...observations].map((observation) => boardingFact(observation, config));
}

function boardingFact(observation: BoardingObservation, config: AssessmentConfig): AssessmentFact {
  const correct = observation.actual === observation.expected;
  return fact({
    id: `boarding:${observation.passengerId}`,
    kind: 'boarding-decision',
    at: observation.at,
    verdict: correct ? 'correct' : 'incorrect',
    scoreDelta: correct ? zeroDelta() : boardingPenalty(observation.actual, config),
    detail: {
      passengerId: observation.passengerId,
      expected: observation.expected,
      actual: observation.actual,
    },
  });
}

function boardingPenalty(actual: BoardingDecision, config: AssessmentConfig): ScoreDelta {
  const penalty = actual === 'admit' ? config.boarding.unsafeAdmit : config.boarding.wrongReject;
  return configuredDelta(penalty);
}

function serviceFacts(
  observations: readonly ServiceObservation[],
  config: AssessmentConfig,
): AssessmentFact[] {
  return observations.map((observation) => serviceFact(observation, config));
}

function serviceFact(observation: ServiceObservation, config: AssessmentConfig): AssessmentFact {
  const targetUs = serviceClassValue(config.service.targetResponseUs, observation.serviceClass);
  const passengerId = observation.passengerId;
  return fact({
    id:
      passengerId === undefined
        ? `service:${observation.index}`
        : `service:${passengerId}:${observation.index}`,
    kind: 'service-request',
    at: observation.at,
    verdict: serviceVerdict(observation, targetUs),
    scoreDelta: serviceScore(observation, targetUs, config),
    reactionUs: observation.timedOut ? undefined : observation.responseUs,
    detail: serviceDetail(observation, targetUs),
  });
}

function serviceVerdict(observation: ServiceObservation, targetUs: number): AssessmentVerdict {
  if (observation.timedOut) return 'missed';
  if ((observation.responseUs ?? 0) > targetUs) return 'late';
  return 'correct';
}

function serviceScore(
  observation: ServiceObservation,
  targetUs: number,
  config: AssessmentConfig,
): ScoreDelta {
  if (observation.timedOut) {
    return delta(0, -serviceClassValue(config.service.timeoutPenalty, observation.serviceClass));
  }
  const responseUs = observation.responseUs ?? 0;
  if (responseUs > targetUs * 2) return delta(0, -config.service.veryLatePenalty);
  if (responseUs > targetUs) return delta(0, -config.service.latePenalty);
  return zeroDelta();
}

function serviceDetail(
  observation: ServiceObservation,
  targetUs: number,
): Record<string, string | number | boolean | null> {
  const detail: Record<string, string | number | boolean | null> = {
    serviceClass: observation.serviceClass,
    timedOut: observation.timedOut,
    targetUs,
  };
  if (observation.passengerId !== undefined) detail.passengerId = observation.passengerId;
  return detail;
}

function fireFacts(
  observations: Iterable<FireObservation>,
  config: AssessmentConfig,
  endedAt: SimTimeUs | null,
): AssessmentFact[] {
  return [...observations].map((observation) => fireFact(observation, config, endedAt));
}

function fireFact(
  observation: FireObservation,
  config: AssessmentConfig,
  endedAt: SimTimeUs | null,
): AssessmentFact {
  const critical = observation.criticalAt !== null;
  const extinguished = observation.extinguishedAt !== null;
  return fact({
    id: `fire:${observation.incidentId}`,
    kind: 'fire',
    at: fireObservedAt(observation, endedAt),
    verdict: critical || !extinguished ? 'missed' : 'correct',
    scoreDelta: critical ? configuredDelta(config.incidents.criticalFire) : zeroDelta(),
    reactionUs:
      observation.extinguishedAt === null
        ? undefined
        : observation.extinguishedAt - observation.startedAt,
    detail: {
      incidentId: observation.incidentId,
      extinguished,
      critical,
    },
  });
}

function fireObservedAt(observation: FireObservation, endedAt: SimTimeUs | null): SimTimeUs {
  if (observation.criticalAt !== null) return observation.criticalAt;
  if (observation.extinguishedAt !== null) return observation.extinguishedAt;
  return endedAt ?? observation.startedAt;
}

function pressureFacts(
  observations: Iterable<PressureObservation>,
  config: AssessmentConfig,
): AssessmentFact[] {
  return [...observations].map((observation) => pressureFact(observation, config));
}

function pressureFact(observation: PressureObservation, config: AssessmentConfig): AssessmentFact {
  const critical = observation.criticalAt !== null;
  return fact({
    id: `pressure:${observation.incidentId}`,
    kind: 'pressure',
    at: observation.criticalAt ?? observation.startedAt,
    verdict: critical ? 'missed' : 'correct',
    scoreDelta: critical ? configuredDelta(config.incidents.criticalPressure) : zeroDelta(),
    detail: { incidentId: observation.incidentId, critical },
  });
}

function emergencyFacts(
  observation: EmergencyObservation,
  config: AssessmentConfig,
): AssessmentFact[] {
  const built = emergencyFact(observation, config);
  return built === null ? [] : [built];
}

function emergencyFact(
  observation: EmergencyObservation,
  config: AssessmentConfig,
): AssessmentFact | null {
  const sealRemoved = observation.sealRemovedAt !== null;
  const activated = observation.activatedAt !== null;
  if (!sealRemoved && !activated) return null;
  return fact({
    id: 'emergency-brake',
    kind: 'emergency-brake',
    at: observation.activatedAt ?? observation.sealRemovedAt ?? 0,
    verdict: emergencyVerdict(activated, observation.hazardActive),
    scoreDelta: emergencyScore(observation, config),
    detail: {
      sealRemoved,
      activated,
      hazardActive: observation.hazardActive,
    },
  });
}

function emergencyVerdict(activated: boolean, hazardActive: boolean): AssessmentVerdict {
  if (activated && hazardActive) return 'correct';
  return 'incorrect';
}

function emergencyScore(observation: EmergencyObservation, config: AssessmentConfig): ScoreDelta {
  const activated = observation.activatedAt !== null;
  const sealRemoved = observation.sealRemovedAt !== null;
  if (activated && !observation.hazardActive) {
    return configuredDelta(config.emergency.falseActivation);
  }
  if (sealRemoved && !activated) {
    return configuredDelta(config.emergency.sealRemovedWithoutActivation);
  }
  return zeroDelta();
}

function applyPredepartureLift(
  facts: readonly AssessmentFact[],
  termination: AssessmentTermination,
  realProblem: boolean,
  config: AssessmentConfig,
): AssessmentFact[] {
  const lift = predepartureLift(facts, termination, realProblem, config);
  if (lift === 0) return [...facts];
  return facts.map((item) => addJournalSafety(item, lift));
}

function predepartureLift(
  facts: readonly AssessmentFact[],
  termination: AssessmentTermination,
  realProblem: boolean,
  config: AssessmentConfig,
): number {
  if (!liftsPredepartureSafety(termination, realProblem)) return 0;
  const provisional = config.startingScore + sumDeltas(facts).safety;
  return Math.max(0, config.safePredepartureMinimumSafety - provisional);
}

function liftsPredepartureSafety(
  termination: AssessmentTermination,
  realProblem: boolean,
): boolean {
  return (
    termination.kind === 'terminal-rule' &&
    termination.outcomeId === 'wagon-unserviceable' &&
    realProblem
  );
}

function addJournalSafety(item: AssessmentFact, lift: number): AssessmentFact {
  if (item.kind !== 'journal-submission') return item;
  return fact({
    id: item.id,
    kind: item.kind,
    at: item.at,
    verdict: item.verdict,
    scoreDelta: delta(item.scoreDelta.safety + lift, item.scoreDelta.customerSatisfaction),
    reactionUs: item.reactionUs,
    detail: { ...item.detail },
  });
}

function grantsCleanPredeparture(journal: JournalAssessmentInput | null): boolean {
  return (
    journal !== null &&
    journal.sanitation === 'clean' &&
    !journal.reportedProblem &&
    !journal.missedProblem &&
    !journal.falseReport
  );
}

function allBoardingDecisionsCorrect(boarding: ReadonlyMap<string, BoardingObservation>): boolean {
  return boarding.size > 0 && [...boarding.values()].every((item) => item.actual === item.expected);
}

function isFastFireResponse(
  startedAt: SimTimeUs | null,
  extinguishedAt: SimTimeUs | null,
  thresholdUs: number,
): boolean {
  return startedAt !== null && extinguishedAt !== null && extinguishedAt - startedAt <= thresholdUs;
}

type ScoreDelta = AssessmentScoreDelta;

function zeroDelta(): ScoreDelta {
  return { safety: 0, customerSatisfaction: 0 };
}

function delta(safety: number, customerSatisfaction: number): ScoreDelta {
  return { safety, customerSatisfaction };
}

function configuredDelta(value: ScoreDelta): ScoreDelta {
  return delta(value.safety, value.customerSatisfaction);
}

function addDeltas(deltas: readonly ScoreDelta[]): ScoreDelta {
  let safety = 0;
  let customerSatisfaction = 0;
  for (const item of deltas) {
    safety += item.safety;
    customerSatisfaction += item.customerSatisfaction;
  }
  return delta(safety, customerSatisfaction);
}

function sumDeltas(facts: readonly AssessmentFact[]): ScoreDelta {
  return addDeltas(facts.map((item) => item.scoreDelta));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function compareFacts(left: AssessmentFact, right: AssessmentFact): number {
  if (left.at !== right.at) return left.at - right.at;
  return compareIds(left.id, right.id);
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fact(input: {
  readonly id: string;
  readonly kind: AssessmentFactKind;
  readonly at: number;
  readonly verdict: AssessmentVerdict;
  readonly scoreDelta: ScoreDelta;
  readonly reactionUs?: number | undefined;
  readonly detail: Record<string, string | number | boolean | null>;
}): AssessmentFact {
  return {
    id: input.id,
    kind: input.kind,
    at: input.at,
    verdict: input.verdict,
    scoreDelta: input.scoreDelta,
    detail: input.detail,
    ...(input.reactionUs === undefined ? {} : { reactionUs: input.reactionUs }),
  };
}
