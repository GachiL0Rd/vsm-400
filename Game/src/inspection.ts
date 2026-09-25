export type InspectionTone = 'neutral' | 'good' | 'warning';

export interface InspectionProperty {
  readonly label: string;
  readonly value: string;
  readonly tone?: InspectionTone;
}

export interface InspectionActionDefinition<ActionId extends string = string> {
  readonly id: ActionId;
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}

export interface InspectionViewModel<ActionId extends string = string> {
  readonly title: string;
  readonly description?: string;
  readonly properties: readonly InspectionProperty[];
  readonly actions: readonly InspectionActionDefinition<ActionId>[];
  readonly footer?: string;
}
