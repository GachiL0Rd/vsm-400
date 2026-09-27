import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { isUuid } from '../auth/uuid';
import { Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrgService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listDepots(actor: AuthUser) {
    if (!seesAllOrg(actor) && !actor.depotId) {
      return [];
    }
    return this.prisma.depot.findMany({
      where: seesAllOrg(actor) ? undefined : { id: actor.depotId ?? undefined },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, city: true },
    });
  }

  async listBrigades(depotId: string, actor: AuthUser) {
    if (!isUuid(depotId)) {
      throw new NotFoundException({ message: 'Депо не найдено', code: 'NOT_FOUND' });
    }
    // Чужой id не подтверждаем: тот же 404, что и для пустого депо.
    if (!seesAllOrg(actor) && actor.depotId !== depotId) {
      throw new NotFoundException({ message: 'Депо не найдено', code: 'NOT_FOUND' });
    }
    const depot = await this.prisma.depot.findUnique({
      where: { id: depotId },
      select: { id: true },
    });
    if (!depot) {
      throw new NotFoundException({ message: 'Депо не найдено', code: 'NOT_FOUND' });
    }
    if (!seesAllOrg(actor) && !actor.brigadeId) {
      return [];
    }
    return this.prisma.brigade.findMany({
      where: seesAllOrg(actor) ? { depotId } : { depotId, id: actor.brigadeId ?? undefined },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, depotId: true },
    });
  }

  async getBrigade(id: string, actor: AuthUser) {
    if (!isUuid(id)) {
      throw new NotFoundException({ message: 'Бригада не найдена', code: 'NOT_FOUND' });
    }
    const brigade = await this.prisma.brigade.findUnique({
      where: { id },
      include: {
        depot: { select: { id: true, code: true, name: true, city: true } },
        users: {
          where: { disabledAt: null },
          orderBy: { callsign: 'asc' },
          select: { callsign: true, role: true, grade: true, login: true },
        },
      },
    });
    if (!brigade) {
      throw new NotFoundException({ message: 'Бригада не найдена', code: 'NOT_FOUND' });
    }
    if (!canSeeMembers(actor, brigade.id)) {
      throw new ForbiddenException({ message: 'Чужая бригада', code: 'BRIGADE_FORBIDDEN' });
    }
    const showLogin = actor.role === Role.ADMIN;
    return {
      id: brigade.id,
      code: brigade.code,
      name: brigade.name,
      depotId: brigade.depotId,
      depot: brigade.depot,
      members: brigade.users.map((member) => ({
        callsign: member.callsign,
        role: member.role,
        grade: member.grade,
        ...(showLogin ? { login: member.login } : {}),
      })),
    };
  }
}

function seesAllOrg(actor: AuthUser): boolean {
  return actor.role === Role.ADMIN || actor.role === Role.METHODIST;
}

function canSeeMembers(actor: AuthUser, brigadeId: string): boolean {
  if (actor.role === Role.ADMIN || actor.role === Role.METHODIST) {
    return true;
  }
  return actor.brigadeId === brigadeId;
}
