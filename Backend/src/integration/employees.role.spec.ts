import { describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/client';
import { hrMaySetRole } from './employees.service';

describe('кадровая роль', () => {
  it('пускает ту же роль и понижение, запрещает рост и чужие роли', () => {
    expect(hrMaySetRole(Role.CONDUCTOR, Role.CONDUCTOR)).toBe(true);
    expect(hrMaySetRole(Role.CHIEF, Role.CONDUCTOR)).toBe(true);
    expect(hrMaySetRole(Role.CHIEF, Role.CHIEF)).toBe(true);
    expect(hrMaySetRole(Role.CONDUCTOR, Role.CHIEF)).toBe(false);
    expect(hrMaySetRole(Role.METHODIST, Role.CONDUCTOR)).toBe(false);
    expect(hrMaySetRole(Role.ADMIN, Role.CHIEF)).toBe(false);
    expect(hrMaySetRole(Role.CONDUCTOR, Role.ADMIN)).toBe(false);
    expect(hrMaySetRole(Role.CONDUCTOR, Role.METHODIST)).toBe(false);
  });
});
