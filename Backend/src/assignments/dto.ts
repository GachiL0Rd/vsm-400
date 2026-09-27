import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CompetencySchema } from '../engine/schema';

const optionalUuid = z.preprocess(
  (value) => (value === undefined || value === '' ? undefined : value),
  z.uuid().optional(),
);

export const AssignmentQuerySchema = z.object({
  brigadeId: optionalUuid,
});

export class AssignmentQueryDto extends createZodDto(AssignmentQuerySchema) {}

export const CreateAssignmentsSchema = z
  .object({
    userIds: z.array(z.uuid()).min(1).max(32),
    scenarioIds: z.array(z.string().min(1)).min(1).max(8),
    departureAt: z.iso.datetime({ offset: true }).optional(),
    focus: z.array(CompetencySchema).min(1).max(6).optional(),
  })
  .refine((body) => new Set(body.userIds).size === body.userIds.length, {
    message: 'сотрудники повторяются',
  })
  .refine((body) => new Set(body.scenarioIds).size === body.scenarioIds.length, {
    message: 'сценарии повторяются',
  });

export class CreateAssignmentsDto extends createZodDto(CreateAssignmentsSchema) {}

export const AssignmentSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    callsign: z.string(),
    status: z.enum(['PLANNED', 'STARTED', 'DONE', 'CANCELLED']),
    train: z.string(),
    from: z.string(),
    fromGenitive: z.string(),
    to: z.string(),
    car: z.number().int(),
    carClass: z.string(),
    departure: z.string(),
    departureAt: z.string(),
    stops: z.array(z.string()),
    focus: z.array(CompetencySchema),
    scenarioIds: z.array(z.string()),
  })
  .meta({ id: 'Assignment' });

export class AssignmentDto extends createZodDto(AssignmentSchema) {}

export const AssignmentListSchema = z
  .object({
    assignments: z.array(AssignmentSchema),
  })
  .meta({ id: 'AssignmentList' });

export class AssignmentListDto extends createZodDto(AssignmentListSchema) {}

export type AssignmentResponse = z.infer<typeof AssignmentSchema>;
export type CreateAssignmentsBody = z.infer<typeof CreateAssignmentsSchema>;
