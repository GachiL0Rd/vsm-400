import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ACHIEVEMENT_GRANTED,
  type AchievementGrantedPayload,
  ASSIGNMENT_CREATED,
  type AssignmentCreatedPayload,
  PROMOTION_RECOMMENDED,
  type PromotionRecommendedPayload,
  SCENARIO_PUBLISHED,
  type ScenarioPublishedPayload,
} from '../common/events';
import { NotificationKind, Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { gradeLabel, pointsWord } from './ru-format';

@Injectable()
export class NotificationListener {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(ACHIEVEMENT_GRANTED, { async: true })
  async onAchievement(payload: AchievementGrantedPayload): Promise<void> {
    const title = `Получен знак «${payload.title}»`;
    const run = await this.prisma.run.findFirst({
      where: { userId: payload.userId },
      orderBy: { finishedAt: 'desc' },
      select: { id: true },
    });
    const text =
      payload.bonusPoints > 0
        ? `Начислено ${payload.bonusPoints} ${pointsWord(payload.bonusPoints)}.`
        : 'Знак в коллекции.';
    await this.notifications.create(payload.userId, {
      kind: NotificationKind.achievement,
      title,
      text,
      link: run ? `/runs/${run.id}` : undefined,
      dedupKey: `achievement:${payload.userId}:${payload.code}`,
    });
  }

  @OnEvent(PROMOTION_RECOMMENDED, { async: true })
  async onPromotion(payload: PromotionRecommendedPayload): Promise<void> {
    const from = gradeLabel(payload.fromGrade);
    const to = gradeLabel(payload.toGrade);
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { callsign: true, brigadeId: true },
    });
    await this.notifications.create(payload.userId, {
      kind: NotificationKind.promotion,
      title: 'Рекомендовано повышение',
      text: `С «${from}» на «${to}».`,
      dedupKey: `promotion:${payload.recommendationId}`,
    });
    if (!user?.brigadeId) {
      return;
    }
    const chief = await this.prisma.user.findFirst({
      where: { brigadeId: user.brigadeId, role: Role.CHIEF, disabledAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!chief || chief.id === payload.userId) {
      return;
    }
    const callsign = user.callsign;
    await this.notifications.create(chief.id, {
      kind: NotificationKind.promotion,
      title: 'Рекомендовано повышение',
      text: `#${callsign}: с «${from}» на «${to}».`,
      dedupKey: `promotion:${payload.recommendationId}:chief`,
    });
  }

  @OnEvent(ASSIGNMENT_CREATED, { async: true })
  async onAssignment(payload: AssignmentCreatedPayload): Promise<void> {
    const text = await this.assignmentText(payload.scenarioIds);
    await this.notifications.create(payload.userId, {
      kind: NotificationKind.assignment,
      title: 'Назначена смена',
      text,
      dedupKey: `assignment:${payload.assignmentId}`,
    });
  }

  @OnEvent(SCENARIO_PUBLISHED, { async: true })
  async onScenarioPublished(payload: ScenarioPublishedPayload): Promise<void> {
    const scenario = await this.prisma.scenario.findUnique({
      where: { id: payload.scenarioId },
      select: { id: true, title: true, carClasses: true, status: true },
    });
    if (scenario?.status !== 'PUBLISHED') {
      return;
    }
    if (scenario.carClasses.length === 0) {
      return;
    }
    const conductors = await this.prisma.user.findMany({
      where: {
        role: Role.CONDUCTOR,
        disabledAt: null,
        OR: [
          { runs: { some: { carClass: { in: scenario.carClasses } } } },
          { assignedShifts: { some: { carClass: { in: scenario.carClasses } } } },
        ],
      },
      select: { id: true },
    });
    for (const conductor of conductors) {
      await this.notifications.create(conductor.id, {
        kind: NotificationKind.scenario,
        title: `Новый сценарий «${scenario.title}»`,
        text: scenario.title,
        dedupKey: `scenario:${scenario.id}:v${payload.version}:${conductor.id}`,
      });
    }
  }

  private async assignmentText(scenarioIds: readonly string[]): Promise<string> {
    if (scenarioIds.length === 0) {
      return 'Смена назначена.';
    }
    const rows = await this.prisma.scenario.findMany({
      where: { id: { in: [...scenarioIds] } },
      select: { id: true, title: true },
    });
    const titles = new Map(rows.map((row) => [row.id, row.title]));
    const names: string[] = [];
    for (const id of scenarioIds) {
      names.push(titles.get(id) ?? id);
    }
    return names.join(', ');
  }
}
