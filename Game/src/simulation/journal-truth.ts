import {
  type AcceptanceJournalState,
  acceptanceJournalHasCriticalProblem,
  type ExtinguisherState,
  type SanitationCheckState,
} from './item-store';

const CRITICAL_FIELDS = ['communication', 'extinguisher', 'climate', 'emergencyBrake'] as const;

type CriticalField = (typeof CRITICAL_FIELDS)[number];

export interface JournalEquipmentState {
  readonly extinguisher: ExtinguisherState;
  readonly emergencyBrake: {
    readonly seal: 'intact' | 'broken';
    readonly activated: boolean;
  };
}

export interface JournalSubmissionFacts {
  readonly sanitation: SanitationCheckState;
  readonly reportedProblem: boolean;
  readonly realProblem: boolean;
  readonly falseReport: boolean;
  readonly missedProblem: boolean;
}

/**
 * Climate has no pre-departure out-of-range threshold, and communication has
 * no simulated state. Both are therefore never a real problem here.
 */
export function journalSubmissionFacts(
  journal: AcceptanceJournalState,
  equipment: JournalEquipmentState,
): JournalSubmissionFacts {
  const real = realFaults(equipment);
  const reportedProblem = acceptanceJournalHasCriticalProblem(journal);
  const realProblem = markedProblemIsReal(journal, real);
  return {
    sanitation: journal.sanitation,
    reportedProblem,
    realProblem,
    falseReport: reportedProblem && !realProblem,
    missedProblem: realFaultWasNotReported(journal, real),
  };
}

function realFaults(equipment: JournalEquipmentState): Record<CriticalField, boolean> {
  return {
    communication: false,
    extinguisher: extinguisherReallyFaulty(equipment.extinguisher),
    climate: false,
    emergencyBrake: brakeReallyFaulty(equipment.emergencyBrake),
  };
}

function extinguisherReallyFaulty(state: ExtinguisherState): boolean {
  return (
    state.pressure !== 'normal' ||
    state.seal === 'broken' ||
    state.pin === 'removed' ||
    state.bodyDamage !== 'none' ||
    state.used
  );
}

function brakeReallyFaulty(state: JournalEquipmentState['emergencyBrake']): boolean {
  return state.seal !== 'intact' || state.activated;
}

function markedProblemIsReal(
  journal: AcceptanceJournalState,
  real: Readonly<Record<CriticalField, boolean>>,
): boolean {
  return CRITICAL_FIELDS.some((field) => journal[field] === 'problem' && real[field]);
}

function realFaultWasNotReported(
  journal: AcceptanceJournalState,
  real: Readonly<Record<CriticalField, boolean>>,
): boolean {
  return CRITICAL_FIELDS.some((field) => real[field] && journal[field] !== 'problem');
}
