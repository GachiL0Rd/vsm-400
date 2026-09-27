export type SessionMode =
  | { readonly kind: 'live' }
  | {
      readonly kind: 'guided';
      readonly hints: {
        readonly immediateFeedback: boolean;
        readonly suggestions: boolean;
        readonly highlights: boolean;
        readonly explanations: boolean;
      };
    }
  | {
      readonly kind: 'replay';
      readonly source: {
        readonly simulationCompatibilityVersion: string;
        readonly gameLevelVersion: string;
        readonly rootSeed: string;
        readonly userInputs: readonly unknown[];
      };
      readonly reveal: {
        readonly traits: boolean;
        readonly actionLogits: boolean;
        readonly hiddenObjectState: boolean;
        readonly assessment: boolean;
        readonly explanations: boolean;
      };
    };

export interface ResolvedPlatformSession {
  readonly attemptId: string;
  readonly gameLevelId: string;
  readonly mode: SessionMode;
}

export interface FinishedGameResult {
  readonly attemptId: string;
  readonly content: {
    readonly gameLevelId: string;
    readonly gameLevelVersion: string;
    readonly simulationCompatibilityVersion: string;
  };
  readonly rootSeed: string;
  readonly userInputs: readonly unknown[];
  readonly achievements: {
    readonly setVersion: string;
    readonly ids: readonly string[];
  };
  readonly termination: {
    readonly kind: 'route-completed' | 'terminal-rule';
    readonly outcomeId: string;
  };
  readonly scores: {
    readonly safety: number;
    readonly customerSatisfaction: number;
  };
}

export interface FinishSessionResponse {
  readonly resultId: string;
  readonly redirectUrl: string;
}

export interface PlatformGateway {
  resolveSession(sessionKey: string): Promise<ResolvedPlatformSession>;
  finishSession(result: FinishedGameResult): Promise<FinishSessionResponse>;
}

export class PlatformGatewayError extends Error {
  constructor(
    readonly kind:
      | 'invalid-session'
      | 'session-unavailable'
      | 'authentication'
      | 'unavailable'
      | 'contract'
      | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'PlatformGatewayError';
  }
}
