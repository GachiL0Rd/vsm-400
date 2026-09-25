import { describe, expect, it } from 'vitest';
import { BOARDING_DOCUMENTS_DIALOGUE } from './content/dialogues';
import { DEMO_PASSENGER } from './content/passengers';
import { applyDialogueOption, selectDialogueVariant } from './dialogue';
import { createPassengerState } from './passenger';

describe('passenger dialogue resources', () => {
  it('selects a dialogue variant from passenger state', () => {
    const state = createPassengerState(DEMO_PASSENGER);
    const variant = selectDialogueVariant(BOARDING_DOCUMENTS_DIALOGUE, state);

    expect(variant.id).toBe('pending-default');
    expect(variant.options.map((option) => option.id)).toEqual(['admit', 'reject']);
  });

  it('applies dialogue option effects to passenger state', () => {
    const initial = createPassengerState(DEMO_PASSENGER);
    const variant = selectDialogueVariant(BOARDING_DOCUMENTS_DIALOGUE, initial);
    const reject = variant.options.find((option) => option.id === 'reject');
    expect(reject).toBeDefined();

    const result = applyDialogueOption(DEMO_PASSENGER, initial, reject!);
    const resolvedVariant = selectDialogueVariant(BOARDING_DOCUMENTS_DIALOGUE, result.state);

    expect(result.state.documentDecision).toBe('reject');
    expect(result.state.decisionQuality).toBe('incorrect');
    expect(result.state.mood).toBe('annoyed');
    expect(resolvedVariant.id).toBe('resolved-annoyed');
  });
});
