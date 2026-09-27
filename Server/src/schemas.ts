import { z } from '@hono/zod-openapi';

export const ErrorSchema = z
  .object({ error: z.string().openapi({ example: 'unauthorized' }) })
  .openapi('Error');

export const HealthSchema = z.object({ ok: z.boolean() }).openapi('Health');

export const CredentialsSchema = z
  .object({
    login: z.string().trim().min(1).openapi({ example: 'demo' }),
    password: z.string().min(1).openapi({ example: 'demo' }),
  })
  .openapi('Credentials');

export const SessionSchema = z
  .object({
    token: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .openapi('Session');

export const ConfigSchema = z
  .object({ gameUrl: z.url().openapi({ example: 'http://localhost:5173/' }) })
  .openapi('Config');

export const ProfileSchema = z
  .object({
    id: z.number().int(),
    login: z.string(),
    displayName: z.string(),
    position: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi('Profile');

export const AchievementSchema = z
  .object({
    code: z.string(),
    title: z.string(),
    description: z.string(),
    earnedAt: z.iso.datetime().nullable().openapi({ description: 'null — ещё не получено' }),
  })
  .openapi('Achievement');

export const RunOutcomeSchema = z
  .enum(['completed', 'incident', 'terminated'])
  .openapi('RunOutcome');

export const RunSchema = z
  .object({
    id: z.number().int(),
    scenarioId: z.string(),
    finishedAt: z.iso.datetime(),
    outcome: RunOutcomeSchema,
    safetyScore: z.number().int().min(0).max(100),
    serviceScore: z.number().int().min(0).max(100),
    errors: z.number().int().min(0),
  })
  .openapi('Run');

export const StatsSchema = z
  .object({
    runs: z.number().int(),
    completedRuns: z.number().int(),
    avgSafetyScore: z.number().int().nullable(),
    avgServiceScore: z.number().int().nullable(),
    errors: z.number().int(),
    achievementsEarned: z.number().int(),
    achievementsTotal: z.number().int(),
  })
  .openapi('Stats');
