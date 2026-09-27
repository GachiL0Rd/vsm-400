import { randomBytes } from 'node:crypto';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { ActorType, Grade, Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { allocateCallsign } from '../users/callsign';
import { isUniqueViolation } from '../users/unique-violation';
import { PasswordService } from './password.service';

const BOOTSTRAP_PASSWORD_MIN = 10;

export function bootstrapPassword(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv: AppConfig['nodeEnv'] = 'development',
): string {
  const configured = env.BOOTSTRAP_ADMIN_PASSWORD?.trim();
  if (!configured) {
    return randomBytes(18).toString('base64url');
  }
  if (nodeEnv === 'production') {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD запрещён в production');
  }
  if (configured.length < BOOTSTRAP_PASSWORD_MIN) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD короче 10 символов');
  }
  return configured;
}

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // health e2e подменяет Prisma моком без user, а vitest всегда NODE_ENV=test.
    if (this.config.nodeEnv === 'test') {
      return;
    }
    await this.ensureAdmin();
  }

  async ensureAdmin(): Promise<{ login: string; password: string } | null> {
    const existing = await this.prisma.user.findFirst({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    if (existing) {
      return null;
    }
    const password = bootstrapPassword(process.env, this.config.nodeEnv);
    const passwordHash = await this.passwords.hash(password);
    const callsign = await allocateCallsign((candidate) => this.callsignTaken(candidate));
    const created = await this.insertAdmin(passwordHash, callsign);
    if (!created) {
      return null;
    }
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'auth.bootstrap',
      target: 'admin',
    });
    printBootstrap(password, this.config.port);
    return { login: 'admin', password };
  }

  private async insertAdmin(passwordHash: string, callsign: string): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const again = await tx.user.findFirst({
          where: { role: Role.ADMIN },
          select: { id: true },
        });
        if (again) {
          return false;
        }
        await tx.user.create({
          data: {
            login: 'admin',
            passwordHash,
            role: Role.ADMIN,
            callsign,
            position: 'Администратор',
            grade: Grade.INSTRUCTOR,
            mustChangePassword: true,
          },
        });
        return true;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  private async callsignTaken(callsign: string): Promise<boolean> {
    const found = await this.prisma.user.findUnique({
      where: { callsign },
      select: { id: true },
    });
    return found !== null;
  }
}

function printBootstrap(password: string, port: number): void {
  const lines = [
    'Первый администратор создан. Пароль больше не будет показан.',
    'Логин: admin',
    `Пароль: ${password}`,
    `Документация: http://localhost:${port}/api/docs`,
  ];
  const width = Math.max(...lines.map((line) => line.length));
  const border = '═'.repeat(width + 2);
  console.log(`╔${border}╗`);
  for (const line of lines) {
    console.log(`║ ${line.padEnd(width)} ║`);
  }
  console.log(`╚${border}╝`);
}
