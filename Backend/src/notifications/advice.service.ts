import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Clock } from '../common/clock';
import type { Competency } from '../generated/prisma/client';
import { NotificationKind } from '../generated/prisma/client';
import { seasonWindow } from '../leaderboard/season-window';
import { PrismaService } from '../prisma/prisma.service';
import { RulesService } from '../rules/rules.service';
import { adviceText, adviceTitle } from './advice';
import { COMPETENCY_ORDER } from './competency-label';
import { NotificationsService } from './notifications.service';

/** Пн 09:00 МСК. День недели: 1 — понедельник, как у закрытия сезона. */
export const ADVICE_CRON = '0 9 * * 1';

type Person = {
  id: string;
  depotId: string;
  scores: { competency: Competency; value: number }[];
};

@Injectable()
export class AdviceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  @Cron(ADVICE_CRON, {
    name: 'social-advice-weekly',
    timeZone: 'Europe/Moscow',
    waitForCompletion: true,
  })
  adviseDue(): Promise<number> {
    return this.advise(this.clock.now());
  }

  async advise(now: Date): Promise<number> {
    const week = seasonWindow(now).startsAt.toISOString();
    const weak = this.rules.weakScore();
    const people = await this.people();
    const averages = depotAverages(people);
    let sent = 0;
    for (const person of people) {
      sent += await this.advisePerson(person, averages.get(person.depotId), weak, week);
    }
    return sent;
  }

  private async advisePerson(
    person: Person,
    averages: Map<Competency, number> | undefined,
    weak: number,
    week: string,
  ): Promise<number> {
    if (!averages) {
      return 0;
    }
    let sent = 0;
    for (const competency of COMPETENCY_ORDER) {
      const raw = scoreOf(person, competency);
      if (raw === null) {
        continue;
      }
      const average = averages.get(competency);
      if (average === undefined) {
        continue;
      }
      const mine = Math.round(raw);
      if (mine >= weak || mine >= average) {
        continue;
      }
      await this.notifications.create(person.id, {
        kind: NotificationKind.advice,
        title: adviceTitle(competency),
        text: adviceText(competency, mine, average),
        dedupKey: `advice:${week}:${person.id}:${competency}`,
      });
      sent += 1;
    }
    return sent;
  }

  private async people(): Promise<Person[]> {
    const rows = await this.prisma.user.findMany({
      where: { disabledAt: null, brigadeId: { not: null } },
      select: {
        id: true,
        brigade: { select: { depotId: true } },
        competencyScores: { select: { competency: true, value: true } },
      },
    });
    const people: Person[] = [];
    for (const row of rows) {
      if (!row.brigade) {
        continue;
      }
      people.push({
        id: row.id,
        depotId: row.brigade.depotId,
        scores: row.competencyScores,
      });
    }
    return people;
  }
}

function scoreOf(person: Person, competency: Competency): number | null {
  for (const score of person.scores) {
    if (score.competency === competency && Number.isFinite(score.value)) {
      return score.value;
    }
  }
  return null;
}

function depotAverages(people: readonly Person[]): Map<string, Map<Competency, number>> {
  const buckets = new Map<string, Map<Competency, { total: number; count: number }>>();
  for (const person of people) {
    for (const score of person.scores) {
      if (!Number.isFinite(score.value)) {
        continue;
      }
      let depot = buckets.get(person.depotId);
      if (!depot) {
        depot = new Map();
        buckets.set(person.depotId, depot);
      }
      const bucket = depot.get(score.competency) ?? { total: 0, count: 0 };
      bucket.total += score.value;
      bucket.count += 1;
      depot.set(score.competency, bucket);
    }
  }
  const averages = new Map<string, Map<Competency, number>>();
  for (const [depotId, depot] of buckets) {
    const rounded = new Map<Competency, number>();
    for (const [competency, bucket] of depot) {
      rounded.set(competency, Math.round(bucket.total / bucket.count));
    }
    averages.set(depotId, rounded);
  }
  return averages;
}
