import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { isUniqueViolation, uniqueFields } from './unique-violation';

describe('P2002', () => {
  it('узнаёт ошибку Prisma и игнорирует похожий объект', () => {
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['login'] } })).toBe(false);
    const error = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['callsign'] },
    });
    expect(isUniqueViolation(error)).toBe(true);
    expect(uniqueFields(error)).toEqual(['callsign']);
  });
});
