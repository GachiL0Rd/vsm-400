export type PassengerActivity = 'waiting-on-platform' | 'boarding' | 'seated';
export type DocumentDecision = 'pending' | 'admit' | 'reject';
export type DecisionQuality = 'unassessed' | 'correct' | 'incorrect';
export type PassengerAttention = 'low' | 'normal' | 'high';
export type PassengerMood = 'calm' | 'neutral' | 'annoyed';

export interface PassengerDocument {
  readonly fullName: string;
  readonly documentNumber: string;
  readonly birthDate: string;
}

export interface PassengerTicket {
  readonly fullName: string;
  readonly train: string;
  readonly carriage: string;
  readonly seat: string;
}

export interface PassengerBehaviourStep {
  readonly atSeconds: number;
  readonly activity: PassengerActivity;
}

export interface PassengerDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly traits: {
    readonly attention: PassengerAttention;
    readonly initialMood: PassengerMood;
  };
  readonly document: PassengerDocument;
  readonly ticket: PassengerTicket;
  readonly behaviour: {
    readonly timeline: readonly PassengerBehaviourStep[];
  };
  readonly dialogueSetId: string;
}

export interface PassengerState {
  readonly passengerId: string;
  readonly activity: PassengerActivity;
  readonly attention: PassengerAttention;
  readonly mood: PassengerMood;
  readonly documentDecision: DocumentDecision;
  readonly decisionQuality: DecisionQuality;
}

export interface PassengerDecisionAction {
  readonly accepted: boolean;
  readonly message: string;
  readonly state: PassengerState;
}

export function createPassengerState(definition: PassengerDefinition): PassengerState {
  return {
    passengerId: definition.id,
    activity: 'waiting-on-platform',
    attention: definition.traits.attention,
    mood: definition.traits.initialMood,
    documentDecision: 'pending',
    decisionQuality: 'unassessed',
  };
}

export function advancePassenger(
  definition: PassengerDefinition,
  state: PassengerState,
  elapsedSeconds: number,
): PassengerState {
  if (elapsedSeconds < 0) {
    throw new Error('elapsedSeconds cannot be negative.');
  }

  let activity = state.activity;
  for (const step of definition.behaviour.timeline) {
    if (elapsedSeconds >= step.atSeconds) {
      activity = step.activity;
    }
  }

  if (activity === state.activity) {
    return state;
  }

  return { ...state, activity };
}

export function decideDocuments(
  definition: PassengerDefinition,
  state: PassengerState,
  decision: Exclude<DocumentDecision, 'pending'>,
): PassengerDecisionAction {
  if (state.documentDecision !== 'pending') {
    return {
      accepted: false,
      message: 'Решение по документам уже зафиксировано.',
      state,
    };
  }

  const shouldAdmit = documentsMatch(definition);
  const decisionQuality: DecisionQuality =
    (decision === 'admit') === shouldAdmit ? 'correct' : 'incorrect';

  const mood: PassengerMood =
    decisionQuality === 'correct'
      ? decision === 'admit'
        ? 'calm'
        : 'neutral'
      : 'annoyed';

  const message =
    decisionQuality === 'correct'
      ? `Решение по документам ${decision === 'admit' ? 'допустить' : 'отказать'} отмечено как корректное.`
      : `Решение по документам ${decision === 'admit' ? 'допустить' : 'отказать'} отмечено как ошибка, но симуляция продолжается.`;

  return {
    accepted: true,
    message,
    state: {
      ...state,
      mood,
      documentDecision: decision,
      decisionQuality,
    },
  };
}

export function setPassengerMood(state: PassengerState, mood: PassengerMood): PassengerState {
  return state.mood === mood ? state : { ...state, mood };
}

export function documentsMatch(definition: PassengerDefinition): boolean {
  return definition.document.fullName.trim() === definition.ticket.fullName.trim();
}
