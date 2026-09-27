import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CarClassSchema } from '../engine/schema';

const transportSchema = z.enum(['REST', 'WS']);
const sessionStatusSchema = z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'ABORTED', 'EXPIRED']);

export const openSessionSchema = z.strictObject({
  transport: transportSchema,
  carClass: CarClassSchema.optional(),
});

export class OpenSessionDto extends createZodDto(openSessionSchema) {}

/** Верх Date в JS. Выше new Date даёт Invalid Date и 500 на записи журнала. */
const MAX_CLIENT_TS_MS = 8_640_000_000_000_000;

export const decisionSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  choiceId: z.string().min(1).max(64),
  clientTs: z.number().int().nonnegative().max(MAX_CLIENT_TS_MS).optional(),
});

export class DecisionDto extends createZodDto(decisionSchema) {}

const publicPlanSchema = z.strictObject({
  train: z.string(),
  route: z.string(),
  car: z.number().int(),
  carClass: CarClassSchema,
  departure: z.string(),
  segments: z.number().int().nonnegative(),
  titles: z.array(z.string()),
});

const choiceSchema = z.strictObject({
  id: z.string(),
  text: z.string(),
});

const nodeViewSchema = z.strictObject({
  nodeId: z.string(),
  text: z.string(),
  timerSec: z.number().nullable(),
  choices: z.array(choiceSchema),
  loyalty: z.number(),
  safety: z.number(),
  seq: z.number().int(),
  finished: z.boolean(),
  progress: z.strictObject({
    index: z.number().int(),
    total: z.number().int(),
  }),
});

const scalesSchema = z.strictObject({
  loyalty: z.number(),
  safety: z.number(),
  politeness: z.number(),
});

export const sessionViewSchema = z.strictObject({
  status: sessionStatusSchema,
  seq: z.number().int(),
  view: nodeViewSchema,
  scales: scalesSchema,
  deadlineAt: z.string().nullable(),
  progress: nodeViewSchema.shape.progress,
});

export class SessionViewDto extends createZodDto(sessionViewSchema) {}

export const decisionViewSchema = sessionViewSchema.extend({
  applied: z.enum(['choice', 'timeout']),
  finished: z.boolean(),
});

export class DecisionViewDto extends createZodDto(decisionViewSchema) {}

export const openedSessionSchema = z.strictObject({
  sessionId: z.uuid(),
  ticket: z.string().min(1),
  wsUrl: z.string().min(1),
  seedCommit: z.string().regex(/^[0-9a-f]{64}$/),
  plan: publicPlanSchema,
});

export class OpenedSessionDto extends createZodDto(openedSessionSchema) {}

export const revealSchema = z.strictObject({
  seed: z.string().regex(/^[0-9a-f]{64}$/),
  commit: z.string().regex(/^[0-9a-f]{64}$/),
});

export class RevealDto extends createZodDto(revealSchema) {}

export const abortResultSchema = z.strictObject({
  status: z.literal('ABORTED'),
});

export class AbortResultDto extends createZodDto(abortResultSchema) {}

const verdictSchema = z.enum(['correct', 'late', 'incorrect', 'missed', 'best', 'ok', 'worse']);
const stageSchema = z.enum(['acceptance', 'boarding', 'enroute', 'stop', 'handover', 'ride']);

export const runReportSchema = z.strictObject({
  contractVersion: z.literal(1),
  protocolVersion: z.number().int(),
  scenarioId: z.string().min(1),
  simulationSeconds: z.number().nonnegative(),
  outcome: z.enum(['completed', 'incident', 'terminated']),
  outcomeNote: z.string(),
  safety: z.number(),
  loyalty: z.number(),
  facts: z.strictObject({
    prevented: z.number().int(),
    incidents: z.number().int(),
    complaints: z.number().int(),
    interventions: z.number().int(),
  }),
  decisions: z.array(
    z.strictObject({
      id: z.string().min(1),
      time: z.string().min(1),
      stage: stageSchema,
      situation: z.string().optional(),
      action: z.string().optional(),
      verdict: verdictSchema,
      safety: z.number(),
      loyalty: z.number(),
      reactionSec: z.number().nonnegative().optional(),
      lucky: z.boolean().optional(),
      consequence: z.string().nullable().optional(),
      better: z.string().nullable().optional(),
      basis: z.string().nullable().optional(),
    }),
  ),
  checks: z.array(
    z.strictObject({
      id: z.string().min(1),
      detected: z.boolean(),
      reportRequired: z.boolean(),
      reported: z.boolean(),
      actionCorrect: z.boolean(),
      consequenceRolled: z.boolean(),
    }),
  ),
});

export class RunReportDto extends createZodDto(runReportSchema) {}
export type RunReport = z.infer<typeof runReportSchema>;

export const reportResultSchema = z.strictObject({
  runId: z.uuid(),
});

export class ReportResultDto extends createZodDto(reportResultSchema) {}

export const eventsSchema = z.strictObject({
  events: z
    .array(
      z.strictObject({
        seq: z.number().int().nonnegative(),
        type: z.string().min(1).max(64),
        payload: z.record(z.string(), z.unknown()),
        clientAt: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .max(100),
});

export class EventsDto extends createZodDto(eventsSchema) {}
export type GameEventsBody = z.infer<typeof eventsSchema>;

export const eventsResultSchema = z.strictObject({
  accepted: z.number().int(),
  duplicates: z.number().int(),
});

export class EventsResultDto extends createZodDto(eventsResultSchema) {}

const shiftPlanSchema = z.strictObject({
  train: z.string(),
  route: z.string(),
  fromStation: z.string(),
  toStation: z.string(),
  stops: z.array(z.string()),
  car: z.number().int(),
  carClass: CarClassSchema,
  departure: z.string(),
  scenarios: z.array(
    z.strictObject({
      scenarioId: z.string(),
      version: z.number().int(),
      params: z.record(z.string(), z.number()),
    }),
  ),
});

export const verifyTicketSchema = z.strictObject({
  ticket: z.string().min(1),
});

export class VerifyTicketDto extends createZodDto(verifyTicketSchema) {}

export const verifyResultSchema = z.strictObject({
  userId: z.uuid(),
  callsign: z.string(),
  sessionId: z.uuid(),
  plan: shiftPlanSchema,
  status: sessionStatusSchema,
});

export class VerifyResultDto extends createZodDto(verifyResultSchema) {}

export type SessionView = z.infer<typeof sessionViewSchema>;
export type DecisionView = z.infer<typeof decisionViewSchema>;
export type OpenedSession = z.infer<typeof openedSessionSchema>;
export type PublicPlan = z.infer<typeof publicPlanSchema>;
export type VerifyResult = z.infer<typeof verifyResultSchema>;
