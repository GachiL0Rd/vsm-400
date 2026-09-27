import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { Clock } from '../common/clock';
import { acquireCronLock, cronWindow } from '../common/cron-lock';
import { RUN_RECORDED, type RunRecordedPayload } from '../common/events';
import {
  ActorType,
  type Competency,
  NotificationKind,
  type Season,
} from '../generated/prisma/client';
import { competencyTitle } from '../notifications/competency-label';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RulesService } from '../rules/rules.service';
import { challengeText, lowestAverage, readThemeCompetency, runMatchesTheme } from './challenge';
import { challengeAwardKey, challengeThemeKey } from './keys';
import { SeasonsService } from './seasons.service';

const DAY_SEC = 86_400;
const AWARD_TTL_SEC = 40 * DAY_SEC;
const CRON_SLOT_TTL_MS = 30 * 60_000;

/** Пн 00:00 МСК — та же минута, что закрывает прошлую неделю. */
export const CHALLENGE_CRON = '0 0 * * 1';

type Theme = { competency: Competency; fresh: boolean };

@Injectable()
export class ChallengeService {
  private readonly logger = new Logger(ChallengeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  @Cron(CHALLENGE_CRON, {
    name: 'social-challenge-open',
    timeZone: 'Europe/Moscow',
    waitForCompletion: true,
  })
  async openDue(): Promise<void> {
    const now = this.clock.now();
    const locked = await acquireCronLock(
      this.redis,
      'social-challenge-open',
      cronWindow(now, 'day'),
      CRON_SLOT_TTL_MS,
    );
    if (!locked) {
      return;
    }
    await this.openWeek(now);
  }

  @OnEvent(RUN_RECORDED, { async: true })
  async onRunRecorded(payload: RunRecordedPayload): Promise<void> {
    if (payload.suspicious || !payload.depotId) {
      return;
    }
    const now = this.clock.now();
    const season = await this.seasons.current(now);
    const theme = await this.ensureTheme(season, payload.depotId, now);
    if (!theme) {
      return;
    }
    if (theme.fresh) {
      await this.notify(season, payload.depotId, theme.competency);
    }
    await this.award(payload, theme.competency, now);
  }

  async openWeek(now: Date): Promise<void> {
    const season = await this.seasons.current(now);
    const depots = await this.prisma.depot.findMany({ select: { id: true } });
    for (const depot of depots) {
      const theme = await this.ensureTheme(season, depot.id, now);
      if (!theme) {
        continue;
      }
      await this.notify(season, depot.id, theme.competency);
    }
  }

  private async ensureTheme(season: Season, depotId: string, now: Date): Promise<Theme | null> {
    const key = challengeThemeKey(season.id, depotId);
    const cached = await this.readCache(key);
    if (cached) {
      return { competency: cached, fresh: false };
    }
    const audited = await this.readAudit(season.id, depotId);
    if (audited) {
      await this.redis.set(key, audited, 'EX', themeTtlSec(now, season.endsAt));
      return { competency: audited, fresh: false };
    }
    const rows = await this.prisma.competencyScore.findMany({
      where: { user: { disabledAt: null, brigade: { depotId } } },
      select: { competency: true, value: true },
    });
    const competency = lowestAverage(rows);
    if (!competency) {
      return null;
    }
    const gate = await this.redis.set(key, competency, 'EX', themeTtlSec(now, season.endsAt), 'NX');
    if (gate !== 'OK') {
      const winner = (await this.readCache(key)) ?? competency;
      return { competency: winner, fresh: false };
    }
    await this.prisma.auditLog.create({
      data: {
        actorType: ActorType.SYSTEM,
        action: 'challenge.theme',
        target: themeTarget(season.id, depotId),
        meta: { competency },
      },
    });
    return { competency, fresh: true };
  }

  private async notify(season: Season, depotId: string, competency: Competency): Promise<void> {
    const title = competencyTitle(competency);
    const users = await this.prisma.user.findMany({
      where: { disabledAt: null, brigade: { depotId } },
      select: { id: true },
    });
    for (const user of users) {
      await this.notifications.create(user.id, {
        kind: NotificationKind.challenge,
        title: `Неделя ${title}`,
        text: challengeText(title),
        dedupKey: `challenge:${season.id}:${user.id}`,
      });
    }
  }

  private async award(payload: RunRecordedPayload, theme: Competency, now: Date): Promise<void> {
    const run = await this.prisma.run.findUnique({
      where: { id: payload.runId },
      select: {
        competencyDelta: true,
        decisions: { select: { scenarioId: true } },
      },
    });
    if (!run) {
      return;
    }
    const ids = uniqueIds(run.decisions.map((decision) => decision.scenarioId));
    const scenarios =
      ids.length === 0
        ? []
        : await this.prisma.scenario.findMany({
            where: { id: { in: ids } },
            select: { competencies: true },
          });
    if (
      !runMatchesTheme(
        theme,
        scenarios.map((row) => row.competencies),
        run.competencyDelta,
      )
    ) {
      return;
    }
    const amount = this.rules.challengePoints();
    if (amount <= 0) {
      return;
    }
    const gate = await this.redis.set(
      challengeAwardKey(payload.runId),
      '1',
      'EX',
      AWARD_TTL_SEC,
      'NX',
    );
    if (gate !== 'OK') {
      return;
    }
    try {
      const existing = await this.prisma.pointLedger.findFirst({
        where: { runId: payload.runId, reason: 'CHALLENGE' },
        select: { id: true },
      });
      if (existing) {
        return;
      }
      await this.prisma.pointLedger.create({
        data: {
          userId: payload.userId,
          amount,
          reason: 'CHALLENGE',
          runId: payload.runId,
          expiresAt: new Date(now.getTime() + this.rules.pointsTtlDays() * DAY_SEC * 1000),
        },
      });
    } catch (error) {
      await this.redis.del(challengeAwardKey(payload.runId));
      this.logger.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async readCache(key: string): Promise<Competency | null> {
    const raw = await this.redis.get(key);
    return readThemeCompetency({ competency: raw });
  }

  private async readAudit(seasonId: string, depotId: string): Promise<Competency | null> {
    const row = await this.prisma.auditLog.findFirst({
      where: { action: 'challenge.theme', target: themeTarget(seasonId, depotId) },
      orderBy: { id: 'desc' },
    });
    return readThemeCompetency(row?.meta);
  }
}

function themeTarget(seasonId: string, depotId: string): string {
  return `${seasonId}:${depotId}`;
}

function themeTtlSec(now: Date, endsAt: Date): number {
  const seconds = Math.ceil((endsAt.getTime() - now.getTime()) / 1000) + DAY_SEC;
  if (!Number.isFinite(seconds) || seconds < 3600) {
    return 3600;
  }
  return seconds;
}

function uniqueIds(ids: readonly string[]): string[] {
  const unique: string[] = [];
  for (const id of ids) {
    if (!unique.includes(id)) {
      unique.push(id);
    }
  }
  return unique;
}
