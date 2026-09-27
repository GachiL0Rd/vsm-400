import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { authThrottlers } from './throttle';

function context(url: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
    }),
  } as ExecutionContext;
}

describe('лимиты входа', () => {
  const [ip, login, password] = authThrottlers();

  it('считает IP на обеих ручках, логин и пароль — только на своих', () => {
    expect(ip?.skipIf).toBeUndefined();
    expect(login?.skipIf?.(context('/api/v1/auth/login'))).toBe(false);
    expect(login?.skipIf?.(context('/api/v1/auth/password'))).toBe(true);
    expect(password?.skipIf?.(context('/api/v1/auth/password'))).toBe(false);
    expect(password?.skipIf?.(context('/api/v1/auth/login'))).toBe(true);
    expect(ip?.limit).toBe(20);
    expect(login?.limit).toBe(5);
    expect(password?.limit).toBe(5);
  });
});
