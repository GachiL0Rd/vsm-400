import { describe, expect, it } from 'vitest';
import { Grade, Role } from '../generated/prisma/client';
import { gradeSchema, roleSchema } from './enums';

describe('роли и грейды', () => {
  it('берёт значения из Prisma и отвергает чужие', () => {
    expect(roleSchema.options).toEqual(Object.values(Role));
    expect(gradeSchema.options).toEqual(Object.values(Grade));
    expect(gradeSchema.safeParse('NOPE').success).toBe(false);
    expect(roleSchema.parse(Role.ADMIN)).toBe(Role.ADMIN);
  });
});
