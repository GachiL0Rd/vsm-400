/** Public, observable wire contract. No latent NPC, fault, RNG or scoring inputs belong here. */
export const PROTOCOL_VERSION = 1;

export type ZoneId = 'platform' | 'vestibule' | 'cabin' | 'service';
export type PoiKind = 'door' | 'seat' | 'panel' | 'extinguisher' | 'fire' | 'service' | 'toilet';
export type IntentKind = 'wait' | 'walk' | 'sit' | 'call' | 'complain' | 'inspect' | 'react';
export type CueKind = 'speech' | 'call' | 'whistle' | 'pressure' | 'smoke' | 'fire' | 'notice';
export type TaskState = 'open' | 'completed' | 'failed';
export type ItemState = 'stored' | 'held' | 'prepared' | 'used';
export type ActionKind =
  | 'move-zone'
  | 'inspect'
  | 'interact'
  | 'talk'
  | 'dialogue-choice'
  | 'take-item'
  | 'use-item'
  | 'report'
  | 'complete-task'
  | 'dev-control'
  | 'finish';

export interface ActionView {
  id: string;
  kind: ActionKind;
  label: string;
  enabled: boolean;
  disabledReason?: string;
}

export interface PoiView {
  id: string;
  kind: PoiKind;
  label: string;
  zoneId: ZoneId;
  observation?: string;
  actions: ActionView[];
}

export interface NpcView {
  id: string;
  label: string;
  zoneId: ZoneId;
  anchorId: string;
  intent: { kind: IntentKind; targetId: string; sequence: number };
  speech?: string;
  actions: ActionView[];
}

export interface CueView {
  id: string;
  kind: CueKind;
  text: string;
  anchorId?: string;
  sourceId?: string;
}

export interface TaskView {
  id: string;
  sourceId: string;
  title: string;
  targetId: string;
  urgency: 'normal' | 'urgent';
  state: TaskState;
  softDeadline: number;
  hardDeadline: number;
  actions: ActionView[];
}

export interface DialogueView {
  id: string;
  npcId: string;
  title: string;
  lines: string[];
  level: 1 | 2;
  options: { id: string; label: string; enabled: boolean; disabledReason?: string }[];
  document?: { fullName: string; number: string; birthDate: string };
  ticket?: { fullName: string; train: string; carriage: string; seat: string };
}

export interface DebriefView {
  title: string;
  safety: number;
  satisfaction: number;
  process: string[];
  outcome: string[];
}

export interface ObservableSnapshot {
  sessionId: string;
  revision: number;
  simulationTime: number;
  phase: 'boarding' | 'ride' | 'finished';
  playerZone: ZoneId;
  message: string;
  poi: PoiView[];
  npcs: NpcView[];
  cues: CueView[];
  tasks: TaskView[];
  dialogue: DialogueView | null;
  item: ItemState;
  metrics: { safety: number; satisfaction: number } | null;
  debrief: DebriefView | null;
  controls?: { speed: 0 | 1 | 3 };
}

export type SnapshotPatch = Partial<Omit<ObservableSnapshot, 'sessionId' | 'revision'>>;
export type ServerMessage =
  | { type: 'snapshot'; protocolVersion: 1; state: ObservableSnapshot }
  | { type: 'delta'; protocolVersion: 1; sessionId: string; revision: number; patch: SnapshotPatch }
  | { type: 'ack'; protocolVersion: 1; sessionId: string; requestId: string; revision: number }
  | { type: 'reject'; protocolVersion: 1; sessionId: string; requestId: string; reason: string };

export type ClientMessage =
  | { type: 'hello'; protocolVersion: 1; sessionId?: string }
  | { type: 'resync'; protocolVersion: 1; sessionId: string; afterRevision: number }
  | {
      type: 'command';
      protocolVersion: 1;
      sessionId: string;
      requestId: string;
      baseRevision: number;
      kind: ActionKind;
      targetId?: string;
      optionId?: string;
      zoneId?: ZoneId;
      inspection?: 'quick' | 'full';
      speed?: 0 | 1 | 3;
    };

type RecordValue = Record<string, unknown>;
const ZONES: ZoneId[] = ['platform', 'vestibule', 'cabin', 'service'];
const POI_KINDS: PoiKind[] = ['door', 'seat', 'panel', 'extinguisher', 'fire', 'service', 'toilet'];
const INTENTS: IntentKind[] = ['wait', 'walk', 'sit', 'call', 'complain', 'inspect', 'react'];
const CUES: CueKind[] = ['speech', 'call', 'whistle', 'pressure', 'smoke', 'fire', 'notice'];
const TASK_STATES: TaskState[] = ['open', 'completed', 'failed'];
const ITEMS: ItemState[] = ['stored', 'held', 'prepared', 'used'];
const ACTIONS: ActionKind[] = [
  'move-zone',
  'inspect',
  'interact',
  'talk',
  'dialogue-choice',
  'take-item',
  'use-item',
  'report',
  'complete-task',
  'dev-control',
  'finish',
];

function record(value: unknown): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected object');
  }
  return value as RecordValue;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected string');
  return value;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Expected finite number');
  return value;
}

function integer(value: unknown): number {
  const result = number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Expected nonnegative integer');
  return result;
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected boolean');
  return value;
}

function choice<T extends string>(value: unknown, options: readonly T[]): T {
  const result = string(value);
  if (!options.includes(result as T)) throw new Error(`Unsupported value: ${result}`);
  return result as T;
}

function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Expected array');
  return value.map(parse);
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : string(value);
}

function action(value: unknown): ActionView {
  const data = record(value);
  const result: ActionView = {
    id: string(data.id),
    kind: choice(data.kind, ACTIONS),
    label: string(data.label),
    enabled: flag(data.enabled),
  };
  const reason = optionalString(data.disabledReason);
  if (reason !== undefined) result.disabledReason = reason;
  return result;
}

function poi(value: unknown): PoiView {
  const data = record(value);
  const result: PoiView = {
    id: string(data.id),
    kind: choice(data.kind, POI_KINDS),
    label: string(data.label),
    zoneId: choice(data.zoneId, ZONES),
    actions: list(data.actions, action),
  };
  const observation = optionalString(data.observation);
  if (observation !== undefined) result.observation = observation;
  return result;
}

function npc(value: unknown): NpcView {
  const data = record(value);
  const intent = record(data.intent);
  const result: NpcView = {
    id: string(data.id),
    label: string(data.label),
    zoneId: choice(data.zoneId, ZONES),
    anchorId: string(data.anchorId),
    intent: {
      kind: choice(intent.kind, INTENTS),
      targetId: string(intent.targetId),
      sequence: integer(intent.sequence),
    },
    actions: list(data.actions, action),
  };
  const speech = optionalString(data.speech);
  if (speech !== undefined) result.speech = speech;
  return result;
}

function cue(value: unknown): CueView {
  const data = record(value);
  const result: CueView = {
    id: string(data.id),
    kind: choice(data.kind, CUES),
    text: string(data.text),
  };
  const anchorId = optionalString(data.anchorId);
  if (anchorId !== undefined) result.anchorId = anchorId;
  const sourceId = optionalString(data.sourceId);
  if (sourceId !== undefined) result.sourceId = sourceId;
  return result;
}

function task(value: unknown): TaskView {
  const data = record(value);
  return {
    id: string(data.id),
    sourceId: string(data.sourceId),
    title: string(data.title),
    targetId: string(data.targetId),
    urgency: choice(data.urgency, ['normal', 'urgent']),
    state: choice(data.state, TASK_STATES),
    softDeadline: number(data.softDeadline),
    hardDeadline: number(data.hardDeadline),
    actions: list(data.actions, action),
  };
}

function dialogue(value: unknown): DialogueView | null {
  if (value === null) return null;
  const data = record(value);
  const level = number(data.level);
  if (level !== 1 && level !== 2) throw new Error('Unsupported dialogue depth');
  const options = list(data.options, (entry) => {
    const option = record(entry);
    const result: DialogueView['options'][number] = {
      id: string(option.id),
      label: string(option.label),
      enabled: flag(option.enabled),
    };
    const reason = optionalString(option.disabledReason);
    if (reason !== undefined) result.disabledReason = reason;
    return result;
  });
  if (options.length > 3) throw new Error('Too many dialogue options');
  const result: DialogueView = {
    id: string(data.id),
    npcId: string(data.npcId),
    title: string(data.title),
    lines: list(data.lines, string),
    level,
    options,
  };
  if (data.document !== undefined) {
    const document = record(data.document);
    result.document = {
      fullName: string(document.fullName),
      number: string(document.number),
      birthDate: string(document.birthDate),
    };
  }
  if (data.ticket !== undefined) {
    const ticket = record(data.ticket);
    result.ticket = {
      fullName: string(ticket.fullName),
      train: string(ticket.train),
      carriage: string(ticket.carriage),
      seat: string(ticket.seat),
    };
  }
  return result;
}

function debrief(value: unknown): DebriefView | null {
  if (value === null) return null;
  const data = record(value);
  return {
    title: string(data.title),
    safety: number(data.safety),
    satisfaction: number(data.satisfaction),
    process: list(data.process, string),
    outcome: list(data.outcome, string),
  };
}

function metrics(value: unknown): ObservableSnapshot['metrics'] {
  if (value === null) return null;
  const data = record(value);
  return { safety: number(data.safety), satisfaction: number(data.satisfaction) };
}

function controls(value: unknown): NonNullable<ObservableSnapshot['controls']> {
  const data = record(value);
  const speed = number(data.speed);
  if (speed !== 0 && speed !== 1 && speed !== 3) throw new Error('Unsupported speed');
  return { speed };
}

function patch(value: unknown, complete: boolean): SnapshotPatch {
  const data = record(value);
  const result: SnapshotPatch = {};
  if (complete || data.simulationTime !== undefined)
    result.simulationTime = number(data.simulationTime);
  if (complete || data.phase !== undefined)
    result.phase = choice(data.phase, ['boarding', 'ride', 'finished']);
  if (complete || data.playerZone !== undefined) result.playerZone = choice(data.playerZone, ZONES);
  if (complete || data.message !== undefined) result.message = string(data.message);
  if (complete || data.poi !== undefined) result.poi = list(data.poi, poi);
  if (complete || data.npcs !== undefined) result.npcs = list(data.npcs, npc);
  if (complete || data.cues !== undefined) result.cues = list(data.cues, cue);
  if (complete || data.tasks !== undefined) result.tasks = list(data.tasks, task);
  if (complete || data.dialogue !== undefined) result.dialogue = dialogue(data.dialogue);
  if (complete || data.item !== undefined) result.item = choice(data.item, ITEMS);
  if (complete || data.metrics !== undefined) result.metrics = metrics(data.metrics);
  if (complete || data.debrief !== undefined) result.debrief = debrief(data.debrief);
  if (data.controls !== undefined) result.controls = controls(data.controls);
  return result;
}

/** Parse and copy only allowed public fields; unknown wire fields never enter client state. */
export function parseServerMessage(raw: string): ServerMessage {
  const data = record(JSON.parse(raw) as unknown);
  if (data.protocolVersion !== PROTOCOL_VERSION) throw new Error('Protocol version mismatch');
  switch (data.type) {
    case 'snapshot': {
      const state = record(data.state);
      const publicFields = patch(state, true);
      return {
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        state: {
          sessionId: string(state.sessionId),
          revision: integer(state.revision),
          simulationTime: publicFields.simulationTime as number,
          phase: publicFields.phase as ObservableSnapshot['phase'],
          playerZone: publicFields.playerZone as ZoneId,
          message: publicFields.message as string,
          poi: publicFields.poi as PoiView[],
          npcs: publicFields.npcs as NpcView[],
          cues: publicFields.cues as CueView[],
          tasks: publicFields.tasks as TaskView[],
          dialogue: publicFields.dialogue as DialogueView | null,
          item: publicFields.item as ItemState,
          metrics: publicFields.metrics as ObservableSnapshot['metrics'],
          debrief: publicFields.debrief as DebriefView | null,
          ...(publicFields.controls === undefined ? {} : { controls: publicFields.controls }),
        },
      };
    }
    case 'delta':
      return {
        type: 'delta',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: string(data.sessionId),
        revision: integer(data.revision),
        patch: patch(data.patch, false),
      };
    case 'ack':
      return {
        type: 'ack',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: string(data.sessionId),
        requestId: string(data.requestId),
        revision: integer(data.revision),
      };
    case 'reject':
      return {
        type: 'reject',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: string(data.sessionId),
        requestId: string(data.requestId),
        reason: string(data.reason),
      };
    default:
      throw new Error('Unknown server message');
  }
}
