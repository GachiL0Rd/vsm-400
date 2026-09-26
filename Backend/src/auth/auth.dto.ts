import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const loginSchema = z.object({
  login: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

const passwordSchema = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(10, 'Минимум 10 символов').max(200),
});

const loginUserSchema = z.object({
  id: z.uuid(),
  login: z.string(),
  callsign: z.string(),
  role: z.enum(['CONDUCTOR', 'CHIEF', 'METHODIST', 'ADMIN']),
  grade: z.enum(['TRAINEE', 'CONDUCTOR', 'CONDUCTOR_SENIOR', 'INSTRUCTOR']),
  mustChangePassword: z.boolean(),
});

export class LoginDto extends createZodDto(loginSchema) {}
export class PasswordDto extends createZodDto(passwordSchema) {}
export class LoginResponseDto extends createZodDto(z.object({ user: loginUserSchema })) {}
export class SessionResponseDto extends createZodDto(
  z.object({
    id: z.uuid(),
    role: z.enum(['CONDUCTOR', 'CHIEF', 'METHODIST', 'ADMIN']),
    brigadeId: z.uuid().nullable(),
    depotId: z.uuid().nullable(),
  }),
) {}
