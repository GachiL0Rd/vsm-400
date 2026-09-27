import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/env';
import type { RedisService } from '../redis/redis.service';
import { TicketService } from './ticket.service';

const secret = 'local-dev-game-ticket-secret-32ch';
const userId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';
const sessionId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5c';

function service(): { jwt: JwtService; tickets: TicketService } {
  const jwt = new JwtService();
  const tickets = new TicketService(
    jwt,
    { gameTicketSecret: secret } as AppConfig,
    { set: vi.fn() } as unknown as RedisService,
  );
  return { jwt, tickets };
}

function sign(
  jwt: JwtService,
  expiresIn: number,
  payload: Record<string, string> = { sid: sessionId },
) {
  return jwt.signAsync(payload, {
    secret,
    algorithm: 'HS256',
    expiresIn,
    issuer: 'vsm-backend',
    audience: 'vsm-game',
    subject: userId,
    jwtid: 'jti-1',
  });
}

describe('TicketService.classify', () => {
  it('отличает истечение от битой подписи', async () => {
    const { jwt, tickets } = service();
    const expired = await sign(jwt, -30);
    const broken = `${expired}x`;
    await expect(tickets.classify(expired)).resolves.toEqual({ status: 'expired' });
    await expect(tickets.classify(broken)).resolves.toEqual({ status: 'invalid' });
    await expect(tickets.classify('not-a-jwt')).resolves.toEqual({ status: 'invalid' });
  });

  it('принимает живой билет и отвергает чужие claims', async () => {
    const { jwt, tickets } = service();
    const token = await sign(jwt, 60);
    await expect(tickets.classify(token)).resolves.toEqual({
      status: 'ok',
      claims: { sub: userId, sid: sessionId, jti: 'jti-1' },
    });
    const bare = await sign(jwt, 60, {});
    await expect(tickets.classify(bare)).resolves.toEqual({ status: 'invalid' });
    const foreign = await jwt.signAsync(
      { sid: sessionId },
      {
        secret,
        algorithm: 'HS256',
        expiresIn: 60,
        issuer: 'other',
        audience: 'vsm-game',
        subject: userId,
        jwtid: 'jti-1',
      },
    );
    await expect(tickets.classify(foreign)).resolves.toEqual({ status: 'invalid' });
  });
});
