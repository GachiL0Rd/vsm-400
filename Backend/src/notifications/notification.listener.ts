import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ACHIEVEMENT_GRANTED,
  type AchievementGrantedPayload,
  ASSIGNMENT_CREATED,
  type AssignmentCreatedPayload,
  PROMOTION_RECOMMENDED,
  type PromotionRecommendedPayload,
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
    const existing = await this.prisma.notification.findFirst({
      where: { userId: payload.userId, kind: NotificationKind.achievement, title },
    });
    if (existing) {
      return;
    }
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
      link: run ? `/runs/${run.id}` : `vsm:achievement:${payload.userId}:${payload.code}`,
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
      link: `vsm:promo:${payload.recommendationId}`,
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
      link: `vsm:promo:${payload.recommendationId}:chief`,
    });
  }

  @OnEvent(ASSIGNMENT_CREATED, { async: true })
  async onAssignment(payload: AssignmentCreatedPayload): Promise<void> {
    const text =
      payload.scenarioIds.length > 0 ? payload.scenarioIds.join(', ') : 'Список сценариев пуст.';
    await this.notifications.create(payload.userId, {
      kind: NotificationKind.assignment,
      title: 'Назначен сценарий',
      text,
      link: `vsm:assignment:${payload.assignmentId}`,
    });
  }
}
