import type { PasswordService } from '../../src/auth/password.service';
import { Grade, type Prisma, Role } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { UsersService } from '../../src/users/users.service';

const GRADES = [Grade.TRAINEE, Grade.CONDUCTOR, Grade.CONDUCTOR_SENIOR, Grade.INSTRUCTOR] as const;

const POSITION: Record<Grade, string> = {
  TRAINEE: 'Стажёр',
  CONDUCTOR: 'Проводник',
  CONDUCTOR_SENIOR: 'Старший проводник',
  INSTRUCTOR: 'Инструктор-проводник',
};

const DEPOTS = [
  {
    code: 'MSK',
    name: 'Москва-Октябрьская',
    city: 'Москва',
    brigades: ['11', '12', '13'],
  },
  {
    code: 'SPB',
    name: 'Санкт-Петербург-Московская',
    city: 'Санкт-Петербург',
    brigades: ['21', '22', '23'],
  },
] as const;

export type ConductorRef = {
  id: string;
  login: string;
  brigadeCode: string;
};

export type OrgStaff = {
  demoId: string;
  chiefId: string;
  methodistId: string;
  conductors: ConductorRef[];
};

type Deps = {
  prisma: PrismaService;
  users: UsersService;
  passwords: PasswordService;
};

/**
 * UsersService.createUser сам придумывает пароль и ставит mustChangePassword.
 * Известный пароль хеширует тот же PasswordService (argon2id), флаг снимается
 * только у demo/chief/methodist.
 */
export async function seedOrg(deps: Deps): Promise<OrgStaff> {
  const brigades = await seedDepots(deps.prisma);
  const moscow12 = brigades.get('MSK:12');
  if (!moscow12) {
    throw new Error('Нет бригады 12 депо Москва');
  }
  const demo = await deps.users.createUser({
    login: 'demo',
    role: Role.CONDUCTOR,
    position: 'Проводник бизнес-класса',
    grade: Grade.CONDUCTOR,
    brigadeId: moscow12,
  });
  await knownPassword(deps, demo.user.id, 'demo', 'A7F3');
  const chief = await deps.users.createUser({
    login: 'chief',
    role: Role.CHIEF,
    position: 'Начальник поезда',
    grade: Grade.CONDUCTOR_SENIOR,
    brigadeId: moscow12,
  });
  await knownPassword(deps, chief.user.id, 'chief');
  const conductors: ConductorRef[] = [{ id: demo.user.id, login: 'demo', brigadeCode: '12' }];
  await seedBrigades(deps, brigades, conductors);
  const methodist = await deps.users.createUser({
    login: 'methodist',
    role: Role.METHODIST,
    position: 'Методист',
    grade: Grade.INSTRUCTOR,
    brigadeId: null,
  });
  await knownPassword(deps, methodist.user.id, 'methodist');
  return {
    demoId: demo.user.id,
    chiefId: chief.user.id,
    methodistId: methodist.user.id,
    conductors,
  };
}

async function seedDepots(prisma: PrismaService): Promise<Map<string, string>> {
  const brigades = new Map<string, string>();
  for (const depot of DEPOTS) {
    const created = await prisma.depot.create({
      data: { code: depot.code, name: depot.name, city: depot.city },
    });
    for (const code of depot.brigades) {
      const brigade = await prisma.brigade.create({
        data: { code, name: `Бригада ${code}`, depotId: created.id },
      });
      brigades.set(`${depot.code}:${code}`, brigade.id);
    }
  }
  return brigades;
}

async function seedBrigades(
  deps: Deps,
  brigades: ReadonlyMap<string, string>,
  conductors: ConductorRef[],
): Promise<void> {
  for (const depot of DEPOTS) {
    for (const code of depot.brigades) {
      const brigadeId = brigades.get(`${depot.code}:${code}`);
      if (!brigadeId) {
        throw new Error(`Нет бригады ${code}`);
      }
      if (!(depot.code === 'MSK' && code === '12')) {
        await deps.users.createUser({
          login: `chief-${code}`,
          role: Role.CHIEF,
          position: 'Начальник поезда',
          grade: Grade.CONDUCTOR_SENIOR,
          brigadeId,
        });
      }
      await seedConductors(deps, depot.code, code, brigadeId, conductors);
    }
  }
}

async function seedConductors(
  deps: Deps,
  depotCode: string,
  brigadeCode: string,
  brigadeId: string,
  conductors: ConductorRef[],
): Promise<void> {
  const start = depotCode === 'MSK' && brigadeCode === '12' ? 1 : 0;
  for (let index = start; index < 8; index += 1) {
    const grade = GRADES[index % GRADES.length] ?? Grade.CONDUCTOR;
    const login = `c-${depotCode.toLowerCase()}-${brigadeCode}-${index + 1}`;
    const created = await deps.users.createUser({
      login,
      role: Role.CONDUCTOR,
      position: POSITION[grade],
      grade,
      brigadeId,
    });
    conductors.push({ id: created.user.id, login, brigadeCode });
  }
}

async function knownPassword(
  deps: Deps,
  id: string,
  password: string,
  callsign?: string,
): Promise<void> {
  const passwordHash = await deps.passwords.hash(password);
  const data: Prisma.UserUpdateInput = { passwordHash, mustChangePassword: false };
  if (callsign) {
    data.callsign = callsign;
  }
  await deps.prisma.user.update({ where: { id }, data });
}
