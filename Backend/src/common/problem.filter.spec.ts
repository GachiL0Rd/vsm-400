import {
  type ArgumentsHost,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import type { Problem } from './problem';
import { ProblemFilter } from './problem.filter';

class FakeReply {
  statusCode = 0;
  payload: unknown;
  contentType = '';

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  header(name: string, value: string): this {
    if (name.toLowerCase() === 'content-type') {
      this.contentType = value;
    }
    return this;
  }

  send(payload: unknown): void {
    this.payload = payload;
  }
}

function hostWith(reply: FakeReply): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({}),
      getNext: () => undefined,
    }),
  } as ArgumentsHost;
}

function bodyOf(reply: FakeReply): Problem {
  return reply.payload as Problem;
}

describe('ProblemFilter', () => {
  const filter = new ProblemFilter();

  it('отдаёт HttpException как problem+json', () => {
    const reply = new FakeReply();
    filter.catch(new NotFoundException('Сессия не найдена'), hostWith(reply));
    const body = bodyOf(reply);
    expect(reply.statusCode).toBe(404);
    expect(reply.contentType).toContain('application/problem+json');
    expect(body.status).toBe(404);
    expect(body.detail).toBe('Сессия не найдена');
    expect(body.code).toBe('HTTP_404');
    expect(reply.payload).not.toHaveProperty('stack');
  });

  it('410 Gone остаётся 410', () => {
    const reply = new FakeReply();
    filter.catch(
      new GoneException({ message: 'Ключ сессии истёк', code: 'session-expired' }),
      hostWith(reply),
    );
    const body = bodyOf(reply);
    expect(reply.statusCode).toBe(410);
    expect(body.status).toBe(410);
    expect(body.code).toBe('session-expired');
    expect(body.title).toBe('Больше не доступен');
  });

  it('кладёт ZodError в 422 и errors[]', () => {
    const parsed = z.object({ login: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }
    const reply = new FakeReply();
    filter.catch(parsed.error, hostWith(reply));
    const body = bodyOf(reply);
    expect(body.status).toBe(422);
    expect(body.code).toBe('VALIDATION');
    expect(body.errors?.[0]?.path).toBe('login');
  });

  it('узнаёт обёртку nestjs-zod раньше статуса HttpException', () => {
    const parsed = z.object({ login: z.string() }).safeParse({});
    if (parsed.success) {
      throw new Error('схема должна отвергнуть пустой объект');
    }
    const reply = new FakeReply();
    filter.catch({ getZodError: () => parsed.error }, hostWith(reply));
    expect(bodyOf(reply).status).toBe(422);
  });

  it('переносит errors[] из HttpException', () => {
    const reply = new FakeReply();
    filter.catch(
      new UnprocessableEntityException({
        message: 'Граф сценария не связан',
        code: 'VALIDATION',
        errors: [{ path: 'nodes.n1.choices.0.next', code: 'NEXT_MISSING', message: 'нет узла' }],
      }),
      hostWith(reply),
    );
    const body = bodyOf(reply);
    expect(body.status).toBe(422);
    expect(body.code).toBe('VALIDATION');
    expect(body.errors?.[0]?.path).toBe('nodes.n1.choices.0.next');
  });

  it('P2002 → 409 без текста драйвера', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`login`)',
      { code: 'P2002', clientVersion: 'test' },
    );
    const reply = new FakeReply();
    filter.catch(error, hostWith(reply));
    const body = bodyOf(reply);
    expect(body.status).toBe(409);
    expect(body.code).toBe('UNIQUE_CONSTRAINT');
    expect(JSON.stringify(body)).not.toContain('login');
  });

  it('P2025 → 404', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Record to update not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    const reply = new FakeReply();
    filter.catch(error, hostWith(reply));
    expect(bodyOf(reply)).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('прочую ошибку прячет за 500', () => {
    const reply = new FakeReply();
    filter.catch(new Error('password=super-secret'), hostWith(reply));
    const body = bodyOf(reply);
    expect(body.status).toBe(500);
    expect(body.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('super-secret');
    expect(JSON.stringify(body)).not.toContain('stack');
  });
});
