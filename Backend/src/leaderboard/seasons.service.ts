import { Inject, Injectable } from '@nestjs/common';
import type { Season } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { seasonWindow } from './season-window';

/** Один создатель сезона на кластер. Число постоянное, схема не меняется. */
const SEASON_LOCK = 7_482_391_001n;

@Injectable()
export class SeasonsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Лениво создаёт сезон недели, в которую попадает instant. */
  async current(instant = new Date()): Promise<Season> {
    const window = seasonWindow(instant);
    const existing = await this.prisma.season.findFirst({
      where: { startsAt: window.startsAt },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEASON_LOCK})`;
      const again = await tx.season.findFirst({ where: { startsAt: window.startsAt } });
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
  }
}
