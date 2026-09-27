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

  it('falls back to the local demo key when a localhost resume token is rejected', () => {
    const storage = new MemoryStorage();
    storage.setItem('vsm-game.resume-token', 'superseded-token');
    const bootstrap = createBrowserSessionBootstrap({
      href: 'http://localhost:4174/',
      storage,
      replaceUrl: () => undefined,
    });

    expect(bootstrap.helloCommand('hello-1')).toMatchObject({ resumeToken: 'superseded-token' });
    bootstrap.invalidateCredentials();

    expect(bootstrap.hasCredential).toBe(true);
    expect(bootstrap.helloCommand('hello-2')).toMatchObject({ sessionKey: 'local-demo' });
  });

  it('does not retry the local demo key after the demo key itself is rejected', () => {
    const bootstrap = createBrowserSessionBootstrap({
      href: 'http://localhost:4174/',
      storage: new MemoryStorage(),
      replaceUrl: () => undefined,
    });

    expect(bootstrap.helloCommand('hello-1')).toMatchObject({ sessionKey: 'local-demo' });
    bootstrap.invalidateCredentials();

    expect(bootstrap.hasCredential).toBe(false);
  });

  it('does not invent a fallback credential for a rejected remote resume token', () => {
    const storage = new MemoryStorage();
    storage.setItem('vsm-game.resume-token', 'expired-token');
    const bootstrap = createBrowserSessionBootstrap({
      href: 'https://game.test/',
      storage,
      replaceUrl: () => undefined,
    });

    bootstrap.helloCommand('hello-1');
    bootstrap.invalidateCredentials();

    expect(bootstrap.hasCredential).toBe(false);
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

  it('uses a demo session key when the local game is opened directly', () => {
    const bootstrap = createBrowserSessionBootstrap({
      href: 'http://127.0.0.1:4174/',
      storage: new MemoryStorage(),
      replaceUrl: () => undefined,
    });

    expect(bootstrap.helloCommand('hello-local')).toMatchObject({ sessionKey: 'local-demo' });
  });

  it('still requires an explicit credential outside the local game', () => {
    const bootstrap = createBrowserSessionBootstrap({
      href: 'https://game.test/',
      storage: new MemoryStorage(),
      replaceUrl: () => undefined,
    });

    expect(bootstrap.hasCredential).toBe(false);
  });
});
