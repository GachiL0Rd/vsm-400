import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth-user';
import { IS_PUBLIC_KEY } from './public.decorator';
import { passwordChangeAllows, readAccessToken } from './request';

const claimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(['CONDUCTOR', 'CHIEF', 'METHODIST', 'ADMIN']),
  bid: z.string().nullable(),
  did: z.string().nullable(),
  sid: z.uuid(),
});

type AccessRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  user?: AuthUser;
};

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AccessRequest>();
    const url = request.url ?? '';
    if (this.isPublic(context)) {
      return true;
    }
    const claims = await this.readClaims(request);
    await this.assertSession(claims.sid, claims.sub);
    const row = await this.loadUser(claims.sub);
    request.user = {
      id: row.id,
      role: row.role,
      brigadeId: row.brigadeId,
      depotId: row.brigade?.depotId ?? null,
    };
    if (row.mustChangePassword && !passwordChangeAllows(request.method ?? '', url)) {
      throw new ForbiddenException({
        message: 'Сначала смените пароль',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private async readClaims(request: AccessRequest): Promise<z.infer<typeof claimsSchema>> {
    const token = readAccessToken(request);
    if (!token) {
      throw new UnauthorizedException({
        message: 'Нужна аутентификация',
        code: 'UNAUTHENTICATED',
      });
    }
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException({
        message: 'Недействительный токен',
        code: 'INVALID_TOKEN',
      });
    }
    const parsed = claimsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new UnauthorizedException({
        message: 'Недействительный токен',
        code: 'INVALID_TOKEN',
      });
    }
    return parsed.data;
  }

  private async assertSession(sid: string, userId: string): Promise<void> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sid },
      select: { userId: true, revokedAt: true, replacedById: true, expiresAt: true },
    });
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.replacedById ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException({
        message: 'Сессия отозвана',
        code: 'SESSION_REVOKED',
      });
    }
  }

  private async loadUser(id: string) {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        brigadeId: true,
        mustChangePassword: true,
        disabledAt: true,
        brigade: { select: { depotId: true } },
      },
    });
    if (!row || row.disabledAt) {
      throw new UnauthorizedException({
        message: 'Нужна аутентификация',
        code: 'UNAUTHENTICATED',
      });
    }
    return row;
  }
}
