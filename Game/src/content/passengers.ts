import type { PassengerDefinition } from '../passenger';

export const DEMO_PASSENGER = {
  id: 'alexey-voronov',
  displayName: 'Алексей Воронов',
  traits: {
    attention: 'normal',
    initialMood: 'calm',
  },
  document: {
    fullName: 'Алексей Воронов',
    documentNumber: '40 18 735214',
    birthDate: '14.02.1992',
  },
  ticket: {
    fullName: 'Алексей Воронов',
    train: 'ВСМ 001',
    carriage: '04',
    seat: '18A',
  },
  behaviour: {
    timeline: [
      { atSeconds: 9, activity: 'boarding' },
      { atSeconds: 15, activity: 'seated' },
    ],
  },
  dialogueSetId: 'boarding-documents',
} as const satisfies PassengerDefinition;
