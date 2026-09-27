import { type ArgumentsHost, BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Problem } from '../common/problem';
import { ProblemFilter } from '../common/problem.filter';
import { finishedGameResultSchema } from './platform.dto';
import { PlatformZodPipe } from './platform-zod.pipe';

class FakeReply {
  statusCode = 0;
  payload: unknown;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  header(): this {
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

const valid = {
  attemptId: '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5c',
  content: {
    gameLevelId: 'vsm-baseline-01',
    gameLevelVersion: '1',
    simulationCompatibilityVersion: '1',
  },
  rootSeed: '8745983467598346759',
  userInputs: [{ at: 1, sequence: 1, command: { type: 'move-to' } }],
  achievements: { setVersion: 'baseline-v1', ids: ['inspected-extinguisher'] },
  termination: { kind: 'route-completed', outcomeId: 'destination-arrived' },
  scores: { safety: 96, customerSatisfaction: 84 },
};

describe('PlatformZodPipe', () => {
  const pipe = new PlatformZodPipe(finishedGameResultSchema);
  const filter = new ProblemFilter();

  function problem(value: unknown): Problem {
    let caught: unknown;
    try {
      pipe.transform(value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const reply = new FakeReply();
    filter.catch(caught, hostWith(reply));
    return reply.payload as Problem;
  }

  it('лишнее поле и шкала вне 0..100 дают 400, не 422', () => {
    const extra = problem({ ...valid, extra: true });
    expect(extra.status).toBe(400);
    expect(extra.code).toBe('invalid-body');
    expect(extra.errors?.length).toBeGreaterThan(0);

    const score = problem({ ...valid, scores: { safety: 101, customerSatisfaction: 84 } });
    expect(score.status).toBe(400);
    expect(score.code).toBe('invalid-body');
  });

  it('повторяющиеся id достижений не проходят', () => {
    const body = problem({
      ...valid,
      achievements: { setVersion: 'baseline-v1', ids: ['same', 'same'] },
    });
    expect(body.status).toBe(400);
    expect(body.code).toBe('invalid-body');
  });

  it('пропускает строгое тело и оставляет userInputs как есть', () => {
    const parsed = pipe.transform(valid);
    expect(parsed.userInputs).toEqual(valid.userInputs);
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.assessment).toBeUndefined();
  });

  it('принимает assessment, в том числе неизвестный kind', () => {
    const parsed = pipe.transform({
      ...valid,
      assessment: {
        setVersion: 'baseline-v1',
        durationUs: 90_000_000,
        facts: [
          {
            id: 'boarding:passenger-2',
            kind: 'boarding-decision',
            at: 60_000_000,
            verdict: 'late',
            scoreDelta: { safety: -1, customerSatisfaction: 2 },
            reactionUs: 1_500,
            detail: {
              passengerId: 'passenger-2',
              expected: 'admit',
              actual: 'admit',
              note: null,
            },
          },
          {
            id: 'custom:1',
            kind: 'cabin-noise',
            at: 0,
            verdict: 'missed',
            scoreDelta: { safety: 0, customerSatisfaction: 0 },
            detail: { heard: true },
          },
        ],
      },
    });
    expect(parsed.assessment?.facts).toHaveLength(2);
    expect(parsed.assessment?.facts[1]?.kind).toBe('cabin-noise');
  });

  it('кривой verdict, отрицательный at и не-примитив в detail дают 400', () => {
    const verdict = problem({
      ...valid,
      assessment: {
        setVersion: 'baseline-v1',
        durationUs: 0,
        facts: [
          {
            id: 'fire:1',
            kind: 'fire',
            at: 0,
            verdict: 'best',
            scoreDelta: { safety: 0, customerSatisfaction: 0 },
            detail: {},
          },
        ],
      },
    });
    expect(verdict.status).toBe(400);
    expect(verdict.code).toBe('invalid-body');

    const at = problem({
      ...valid,
      assessment: {
        setVersion: 'baseline-v1',
        durationUs: 0,
        facts: [
          {
            id: 'fire:1',
            kind: 'fire',
            at: -1,
            verdict: 'correct',
            scoreDelta: { safety: 0, customerSatisfaction: 0 },
            detail: {},
          },
        ],
      },
    });
    expect(at.status).toBe(400);

    const nested = problem({
      ...valid,
      assessment: {
        setVersion: 'baseline-v1',
        durationUs: 0,
        facts: [
          {
            id: 'fire:1',
            kind: 'fire',
            at: 0,
            verdict: 'correct',
            scoreDelta: { safety: 0, customerSatisfaction: 0 },
            detail: { nested: { critical: true } },
          },
        ],
      },
    });
    expect(nested.status).toBe(400);

    const list = problem({
      ...valid,
      assessment: {
        setVersion: 'baseline-v1',
        durationUs: 0,
        facts: [
          {
            id: 'fire:1',
            kind: 'fire',
            at: 1.5,
            verdict: 'correct',
            scoreDelta: { safety: Number.POSITIVE_INFINITY, customerSatisfaction: 0 },
            detail: { tags: ['a'] },
          },
        ],
      },
    });
    expect(list.status).toBe(400);
  });

  it('не принимает простыню длиннее 500 фактов', () => {
    const facts = Array.from({ length: 501 }, (_, index) => ({
      id: `f-${index}`,
      kind: 'fire',
      at: index,
      verdict: 'correct' as const,
      scoreDelta: { safety: 0, customerSatisfaction: 0 },
      detail: {},
    }));
    const body = problem({
      ...valid,
      assessment: { setVersion: 'baseline-v1', durationUs: 0, facts },
    });
    expect(body.status).toBe(400);
    expect(body.code).toBe('invalid-body');
  });
});
