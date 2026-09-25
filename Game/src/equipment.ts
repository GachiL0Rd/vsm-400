import type { FireExtinguisherDefinition } from './content/objects';
import type { InspectionViewModel } from './inspection';

export type HeldItem = 'none' | 'fire-extinguisher';
export type ExtinguisherPosition = 'stored' | 'held';
export type ExtinguisherReadiness = 'safe' | 'prepared';
export type ExtinguisherInspectionActionId =
  | 'take-fire-extinguisher'
  | 'prepare-fire-extinguisher'
  | 'test-fire-extinguisher-handle';

export interface EquipmentState {
  readonly heldItem: HeldItem;
  readonly extinguisher: {
    readonly position: ExtinguisherPosition;
    readonly readiness: ExtinguisherReadiness;
  };
}

export interface EquipmentAction {
  readonly accepted: boolean;
  readonly message: string;
  readonly state: EquipmentState;
}

export function createEquipmentState(): EquipmentState {
  return {
    heldItem: 'none',
    extinguisher: {
      position: 'stored',
      readiness: 'safe',
    },
  };
}

export function takeFireExtinguisher(state: EquipmentState): EquipmentAction {
  if (state.heldItem !== 'none') {
    return reject(state, 'Нельзя взять второй предмет: в руке уже огнетушитель.');
  }

  return accept(
    {
      heldItem: 'fire-extinguisher',
      extinguisher: { ...state.extinguisher, position: 'held' },
    },
    'Огнетушитель взят в руку. Откройте его подробный осмотр, чтобы подготовить.',
  );
}

export function prepareFireExtinguisher(state: EquipmentState): EquipmentAction {
  if (state.heldItem !== 'fire-extinguisher') {
    return reject(state, 'Огнетушитель нужно сначала взять в руку.');
  }

  if (state.extinguisher.readiness === 'prepared') {
    return reject(state, 'Огнетушитель уже подготовлен.');
  }

  return accept(
    {
      ...state,
      extinguisher: { ...state.extinguisher, readiness: 'prepared' },
    },
    'Пломба снята: огнетушитель подготовлен к применению.',
  );
}

export function applyFireExtinguisher(state: EquipmentState): EquipmentAction {
  if (state.heldItem !== 'fire-extinguisher') {
    return reject(state, 'Нечего применять: огнетушитель не взят в руку.');
  }

  if (state.extinguisher.readiness !== 'prepared') {
    return reject(state, 'Рукоятка не поддаётся — огнетушитель не подготовлен.');
  }

  return accept(state, 'Огнетушитель подготовлен к применению.');
}

export function createFireExtinguisherInspection(
  definition: FireExtinguisherDefinition,
  state: EquipmentState,
): InspectionViewModel<ExtinguisherInspectionActionId> {
  const isHeld = state.extinguisher.position === 'held';
  const isPrepared = state.extinguisher.readiness === 'prepared';

  return {
    title: definition.inspectionTitle,
    description: definition.inspectionDescription,
    properties: [
      {
        label: definition.copy.positionProperty,
        value: isHeld ? definition.copy.heldValue : definition.copy.storedValue,
      },
      {
        label: definition.copy.readinessProperty,
        value: isPrepared ? definition.copy.preparedValue : definition.copy.safeValue,
        tone: isPrepared ? 'good' : 'neutral',
      },
    ],
    actions: [
      {
        id: 'take-fire-extinguisher',
        label: definition.copy.takeAction,
        enabled: state.heldItem === 'none',
        ...(state.heldItem !== 'none' ? { disabledReason: 'В руке уже есть предмет.' } : {}),
      },
      {
        id: 'prepare-fire-extinguisher',
        label: definition.copy.prepareAction,
        enabled: isHeld && !isPrepared,
        ...(!isHeld
          ? { disabledReason: 'Огнетушитель нужно сначала взять в руку.' }
          : isPrepared
            ? { disabledReason: 'Огнетушитель уже подготовлен.' }
            : {}),
      },
      {
        id: 'test-fire-extinguisher-handle',
        label: definition.copy.testHandleAction,
        enabled: true,
      },
    ],
  };
}

function accept(state: EquipmentState, message: string): EquipmentAction {
  return { accepted: true, message, state };
}

function reject(state: EquipmentState, message: string): EquipmentAction {
  return { accepted: false, message, state };
}
