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
  | { readonly kind: 'route-completed' }
  | { readonly kind: 'terminal-rule'; readonly outcomeId: string };

export interface AssessmentResult {
  readonly scores: AssessmentScores;
  readonly achievements: {
    readonly setVersion: string;
    readonly ids: readonly string[];
  };
}

interface BoardingFact {
  readonly expected: Exclude<PassengerBoardingDecision, 'pending'>;
  readonly actual: Exclude<PassengerBoardingDecision, 'pending'>;
}

interface ServiceFact {
  readonly serviceClass: ServiceClassTrait;
  readonly responseUs?: number;
  readonly timedOut: boolean;
}

interface ScoreDelta {
  readonly safety: number;
  readonly customerSatisfaction: number;
}

/**
 * Baseline assessment observer. It consumes authoritative facts but never
 * changes simulation state or action availability.
 */
export class AssessmentRuntime {
  constructor(private readonly config: AssessmentConfig = BASELINE_ASSESSMENT_CONFIG) {}

  private readonly boarding = new Map<string, BoardingFact>();
  private readonly service: ServiceFact[] = [];
  private journalSubmitted = false;
  private journalSanitation: JournalSubmissionFacts['sanitation'] | null = null;
  private reportedProblem = false;
  private realProblem = false;
  private falseReport = false;
  private missedProblem = false;
  private fireStartedAt: SimTimeUs | null = null;
  private fireExtinguishedAt: SimTimeUs | null = null;
  private fireCritical = false;
  private pressureCritical = false;
  private emergencySealRemoved = false;
  private emergencyActivated = false;
  private emergencyHazardActive = false;

  recordJournalSubmission(input: JournalSubmissionFacts): void {
    this.journalSubmitted = true;
    this.journalSanitation = input.sanitation;
    this.reportedProblem = input.reportedProblem;
    this.realProblem = input.realProblem;
    this.falseReport = input.falseReport;
    this.missedProblem = input.missedProblem;
  }

  recordBoardingDecision(
    passengerId: string,
    expected: Exclude<PassengerBoardingDecision, 'pending'>,
    actual: Exclude<PassengerBoardingDecision, 'pending'>,
  ): void {
    this.boarding.set(passengerId, { expected, actual });
  }

  recordServiceResolution(serviceClass: ServiceClassTrait, responseUs: number): void {
    this.service.push({ serviceClass, responseUs, timedOut: false });
  }

  recordServiceTimeout(serviceClass: ServiceClassTrait): void {
    this.service.push({ serviceClass, timedOut: true });
  }

  recordFireStarted(at: SimTimeUs): void {
    if (this.fireStartedAt === null) this.fireStartedAt = at;
  }

  recordFireExtinguished(at: SimTimeUs): void {
    if (this.fireStartedAt !== null && this.fireExtinguishedAt === null) {
      this.fireExtinguishedAt = at;
    }
  }

  recordFireCritical(): void {
    this.fireCritical = true;
  }

  recordPressureCritical(): void {
    this.pressureCritical = true;
  }

  recordEmergencySealRemoved(): void {
    this.emergencySealRemoved = true;
  }

  recordEmergencyActivation(hazardActive: boolean): void {
    this.emergencyActivated = true;
    this.emergencyHazardActive = hazardActive;
  }

  result(termination: AssessmentTermination): AssessmentResult {
    const score = addDeltas([
      boardingDelta(this.boarding.values(), this.config),
      serviceDelta(this.service, this.config),
      incidentDelta(this.fireCritical, this.pressureCritical, this.config),
      emergencyDelta(
        {
          sealRemoved: this.emergencySealRemoved,
          activated: this.emergencyActivated,
          hazardActive: this.emergencyHazardActive,
        },
        this.config,
      ),
      journalDelta(this.falseReport, this.missedProblem, this.config),
    ]);

    const adjustedSafety = safePredepartureOverride(
      this.config.startingScore + score.safety,
      termination,
      this.realProblem,
      this.config,
    );

    return {
      scores: {
        safety: clampScore(adjustedSafety),
        customerSatisfaction: clampScore(this.config.startingScore + score.customerSatisfaction),
      },
      achievements: {
        setVersion: this.config.setVersion,
        ids: this.achievementIds(),
      },
    };
  }

  private achievementIds(): string[] {
    const ids: string[] = [];
    if (allBoardingDecisionsCorrect(this.boarding)) ids.push('documents-perfect');
    if (
      isFastFireResponse(
        this.fireStartedAt,
        this.fireExtinguishedAt,
        this.config.fastFireResponseUs,
      )
    ) {
      ids.push('fast-fire-response');
    }
    if (this.emergencyActivated && this.emergencyHazardActive) ids.push('safe-emergency-stop');
    if (this.service.length > 0 && this.service.every((fact) => !fact.timedOut)) {
      ids.push('all-service-requests-resolved');
    }
    if (
      grantsCleanPredeparture({
        submitted: this.journalSubmitted,
        sanitation: this.journalSanitation,
        reportedProblem: this.reportedProblem,
        missedProblem: this.missedProblem,
        falseReport: this.falseReport,
      })
    ) {
      ids.push('clean-predeparture');
    }
    return ids.sort(compareIds);
  }
}

function boardingDelta(facts: Iterable<BoardingFact>, config: AssessmentConfig): ScoreDelta {
  let safety = 0;
  let customerSatisfaction = 0;
  for (const fact of facts) {
    if (fact.actual === fact.expected) continue;
    const delta =
      fact.actual === 'admit' ? config.boarding.unsafeAdmit : config.boarding.wrongReject;
    safety += delta.safety;
    customerSatisfaction += delta.customerSatisfaction;
  }
  return { safety, customerSatisfaction };
}

function serviceDelta(facts: readonly ServiceFact[], config: AssessmentConfig): ScoreDelta {
  let customerSatisfaction = 0;
  for (const fact of facts) {
    if (fact.timedOut) {
      customerSatisfaction -= serviceClassValue(config.service.timeoutPenalty, fact.serviceClass);
      continue;
    }
    const responseUs = fact.responseUs ?? 0;
    const targetUs = serviceClassValue(config.service.targetResponseUs, fact.serviceClass);
    if (responseUs > targetUs * 2) customerSatisfaction -= config.service.veryLatePenalty;
    else if (responseUs > targetUs) customerSatisfaction -= config.service.latePenalty;
  }
  return { safety: 0, customerSatisfaction };
}

function incidentDelta(
  fireCritical: boolean,
  pressureCritical: boolean,
  config: AssessmentConfig,
): ScoreDelta {
  return addDeltas([
    fireCritical ? config.incidents.criticalFire : { safety: 0, customerSatisfaction: 0 },
    pressureCritical ? config.incidents.criticalPressure : { safety: 0, customerSatisfaction: 0 },
  ]);
}

function emergencyDelta(
  input: {
    readonly sealRemoved: boolean;
    readonly activated: boolean;
    readonly hazardActive: boolean;
  },
  config: AssessmentConfig,
): ScoreDelta {
  if (input.activated && !input.hazardActive) return config.emergency.falseActivation;
  if (input.sealRemoved && !input.activated) return config.emergency.sealRemovedWithoutActivation;
  return { safety: 0, customerSatisfaction: 0 };
}

function journalDelta(
  falseReport: boolean,
  missedProblem: boolean,
  config: AssessmentConfig,
): ScoreDelta {
  const none = { safety: 0, customerSatisfaction: 0 };
  return addDeltas([
    falseReport ? config.journal.falseCriticalReport : none,
    missedProblem ? config.journal.missedCriticalProblem : none,
  ]);
}

function safePredepartureOverride(
  safety: number,
  termination: AssessmentTermination,
  realProblem: boolean,
  config: AssessmentConfig,
): number {
  if (
    termination.kind === 'terminal-rule' &&
    termination.outcomeId === 'wagon-unserviceable' &&
    realProblem
  ) {
    return Math.max(safety, config.safePredepartureMinimumSafety);
  }
  return safety;
}

function grantsCleanPredeparture(input: {
  readonly submitted: boolean;
  readonly sanitation: JournalSubmissionFacts['sanitation'] | null;
  readonly reportedProblem: boolean;
  readonly missedProblem: boolean;
  readonly falseReport: boolean;
}): boolean {
  return (
    input.submitted &&
    input.sanitation === 'clean' &&
    !input.reportedProblem &&
    !input.missedProblem &&
    !input.falseReport
  );
}

function allBoardingDecisionsCorrect(boarding: ReadonlyMap<string, BoardingFact>): boolean {
  return boarding.size > 0 && [...boarding.values()].every((fact) => fact.actual === fact.expected);
}

function isFastFireResponse(
  startedAt: SimTimeUs | null,
  extinguishedAt: SimTimeUs | null,
  thresholdUs: number,
): boolean {
  return startedAt !== null && extinguishedAt !== null && extinguishedAt - startedAt <= thresholdUs;
}

function addDeltas(deltas: readonly ScoreDelta[]): ScoreDelta {
  return deltas.reduce(
    (sum, delta) => ({
      safety: sum.safety + delta.safety,
      customerSatisfaction: sum.customerSatisfaction + delta.customerSatisfaction,
    }),
    { safety: 0, customerSatisfaction: 0 },
  );
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
