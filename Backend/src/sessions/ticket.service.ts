import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { RedisService } from '../redis/redis.service';
import { TICKET_REDIS_TTL_SEC, TICKET_TTL_SEC } from './game-cookie';
import { invalidTicket } from './http-errors';

const ISSUER = 'vsm-backend';
const AUDIENCE = 'vsm-game';

const claimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  jti: z.string().min(1),
});

export type TicketClaims = z.infer<typeof claimsSchema>;

export type TicketVerdict =
  | { status: 'ok'; claims: TicketClaims }
  | { status: 'expired' }
  | { status: 'invalid' };

@Injectable()
export class TicketService {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  sign(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sid: sessionId },
      {
        secret: this.config.gameTicketSecret,
        algorithm: 'HS256',
        expiresIn: TICKET_TTL_SEC,
        issuer: ISSUER,
        audience: AUDIENCE,
        subject: userId,
        jwtid: randomUUID(),
      },
    );
  }

  /** Legacy /api/internal/v1: и просроченный, и битый билет — 401. */
  async read(token: string): Promise<TicketClaims> {
    const verdict = await this.classify(token);
    if (verdict.status !== 'ok') {
      throw invalidTicket();
    }
    return verdict.claims;
  }

  /** Platform resolve отличает истечение от битой подписи. 401 здесь не бывает. */
  async classify(token: string): Promise<TicketVerdict> {
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.gameTicketSecret,
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const parsed = claimsSchema.safeParse(payload);
      if (!parsed.success) {
        return { status: 'invalid' };
      }
      return { status: 'ok', claims: parsed.data };
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        return { status: 'expired' };
      }
      return { status: 'invalid' };
    }
  }

  /** true — билет погашен впервые. false — jti уже был. */
  async consume(jti: string): Promise<boolean> {
    const result = await this.redis.set(`vsm:ticket:${jti}`, '1', 'EX', TICKET_REDIS_TTL_SEC, 'NX');
    return result === 'OK';
  }
}
