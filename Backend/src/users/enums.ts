import { z } from 'zod';
import { Grade, Role } from '../generated/prisma/client';

export const roleSchema = z.enum(Role);
export const gradeSchema = z.enum(Grade);
