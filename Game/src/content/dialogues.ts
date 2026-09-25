import type { DialogueSet } from '../dialogue';

export const BOARDING_DOCUMENTS_DIALOGUE = {
  id: 'boarding-documents',
  variants: [
    {
      id: 'pending-annoyed',
      when: { documentDecision: 'pending', mood: 'annoyed' },
      passengerLines: ['— Я уже всё подготовил. Вот билет и документ.'],
      options: [
        {
          id: 'admit',
          label: 'Допустить',
          effects: [{ kind: 'document-decision', decision: 'admit' }],
        },
        {
          id: 'reject',
          label: 'Отказать',
          effects: [{ kind: 'document-decision', decision: 'reject' }],
        },
      ],
    },
    {
      id: 'pending-attentive',
      when: { documentDecision: 'pending', attention: 'high' },
      passengerLines: [
        '— Добрый день. Билет и документ здесь. Имя и номер вагона можно сверить сразу.',
      ],
      options: [
        {
          id: 'admit',
          label: 'Допустить',
          effects: [{ kind: 'document-decision', decision: 'admit' }],
        },
        {
          id: 'reject',
          label: 'Отказать',
          effects: [{ kind: 'document-decision', decision: 'reject' }],
        },
      ],
    },
    {
      id: 'pending-default',
      when: { documentDecision: 'pending' },
      passengerLines: ['— Добрый день. Вот билет и документ.'],
      options: [
        {
          id: 'admit',
          label: 'Допустить',
          effects: [{ kind: 'document-decision', decision: 'admit' }],
        },
        {
          id: 'reject',
          label: 'Отказать',
          effects: [{ kind: 'document-decision', decision: 'reject' }],
        },
      ],
    },
    {
      id: 'resolved-annoyed',
      when: { mood: 'annoyed' },
      passengerLines: ['— Понятно. Решение уже принято.'],
      options: [],
    },
    {
      id: 'resolved-default',
      passengerLines: ['— Спасибо. Решение уже принято, я продолжу поездку.'],
      options: [],
    },
  ],
} as const satisfies DialogueSet;

export const DIALOGUE_SETS: Readonly<Record<string, DialogueSet>> = {
  [BOARDING_DOCUMENTS_DIALOGUE.id]: BOARDING_DOCUMENTS_DIALOGUE,
};

export function getDialogueSet(id: string): DialogueSet {
  const dialogue = DIALOGUE_SETS[id];
  if (dialogue === undefined) {
    throw new Error(`Unknown dialogue set: ${id}`);
  }
  return dialogue;
}
