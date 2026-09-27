import { z } from 'zod';

export const GAME_PROTOCOL_VERSION = 1 as const;
export const GAME_WEBSOCKET_PATH = '/game-ws' as const;

const idSchema = z.string().min(1);
const simTimeSchema = z.number().int().nonnegative();
const revisionSchema = z.number().int().nonnegative();
const jsonSchema = z.json();

export const publicTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cell'), cellId: idSchema }),
  z.object({ kind: z.literal('entity'), entityId: idSchema }),
  z.object({ kind: z.literal('object'), objectId: idSchema }),
]);
export type PublicTargetRef = z.infer<typeof publicTargetSchema>;

const liveModeSchema = z.object({ kind: z.literal('live') });
const guidedModeSchema = z.object({
  kind: z.literal('guided'),
  hints: z.object({
    immediateFeedback: z.boolean(),
    suggestions: z.boolean(),
    objectHighlights: z.boolean(),
    explanations: z.boolean(),
  }),
});
const replayModeSchema = z.object({
  kind: z.literal('replay'),
  capabilities: z.object({
    seek: z.boolean(),
    speeds: z.array(z.number().positive()),
    entityInspection: z.boolean(),
    revealTraits: z.boolean(),
    revealActionScores: z.boolean(),
    revealAssessment: z.boolean(),
  }),
});

export const sessionModeSchema = z.discriminatedUnion('kind', [
  liveModeSchema,
  guidedModeSchema,
  replayModeSchema,
]);
export type SessionModeView = z.infer<typeof sessionModeSchema>;

export const attemptPhaseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pre-departure') }),
  z.object({ kind: z.literal('origin-stop') }),
  z.object({ kind: z.literal('travel'), nextStopIndex: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal('stop'),
    stopIndex: z.number().int().nonnegative(),
    stopId: idSchema,
  }),
  z.object({ kind: z.literal('finished') }),
]);
export type PublicAttemptPhase = z.infer<typeof attemptPhaseSchema>;

export const terminationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('route-completed'), at: simTimeSchema }),
  z.object({
    kind: z.literal('terminal-rule'),
    at: simTimeSchema,
    ruleId: idSchema,
    outcomeId: idSchema,
  }),
]);
export type PublicTermination = z.infer<typeof terminationSchema>;

export const publicPositionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cell'), cellId: idSchema }),
  z.object({
    kind: z.literal('moving'),
    edgeId: idSchema,
    fromCellId: idSchema,
    toCellId: idSchema,
    startedAt: simTimeSchema,
    arrivesAt: simTimeSchema,
    progress: z.number().min(0).max(1),
  }),
  z.object({ kind: z.literal('attached'), anchorId: idSchema }),
]);
export type PublicPosition = z.infer<typeof publicPositionSchema>;

const publicHeldItemSchema = z.object({
  id: idSchema,
  visualId: idSchema,
});

export const publicEntitySchema = z.object({
  id: idSchema,
  kind: z.enum(['player', 'passenger']),
  appearanceId: idSchema,
  position: publicPositionSchema,
  heldItem: publicHeldItemSchema.optional(),
});
export type PublicEntityView = z.infer<typeof publicEntitySchema>;

const publicCellSchema = z.object({
  id: idSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  regionId: idSchema,
});

const publicEdgeSchema = z.object({
  id: idSchema,
  fromCellId: idSchema,
  toCellId: idSchema,
});

const publicObjectSchema = z.object({
  id: idSchema,
  kind: idSchema,
  visualId: idSchema,
  cellId: idSchema,
});
export type PublicObjectView = z.infer<typeof publicObjectSchema>;

const publicRegionSchema = z.object({
  id: idSchema,
  visualId: idSchema.optional(),
});

export const publicWorldSchema = z.object({
  regions: z.array(publicRegionSchema),
  cells: z.array(publicCellSchema),
  edges: z.array(publicEdgeSchema),
  objects: z.array(publicObjectSchema),
});
export type PublicWorldView = z.infer<typeof publicWorldSchema>;

export const publicClockSchema = z.object({
  timeScale: z.number().positive(),
  paused: z.boolean(),
});
export type PublicClockView = z.infer<typeof publicClockSchema>;

export const publicGameStateSchema = z.object({
  attemptId: idSchema,
  revision: revisionSchema,
  timeUs: simTimeSchema,
  clock: publicClockSchema,
  mode: sessionModeSchema,
  phase: attemptPhaseSchema,
  termination: terminationSchema.nullable(),
  activeRegionIds: z.array(idSchema),
  world: publicWorldSchema,
  entities: z.array(publicEntitySchema),
});
export type PublicGameState = z.infer<typeof publicGameStateSchema>;

export const gameSnapshotSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('snapshot'),
  state: publicGameStateSchema,
});
export type GameSnapshotMessage = z.infer<typeof gameSnapshotSchema>;

const entityDeltaSchema = z.object({
  upsert: z.array(publicEntitySchema),
  removeIds: z.array(idSchema),
});

export const publicStateDeltaSchema = z.object({
  timeUs: simTimeSchema.optional(),
  clock: publicClockSchema.optional(),
  phase: attemptPhaseSchema.optional(),
  termination: terminationSchema.nullable().optional(),
  activeRegionIds: z.array(idSchema).optional(),
  world: publicWorldSchema.optional(),
  entities: entityDeltaSchema.optional(),
});
export type PublicStateDelta = z.infer<typeof publicStateDeltaSchema>;

export const gameDeltaSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('delta'),
  attemptId: idSchema,
  baseRevision: revisionSchema,
  revision: revisionSchema,
  changes: publicStateDeltaSchema,
});
export type GameDeltaMessage = z.infer<typeof gameDeltaSchema>;

export const availableActionSchema = z.object({
  handle: idSchema,
  uiKind: z.enum(['interaction', 'inspect', 'dialogue', 'form']),
  label: z.string().min(1),
  target: publicTargetSchema,
});
export type AvailableActionView = z.infer<typeof availableActionSchema>;

export const helloCommandSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('hello'),
  requestId: idSchema,
  sessionKey: idSchema.optional(),
  resumeToken: idSchema.optional(),
});

export const moveToCommandSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('move-to'),
  requestId: idSchema,
  knownRevision: revisionSchema,
  targetCellId: idSchema,
});

export type MoveToCommand = z.infer<typeof moveToCommandSchema>;

export const queryActionsCommandSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('query-actions'),
  requestId: idSchema,
  knownRevision: revisionSchema,
  target: publicTargetSchema,
});
export type QueryActionsCommand = z.infer<typeof queryActionsCommandSchema>;

export const invokeActionCommandSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('invoke-action'),
  requestId: idSchema,
  knownRevision: revisionSchema,
  actionHandle: idSchema,
  input: jsonSchema.optional(),
});
export type InvokeActionCommand = z.infer<typeof invokeActionCommandSchema>;

export const setTimeScaleCommandSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('set-time-scale'),
  requestId: idSchema,
  knownRevision: revisionSchema,
  scale: z.number().positive(),
});

export const resyncCommandSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('resync'),
  requestId: idSchema,
  knownRevision: revisionSchema.optional(),
});

export const clientCommandSchema = z.discriminatedUnion('type', [
  helloCommandSchema,
  moveToCommandSchema,
  queryActionsCommandSchema,
  invokeActionCommandSchema,
  setTimeScaleCommandSchema,
  resyncCommandSchema,
]);
export type ClientCommand = z.infer<typeof clientCommandSchema>;

export const actionOfferSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('action-offer'),
  requestId: idSchema,
  revision: revisionSchema,
  target: publicTargetSchema,
  actions: z.array(availableActionSchema),
});
export type ActionOfferMessage = z.infer<typeof actionOfferSchema>;

const commandAcceptedSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('command-result'),
  requestId: idSchema,
  status: z.literal('accepted'),
  revision: revisionSchema,
});

const commandRejectedSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('command-result'),
  requestId: idSchema,
  status: z.literal('rejected'),
  revision: revisionSchema,
  code: z.enum([
    'stale-revision',
    'unknown-action',
    'invalid-input',
    'action-rejected',
    'unsupported-command',
  ]),
  message: z.string().min(1),
});

export const commandResultSchema = z.discriminatedUnion('status', [
  commandAcceptedSchema,
  commandRejectedSchema,
]);
export type CommandResultMessage = z.infer<typeof commandResultSchema>;

const hintEventSchema = z.object({
  kind: z.literal('hint'),
  hintId: idSchema,
  presentation: z.enum(['message', 'toast', 'highlight']),
  text: z.string().optional(),
  target: publicTargetSchema.optional(),
});
const speechEventSchema = z.object({
  kind: z.literal('speech'),
  entityId: idSchema,
  text: z.string(),
  visible: z.boolean(),
});
const notificationEventSchema = z.object({
  kind: z.literal('notification'),
  notificationId: idSchema,
  text: z.string(),
});
const achievementEventSchema = z.object({
  kind: z.literal('achievement-unlocked'),
  achievementId: idSchema,
});
const effectEventSchema = z.object({
  kind: z.literal('effect'),
  effectId: idSchema,
  visualId: idSchema,
  target: publicTargetSchema.optional(),
});

export const presentationEventPayloadSchema = z.discriminatedUnion('kind', [
  hintEventSchema,
  speechEventSchema,
  notificationEventSchema,
  achievementEventSchema,
  effectEventSchema,
]);
export type PresentationEventPayload = z.infer<typeof presentationEventPayloadSchema>;

export const presentationEventSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('presentation-event'),
  attemptId: idSchema,
  at: simTimeSchema,
  sequence: z.number().int().nonnegative(),
  event: presentationEventPayloadSchema,
  extensions: z.array(z.object({ type: idSchema, data: jsonSchema })).optional(),
});
export type PresentationEventMessage = z.infer<typeof presentationEventSchema>;

export const sessionReadySchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('session-ready'),
  attemptId: idSchema,
  resumeToken: idSchema.optional(),
  snapshot: gameSnapshotSchema,
});

export const sessionStateSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('session-state'),
  attemptId: idSchema,
  state: z.enum(['active', 'paused', 'finishing', 'finished', 'aborted']),
  redirectUrl: z.string().url().optional(),
});

export const serverErrorSchema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  type: z.literal('error'),
  requestId: idSchema.optional(),
  code: idSchema,
  message: z.string().min(1),
});

export const serverMessageSchema = z.union([
  sessionReadySchema,
  gameSnapshotSchema,
  gameDeltaSchema,
  actionOfferSchema,
  commandResultSchema,
  presentationEventSchema,
  sessionStateSchema,
  serverErrorSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
