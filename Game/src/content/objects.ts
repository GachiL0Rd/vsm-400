export interface InspectableObjectDefinition {
  readonly id: string;
  readonly worldLabel: string;
  readonly interactionPrompt: string;
  readonly inspectionTitle: string;
  readonly inspectionDescription: string;
}

export interface PressureSensorDefinition extends InspectableObjectDefinition {
  readonly copy: {
    readonly indicatorProperty: string;
    readonly uncheckedValue: string;
    readonly normalValue: string;
    readonly warningValue: string;
    readonly checkAction: string;
    readonly checkedAction: string;
    readonly checkedReason: string;
    readonly footer: string;
  };
}

export interface FireExtinguisherDefinition extends InspectableObjectDefinition {
  readonly copy: {
    readonly positionProperty: string;
    readonly readinessProperty: string;
    readonly storedValue: string;
    readonly heldValue: string;
    readonly safeValue: string;
    readonly preparedValue: string;
    readonly takeAction: string;
    readonly prepareAction: string;
    readonly testHandleAction: string;
  };
}

export const PRESSURE_SENSOR_DEFINITION = {
  id: 'pressure-sensor',
  worldLabel: 'Датчик',
  interactionPrompt: 'Датчик: клик — подробный осмотр',
  inspectionTitle: 'Детальный осмотр: датчик давления',
  inspectionDescription: 'Статичный вид панели контроля давления.',
  copy: {
    indicatorProperty: 'Индикатор',
    uncheckedValue: 'Не проверен',
    normalValue: 'Давление в норме',
    warningValue: 'Есть отклонение',
    checkAction: 'Проверить индикатор давления',
    checkedAction: 'Индикатор уже проверен',
    checkedReason: 'Повторная проверка не требуется.',
    footer: 'Мир и игровые часы продолжают идти во время осмотра.',
  },
} as const satisfies PressureSensorDefinition;

export const FIRE_EXTINGUISHER_DEFINITION = {
  id: 'fire-extinguisher',
  worldLabel: 'Огнетушитель',
  interactionPrompt: 'Огнетушитель: клик — подробный осмотр',
  inspectionTitle: 'Детальный осмотр: огнетушитель',
  inspectionDescription: 'Состояние переносного огнетушителя и доступные действия.',
  copy: {
    positionProperty: 'Положение',
    readinessProperty: 'Состояние',
    storedValue: 'На креплении',
    heldValue: 'В руке проводника',
    safeValue: 'Пломба установлена',
    preparedValue: 'Подготовлен',
    takeAction: 'Взять огнетушитель в руку',
    prepareAction: 'Снять пломбу и подготовить',
    testHandleAction: 'Проверить рукоятку',
  },
} as const satisfies FireExtinguisherDefinition;
