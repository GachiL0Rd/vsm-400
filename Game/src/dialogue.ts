import {
  decideDocuments,
  setPassengerMood,
  type DocumentDecision,
  type PassengerDefinition,
  type PassengerMood,
  type PassengerState,
} from './passenger';

export interface PassengerCondition {
  readonly activity?: PassengerState['activity'];
  readonly attention?: PassengerState['attention'];
  readonly mood?: PassengerMood;
  readonly documentDecision?: PassengerState['documentDecision'];
}

export type DialogueEffect =
  | {
      readonly kind: 'document-decision';
      readonly decision: Exclude<DocumentDecision, 'pending'>;
    }
  | {
      readonly kind: 'set-mood';
      readonly mood: PassengerMood;
    };

export interface DialogueOption {
  readonly id: string;
  readonly label: string;
  readonly effects: readonly DialogueEffect[];
}

export interface DialogueVariant {
  readonly id: string;
  readonly when?: PassengerCondition;
  readonly passengerLines: readonly string[];
  readonly options: readonly DialogueOption[];
}

export interface DialogueSet {
  readonly id: string;
  readonly variants: readonly DialogueVariant[];
}

export interface DialogueResult {
  readonly accepted: boolean;
  readonly message: string;
  readonly state: PassengerState;
}

export function selectDialogueVariant(
  dialogue: DialogueSet,
  state: PassengerState,
): DialogueVariant {
  const variant = dialogue.variants.find((candidate) => matchesCondition(candidate.when, state));
  if (variant === undefined) {
    throw new Error(`Dialogue set "${dialogue.id}" has no matching variant.`);
  }
  return variant;
}

export function applyDialogueOption(
  definition: PassengerDefinition,
  state: PassengerState,
  option: DialogueOption,
): DialogueResult {
  let nextState = state;
  const messages: string[] = [];

  for (const effect of option.effects) {
    switch (effect.kind) {
      case 'document-decision': {
        const action = decideDocuments(definition, nextState, effect.decision);
        if (!action.accepted) {
          return action;
        }
        nextState = action.state;
        messages.push(action.message);
        break;
      }
      case 'set-mood':
        nextState = setPassengerMood(nextState, effect.mood);
        messages.push(`Настроение пассажира: ${moodLabel(effect.mood)}.`);
        break;
    }
  }

  return {
    accepted: true,
    message: messages.join(' '),
    state: nextState,
  };
}

function matchesCondition(condition: PassengerCondition | undefined, state: PassengerState): boolean {
  if (condition === undefined) {
    return true;
  }

  return (
    (condition.activity === undefined || condition.activity === state.activity) &&
    (condition.attention === undefined || condition.attention === state.attention) &&
    (condition.mood === undefined || condition.mood === state.mood) &&
    (condition.documentDecision === undefined ||
      condition.documentDecision === state.documentDecision)
  );
}

function moodLabel(mood: PassengerMood): string {
  switch (mood) {
    case 'calm':
      return 'спокойное';
    case 'neutral':
      return 'нейтральное';
    case 'annoyed':
      return 'раздражённое';
  }
}
