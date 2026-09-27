import type { ActionContent } from './action-decision';

/**
 * Minimal behavior content used by the first authoritative server slice.
 * It intentionally covers only wait/service-request/consume loops; world and
 * player interaction actions are added by later server integration patches.
 */
export const BASELINE_ACTION_CONTENT = {
  actions: [
    {
      id: 'wait',
      handler: 'wait',
      baseLogit: 0,
      params: { durationSeconds: 15 },
    },
    {
      id: 'request-drink',
      handler: 'request-item',
      baseLogit: -2,
      params: {
        itemKind: 'drink',
        waitingTrait: 'waiting-drink',
        timeoutSeconds: 120,
        receivedTrait: 'has-drink',
        timeoutTrait: 'annoyed',
      },
    },
    {
      id: 'request-food',
      handler: 'request-item',
      baseLogit: -2,
      params: {
        itemKind: 'food',
        waitingTrait: 'waiting-food',
        timeoutSeconds: 180,
        receivedTrait: 'has-food',
        timeoutTrait: 'annoyed',
      },
    },
    {
      id: 'drink',
      handler: 'consume-item',
      baseLogit: 5,
      params: {
        consumeTrait: 'has-drink',
        satisfyTrait: 'thirsty',
        durationSeconds: 10,
      },
      precondition: { op: 'trait', traitId: 'has-drink' },
    },
    {
      id: 'eat',
      handler: 'consume-item',
      baseLogit: 5,
      params: {
        consumeTrait: 'has-food',
        satisfyTrait: 'hungry',
        durationSeconds: 30,
      },
      precondition: { op: 'trait', traitId: 'has-food' },
    },
  ],
  traits: [
    { id: 'basic' },
    {
      id: 'comfort',
      logitModifiers: [
        { actionId: 'request-drink', curve: { kind: 'constant', value: 0.3 } },
        { actionId: 'request-food', curve: { kind: 'constant', value: 0.3 } },
      ],
    },
    {
      id: 'business',
      logitModifiers: [
        { actionId: 'request-drink', curve: { kind: 'constant', value: 0.8 } },
        { actionId: 'request-food', curve: { kind: 'constant', value: 0.8 } },
      ],
    },
    { id: 'awake' },
    {
      id: 'hungry',
      addActions: ['request-food'],
      logitModifiers: [{ actionId: 'request-food', curve: { kind: 'constant', value: 4 } }],
    },
    {
      id: 'thirsty',
      addActions: ['request-drink'],
      logitModifiers: [{ actionId: 'request-drink', curve: { kind: 'constant', value: 4 } }],
    },
    {
      id: 'impatient',
      logitModifiers: [
        { actionId: 'request-drink', curve: { kind: 'constant', value: 0.4 } },
        { actionId: 'request-food', curve: { kind: 'constant', value: 0.4 } },
      ],
    },
    { id: 'waiting-drink', blacklistActions: [{ op: 'id', id: 'request-drink' }] },
    { id: 'waiting-food', blacklistActions: [{ op: 'id', id: 'request-food' }] },
    { id: 'has-drink', addActions: ['drink'] },
    { id: 'has-food', addActions: ['eat'] },
    { id: 'annoyed' },
  ],
  baseActions: {
    player: ['wait'],
    passenger: ['wait'],
  },
} as const satisfies ActionContent;
