import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import { ActorType, type Grade, type Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { REFRESH_TTL_SEC } from './cookies';
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
  ) {}

  async login(login: string, password: string, meta: SessionMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { login }, ...withDepot });
    const valid = await this.passwords.verify(user?.passwordHash ?? null, password);
    if (!user || !valid || user.disabledAt) {
      await this.audit.log({
        actorType: ActorType.USER,
        actorId: user?.id ?? null,
        action: 'auth.login.failure',
        target: login,
        ip: meta.ip,
      });
      throw invalidCredentials();
    }
    const issued = await this.issue(user, meta);
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: user.id,
      action: 'auth.login.success',
      target: user.id,
      ip: meta.ip,
    });
    return issued;
  }

  async refresh(raw: string | undefined, meta: SessionMeta): Promise<IssuedSession> {
    if (!raw) {
      throw invalidRefresh();
    }
    const outcome = await this.prisma.$transaction((tx) => rotateRefresh(tx, raw, meta));
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
    if (outcome.kind !== 'ok') {
      throw invalidRefresh();
    }
    return {
      access: await this.signAccess(outcome.user),
      refresh: outcome.refresh,
      user: toLoginUser(outcome.user),
    };
  }

  async logout(raw: string | undefined, meta: SessionMeta): Promise<void> {
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
        data: { revokedAt: new Date() },
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
  ): Promise<IssuedSession> {
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
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.authSession.create({
        data: {
          userId,
          refreshHash: sha256(refresh),
          userAgent: meta.userAgent,
          ip: meta.ip,
          expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
        },
      });
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
      access: await this.signAccess(nextUser),
      refresh,
      user: toLoginUser(nextUser),
    };
  }

  private async issue(user: SessionUser, meta: SessionMeta): Promise<IssuedSession> {
    const refresh = randomToken();
    await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshHash: sha256(refresh),
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: refreshExpiry(),
      },
    });
    return {
      access: await this.signAccess(user),
      refresh,
      user: toLoginUser(user),
    };
  }

  private signAccess(user: SessionUser): Promise<string> {
    return this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      bid: user.brigadeId,
      did: user.brigade?.depotId ?? null,
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
