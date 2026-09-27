import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openedSessionSchema } from './dto';
import { gameLaunchUrl, runRedirectUrl } from './platform-url';

const runId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';

describe('gameLaunchUrl', () => {
  it('кладёт sessionKey и кодирует билет', () => {
    const ticket = 'a+b/c== ?й';
    const url = gameLaunchUrl('http://127.0.0.1:4174/', ticket);
    const parsed = new URL(url);
    expect(parsed.origin).toBe('http://127.0.0.1:4174');
    expect(parsed.pathname).toBe('/');
    expect(parsed.searchParams.get('sessionKey')).toBe(ticket);
    expect(url).not.toContain('sessionKey=a+');
    expect(url).toContain('sessionKey=');
  });

  it('сохраняет путь и уже заданный query', () => {
    const url = gameLaunchUrl('http://127.0.0.1:4174/play/?lang=ru', 'ticket');
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/play/');
    expect(parsed.searchParams.get('lang')).toBe('ru');
    expect(parsed.searchParams.get('sessionKey')).toBe('ticket');
  });
});

describe('runRedirectUrl', () => {
  it('терпит хвостовой слэш и даёт абсолютный URL рейса', () => {
    expect(runRedirectUrl('http://127.0.0.1:5173/', runId)).toBe(
      `http://127.0.0.1:5173/runs/${runId}`,
    );
    expect(runRedirectUrl('http://127.0.0.1:5173', runId)).toBe(
      `http://127.0.0.1:5173/runs/${runId}`,
    );
    expect(runRedirectUrl('https://app.example/cabinet/?x=1#top', runId)).toBe(
      `https://app.example/cabinet/runs/${runId}`,
    );
    expect(z.url().safeParse(runRedirectUrl('http://127.0.0.1:5173/', runId)).success).toBe(true);
  });
});

describe('openedSessionSchema', () => {
  it('требует launchUrl', () => {
    const body = {
      sessionId: runId,
      ticket: 'ticket',
      wsUrl: 'ws://127.0.0.1:3001/game',
      seedCommit: 'a'.repeat(64),
      plan: {
        train: '752',
        route: 'Москва — Петербург',
        car: 3,
        carClass: 'ECONOMY',
        departure: '06:00',
        segments: 1,
        titles: [],
      },
    };
    expect(openedSessionSchema.safeParse(body).success).toBe(false);
    expect(
      openedSessionSchema.safeParse({
        ...body,
        launchUrl: gameLaunchUrl('http://127.0.0.1:4174/', body.ticket),
      }).success,
    ).toBe(true);
  });
});
