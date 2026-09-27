import { lifetimeLevelPoints } from '../../src/cabinet/points';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { RulesService } from '../../src/rules/rules.service';
import { DEMO_LOGINS } from './personas';

const LINES = [
  'demo1 / demo1 — проводник LUCH, учится, бригада 12',
  'demo2 / demo2 — старший проводник VOLK, сильные рейсы',
  'demo3 / demo3 — проводник OREL, средний',
  'demo4 / demo4 — проводник ISKR, тяжёлые рейсы',
  'demo5 / demo5 — стажёр SMEN, мало рейсов',
] as const;

export async function printSummary(prisma: PrismaService, rules: RulesService): Promise<void> {
  const [users, runs, badges, depots, brigades] = await Promise.all([
    prisma.user.count(),
    prisma.run.count(),
    prisma.userAchievement.count({ where: { earnedAt: { not: null } } }),
    prisma.depot.count(),
    prisma.brigade.count(),
  ]);
  console.log(`Пользователей: ${users}`);
  console.log(`Депо: ${depots}, бригад: ${brigades}`);
  console.log(`Рейсов: ${runs}`);
  console.log(`Выданных знаков: ${badges}`);
  for (const login of DEMO_LOGINS) {
    const user = await prisma.user.findUnique({
      where: { login },
      select: {
        callsign: true,
        streakDays: true,
        pointLedger: { select: { amount: true, reason: true } },
        _count: { select: { runs: true } },
      },
    });
    if (!user) {
      continue;
    }
    const life = lifetimeLevelPoints(
      user.pointLedger.map((row) => ({
        amount: row.amount,
        reason: row.reason,
        expiresAt: null,
        expiredAt: null,
      })),
    );
    const band = rules.levelFor(life);
    console.log(
      `${login}: позывной ${user.callsign}, уровень ${band.level}, очки ${life}, рейсов ${user._count.runs}, серия ${user.streakDays}`,
    );
  }
  console.log('Демо-вход, пароль равен логину:');
  for (const line of LINES) {
    console.log(`  ${line}`);
  }
}
