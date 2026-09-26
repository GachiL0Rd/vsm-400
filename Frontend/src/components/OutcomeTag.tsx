import { OUTCOME_TITLES, type RunOutcome } from '../model';
import { Tag, type TagTone } from './Tag';

const TONES: Record<RunOutcome, TagTone> = {
  completed: 'ok',
  incident: 'warn',
  terminated: 'stop',
};

export function OutcomeTag({ outcome }: { outcome: RunOutcome }) {
  return <Tag tone={TONES[outcome]}>{OUTCOME_TITLES[outcome]}</Tag>;
}
