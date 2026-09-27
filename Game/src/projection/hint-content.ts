import { z } from 'zod';

/**
 * Coaching copy for guided sessions. Triggers are stable ids the observer
 * understands; texts and timings stay in the content bundle.
 */
const objectTargetSchema = z.object({
  kind: z.literal('object'),
  objectId: z.string().min(1),
});

const highlightSchema = z.object({
  id: z.string().min(1),
  objectId: z.string().min(1),
});

export const hintTriggerSchema = z.enum([
  'attempt-start',
  'journal-taken',
  'journal-filled',
  'meet-passengers',
  'passenger-request-unhandled',
  'feedback-false-journal',
  'feedback-unsafe-admit',
  'feedback-wrong-reject',
  'feedback-false-emergency-brake',
  'inactivity',
]);

const hintDefinitionSchema = z.object({
  id: z.string().min(1),
  trigger: hintTriggerSchema,
  role: z.enum(['suggestion', 'attention', 'feedback']),
  presentation: z.enum(['message', 'toast', 'highlight']),
  text: z.string().min(1).optional(),
  target: objectTargetSchema.optional(),
  highlights: z.array(highlightSchema).optional(),
  afterUs: z.number().int().positive().optional(),
  repeatable: z.boolean().optional(),
  requestActionIds: z.array(z.string().min(1)).min(1).optional(),
});

export const hintContentSchema = z.object({
  schemaVersion: z.literal(1),
  hints: z.array(hintDefinitionSchema).min(1),
});

export type HintTrigger = z.infer<typeof hintTriggerSchema>;
export type HintDefinition = z.infer<typeof hintDefinitionSchema>;
export type HintContent = z.infer<typeof hintContentSchema>;
export type HintObjectTarget = z.infer<typeof objectTargetSchema>;

export interface HintContentWorld {
  readonly objectIds: readonly string[];
  readonly actionIds: readonly string[];
}

const TRIGGER_ROLE: Record<HintTrigger, HintDefinition['role']> = {
  'attempt-start': 'suggestion',
  'journal-taken': 'suggestion',
  'journal-filled': 'suggestion',
  'meet-passengers': 'suggestion',
  inactivity: 'suggestion',
  'passenger-request-unhandled': 'attention',
  'feedback-false-journal': 'feedback',
  'feedback-unsafe-admit': 'feedback',
  'feedback-wrong-reject': 'feedback',
  'feedback-false-emergency-brake': 'feedback',
};

const START_TEXT = 'Начните приёмку: подойдите к журналу на перроне и возьмите его.';
const INSPECT_TEXT =
  'Осмотрите вагон: огнетушитель, стоп-кран, климат и связь. Отметьте результат в журнале.';
const RETURN_TEXT = 'Верните журнал на стол приёмки до отправления.';
const MEET_TEXT = 'Встречайте пассажиров у двери и проверяйте документы.';
const WAITING_TEXT = 'Пассажир ждёт — подойдите к нему.';
const FALSE_JOURNAL_TEXT = 'В журнале отмечена неисправность, которой нет.';
const UNSAFE_ADMIT_TEXT = 'Этого пассажира нельзя было пускать.';
const WRONG_REJECT_TEXT = 'Этого пассажира можно было пропустить.';
const FALSE_BRAKE_TEXT = 'Аварийный тормоз применён без угрозы.';

const JOURNAL_TARGET = { kind: 'object' as const, objectId: 'acceptance-journal' };
const BRAKE_TARGET = { kind: 'object' as const, objectId: 'emergency-brake' };

/** Shipped coaching catalog. Both release bundles carry this object unchanged. */
export const BASELINE_HINT_CONTENT = {
  schemaVersion: 1 as const,
  hints: [
    {
      id: 'attempt-start',
      trigger: 'attempt-start' as const,
      role: 'suggestion' as const,
      presentation: 'message' as const,
      text: START_TEXT,
      target: JOURNAL_TARGET,
    },
    {
      id: 'journal-taken',
      trigger: 'journal-taken' as const,
      role: 'suggestion' as const,
      presentation: 'message' as const,
      text: INSPECT_TEXT,
      highlights: [
        { id: 'highlight-extinguisher', objectId: 'extinguisher' },
        { id: 'highlight-emergency-brake', objectId: 'emergency-brake' },
        { id: 'highlight-climate-control', objectId: 'climate-control' },
        { id: 'highlight-driver-comms', objectId: 'driver-comms' },
      ],
    },
    {
      id: 'journal-filled',
      trigger: 'journal-filled' as const,
      role: 'suggestion' as const,
      presentation: 'message' as const,
      text: RETURN_TEXT,
      target: JOURNAL_TARGET,
    },
    {
      id: 'meet-passengers',
      trigger: 'meet-passengers' as const,
      role: 'suggestion' as const,
      presentation: 'message' as const,
      text: MEET_TEXT,
    },
    {
      id: 'passenger-waiting',
      trigger: 'passenger-request-unhandled' as const,
      role: 'attention' as const,
      presentation: 'toast' as const,
      text: WAITING_TEXT,
      afterUs: 30_000_000,
      requestActionIds: ['request-drink', 'request-food'],
    },
    {
      id: 'feedback-false-journal',
      trigger: 'feedback-false-journal' as const,
      role: 'feedback' as const,
      presentation: 'toast' as const,
      text: FALSE_JOURNAL_TEXT,
      target: JOURNAL_TARGET,
    },
    {
      id: 'feedback-unsafe-admit',
      trigger: 'feedback-unsafe-admit' as const,
      role: 'feedback' as const,
      presentation: 'toast' as const,
      text: UNSAFE_ADMIT_TEXT,
    },
    {
      id: 'feedback-wrong-reject',
      trigger: 'feedback-wrong-reject' as const,
      role: 'feedback' as const,
      presentation: 'toast' as const,
      text: WRONG_REJECT_TEXT,
    },
    {
      id: 'feedback-false-emergency-brake',
      trigger: 'feedback-false-emergency-brake' as const,
      role: 'feedback' as const,
      presentation: 'toast' as const,
      text: FALSE_BRAKE_TEXT,
      target: BRAKE_TARGET,
    },
    {
      id: 'inactivity',
      trigger: 'inactivity' as const,
      role: 'suggestion' as const,
      presentation: 'message' as const,
      afterUs: 60_000_000,
      repeatable: true,
    },
  ],
};

export function loadHintContent(input: unknown, world: HintContentWorld): HintContent {
  const content = hintContentSchema.parse(input);
  validateHintContent(content, world);
  return content;
}

function validateHintContent(content: HintContent, world: HintContentWorld): void {
  const objectIds = new Set(world.objectIds);
  const actionIds = new Set(world.actionIds);
  const seenIds = new Set<string>();
  const seenTriggers = new Set<string>();
  for (const hint of content.hints) {
    validateOneHint(hint, seenIds, seenTriggers, objectIds, actionIds);
  }
}

function validateOneHint(
  hint: HintDefinition,
  seenIds: Set<string>,
  seenTriggers: Set<string>,
  objectIds: ReadonlySet<string>,
  actionIds: ReadonlySet<string>,
): void {
  claimId(seenIds, hint.id);
  if (seenTriggers.has(hint.trigger)) {
    throw new RangeError(`Duplicate hint trigger ${hint.trigger}`);
  }
  seenTriggers.add(hint.trigger);
  validateHintShape(hint);
  requireObject(objectIds, hint.target?.objectId, hint.id);
  for (const highlight of hint.highlights ?? []) {
    claimId(seenIds, highlight.id);
    requireObject(objectIds, highlight.objectId, highlight.id);
  }
  for (const actionId of hint.requestActionIds ?? []) {
    if (!actionIds.has(actionId)) {
      throw new RangeError(`Hint ${hint.id} references missing action ${actionId}`);
    }
  }
}

function validateHintShape(hint: HintDefinition): void {
  if (hint.role !== TRIGGER_ROLE[hint.trigger]) {
    throw new RangeError(`Hint ${hint.id} role does not match trigger ${hint.trigger}`);
  }
  if (hint.presentation === 'highlight') {
    throw new RangeError(`Hint ${hint.id} lists highlights separately from presentation highlight`);
  }
  if (hint.trigger === 'inactivity') {
    validateInactivity(hint);
    return;
  }
  requireCopy(hint);
  requireTiming(hint);
}

function requireCopy(hint: HintDefinition): void {
  if (hint.text === undefined) throw new RangeError(`Hint ${hint.id} requires text`);
  if (hint.trigger === 'attempt-start' && hint.target === undefined) {
    throw new RangeError(`Hint ${hint.id} requires an object target`);
  }
  if (hint.role === 'feedback' && hint.presentation !== 'toast') {
    throw new RangeError(`Hint ${hint.id} must be a toast`);
  }
  if (hint.role === 'suggestion' && hint.presentation !== 'message') {
    throw new RangeError(`Hint ${hint.id} must be a message`);
  }
  if (hint.trigger !== 'journal-taken' && hint.highlights !== undefined) {
    throw new RangeError(`Hint ${hint.id} cannot list highlights`);
  }
}

function requireTiming(hint: HintDefinition): void {
  if (hint.trigger !== 'passenger-request-unhandled') return;
  if (hint.afterUs === undefined || hint.requestActionIds === undefined) {
    throw new RangeError(`Hint ${hint.id} requires afterUs and requestActionIds`);
  }
  if (hint.presentation !== 'toast') throw new RangeError(`Hint ${hint.id} must be a toast`);
}

function requireObject(
  objectIds: ReadonlySet<string>,
  objectId: string | undefined,
  hintId: string,
): void {
  if (objectId !== undefined && !objectIds.has(objectId)) {
    throw new RangeError(`Hint ${hintId} references missing object ${objectId}`);
  }
}

function validateInactivity(hint: HintDefinition): void {
  if (hint.text !== undefined) {
    throw new RangeError(`Hint ${hint.id} repeats the current objective and has no own text`);
  }
  if (hint.afterUs === undefined || hint.repeatable !== true) {
    throw new RangeError(`Hint ${hint.id} requires afterUs and repeatable`);
  }
  if (hint.presentation !== 'message') throw new RangeError(`Hint ${hint.id} must be a message`);
  if (hint.highlights !== undefined || hint.requestActionIds !== undefined) {
    throw new RangeError(`Hint ${hint.id} cannot list highlights or request actions`);
  }
}

function claimId(seen: Set<string>, id: string): void {
  if (seen.has(id)) throw new RangeError(`Duplicate hint id ${id}`);
  seen.add(id);
}
