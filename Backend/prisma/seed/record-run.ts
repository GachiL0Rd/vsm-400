import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { RUN_COMPLETED } from '../../src/common/events';
import { commitOf } from '../../src/engine/rng';
import type { Prisma } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SimulatedRun } from './play';

type Recorder = {
  prisma: PrismaService;
  events: EventEmitter2;
  seedKey: string;
};

/** seedEnc — AES-256-GCM, как в контракте сессии. IV случайный: наружу seed не нужен. */
function sealSeed(keyHex: string, seed: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([cipher.update(seed), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function recordRun(deps: Recorder, userId: string, run: SimulatedRun): Promise<void> {
  const playMs = (8 + ((run.seed[0] ?? 0) % 10)) * 60_000;
  const startedAt = new Date(run.finishedAt.getTime() - playMs);
  const session = await deps.prisma.gameSession.create({
    data: {
      userId,
      status: 'COMPLETED',
      transport: 'REST',
      plan: asJson(run.plan),
      seedCommit: commitOf(run.seed),
      seedEnc: sealSeed(deps.seedKey, run.seed),
      state: asJson(run.state),
      seq: run.state.seq,
      startedAt,
      finishedAt: run.finishedAt,
      expiresAt: new Date(run.finishedAt.getTime() + 3_600_000),
      createdAt: startedAt,
      flags: [],
    },
  });
  await deps.events.emitAsync(RUN_COMPLETED, {
    runId: randomUUID(),
    userId,
    sessionId: session.id,
    summary: run.summary,
    suspicious: false,
  });
}
