import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { gradeSchema, roleSchema } from './enums';

const createUserSchema = z.object({
  login: z.string().trim().min(1).max(64),
  role: roleSchema,
  position: z.string().trim().min(1).max(120),
  grade: gradeSchema,
  brigadeId: z.uuid().nullable().optional(),
});

const updateUserSchema = z.object({
  role: roleSchema.optional(),
  brigadeId: z.uuid().nullable().optional(),
  disabled: z.boolean().optional(),
});

const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  brigade: z.uuid().optional(),
  role: roleSchema.optional(),
});

export class CreateUserDto extends createZodDto(createUserSchema) {}
export class UpdateUserDto extends createZodDto(updateUserSchema) {}
export class ListUsersDto extends createZodDto(listUsersSchema) {}
