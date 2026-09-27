import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import type { Season } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../users/unique-violation';
import { seasonWindow } from './season-window';

/** Один создатель сезона на кластер. Уникальность startsAt — запасной замок. */
const SEASON_LOCK = 7_482_391_001n;

@Injectable()
export class SeasonsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Лениво создаёт сезон недели, в которую попадает instant. */
  async current(instant?: Date): Promise<Season> {
    const at = instant ?? this.clock.now();
    const window = seasonWindow(at);
    const existing = await this.prisma.season.findUnique({
      where: { startsAt: window.startsAt },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEASON_LOCK})`;
        const again = await tx.season.findUnique({ where: { startsAt: window.startsAt } });
        if (again) {
          return again;
        }
        return tx.season.create({
          data: {
            title: window.title,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
          },
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const row = await this.prisma.season.findUnique({
        where: { startsAt: window.startsAt },
      });
      if (!row) {
        throw error;
      }
      return row;
    }
  }
}
