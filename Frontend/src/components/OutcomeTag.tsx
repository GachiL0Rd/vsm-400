import { OUTCOME_TITLES, type RunOutcome } from '../model';

const TONES: Record<RunOutcome, string> = {
  completed: 'tag--ok',
  incident: 'tag--warn',
  terminated: 'tag--stop',
};

export function OutcomeTag({ outcome }: { outcome: RunOutcome }) {
  return <span className={`tag ${TONES[outcome]}`}>{OUTCOME_TITLES[outcome]}</span>;
}
