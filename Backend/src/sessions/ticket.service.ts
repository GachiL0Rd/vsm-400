import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

  async read(token: string): Promise<TicketClaims> {
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.gameTicketSecret,
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch {
      throw invalidTicket();
    }
    const parsed = claimsSchema.safeParse(payload);
    if (!parsed.success) {
      throw invalidTicket();
    }
    return parsed.data;
  }

  /** true — билет погашен впервые. false — jti уже был. */
  async consume(jti: string): Promise<boolean> {
    const result = await this.redis.set(`vsm:ticket:${jti}`, '1', 'EX', TICKET_REDIS_TTL_SEC, 'NX');
    return result === 'OK';
  }
}
