import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { ActorType, type Grade, type Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { refreshExpiry, rotateRefresh, type SessionMeta, type SessionUser } from './refresh';
import { randomToken, sha256 } from './token';

export type LoginUser = {
  id: string;
  login: string;
  callsign: string;
  role: Role;
  grade: Grade;
  mustChangePassword: boolean;
};

export type IssuedSession = {
  access: string;
  refresh: string;
  user: LoginUser;
};

const withDepot = { include: { brigade: { select: { depotId: true } } } } as const;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async login(
    login: string,
    password: string,
    meta: SessionMeta,
    now?: Date,
  ): Promise<IssuedSession> {
    const at = now ?? this.clock.now();
    const user = await this.prisma.user.findUnique({ where: { login }, ...withDepot });
    const valid = await this.passwords.verify(user?.passwordHash ?? null, password);
    if (!user || !valid || user.disabledAt) {
      await this.audit.log({
        actorType: ActorType.USER,
        actorId: user?.id ?? null,
        action: 'auth.login.failure',
        target: null,
        ip: meta.ip,
      });
      throw invalidCredentials();
    }
    const issued = await this.issue(user, meta, at);
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: user.id,
      action: 'auth.login.success',
      target: user.id,
      ip: meta.ip,
    });
    return issued;
  }

  async refresh(raw: string | undefined, meta: SessionMeta, now?: Date): Promise<IssuedSession> {
    const at = now ?? this.clock.now();
    if (!raw) {
      throw invalidRefresh();
    }
    const outcome = await this.prisma.$transaction((tx) => rotateRefresh(tx, raw, meta, at));
    if (outcome.kind === 'race') {
      throw new ConflictException({
        message: 'Refresh уже обновлён другим запросом',
        code: 'REFRESH_RACE',
      });
    }
    if (outcome.kind === 'reuse') {
      await this.audit.log({
        actorType: ActorType.USER,
        actorId: outcome.userId,
        action: 'auth.refresh.reuse',
        target: outcome.userId,
        ip: meta.ip,
      });
      throw new UnauthorizedException({ message: 'Сессия отозвана', code: 'REFRESH_REUSE' });
    }
    if (outcome.kind === 'password') {
      throw new ForbiddenException({
        message: 'Сначала смените пароль',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    if (outcome.kind !== 'ok') {
      throw invalidRefresh();
    }
    return {
      access: await this.signAccess(outcome.user, outcome.sessionId),
      refresh: outcome.refresh,
      user: toLoginUser(outcome.user),
    };
  }

  async logout(raw: string | undefined, meta: SessionMeta, now?: Date): Promise<void> {
    const at = now ?? this.clock.now();
    if (!raw) {
      return;
    }
    const session = await this.prisma.authSession.findUnique({
      where: { refreshHash: sha256(raw) },
    });
    if (!session) {
      return;
    }
    if (!session.revokedAt) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: at },
      });
    }
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: session.userId,
      action: 'auth.logout',
      target: session.userId,
      ip: meta.ip,
    });
  }

  async changePassword(
    userId: string,
    current: string,
    next: string,
    meta: SessionMeta,
    now?: Date,
  ): Promise<IssuedSession> {
    const at = now ?? this.clock.now();
    if (next.length < 10) {
      throw new BadRequestException({
        message: 'Пароль короче 10 символов',
        code: 'PASSWORD_POLICY',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, ...withDepot });
    if (!user || user.disabledAt) {
      throw new UnauthorizedException({ message: 'Нужна аутентификация', code: 'UNAUTHENTICATED' });
    }
    const valid = await this.passwords.verify(user.passwordHash, current);
    if (!valid) {
      throw invalidCredentials();
    }
    const passwordHash = await this.passwords.hash(next);
    const refresh = randomToken();
    const sessionId = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: at },
      });
      const created = await tx.authSession.create({
        data: {
          userId,
          refreshHash: sha256(refresh),
          userAgent: meta.userAgent,
          ip: meta.ip,
          expiresAt: refreshExpiry(at),
        },
        select: { id: true },
      });
      return created.id;
    });
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: userId,
      action: 'auth.password.changed',
      target: userId,
      ip: meta.ip,
    });
    const nextUser = { ...user, mustChangePassword: false };
    return {
      access: await this.signAccess(nextUser, sessionId),
      refresh,
      user: toLoginUser(nextUser),
    };
  }

  private async issue(user: SessionUser, meta: SessionMeta, now: Date): Promise<IssuedSession> {
    const refresh = randomToken();
    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshHash: sha256(refresh),
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: refreshExpiry(now),
      },
      select: { id: true },
    });
    return {
      access: await this.signAccess(user, session.id),
      refresh,
      user: toLoginUser(user),
    };
  }

  private signAccess(user: SessionUser, sessionId: string): Promise<string> {
    return this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      bid: user.brigadeId,
      did: user.brigade?.depotId ?? null,
      sid: sessionId,
    });
  }
}

function toLoginUser(user: SessionUser): LoginUser {
  return {
    id: user.id,
    login: user.login,
    callsign: user.callsign,
    role: user.role,
    grade: user.grade,
    mustChangePassword: user.mustChangePassword,
  };
}

function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Неверный логин или пароль',
    code: 'INVALID_CREDENTIALS',
  });
}

function invalidRefresh(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Недействительный refresh-токен',
    code: 'INVALID_REFRESH',
  });
}
