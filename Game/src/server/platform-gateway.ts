import { z } from 'zod';
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
}

/** HTTP is deliberately contained here; simulation receives only server-domain values. */
export class HttpPlatformGateway implements PlatformGateway {
  private readonly request: typeof fetch;

  constructor(private readonly options: HttpPlatformGatewayOptions) {
    this.request = options.fetch ?? fetch;
  }

  async resolveSession(sessionKey: string): Promise<ResolvedPlatformSession> {
    const response = await this.post('/api/game/sessions/resolve', { key: sessionKey });
    const dto = await parseResponse(resolveResponseSchema, response, 'resolve session');
    return { attemptId: dto.attemptId, gameLevelId: dto.gameLevelId, mode: dto.mode };
  }

  async finishSession(result: FinishedGameResult): Promise<FinishSessionResponse> {
    const response = await this.post(
      `/api/game/sessions/${encodeURIComponent(result.attemptId)}/finish`,
      result,
    );
    const dto = await parseResponse(finishResponseSchema, response, 'finish session');
    return { resultId: dto.resultId, redirectUrl: dto.redirectUrl };
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.request(new URL(path, this.options.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.serviceToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw platformHttpError(path, response.status);
      return response;
    } catch (error) {
      if (error instanceof PlatformGatewayError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PlatformGatewayError(
          'timeout',
          `Platform request timed out after ${this.options.timeoutMs}ms`,
        );
      }
      throw new PlatformGatewayError('unavailable', `Platform request failed: ${String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
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
