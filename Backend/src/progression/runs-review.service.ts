import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { Clock } from '../common/clock';
import { ActorType, type Prisma, Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RulesService } from '../rules/rules.service';
import { assertUuid } from './lock-user';
import { difficultyOf, type PointsRun, pointsForRun } from './run-points';
import { RunRecorder } from './run-recorder';

const DAY_MS = 86_400_000;
const QUEUE_LIMIT = 100;

export type RunReviewView = {
  id: string;
  userId: string;
  suspicious: boolean;
  points: number;
  reviewApproved: boolean;
  reviewedAt: string;
  reviewedById: string;
};

export type SuspiciousRunView = {
  id: string;
  userId: string;
  callsign: string;
  brigadeId: string | null;
  train: string;
  route: string;
  outcome: string;
  points: number;
  finishedAt: string;
};

type AccessRow = {
  id: string;
  userId: string;
  suspicious: boolean;
  reviewedAt: Date | null;
  user: { brigadeId: string | null };
};

@Injectable()
export class RunsReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(RunRecorder) private readonly recorder: RunRecorder,
  ) {}

  async queue(actor: AuthUser): Promise<SuspiciousRunView[]> {
    this.assertStaff(actor);
    if (actor.role === Role.CHIEF && !actor.brigadeId) {
      return [];
    }
    const rows = await this.prisma.run.findMany({
      where: {
        suspicious: true,
        reviewedAt: null,
        ...(actor.role === Role.CHIEF ? { user: { brigadeId: actor.brigadeId } } : {}),
      },
      orderBy: { finishedAt: 'desc' },
      take: QUEUE_LIMIT,
      select: {
        id: true,
        userId: true,
        train: true,
        route: true,
        outcome: true,
        points: true,
        finishedAt: true,
        user: { select: { callsign: true, brigadeId: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      callsign: row.user.callsign,
      brigadeId: row.user.brigadeId,
      train: row.train,
      route: row.route,
      outcome: row.outcome,
      points: row.points,
      finishedAt: row.finishedAt.toISOString(),
    }));
  }

  async review(actor: AuthUser, runId: string, approve: boolean): Promise<RunReviewView> {
    this.assertStaff(actor);
    const current = await this.loadAccess(runId);
    this.assertBrigade(actor, current.user.brigadeId);
    if (actor.id === current.userId) {
      throw new ForbiddenException({
        message: 'Нельзя разбирать собственный рейс',
        code: 'SELF_DECISION',
      });
    }
    if (current.reviewedAt) {
      throw reviewed();
    }
    if (!current.suspicious) {
      throw notSuspicious();
    }

    const now = this.clock.now();
    await this.prisma.$transaction((tx) => this.commitReview(tx, actor, runId, approve, now));

    if (approve) {
      const payload = await this.recorder.payloadOf(runId);
      if (payload) {
        await this.recorder.dispatchEffects(payload);
      }
    }

    const saved = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!saved?.reviewedAt || saved.reviewApproved === null || !saved.reviewedById) {
      throw new NotFoundException({ message: 'Рейс не найден', code: 'NOT_FOUND' });
    }
    return {
      id: saved.id,
      userId: saved.userId,
      suspicious: saved.suspicious,
      points: saved.points,
      reviewApproved: saved.reviewApproved,
      reviewedAt: saved.reviewedAt.toISOString(),
      reviewedById: saved.reviewedById,
    };
  }

  private async commitReview(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    runId: string,
    approve: boolean,
    now: Date,
  ): Promise<void> {
    const run = await tx.run.findUnique({
      where: { id: runId },
      include: {
        decisions: {
          orderBy: { idx: 'asc' },
          select: {
            scenarioId: true,
            choiceId: true,
            verdict: true,
            reactionMs: true,
            timerSec: true,
          },
        },
      },
    });
    if (!run) {
      throw new NotFoundException({ message: 'Рейс не найден', code: 'NOT_FOUND' });
    }
    if (run.reviewedAt || !run.suspicious) {
      throw reviewed();
    }
    const points = approve ? await this.freshPoints(tx, run) : run.points;
    const marked = await tx.run.updateMany({
      where: { id: runId, suspicious: true, reviewedAt: null },
      data: {
        reviewedAt: now,
        reviewedById: actor.id,
        reviewApproved: approve,
        ...(approve ? { suspicious: false, points, effectsAt: null } : {}),
      },
    });
    if (marked.count !== 1) {
      throw reviewed();
    }
    if (approve) {
      await this.grantRunPoints(tx, run.userId, runId, points, now);
    }
    await tx.auditLog.create({
      data: {
        actorType: ActorType.USER,
        actorId: actor.id,
        action: approve ? 'run.review.approved' : 'run.review.rejected',
        target: runId,
        meta: { userId: run.userId, points, approve },
      },
    });
  }

  private async freshPoints(tx: Prisma.TransactionClient, run: PointsRun): Promise<number> {
    const difficulty = await difficultyOf(
      tx,
      run.decisions.map((decision) => decision.scenarioId),
    );
    return pointsForRun(
      {
        outcome: run.outcome,
        loyalty: run.loyalty,
        safety: run.safety,
        decisions: run.decisions,
      },
      difficulty,
      this.rules.scoring(),
    );
  }

  private async grantRunPoints(
    tx: Prisma.TransactionClient,
    userId: string,
    runId: string,
    points: number,
    now: Date,
  ): Promise<void> {
    if (points <= 0) {
      return;
    }
    const existing = await tx.pointLedger.findFirst({
      where: { runId, reason: 'RUN' },
      select: { id: true },
    });
    if (existing) {
      return;
    }
    await tx.pointLedger.create({
      data: {
        userId,
        amount: points,
        reason: 'RUN',
        runId,
        expiresAt: new Date(now.getTime() + this.rules.pointsTtlDays() * DAY_MS),
      },
    });
  }

  private async loadAccess(runId: string): Promise<AccessRow> {
    if (!isUuid(runId)) {
      throw new NotFoundException({ message: 'Рейс не найден', code: 'NOT_FOUND' });
    }
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      select: {
        id: true,
        userId: true,
        suspicious: true,
        reviewedAt: true,
        user: { select: { brigadeId: true } },
      },
    });
    if (!run) {
      throw new NotFoundException({ message: 'Рейс не найден', code: 'NOT_FOUND' });
    }
    return run;
  }

  private assertStaff(actor: AuthUser): void {
    if (actor.role === Role.ADMIN || actor.role === Role.CHIEF) {
      return;
    }
    throw new ForbiddenException({
      message: 'Разбор рейса доступен начальнику бригады или администратору',
      code: 'FORBIDDEN',
    });
  }

  private assertBrigade(actor: AuthUser, brigadeId: string | null): void {
    if (actor.role === Role.ADMIN) {
      return;
    }
    if (actor.brigadeId && actor.brigadeId === brigadeId) {
      return;
    }
    throw new ForbiddenException({
      message: 'Начальник разбирает только свою бригаду',
      code: 'FORBIDDEN',
    });
  }
}

function reviewed(): ConflictException {
  return new ConflictException({ message: 'Рейс уже рассмотрен', code: 'RUN_REVIEWED' });
}

function notSuspicious(): ConflictException {
  return new ConflictException({ message: 'У рейса нет флага', code: 'RUN_NOT_SUSPICIOUS' });
}

function isUuid(value: string): boolean {
  try {
    assertUuid(value, 'Рейс');
    return true;
  } catch {
    return false;
  }
}
