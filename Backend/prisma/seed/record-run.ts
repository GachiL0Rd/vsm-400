import { createHash, randomUUID } from 'node:crypto';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { RUN_COMPLETED } from '../../src/common/events';
import { commitOf } from '../../src/engine/rng';
import type { Prisma } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { payloadSha256 } from '../../src/sessions/canonical-json';
import { finishToSummary } from '../../src/sessions/finish-map';
import type { FinishedGameResult } from '../../src/sessions/platform.dto';
import { encryptSeed } from '../../src/sessions/seed-box';

const MIN_PLAY_MS = 60_000;

/** План сессии описывает уровень vsm-train2-01, не текстовый квест. */
const LEVEL_PLAN = {
  train: 'ВСМ-001',
  route: 'Москва — Санкт-Петербург',
  fromStation: 'Москва',
  toStation: 'Санкт-Петербург',
  stops: ['Тверь'],
  car: 1,
  carClass: 'BUSINESS',
  departure: '12:00',
  scenarios: [],
} as const;

type Recorder = {
  prisma: PrismaService;
  events: EventEmitter2;
  seedKey: string;
};

export async function recordFixtureRun(
  deps: Recorder,
  userId: string,
  fixture: FinishedGameResult,
  finishedAt: Date,
): Promise<void> {
  const playMs = Math.max(MIN_PLAY_MS, Math.round((fixture.assessment?.durationUs ?? 0) / 1000));
  const startedAt = new Date(finishedAt.getTime() - playMs);
  const seed = createHash('sha256')
    .update(`vsm-train2-01:${fixture.rootSeed}:${finishedAt.toISOString()}`)
    .digest();
  const session = await deps.prisma.gameSession.create({
    data: {
      userId,
      status: 'COMPLETED',
      transport: 'WS',
      plan: asJson(LEVEL_PLAN),
      seedCommit: commitOf(seed),
      seedEnc: encryptSeed(seed, deps.seedKey),
      startedAt,
      finishedAt,
      expiresAt: finishedAt,
      createdAt: startedAt,
      flags: [],
    },
  });
  const body: FinishedGameResult = { ...fixture, attemptId: session.id };
  const summary = finishToSummary(body);
  const runId = randomUUID();
  await deps.prisma.gameSession.update({
    where: { id: session.id },
    data: {
      result: asJson({
        runId,
        suspicious: false,
        summary,
        platform: { payloadSha256: payloadSha256(body), result: body },
      }),
    },
  });
  await deps.events.emitAsync(RUN_COMPLETED, {
    runId,
    userId,
    sessionId: session.id,
    summary,
    suspicious: false,
  });
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
