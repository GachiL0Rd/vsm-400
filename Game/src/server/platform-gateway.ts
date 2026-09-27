import { z } from 'zod';
import { createSilentServerLogger, type ServerLogger } from './logger.ts';
import {
  type FinishedGameResult,
  type FinishSessionResponse,
  type PlatformGateway,
  PlatformGatewayError,
  type ResolvedPlatformSession,
  type SessionMode,
} from './types.ts';

const modeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('live') }),
  z.object({
    kind: z.literal('guided'),
    hints: z.object({
      immediateFeedback: z.boolean(),
      suggestions: z.boolean(),
      highlights: z.boolean(),
      explanations: z.boolean(),
    }),
  }),
  z.object({
    kind: z.literal('replay'),
    source: z.object({
      simulationCompatibilityVersion: z.string(),
      gameLevelVersion: z.string(),
      rootSeed: z.string(),
      userInputs: z.array(z.unknown()),
    }),
    reveal: z.object({
      traits: z.boolean(),
      actionLogits: z.boolean(),
      hiddenObjectState: z.boolean(),
      assessment: z.boolean(),
      explanations: z.boolean(),
    }),
  }),
]);

const resolveResponseSchema = z.object({
  contractVersion: z.literal(1),
  attemptId: z.string().min(1),
  gameLevelId: z.string().min(1),
  mode: modeSchema,
});

const finishResponseSchema = z.object({
  contractVersion: z.literal(1),
  resultId: z.string().min(1),
  redirectUrl: z.string().url(),
});

export interface HttpPlatformGatewayOptions {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
  readonly logger?: ServerLogger;
}

/** HTTP is deliberately contained here; simulation receives only server-domain values. */
export class HttpPlatformGateway implements PlatformGateway {
  private readonly request: typeof fetch;
  private readonly logger: ServerLogger;

  constructor(private readonly options: HttpPlatformGatewayOptions) {
    this.request = options.fetch ?? fetch;
    this.logger = (options.logger ?? createSilentServerLogger()).child({
      component: 'platform-gateway',
    });
  }

  async resolveSession(sessionKey: string): Promise<ResolvedPlatformSession> {
    const response = await this.post(
      '/api/game/sessions/resolve',
      { key: sessionKey },
      'resolve-session',
    );
    const dto = await parseResponse(resolveResponseSchema, response, 'resolve session');
    this.logger.info(
      {
        event: 'platform-session-resolved',
        attemptId: dto.attemptId,
        gameLevelId: dto.gameLevelId,
        mode: dto.mode.kind,
      },
      'Platform session resolved',
    );
    return { attemptId: dto.attemptId, gameLevelId: dto.gameLevelId, mode: dto.mode };
  }

  async finishSession(result: FinishedGameResult): Promise<FinishSessionResponse> {
    const response = await this.post(
      `/api/game/sessions/${encodeURIComponent(result.attemptId)}/finish`,
      result,
      'finish-session',
      result.attemptId,
    );
    const dto = await parseResponse(finishResponseSchema, response, 'finish session');
    this.logger.info(
      { event: 'platform-session-finished', attemptId: result.attemptId, resultId: dto.resultId },
      'Platform accepted terminal result',
    );
    return { resultId: dto.resultId, redirectUrl: dto.redirectUrl };
  }

  private async post(
    path: string,
    body: unknown,
    operation: string,
    attemptId?: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const context = requestLogContext(operation, path, attemptId);
    const startedAt = performance.now();
    this.logger.debug({ event: 'platform-request-start', ...context }, 'Sending Platform request');
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.performPost(path, body, controller.signal);
      if (!response.ok) {
        this.logger.warn(
          {
            event: 'platform-request-http-error',
            ...context,
            status: response.status,
            durationMs: elapsedMs(startedAt),
          },
          'Platform request returned an error status',
        );
        throw platformHttpError(path, response.status);
      }
      this.logger.debug(
        {
          event: 'platform-request-succeeded',
          ...context,
          status: response.status,
          durationMs: elapsedMs(startedAt),
        },
        'Platform request succeeded',
      );
      return response;
    } catch (error) {
      const failure = normalizePlatformRequestError(error, this.options.timeoutMs);
      this.logger.warn(
        {
          err: failure,
          event: 'platform-request-failed',
          ...context,
          kind: failure.kind,
          durationMs: elapsedMs(startedAt),
        },
        platformFailureMessage(failure),
      );
      throw failure;
    } finally {
      clearTimeout(timeout);
    }
  }

  private performPost(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    return this.request(new URL(path, this.options.baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.serviceToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  }
}

function requestLogContext(
  operation: string,
  path: string,
  attemptId?: string,
): Record<string, unknown> {
  return { operation, path, ...(attemptId === undefined ? {} : { attemptId }) };
}

function normalizePlatformRequestError(error: unknown, timeoutMs: number): PlatformGatewayError {
  if (error instanceof PlatformGatewayError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new PlatformGatewayError('timeout', `Platform request timed out after ${timeoutMs}ms`);
  }
  return new PlatformGatewayError('unavailable', `Platform request failed: ${String(error)}`);
}

function platformFailureMessage(error: PlatformGatewayError): string {
  if (error.kind === 'timeout') return 'Platform request timed out';
  if (error.kind === 'unavailable') return 'Platform request transport failed';
  return 'Platform request failed';
}

function platformHttpError(path: string, status: number): PlatformGatewayError {
  const message = `Platform returned ${status} for ${path}`;
  if (status === 401 || status === 403) return new PlatformGatewayError('authentication', message);

  const kind =
    path === '/api/game/sessions/resolve' ? resolveErrorKind(status) : finishErrorKind(status);
  return new PlatformGatewayError(kind, message);
}

function resolveErrorKind(status: number): PlatformGatewayError['kind'] {
  if (status === 404 || status === 410) return 'invalid-session';
  if (status === 409) return 'session-unavailable';
  if (status === 400) return 'contract';
  return 'unavailable';
}

function finishErrorKind(status: number): PlatformGatewayError['kind'] {
  if (status === 404) return 'session-unavailable';
  if (status === 400 || status === 409) return 'contract';
  return 'unavailable';
}

function parseResponse<T>(schema: z.ZodType<T>, response: Response, operation: string): Promise<T> {
  return response
    .json()
    .catch(() => {
      throw new PlatformGatewayError('contract', `Platform ${operation} response is not JSON`);
    })
    .then((body: unknown) => {
      const parsed = schema.safeParse(body);
      if (!parsed.success)
        throw new PlatformGatewayError(
          'contract',
          `Platform ${operation} response violates contract v1`,
        );
      return parsed.data;
    });
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

export class MockPlatformGateway implements PlatformGateway {
  readonly finished: FinishedGameResult[] = [];

  constructor(private readonly session: ResolvedPlatformSession) {}

  async resolveSession(_sessionKey: string): Promise<ResolvedPlatformSession> {
    return this.session;
  }

  async finishSession(result: FinishedGameResult): Promise<FinishSessionResponse> {
    const previous = this.finished.find((candidate) => candidate.attemptId === result.attemptId);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(result)) {
      throw new PlatformGatewayError('contract', `Mock result conflict for ${result.attemptId}`);
    }
    if (previous === undefined) this.finished.push(result);
    return {
      resultId: `mock-result-${result.attemptId}`,
      redirectUrl: `http://localhost/results/${encodeURIComponent(result.attemptId)}`,
    };
  }
}

export function mockMode(kind: 'live' | 'guided'): SessionMode {
  return kind === 'live'
    ? { kind: 'live' }
    : {
        kind: 'guided',
        hints: { immediateFeedback: true, suggestions: true, highlights: true, explanations: true },
      };
}
