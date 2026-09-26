import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { applyScores, weakestCompetencies } from '../cabinet/competencies';
import {
  carClassLabel,
  forecastRoute,
  formatHm,
  moscowDate,
  moscowDateTime,
  stationGenitive,
  upcomingShiftDate,
} from '../cabinet/forecast';
import { ASSIGNMENT_CREATED } from '../common/events';
import type { Competency } from '../engine/schema';
import { Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AssignmentResponse, CreateAssignmentsBody } from './dto';

type Member = {
  id: string;
  callsign: string;
  brigadeId: string | null;
  competencyScores: { competency: Competency; value: number }[];
};

@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async create(actor: AuthUser, body: CreateAssignmentsBody, now = new Date()) {
    await this.requireScenarios(body.scenarioIds);
    const members = await this.requireMembers(body.userIds);
    this.assertChiefBrigade(actor, members);
    const departureAt = body.departureAt ? new Date(body.departureAt) : null;
    const date = departureAt ? moscowDate(departureAt) : upcomingShiftDate(actor.id, now);
    const route = forecastRoute(actor.id, date);
    const when = departureAt ?? moscowDateTime(date, route.departure);
    const created = await this.prisma.$transaction((tx) =>
      this.insertAll(tx, actor, members, body, route, when),
    );
    for (const row of created) {
      this.events.emit(ASSIGNMENT_CREATED, {
        assignmentId: row.id,
        userId: row.userId,
        assignedById: actor.id,
        scenarioIds: row.scenarioIds.slice(),
      });
    }
    return { assignments: created };
  }

  async list(actor: AuthUser, brigadeId: string | undefined) {
    const id = this.resolveBrigade(actor, brigadeId);
    if (!z.uuid().safeParse(id).success) {
      throw new NotFoundException({ message: 'Бригада не найдена', code: 'NOT_FOUND' });
    }
    const brigade = await this.prisma.brigade.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!brigade) {
      throw new NotFoundException({ message: 'Бригада не найдена', code: 'NOT_FOUND' });
    }
    const rows = await this.prisma.shiftAssignment.findMany({
      where: { user: { brigadeId: id }, status: { not: 'CANCELLED' } },
      orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
      take: 100,
      include: { user: { select: { callsign: true } } },
    });
    return {
      assignments: rows.map((row) => presentAssignment(row, row.user.callsign)),
    };
  }

  async cancel(actor: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) {
      throw new NotFoundException({ message: 'Назначение не найдено', code: 'NOT_FOUND' });
    }
    const existing = await this.prisma.shiftAssignment.findUnique({
      where: { id },
      include: { user: { select: { callsign: true, brigadeId: true } } },
    });
    if (!existing) {
      throw new NotFoundException({ message: 'Назначение не найдено', code: 'NOT_FOUND' });
    }
    this.assertAssignmentBrigade(actor, existing.user.brigadeId);
    if (existing.status === 'CANCELLED') {
      return presentAssignment(existing, existing.user.callsign);
    }
    const updated = await this.prisma.shiftAssignment.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: { user: { select: { callsign: true } } },
    });
    return presentAssignment(updated, updated.user.callsign);
  }

  private async insertAll(
    tx: PrismaTx,
    actor: AuthUser,
    members: readonly Member[],
    body: CreateAssignmentsBody,
    route: ReturnType<typeof forecastRoute>,
    when: Date,
  ): Promise<AssignmentResponse[]> {
    const rows: AssignmentResponse[] = [];
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      if (!member) {
        continue;
      }
      const created = await tx.shiftAssignment.create({
        data: {
          userId: member.id,
          assignedById: actor.id,
          train: route.train,
          fromStation: route.from,
          toStation: route.to,
          stops: route.stops,
          car: carNumber(route.car, index),
          carClass: route.carClass,
          departureAt: when,
          focus: focusFor(member, body.focus),
          scenarioIds: body.scenarioIds,
          status: 'PLANNED',
        },
      });
      rows.push(presentAssignment(created, member.callsign));
    }
    return rows;
  }

  private async requireScenarios(ids: readonly string[]) {
    const scenarios = await this.prisma.scenario.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, status: true },
    });
    if (scenarios.length !== ids.length) {
      throw new UnprocessableEntityException({
        message: 'Сценарий не найден',
        code: 'SCENARIO_NOT_FOUND',
      });
    }
    if (scenarios.some((scenario) => scenario.status !== 'PUBLISHED')) {
      throw new UnprocessableEntityException({
        message: 'Сценарий не опубликован',
        code: 'SCENARIO_NOT_PUBLISHED',
      });
    }
  }

  private async requireMembers(ids: readonly string[]): Promise<Member[]> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] }, disabledAt: null },
      select: {
        id: true,
        callsign: true,
        brigadeId: true,
        competencyScores: { select: { competency: true, value: true } },
      },
    });
    if (users.length !== ids.length) {
      throw new UnprocessableEntityException({
        message: 'Сотрудник не найден',
        code: 'USER_NOT_FOUND',
      });
    }
    const byId = new Map(users.map((user) => [user.id, user]));
    const ordered: Member[] = [];
    for (const id of ids) {
      const member = byId.get(id);
      if (!member) {
        throw new UnprocessableEntityException({
          message: 'Сотрудник не найден',
          code: 'USER_NOT_FOUND',
        });
      }
      ordered.push(member);
    }
    return ordered;
  }

  private assertChiefBrigade(actor: AuthUser, members: readonly Member[]) {
    if (actor.role !== Role.CHIEF) {
      return;
    }
    for (const member of members) {
      if (member.brigadeId === null || member.brigadeId !== actor.brigadeId) {
        throw new ForbiddenException({
          message: 'Нет доступа к этой бригаде',
          code: 'FORBIDDEN_BRIGADE',
        });
      }
    }
  }

  private assertAssignmentBrigade(actor: AuthUser, brigadeId: string | null) {
    if (brigadeId === null) {
      if (actor.role === Role.CHIEF) {
        throw new ForbiddenException({
          message: 'Нет доступа к этой бригаде',
          code: 'FORBIDDEN_BRIGADE',
        });
      }
      return;
    }
    if (actor.role === Role.CHIEF && actor.brigadeId !== brigadeId) {
      throw new ForbiddenException({
        message: 'Нет доступа к этой бригаде',
        code: 'FORBIDDEN_BRIGADE',
      });
    }
  }

  private resolveBrigade(actor: AuthUser, requested: string | undefined): string {
    if (actor.role === Role.CHIEF) {
      if (!actor.brigadeId || (requested !== undefined && requested !== actor.brigadeId)) {
        throw new ForbiddenException({
          message: 'Нет доступа к этой бригаде',
          code: 'FORBIDDEN_BRIGADE',
        });
      }
      return actor.brigadeId;
    }
    if (!requested) {
      throw new UnprocessableEntityException({
        message: 'Нужен brigadeId',
        code: 'BRIGADE_REQUIRED',
      });
    }
    return requested;
  }
}

type PrismaTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

type AssignmentRow = {
  id: string;
  userId: string;
  status: AssignmentResponse['status'];
  train: string;
  fromStation: string;
  toStation: string;
  car: number;
  carClass: Parameters<typeof carClassLabel>[0];
  departureAt: Date;
  stops: string[];
  focus: Competency[];
  scenarioIds: string[];
};

function presentAssignment(row: AssignmentRow, callsign: string): AssignmentResponse {
  return {
    id: row.id,
    userId: row.userId,
    callsign,
    status: row.status,
    train: row.train,
    from: row.fromStation,
    fromGenitive: stationGenitive(row.fromStation),
    to: row.toStation,
    car: row.car,
    carClass: carClassLabel(row.carClass),
    departure: formatHm(row.departureAt),
    departureAt: row.departureAt.toISOString(),
    stops: row.stops,
    focus: row.focus,
    scenarioIds: row.scenarioIds,
  };
}

function focusFor(member: Member, focus: Competency[] | undefined): Competency[] {
  if (focus && focus.length > 0) {
    return focus;
  }
  return weakestCompetencies(applyScores(member.competencyScores), 2);
}

function carNumber(base: number, index: number): number {
  return ((base - 1 + index) % 8) + 1;
}
