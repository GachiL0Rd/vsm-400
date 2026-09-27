import { describe, expect, it, vi } from 'vitest';
import { ClientLogger } from './client-log';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const silentOutput = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('ClientLogger', () => {
  it('persists a bounded journal across reloads and exports ordered events', () => {
    const storage = memoryStorage();
    const logger = new ClientLogger({ storage, output: silentOutput, maxEntries: 2 });
    logger.record('info', 'client', 'start');
    logger.record('info', 'navigation', 'step-sent', { requestId: 'move-1' });
    logger.record('warn', 'websocket', 'in.command-result', { status: 'rejected' });
    logger.flush();

    const restored = new ClientLogger({ storage, output: silentOutput, maxEntries: 2 });
    const exported = JSON.parse(restored.exportJson()) as {
      dropped: number;
      entries: Array<{ sequence: number; event: string }>;
    };
    expect(exported.dropped).toBe(1);
    expect(exported.entries.map((entry) => entry.event)).toEqual([
      'step-sent',
      'in.command-result',
    ]);
    expect(exported.entries.map((entry) => entry.sequence)).toEqual([2, 3]);
  });

  it('redacts credentials and form input from the console and exported JSON', () => {
    const logger = new ClientLogger({ output: silentOutput });
    logger.record('info', 'websocket', 'out.hello', {
      sessionKey: 'secret-session',
      nested: { resumeToken: 'secret-resume', input: { note: 'secret-note' } },
      url: '/?sessionKey=secret-url',
    });
    const json = logger.exportJson();
    expect(json).not.toContain('secret-');
    expect(json).toContain('[redacted]');
    expect(silentOutput.info).toHaveBeenCalledWith(
      '[game:websocket] out.hello',
      expect.objectContaining({ sessionKey: '[redacted]' }),
    );
  });

  it('continues collecting when browser storage is unavailable', () => {
    const logger = new ClientLogger({
      output: silentOutput,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('Storage quota exceeded');
        },
        removeItem: () => undefined,
      },
    });
    logger.record('error', 'browser', 'uncaught-error', { message: 'Problem' });
    expect(() => logger.flush()).not.toThrow();
    expect(logger.getEntries()).toHaveLength(1);
  });
});
