import type { PasswordService } from '../../src/auth/password.service';
import { Grade, type Prisma, Role } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { UsersService } from '../../src/users/users.service';
import { DEMO_LOGINS, type DemoLogin, type PersonaAssignment } from './personas';

const POSITION: Record<PersonaAssignment['grade'], string> = {
  TRAINEE: 'Стажёр',
  CONDUCTOR: 'Проводник',
  CONDUCTOR_SENIOR: 'Старший проводник',
};

export type ConductorRef = {
  id: string;
  login: DemoLogin;
  callsign: string;
};

type Deps = {
  prisma: PrismaService;
  users: UsersService;
  passwords: PasswordService;
};

/**
 * Одно депо, одна бригада, пять проводников.
 * Пароль совпадает с логином. CHIEF и METHODIST сид не создаёт.
 */
export async function seedOrg(
  deps: Deps,
  personas: readonly PersonaAssignment[],
): Promise<ConductorRef[]> {
  const brigadeId = await seedBrigade(deps.prisma);
  const conductors: ConductorRef[] = [];
  for (const login of DEMO_LOGINS) {
    const persona = personas.find((item) => item.login === login);
    if (!persona) {
      throw new Error(`Нет персонажа ${login}`);
    }
    const created = await deps.users.createUser({
      login,
      role: Role.CONDUCTOR,
      position: POSITION[persona.grade],
      grade: Grade[persona.grade],
      brigadeId,
    });
    await knownPassword(deps, created.user.id, login, persona.callsign);
    conductors.push({ id: created.user.id, login, callsign: persona.callsign });
  }
  return conductors;
}

async function seedBrigade(prisma: PrismaService): Promise<string> {
  const depot = await prisma.depot.create({
    data: { code: 'MSK', name: 'Москва-Октябрьская', city: 'Москва' },
  });
  const brigade = await prisma.brigade.create({
    data: { code: '12', name: 'Бригада 12', depotId: depot.id },
  });
  return brigade.id;
}

async function knownPassword(
  deps: Deps,
  id: string,
  password: string,
  callsign: string,
): Promise<void> {
  const passwordHash = await deps.passwords.hash(password);
  const data: Prisma.UserUpdateInput = {
    passwordHash,
    mustChangePassword: false,
    callsign,
  };
  await deps.prisma.user.update({ where: { id }, data });
}
