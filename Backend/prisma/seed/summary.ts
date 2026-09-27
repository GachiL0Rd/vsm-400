import { lifetimeLevelPoints } from '../../src/cabinet/points';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { RulesService } from '../../src/rules/rules.service';

const LOGINS = [
  'demo / demo — проводник A7F3, бригада 12, депо Москва-Октябрьская',
  'chief / chief — начальник поезда, бригада 12',
  'methodist / methodist — методист',
] as const;

export async function printSummary(prisma: PrismaService, rules: RulesService): Promise<void> {
  const [users, runs, badges, demo] = await Promise.all([
    prisma.user.count(),
    prisma.run.count(),
    prisma.userAchievement.count({ where: { earnedAt: { not: null } } }),
    prisma.user.findUnique({
      where: { login: 'demo' },
      select: {
        id: true,
        streakDays: true,
        pointLedger: { select: { amount: true, reason: true } },
      },
    }),
  ]);
  console.log(`Пользователей: ${users}`);
  console.log(`Рейсов: ${runs}`);
  console.log(`Выданных знаков: ${badges}`);
  if (demo) {
    const life = lifetimeLevelPoints(
      demo.pointLedger.map((row) => ({
        amount: row.amount,
        reason: row.reason,
        expiresAt: null,
        expiredAt: null,
      })),
    );
    const band = rules.levelFor(life);
    console.log(`demo: уровень ${band.level}, пожизненные очки ${life}, серия ${demo.streakDays}`);
  }
  console.log('Демо-вход:');
  for (const line of LOGINS) {
    console.log(`  ${line}`);
  }
}
