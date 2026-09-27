import { type ClientCommand, GAME_PROTOCOL_VERSION, type ServerMessage } from '../../common';

const RESUME_TOKEN_STORAGE_KEY = 'vsm-game.resume-token';
const SESSION_KEY_STORAGE_KEY = 'vsm-game.session-key';
const LOCAL_DEMO_SESSION_KEY = 'local-demo';

export interface BrowserSessionBootstrapOptions {
  href: string;
  storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;
  replaceUrl(url: string): void;
}

export interface BrowserSessionBootstrap {
  readonly hasCredential: boolean;
  helloCommand(requestId: string): ClientCommand | null;
  observe(message: ServerMessage): void;
  invalidateCredentials(): void;
}

export function createBrowserSessionBootstrap(
  options: BrowserSessionBootstrapOptions,
): BrowserSessionBootstrap {
  const launchUrl = new URL(options.href);
  const launchSessionKey = credential(launchUrl.searchParams.get('sessionKey'));

  if (launchSessionKey !== null) {
    // An explicit launch starts a new platform session, so it must not inherit a
    // resume token left by a different attempt in this browser tab.
    options.storage.removeItem(RESUME_TOKEN_STORAGE_KEY);
    options.storage.setItem(SESSION_KEY_STORAGE_KEY, launchSessionKey);
    launchUrl.searchParams.delete('sessionKey');
    options.replaceUrl(`${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`);
  }

  const localDemoSessionKey = isLocalHost(launchUrl.hostname) ? LOCAL_DEMO_SESSION_KEY : null;
  let sessionKey =
    launchSessionKey ??
    credential(options.storage.getItem(SESSION_KEY_STORAGE_KEY)) ??
    localDemoSessionKey;
  let lastHelloUsedResumeToken = false;
  const resumeToken = (): string | null =>
    credential(options.storage.getItem(RESUME_TOKEN_STORAGE_KEY));

  return {
    get hasCredential(): boolean {
      return sessionKey !== null || resumeToken() !== null;
    },
    helloCommand(requestId: string): ClientCommand | null {
      const resume = resumeToken();
      lastHelloUsedResumeToken = resume !== null;
      if (resume !== null) {
        return {
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'hello',
          requestId,
          resumeToken: resume,
        };
      }
      if (sessionKey !== null) {
        return { protocolVersion: GAME_PROTOCOL_VERSION, type: 'hello', requestId, sessionKey };
      }
      return null;
    },
    observe(message: ServerMessage): void {
      if (message.type !== 'session-ready' || message.resumeToken === undefined) return;
      options.storage.setItem(RESUME_TOKEN_STORAGE_KEY, message.resumeToken);
      options.storage.removeItem(SESSION_KEY_STORAGE_KEY);
      sessionKey = null;
    },
    invalidateCredentials(): void {
      // A rejected resume token on localhost usually means another tab took over
      // the shared demo attempt; start again from the local demo key. A rejected
      // demo key itself must not loop.
      sessionKey = lastHelloUsedResumeToken ? localDemoSessionKey : null;
      options.storage.removeItem(RESUME_TOKEN_STORAGE_KEY);
      options.storage.removeItem(SESSION_KEY_STORAGE_KEY);
    },
  };
}

function credential(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized === '' ? null : normalized;
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
