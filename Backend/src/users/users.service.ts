import { randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { isUuid } from '../auth/uuid';
import { ActorType, type Grade, type Prisma, type Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { allocateCallsign } from './callsign';
import { isUniqueViolation, uniqueFields } from './unique-violation';

export type UserActor = { id: string; ip?: string | null };

export type UserProfile = {
  id: string;
  login: string;
  callsign: string;
  role: Role;
  grade: Grade;
  position: string;
  brigadeId: string | null;
  mustChangePassword: boolean;
  disabledAt: string | null;
  createdAt: string;
};

export type CreateUserInput = {
  login: string;
  role: Role;
  position: string;
  grade: Grade;
  brigadeId?: string | null;
  /** HMAC табельного номера. Кадровый контур передаёт, админская ручка — нет. */
  extHash?: string;
};

const profileSelect = {
  id: true,
  login: true,
  callsign: true,
  role: true,
  grade: true,
  position: true,
  brigadeId: true,
  mustChangePassword: true,
  disabledAt: true,
  createdAt: true,
} as const;

type ProfileRow = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async generateCallsign(): Promise<string> {
    try {
      return await allocateCallsign((callsign) => this.callsignTaken(callsign));
    } catch (error) {
      if (error instanceof Error && error.message === 'CALLSIGN_EXHAUSTED') {
        throw new ConflictException({
          message: 'Не удалось подобрать позывной',
          code: 'CALLSIGN_EXHAUSTED',
        });
      }
      throw error;
    }
  }

  async createUser(
    input: CreateUserInput,
    actor?: UserActor,
  ): Promise<{ user: UserProfile; password: string }> {
    await this.assertBrigade(input.brigadeId);
    const password = randomBytes(18).toString('base64url');
    const passwordHash = await this.passwords.hash(password);
    const user = await this.insertUser(input, passwordHash);
    await this.audit.log({
      actorType: actor ? ActorType.USER : ActorType.SYSTEM,
      actorId: actor?.id ?? null,
      action: 'user.created',
      target: user.id,
      meta: { login: user.login, role: user.role },
      ip: actor?.ip ?? null,
    });
    return { user, password };
  }

  async list(query: { page: number; limit: number; brigade?: string; role?: Role }) {
    const where = {
      ...(query.brigade ? { brigadeId: query.brigade } : {}),
      ...(query.role ? { role: query.role } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: profileSelect,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: rows.map(toProfile),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async update(
    id: string,
    input: { role?: Role; brigadeId?: string | null; disabled?: boolean },
    actor: UserActor,
  ): Promise<UserProfile> {
    const current = await this.findActiveRecord(id);
    await this.assertBrigade(input.brigadeId);
    const data = patchData(current.brigadeId, input);
    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: profileSelect,
    });
    if (input.disabled === true) {
      await this.prisma.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: actor.id,
      action: 'user.updated',
      target: id,
      meta: {
        role: input.role ?? null,
        brigadeId: input.brigadeId === undefined ? null : input.brigadeId,
        disabled: input.disabled ?? null,
      },
      ip: actor.ip ?? null,
    });
    return toProfile(updated);
  }

  async resetPassword(id: string, actor: UserActor): Promise<{ password: string }> {
    await this.findActiveRecord(id);
    const password = randomBytes(18).toString('base64url');
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true },
      }),
      this.prisma.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: actor.id,
      action: 'user.password_reset',
      target: id,
      ip: actor.ip ?? null,
    });
    return { password };
  }

  private async insertUser(input: CreateUserInput, passwordHash: string): Promise<UserProfile> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const callsign = await this.generateCallsign();
      try {
        const row = await this.prisma.user.create({
          data: {
            login: input.login,
            passwordHash,
            role: input.role,
            callsign,
            position: input.position,
            grade: input.grade,
            brigadeId: input.brigadeId ?? null,
            mustChangePassword: true,
            ...(input.extHash ? { extHash: input.extHash } : {}),
          },
          select: profileSelect,
        });
        return toProfile(row);
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        const fields = uniqueFields(error);
        if (fields.some((field) => field.includes('callsign'))) {
          continue;
        }
        throw new ConflictException({ message: 'Логин уже занят', code: 'LOGIN_TAKEN' });
      }
    }
    throw new ConflictException({
      message: 'Не удалось подобрать позывной',
      code: 'CALLSIGN_EXHAUSTED',
    });
  }

  private async callsignTaken(callsign: string): Promise<boolean> {
    const found = await this.prisma.user.findUnique({
      where: { callsign },
      select: { id: true },
    });
    return found !== null;
  }

  private async assertBrigade(brigadeId: string | null | undefined): Promise<void> {
    if (!brigadeId) {
      return;
    }
    const brigade = await this.prisma.brigade.findUnique({
      where: { id: brigadeId },
      select: { id: true },
    });
    if (!brigade) {
      throw new NotFoundException({ message: 'Бригада не найдена', code: 'NOT_FOUND' });
    }
  }

  private async findActiveRecord(id: string): Promise<{ brigadeId: string | null }> {
    if (!isUuid(id)) {
      throw new NotFoundException({ message: 'Пользователь не найден', code: 'NOT_FOUND' });
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, brigadeId: true },
    });
    if (!user) {
      throw new NotFoundException({ message: 'Пользователь не найден', code: 'NOT_FOUND' });
    }
    return user;
  }
}

function toProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    login: row.login,
    callsign: row.callsign,
    role: row.role,
    grade: row.grade,
    position: row.position,
    brigadeId: row.brigadeId,
    mustChangePassword: row.mustChangePassword,
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function patchData(
  currentBrigadeId: string | null,
  input: { role?: Role; brigadeId?: string | null; disabled?: boolean },
): Prisma.UserUpdateInput {
  const data: Prisma.UserUpdateInput = {};
  if (input.role) {
    data.role = input.role;
  }
  if (input.brigadeId) {
    data.brigade = { connect: { id: input.brigadeId } };
  } else if (input.brigadeId === null && currentBrigadeId) {
    data.brigade = { disconnect: true };
  }
  if (input.disabled === true) {
    data.disabledAt = new Date();
  } else if (input.disabled === false) {
    data.disabledAt = null;
  }
  return data;
}
