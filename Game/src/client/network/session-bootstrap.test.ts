import { describe, expect, it } from 'vitest';
import { GAME_PROTOCOL_VERSION } from '../../common';
import { createBrowserSessionBootstrap } from './session-bootstrap';

class MemoryStorage implements Pick<Storage, 'getItem' | 'removeItem' | 'setItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('browser session bootstrap', () => {
  it('uses the launch session key once, then prefers the server resume token', () => {
    const storage = new MemoryStorage();
    const replacedUrls: string[] = [];
    const bootstrap = createBrowserSessionBootstrap({
      href: 'https://game.test/?sessionKey=platform-key',
      storage,
      replaceUrl: (url) => replacedUrls.push(url),
    });

    expect(replacedUrls).toEqual(['/']);

    expect(bootstrap.helloCommand('hello-1')).toEqual({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'hello',
      requestId: 'hello-1',
      sessionKey: 'platform-key',
    });
    bootstrap.observe({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'session-ready',
      attemptId: 'attempt-1',
      resumeToken: 'resume-1',
      snapshot: {} as never,
    });
    expect(bootstrap.helloCommand('hello-2')).toEqual({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'hello',
      requestId: 'hello-2',
      resumeToken: 'resume-1',
    });
  });

  it('has an explicit credential-free state after authentication is rejected', () => {
    const bootstrap = createBrowserSessionBootstrap({
      href: 'https://game.test/?sessionKey=platform-key',
      storage: new MemoryStorage(),
      replaceUrl: () => undefined,
    });

    bootstrap.invalidateCredentials();

    expect(bootstrap.hasCredential).toBe(false);
    expect(bootstrap.helloCommand('hello-1')).toBeNull();
  });

  it('retains a launch credential across a reload before session-ready arrives', () => {
    const storage = new MemoryStorage();
    createBrowserSessionBootstrap({
      href: 'https://game.test/?sessionKey=platform-key',
      storage,
      replaceUrl: () => undefined,
    });
    const reloaded = createBrowserSessionBootstrap({
      href: 'https://game.test/',
      storage,
      replaceUrl: () => undefined,
    });

    expect(reloaded.helloCommand('hello-reload')).toMatchObject({ sessionKey: 'platform-key' });
  });
});
