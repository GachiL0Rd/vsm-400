import type { ServiceClassTrait } from './entity-store';
import type { PassengerBoardingDecision } from './game-attempt';
import type { SanitationCheckState } from './item-store';
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
  private readonly boarding = new Map<string, BoardingFact>();
  private readonly service: ServiceFact[] = [];
  private journalSubmitted = false;
  private journalSanitation: SanitationCheckState | null = null;
  private journalCriticalProblem = false;
  private fireStartedAt: SimTimeUs | null = null;
  private fireExtinguishedAt: SimTimeUs | null = null;
  private fireCritical = false;
  private pressureCritical = false;
  private emergencySealRemoved = false;
  private emergencyActivated = false;
  private emergencyHazardActive = false;

  recordJournalSubmission(input: {
    sanitation: SanitationCheckState;
    criticalProblem: boolean;
  }): void {
    this.journalSubmitted = true;
    this.journalSanitation = input.sanitation;
    this.journalCriticalProblem = input.criticalProblem;
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
      boardingDelta(this.boarding.values()),
      serviceDelta(this.service),
      incidentDelta(this.fireCritical, this.pressureCritical),
      emergencyDelta({
        sealRemoved: this.emergencySealRemoved,
        activated: this.emergencyActivated,
        hazardActive: this.emergencyHazardActive,
      }),
    ]);

    const adjustedSafety = safePredepartureOverride(
      100 + score.safety,
      termination,
      this.journalCriticalProblem,
    );

    return {
      scores: {
        safety: clampScore(adjustedSafety),
        customerSatisfaction: clampScore(100 + score.customerSatisfaction),
      },
      achievements: {
        setVersion: 'baseline-v1',
        ids: this.achievementIds(),
      },
    };
  }

  private achievementIds(): string[] {
    const ids: string[] = [];
    if (allBoardingDecisionsCorrect(this.boarding)) ids.push('documents-perfect');
    if (isFastFireResponse(this.fireStartedAt, this.fireExtinguishedAt)) {
      ids.push('fast-fire-response');
    }
    if (this.emergencyActivated && this.emergencyHazardActive) ids.push('safe-emergency-stop');
    if (this.service.length > 0 && this.service.every((fact) => !fact.timedOut)) {
      ids.push('all-service-requests-resolved');
    }
    if (
      this.journalSubmitted &&
      this.journalSanitation === 'clean' &&
      !this.journalCriticalProblem
    ) {
      ids.push('clean-predeparture');
    }
    return ids.sort(compareIds);
  }
}

function boardingDelta(facts: Iterable<BoardingFact>): ScoreDelta {
  let safety = 0;
  let customerSatisfaction = 0;
  for (const fact of facts) {
    if (fact.actual === fact.expected) continue;
    if (fact.actual === 'admit') safety -= 15;
    else customerSatisfaction -= 25;
  }
  return { safety, customerSatisfaction };
}

function serviceDelta(facts: readonly ServiceFact[]): ScoreDelta {
  let customerSatisfaction = 0;
  for (const fact of facts) {
    if (fact.timedOut) {
      customerSatisfaction -= timeoutPenalty(fact.serviceClass);
      continue;
    }
    const responseUs = fact.responseUs ?? 0;
    const targetUs = serviceTargetUs(fact.serviceClass);
    if (responseUs > targetUs * 2) customerSatisfaction -= 10;
    else if (responseUs > targetUs) customerSatisfaction -= 5;
  }
  return { safety: 0, customerSatisfaction };
}

function incidentDelta(fireCritical: boolean, pressureCritical: boolean): ScoreDelta {
  return {
    safety: (fireCritical ? -60 : 0) + (pressureCritical ? -50 : 0),
    customerSatisfaction: (fireCritical ? -30 : 0) + (pressureCritical ? -25 : 0),
  };
}

function emergencyDelta(input: {
  readonly sealRemoved: boolean;
  readonly activated: boolean;
  readonly hazardActive: boolean;
}): ScoreDelta {
  if (input.activated && !input.hazardActive) {
    return { safety: -20, customerSatisfaction: -20 };
  }
  if (input.sealRemoved && !input.activated) {
    return { safety: -5, customerSatisfaction: 0 };
  }
  return { safety: 0, customerSatisfaction: 0 };
}

function safePredepartureOverride(
  safety: number,
  termination: AssessmentTermination,
  journalCriticalProblem: boolean,
): number {
  if (
    termination.kind === 'terminal-rule' &&
    termination.outcomeId === 'wagon-unserviceable' &&
    journalCriticalProblem
  ) {
    return Math.max(safety, 95);
  }
  return safety;
}

function allBoardingDecisionsCorrect(boarding: ReadonlyMap<string, BoardingFact>): boolean {
  return boarding.size > 0 && [...boarding.values()].every((fact) => fact.actual === fact.expected);
}

function isFastFireResponse(
  startedAt: SimTimeUs | null,
  extinguishedAt: SimTimeUs | null,
): boolean {
  return startedAt !== null && extinguishedAt !== null && extinguishedAt - startedAt <= 120_000_000;
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

function serviceTargetUs(serviceClass: ServiceClassTrait): number {
  switch (serviceClass) {
    case 'business':
      return 60_000_000;
    case 'comfort':
      return 90_000_000;
    case 'basic':
      return 120_000_000;
  }
}

function timeoutPenalty(serviceClass: ServiceClassTrait): number {
  switch (serviceClass) {
    case 'business':
      return 20;
    case 'comfort':
      return 15;
    case 'basic':
      return 10;
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
