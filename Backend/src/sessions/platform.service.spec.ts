import { HttpException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../common/clock';
import { RUN_COMPLETED } from '../common/events';
import type { AppConfig } from '../config/env';
import { ActorType, type GameSession } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { payloadSha256 } from './canonical-json';
import { finishToSummary } from './finish-map';
import { GAME_ATTEMPT_TTL_MS } from './game-cookie';
import type { FinishedGameResult } from './platform.dto';
import { PlatformSessionService } from './platform.service';
import type { SessionsService } from './sessions.service';
import type { TicketClaims, TicketService, TicketVerdict } from './ticket.service';

const userId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';
const sessionId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5c';
const now = new Date('2026-09-27T12:00:00.000Z');

const config = {
  gameLevelId: 'vsm-baseline-01',
  publicAppUrl: 'http://127.0.0.1:5173/',
} as AppConfig;

const clock = { now: () => now } as Clock;

type Row = {
  id: string;
  userId: string;
  status: GameSession['status'];
  transport: GameSession['transport'];
  flags: string[];
  result: unknown;
  expiresAt: Date;
};

function row(patch: Partial<Row> = {}): Row {
  return {
    id: sessionId,
    userId,
    status: 'PENDING',
    transport: 'WS',
    flags: [],
    result: null,
    expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
    ...patch,
  };
}

function claims(): TicketClaims {
  return { sub: userId, sid: sessionId, jti: 'jti-1' };
}

function finished(attemptId: string, patch: Partial<FinishedGameResult> = {}): FinishedGameResult {
  return {
    attemptId,
    content: {
      gameLevelId: 'vsm-baseline-01',
      gameLevelVersion: '1',
      simulationCompatibilityVersion: '1',
    },
    rootSeed: '8745983467598346759',
    userInputs: [{ at: 1200000, sequence: 1, command: { type: 'move-to', cellId: 'c-1' } }],
    achievements: { setVersion: 'baseline-v1', ids: ['inspected-extinguisher'] },
    termination: { kind: 'route-completed', outcomeId: 'destination-arrived' },
    scores: { safety: 96, customerSatisfaction: 84 },
    ...patch,
  };
}

async function rejection(run: () => Promise<unknown>): Promise<HttpException> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('ожидалось исключение');
}

function codeOf(error: HttpException): string {
  const body = error.getResponse();
  if (typeof body === 'object' && body !== null && 'code' in body) {
    const code = body.code;
    return typeof code === 'string' ? code : '';
  }
  return '';
}

function resolveHarness(
  verdict: TicketVerdict,
  current: Row | null,
  fresh = true,
  at: Clock = clock,
) {
  const state = { row: current };
  const classify = vi.fn(async () => verdict);
  const consume = vi.fn(async () => fresh);
  const flagTicketReuse = vi.fn(async () => undefined);
  const activatePendingSession = vi.fn(async () => 'ACTIVE' as const);
  const findUnique = vi.fn(async () => state.row);
  const updateMany = vi.fn(
    async (args: {
      where: {
        id: string;
        status: { in: ReadonlyArray<GameSession['status']> };
        expiresAt: { lt: Date };
      };
      data: { expiresAt: Date };
    }) => {
      const target = state.row;
      const boundary = args.where.expiresAt.lt;
      if (
        !target ||
        target.id !== args.where.id ||
        !args.where.status.in.includes(target.status) ||
        !(target.expiresAt.getTime() < boundary.getTime())
      ) {
        return { count: 0 };
      }
      target.expiresAt = args.data.expiresAt;
      return { count: 1 };
    },
  );
  const service = new PlatformSessionService(
    { gameSession: { findUnique, updateMany } } as unknown as PrismaService,
    { classify, consume } as unknown as TicketService,
    { flagTicketReuse, activatePendingSession } as unknown as SessionsService,
    { emitAsync: vi.fn() } as unknown as EventEmitter2,
    config,
    at,
  );
  return {
    service,
    classify,
    consume,
    flagTicketReuse,
    activatePendingSession,
    findUnique,
    updateMany,
    state,
  };
}

describe('PlatformSessionService.resolve', () => {
  it('битый билет — 404 и без погашения', async () => {
    const harness = resolveHarness({ status: 'invalid' }, row());
    const error = await rejection(() => harness.service.resolve('bad'));
    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('invalid-session');
    expect(harness.consume).not.toHaveBeenCalled();
  });

  it('истёкший билет — 410', async () => {
    const harness = resolveHarness({ status: 'expired' }, row());
    const error = await rejection(() => harness.service.resolve('old'));
    expect(error.getStatus()).toBe(410);
    expect(codeOf(error)).toBe('session-expired');
    expect(harness.consume).not.toHaveBeenCalled();
  });

  it('повтор jti — 410 и флаг переиспользования', async () => {
    const harness = resolveHarness({ status: 'ok', claims: claims() }, row(), false);
    const error = await rejection(() => harness.service.resolve('again'));
    expect(error.getStatus()).toBe(410);
    expect(codeOf(error)).toBe('session-consumed');
    expect(harness.flagTicketReuse).toHaveBeenCalledWith(claims());
    expect(harness.findUnique).not.toHaveBeenCalled();
  });

  it('REST и уже закрытая смена — 409, без активации и продления', async () => {
    const rest = resolveHarness({ status: 'ok', claims: claims() }, row({ transport: 'REST' }));
    const restError = await rejection(() => rest.service.resolve('key'));
    expect(restError.getStatus()).toBe(409);
    expect(codeOf(restError)).toBe('session-unavailable');
    expect(rest.activatePendingSession).not.toHaveBeenCalled();
    expect(rest.updateMany).not.toHaveBeenCalled();

    const done = resolveHarness({ status: 'ok', claims: claims() }, row({ status: 'COMPLETED' }));
    const doneError = await rejection(() => done.service.resolve('key'));
    expect(doneError.getStatus()).toBe(409);
    expect(codeOf(doneError)).toBe('session-unavailable');
    expect(done.activatePendingSession).not.toHaveBeenCalled();
    expect(done.updateMany).not.toHaveBeenCalled();
  });

  it('чужой sub и пустая сессия — 404', async () => {
    const missing = resolveHarness({ status: 'ok', claims: claims() }, null);
    const missingError = await rejection(() => missing.service.resolve('key'));
    expect(missingError.getStatus()).toBe(404);
    expect(codeOf(missingError)).toBe('invalid-session');

    const foreign = resolveHarness(
      { status: 'ok', claims: claims() },
      row({ userId: '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d' }),
    );
    const foreignError = await rejection(() => foreign.service.resolve('key'));
    expect(foreignError.getStatus()).toBe(404);
  });

  it('PENDING и ACTIVE отдают live-попытку', async () => {
    for (const status of ['PENDING', 'ACTIVE'] as const) {
      const harness = resolveHarness({ status: 'ok', claims: claims() }, row({ status }));
      await expect(harness.service.resolve('key')).resolves.toEqual({
        contractVersion: 1,
        attemptId: sessionId,
        gameLevelId: 'vsm-baseline-01',
        mode: { kind: 'live' },
      });
      expect(harness.activatePendingSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: sessionId, status }),
        now,
      );
    }
  });

  it('resolve ставит expiresAt на now + 3 часа', async () => {
    const harness = resolveHarness({ status: 'ok', claims: claims() }, row({ status: 'PENDING' }));
    await harness.service.resolve('key');
    const extended = new Date(now.getTime() + GAME_ATTEMPT_TTL_MS);
    expect(harness.state.row?.expiresAt).toEqual(extended);
    expect(harness.updateMany).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        status: { in: ['PENDING', 'ACTIVE'] },
        expiresAt: { lt: extended },
      },
      data: { expiresAt: extended },
    });
  });

  it('resolve не сокращает expiresAt, если он позже', async () => {
    const later = new Date(now.getTime() + GAME_ATTEMPT_TTL_MS + 60 * 60 * 1000);
    const extended = new Date(now.getTime() + GAME_ATTEMPT_TTL_MS);
    const harness = resolveHarness(
      { status: 'ok', claims: claims() },
      row({ status: 'ACTIVE', expiresAt: later }),
    );
    await harness.service.resolve('key');
    expect(harness.state.row?.expiresAt).toEqual(later);
    expect(harness.updateMany).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        status: { in: ['PENDING', 'ACTIVE'] },
        expiresAt: { lt: extended },
      },
      data: { expiresAt: extended },
    });
  });

  it('повторный resolve ACTIVE продлевает от нового now', async () => {
    let tick = now.getTime();
    const moving = { now: () => new Date(tick) } as Clock;
    const harness = resolveHarness(
      { status: 'ok', claims: claims() },
      row({ status: 'ACTIVE', expiresAt: new Date(tick + 2 * 60 * 60 * 1000) }),
      true,
      moving,
    );
    await harness.service.resolve('key');
    expect(harness.state.row?.expiresAt).toEqual(new Date(tick + GAME_ATTEMPT_TTL_MS));
    tick += 30 * 60 * 1000;
    await harness.service.resolve('again');
    expect(harness.state.row?.expiresAt).toEqual(new Date(tick + GAME_ATTEMPT_TTL_MS));
    expect(harness.updateMany).toHaveBeenCalledTimes(2);
  });
});

type FinishBag = {
  service: PlatformSessionService;
  state: { row: Row | null };
  emitAsync: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  runs: Map<string, { id: string }>;
  audits: unknown[];
};

function finishHarness(current: Row | null, updateMany?: FinishBag['updateMany']): FinishBag {
  const state = { row: current };
  const runs = new Map<string, { id: string }>();
  const audits: unknown[] = [];
  const emitAsync = vi.fn(async (_event: string, payload: { sessionId: string; runId: string }) => {
    runs.set(payload.sessionId, { id: payload.runId });
    return [];
  });
  const write =
    updateMany ??
    vi.fn(
      async (args: {
        where: { id: string; status: string };
        data: { status: Row['status']; result: unknown };
      }) => {
        if (
          !state.row ||
          state.row.id !== args.where.id ||
          state.row.status !== args.where.status
        ) {
          return { count: 0 };
        }
        state.row.status = args.data.status;
        state.row.result = args.data.result;
        return { count: 1 };
      },
    );
  const createAudit = vi.fn(async (args: { data: unknown }) => {
    audits.push(args.data);
    return {};
  });
  const tx = {
    gameSession: { updateMany: write },
    auditLog: { create: createAudit },
  };
  const prisma = {
    gameSession: {
      findUnique: vi.fn(async (args: { where: { id: string } }) =>
        state.row && state.row.id === args.where.id ? state.row : null,
      ),
      updateMany: write,
    },
    run: {
      findUnique: vi.fn(
        async (args: { where: { sessionId: string } }) => runs.get(args.where.sessionId) ?? null,
      ),
    },
    auditLog: { create: createAudit },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<boolean>) => fn(tx)),
  };
  const service = new PlatformSessionService(
    prisma as unknown as PrismaService,
    {} as TicketService,
    {} as SessionsService,
    { emitAsync } as unknown as EventEmitter2,
    config,
    clock,
  );
  return { service, state, emitAsync, updateMany: write, runs, audits };
}

function storedResult(body: FinishedGameResult, runId: string) {
  return {
    runId,
    suspicious: false,
    summary: finishToSummary(body),
    platform: { payloadSha256: payloadSha256(body), result: body },
  };
}

describe('PlatformSessionService.finish', () => {
  it('путь и тело с разным attemptId — 400', async () => {
    const harness = finishHarness(row({ status: 'ACTIVE' }));
    const error = await rejection(() => harness.service.finish(sessionId, finished('other-id')));
    expect(error.getStatus()).toBe(400);
    expect(codeOf(error)).toBe('attempt-mismatch');
    expect(harness.updateMany).not.toHaveBeenCalled();
  });

  it('неизвестная, REST и не ACTIVE — 404', async () => {
    const missing = finishHarness(null);
    const missingError = await rejection(() =>
      missing.service.finish(sessionId, finished(sessionId)),
    );
    expect(missingError.getStatus()).toBe(404);
    expect(codeOf(missingError)).toBe('attempt-not-found');

    const rest = finishHarness(row({ status: 'ACTIVE', transport: 'REST' }));
    const restError = await rejection(() => rest.service.finish(sessionId, finished(sessionId)));
    expect(restError.getStatus()).toBe(404);

    const pending = finishHarness(row({ status: 'PENDING' }));
    const pendingError = await rejection(() =>
      pending.service.finish(sessionId, finished(sessionId)),
    );
    expect(pendingError.getStatus()).toBe(404);
    expect(pending.updateMany).not.toHaveBeenCalled();
  });

  it('ACTIVE пишет итог и шлёт run.completed один раз', async () => {
    const harness = finishHarness(row({ status: 'ACTIVE', flags: [] }));
    const body = finished(sessionId);
    const first = await harness.service.finish(sessionId, body);
    expect(first.contractVersion).toBe(1);
    expect(first.redirectUrl).toBe(`http://127.0.0.1:5173/runs/${first.resultId}`);
    expect(harness.emitAsync).toHaveBeenCalledTimes(1);
    expect(harness.emitAsync).toHaveBeenCalledWith(
      RUN_COMPLETED,
      expect.objectContaining({
        runId: first.resultId,
        userId,
        sessionId,
        suspicious: false,
        summary: expect.objectContaining({ outcome: 'completed', decisions: [] }),
      }),
    );
    expect(harness.audits).toEqual([
      expect.objectContaining({
        actorType: ActorType.GAME_SERVER,
        action: 'session.completed',
        target: sessionId,
      }),
    ]);
    const saved = harness.state.row?.result as {
      platform: { result: { userInputs: unknown } };
    };
    expect(saved.platform.result.userInputs).toEqual(body.userInputs);

    const again = await harness.service.finish(sessionId, body);
    expect(again).toEqual(first);
    expect(harness.emitAsync).toHaveBeenCalledTimes(1);
  });

  it('кладёт факты в decisions события и не трогает шкалы', async () => {
    const harness = finishHarness(row({ status: 'ACTIVE' }));
    const body = finished(sessionId, {
      assessment: {
        setVersion: 'baseline-v1',
        durationUs: 60_000_000,
        facts: [
          {
            id: 'fire:cabin',
            kind: 'fire',
            at: 60_000_000,
            verdict: 'correct',
            scoreDelta: { safety: 4, customerSatisfaction: -1 },
            detail: { incidentId: 'cabin-fire', extinguished: true, critical: false },
          },
        ],
      },
    });
    await harness.service.finish(sessionId, body);
    expect(harness.emitAsync).toHaveBeenCalledWith(
      RUN_COMPLETED,
      expect.objectContaining({
        summary: expect.objectContaining({
          outcome: 'completed',
          safety: 96,
          loyalty: 84,
          decisions: [
            expect.objectContaining({
              nodeId: 'fire:cabin',
              choiceId: 'fire',
              verdict: 'best',
              stage: 'enroute',
              scenarioId: 'vsm-baseline-01',
            }),
          ],
        }),
      }),
    );
  });

  it('тот же payload с другим порядком ключей не шлёт второе событие', async () => {
    const harness = finishHarness(row({ status: 'ACTIVE' }));
    const body = finished(sessionId);
    const first = await harness.service.finish(sessionId, body);
    const reordered: FinishedGameResult = {
      scores: { customerSatisfaction: 84, safety: 96 },
      termination: { outcomeId: 'destination-arrived', kind: 'route-completed' },
      achievements: { ids: ['inspected-extinguisher'], setVersion: 'baseline-v1' },
      userInputs: [{ command: { cellId: 'c-1', type: 'move-to' }, sequence: 1, at: 1200000 }],
      rootSeed: body.rootSeed,
      content: {
        simulationCompatibilityVersion: '1',
        gameLevelVersion: '1',
        gameLevelId: 'vsm-baseline-01',
      },
      attemptId: sessionId,
    };
    const again = await harness.service.finish(sessionId, reordered);
    expect(again).toEqual(first);
    expect(harness.emitAsync).toHaveBeenCalledTimes(1);
  });

  it('другой payload уже закрытой смены — 409 и не затирает запись', async () => {
    const body = finished(sessionId);
    const harness = finishHarness(
      row({ status: 'COMPLETED', result: storedResult(body, 'winner-run') }),
    );
    harness.runs.set(sessionId, { id: 'winner-run' });
    const conflict = finished(sessionId, { scores: { safety: 10, customerSatisfaction: 10 } });
    const error = await rejection(() => harness.service.finish(sessionId, conflict));
    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('result-conflict');
    expect(harness.state.row?.result).toEqual(storedResult(body, 'winner-run'));
    expect(harness.emitAsync).not.toHaveBeenCalled();
    expect(harness.updateMany).not.toHaveBeenCalled();
  });

  it('проигравшая гонка отдаёт уже записанный чек', async () => {
    const body = finished(sessionId);
    const winnerId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d';
    const harness = finishHarness(row({ status: 'ACTIVE' }));
    harness.updateMany.mockImplementation(async () => {
      const current = harness.state.row;
      if (!current) {
        return { count: 0 };
      }
      current.status = 'COMPLETED';
      current.result = storedResult(body, winnerId);
      harness.runs.set(sessionId, { id: winnerId });
      return { count: 0 };
    });
    const receipt = await harness.service.finish(sessionId, body);
    expect(receipt.resultId).toBe(winnerId);
    expect(receipt.redirectUrl).toBe(`http://127.0.0.1:5173/runs/${winnerId}`);
    expect(harness.emitAsync).not.toHaveBeenCalled();
  });

  it('повтор без строки run догоняет run.completed', async () => {
    const body = finished(sessionId);
    const harness = finishHarness(
      row({ status: 'COMPLETED', result: storedResult(body, 'kept-run') }),
    );
    const receipt = await harness.service.finish(sessionId, body);
    expect(receipt.resultId).toBe('kept-run');
    expect(harness.emitAsync).toHaveBeenCalledTimes(1);
    const second = await harness.service.finish(sessionId, body);
    expect(second).toEqual(receipt);
    expect(harness.emitAsync).toHaveBeenCalledTimes(1);
  });
});
