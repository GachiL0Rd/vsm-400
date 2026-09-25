import type { EquipmentState } from './equipment';

export type FireStatus = 'dormant' | 'active' | 'severe' | 'resolved';
export type FireResponseQuality = 'unassessed' | 'correct' | 'late' | 'incorrect' | 'missed';

export interface FireIncidentState {
  readonly status: FireStatus;
  readonly everSevere: boolean;
  readonly responseQuality: FireResponseQuality;
  readonly failedAttempts: number;
}

export interface FireAction {
  readonly accepted: boolean;
  readonly message: string;
  readonly state: FireIncidentState;
}

export const FIRE_STARTS_AT_SECONDS = 32;
export const FIRE_BECOMES_SEVERE_AT_SECONDS = 46;
export const SIMULATION_CAN_END_AT_SECONDS = 58;

export function createFireIncidentState(): FireIncidentState {
  return {
    status: 'dormant',
    everSevere: false,
    responseQuality: 'unassessed',
    failedAttempts: 0,
  };
}

export function advanceFireIncident(
  state: FireIncidentState,
  elapsedSeconds: number,
): FireIncidentState {
  if (elapsedSeconds < 0) {
    throw new Error('elapsedSeconds cannot be negative.');
  }

  if (state.status === 'resolved') {
    return state;
  }

  if (elapsedSeconds >= FIRE_BECOMES_SEVERE_AT_SECONDS) {
    if (state.status === 'severe' && state.everSevere) {
      return state;
    }

    return {
      ...state,
      status: 'severe',
      everSevere: true,
      responseQuality: state.responseQuality === 'unassessed' ? 'missed' : state.responseQuality,
    };
  }

  if (elapsedSeconds >= FIRE_STARTS_AT_SECONDS && state.status === 'dormant') {
    return { ...state, status: 'active' };
  }

  return state;
}

export function attemptToExtinguishFire(
  state: FireIncidentState,
  equipment: EquipmentState,
): FireAction {
  if (state.status === 'dormant') {
    return reject(state, 'Очаг ещё не возник: применять огнетушитель не к чему.');
  }

  if (state.status === 'resolved') {
    return reject(state, 'Очаг уже потушен.');
  }

  if (
    equipment.heldItem !== 'fire-extinguisher' ||
    equipment.extinguisher.readiness !== 'prepared'
  ) {
    return {
      accepted: false,
      message: 'Тушение не удалось: нужен подготовленный огнетушитель в руке.',
      state: {
        ...state,
        failedAttempts: state.failedAttempts + 1,
        responseQuality:
          state.responseQuality === 'unassessed' ? 'incorrect' : state.responseQuality,
      },
    };
  }

  return {
    accepted: true,
    message:
      state.status === 'severe'
        ? 'Очаг потушен, но пожар уже успел ухудшиться.'
        : 'Очаг потушен до ухудшения.',
    state: {
      ...state,
      status: 'resolved',
      responseQuality: state.everSevere || state.status === 'severe' ? 'late' : 'correct',
    },
  };
}

function reject(state: FireIncidentState, message: string): FireAction {
  return { accepted: false, message, state };
}
