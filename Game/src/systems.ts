import type { PressureSensorDefinition } from './content/objects';
import type { InspectionViewModel } from './inspection';

export type PressureLevel = 'normal' | 'warning';
export type PressureSensorActionId = 'check-pressure-indicator';

export interface PressureSystemState {
  readonly level: PressureLevel;
  readonly quickInspected: boolean;
  readonly indicatorChecked: boolean;
}

export interface PressureSystemAction {
  readonly accepted: boolean;
  readonly message: string;
  readonly state: PressureSystemState;
}

export function createPressureSystemState(): PressureSystemState {
  return {
    level: 'normal',
    quickInspected: false,
    indicatorChecked: false,
  };
}

export function quickInspectPressureSystem(state: PressureSystemState): PressureSystemAction {
  if (state.quickInspected) {
    return {
      accepted: false,
      message: 'Датчик уже быстро осмотрен.',
      state,
    };
  }

  return {
    accepted: true,
    message: 'Быстрый осмотр датчика выполнен. Для точной проверки откройте подробный осмотр.',
    state: { ...state, quickInspected: true },
  };
}

export function inspectPressureIndicator(state: PressureSystemState): PressureSystemAction {
  if (state.indicatorChecked) {
    return {
      accepted: false,
      message: 'Индикатор давления уже проверен.',
      state,
    };
  }

  return {
    accepted: true,
    message:
      state.level === 'normal'
        ? 'Детальный осмотр: индикатор давления в норме.'
        : 'Детальный осмотр: индикатор показывает отклонение давления.',
    state: { ...state, indicatorChecked: true },
  };
}

export function createPressureInspection(
  definition: PressureSensorDefinition,
  state: PressureSystemState,
): InspectionViewModel<PressureSensorActionId> {
  return {
    title: definition.inspectionTitle,
    description: definition.inspectionDescription,
    properties: [
      {
        label: definition.copy.indicatorProperty,
        value: state.indicatorChecked
          ? pressureLevelLabel(definition, state.level)
          : definition.copy.uncheckedValue,
        tone: state.indicatorChecked ? (state.level === 'normal' ? 'good' : 'warning') : 'neutral',
      },
    ],
    actions: [
      {
        id: 'check-pressure-indicator',
        label: state.indicatorChecked ? definition.copy.checkedAction : definition.copy.checkAction,
        enabled: !state.indicatorChecked,
        ...(state.indicatorChecked ? { disabledReason: definition.copy.checkedReason } : {}),
      },
    ],
    footer: definition.copy.footer,
  };
}

function pressureLevelLabel(definition: PressureSensorDefinition, level: PressureLevel): string {
  switch (level) {
    case 'normal':
      return definition.copy.normalValue;
    case 'warning':
      return definition.copy.warningValue;
  }
}
