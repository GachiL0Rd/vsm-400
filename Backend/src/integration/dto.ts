import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Grade, Role } from '../generated/prisma/client';
import { isUuid } from './api-key';
import { API_SCOPES, WEBHOOK_EVENTS } from './api-scopes';
import { httpError } from './http-error';

const RoleSchema = z.enum([Role.CONDUCTOR, Role.CHIEF, Role.METHODIST, Role.ADMIN]);
const GradeSchema = z.enum([
  Grade.TRAINEE,
  Grade.CONDUCTOR,
  Grade.CONDUCTOR_SENIOR,
  Grade.INSTRUCTOR,
]);

function uniqueItems(value: readonly string[]): boolean {
  return new Set(value).size === value.length;
}

function hasControl(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 31) {
      return true;
    }
  }
  return false;
}

export const CreateApiClientSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
  })
  .refine((value) => uniqueItems(value.scopes), { path: ['scopes'], message: 'scopes уникальны' });

export class CreateApiClientDto extends createZodDto(CreateApiClientSchema) {}

/** strictObject: ФИО и любые лишние поля отклоняются, в базу они не попадут. */
export const UpsertEmployeeSchema = z.strictObject({
  role: RoleSchema,
  brigadeCode: z.string().trim().min(1).max(32),
  depotCode: z.string().trim().min(1).max(32),
  position: z.string().trim().min(1).max(120),
  grade: GradeSchema,
});

export class UpsertEmployeeDto extends createZodDto(UpsertEmployeeSchema) {}

export type UpsertEmployee = z.infer<typeof UpsertEmployeeSchema>;

const ExtIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !hasControl(value), { message: 'без управляющих символов' });

export function parseExtId(value: string): string {
  const parsed = ExtIdSchema.safeParse(value);
  if (!parsed.success) {
    throw httpError(422, 'Некорректный внешний идентификатор', 'VALIDATION');
  }
  return parsed.data;
}

export function parseUuid(value: string, code: string): string {
  if (!isUuid(value.toLowerCase())) {
    throw httpError(404, 'Запись не найдена', code);
  }
  return value.toLowerCase();
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '') {
      return false;
    }
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export const CreateWebhookSchema = z
  .strictObject({
    url: z
      .string()
      .trim()
      .max(2048)
      .refine(isHttpUrl, { message: 'нужен http(s) URL без логина в адресе' }),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
  })
  .refine((value) => uniqueItems(value.events), { path: ['events'], message: 'events уникальны' });

export class CreateWebhookDto extends createZodDto(CreateWebhookSchema) {}

export type CreateWebhook = z.infer<typeof CreateWebhookSchema>;

export const problemSchema = {
  type: 'object',
  required: ['type', 'title', 'status', 'detail', 'code'],
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    code: { type: 'string' },
  },
};

export const apiClientSchema = {
  type: 'object',
  required: ['id', 'name', 'scopes', 'createdAt', 'revokedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    scopes: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string', format: 'date-time' },
    revokedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

export const createdApiClientSchema = {
  type: 'object',
  required: ['id', 'name', 'scopes', 'createdAt', 'key'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    scopes: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string', format: 'date-time' },
    key: { type: 'string', description: 'Секрет показывается один раз' },
  },
};

export const upsertEmployeeResponseSchema = {
  type: 'object',
  required: ['userId', 'login', 'callsign', 'created'],
  properties: {
    userId: { type: 'string', format: 'uuid' },
    login: { type: 'string' },
    callsign: { type: 'string' },
    created: { type: 'boolean' },
    password: { type: 'string', description: 'Только при создании учётной записи' },
  },
};

export const progressSchema = {
  type: 'object',
  required: [
    'callsign',
    'grade',
    'level',
    'points',
    'competencies',
    'runs',
    'achievements',
    'lastRunAt',
    'promotion',
  ],
  properties: {
    callsign: { type: 'string' },
    grade: { type: 'string' },
    level: { type: 'integer' },
    points: { type: 'integer' },
    competencies: { type: 'object', additionalProperties: { type: 'number' } },
    runs: {
      type: 'object',
      required: ['total', 'completed', 'incidents', 'terminated'],
      properties: {
        total: { type: 'integer' },
        completed: { type: 'integer' },
        incidents: { type: 'integer' },
        terminated: { type: 'integer' },
      },
    },
    achievements: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'earnedAt'],
        properties: {
          code: { type: 'string' },
          earnedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    lastRunAt: { type: 'string', format: 'date-time', nullable: true },
    promotion: { type: 'object', nullable: true },
  },
};

export const orgSchema = {
  type: 'object',
  required: ['depots'],
  properties: {
    depots: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'name', 'city', 'employeeCount', 'brigades'],
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          city: { type: 'string' },
          employeeCount: { type: 'integer' },
          brigades: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
};

export const webhookSchema = {
  type: 'object',
  required: ['id', 'url', 'events', 'active'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    url: { type: 'string' },
    events: { type: 'array', items: { type: 'string' } },
    active: { type: 'boolean' },
    secret: { type: 'string', description: 'Только в ответе на создание' },
  },
};
