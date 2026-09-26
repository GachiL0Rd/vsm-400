import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrgService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async tree() {
    const depots = await this.prisma.depot.findMany({
      orderBy: { code: 'asc' },
      include: {
        brigades: {
          orderBy: { code: 'asc' },
          include: {
            _count: { select: { users: { where: { disabledAt: null } } } },
          },
        },
      },
    });
    return {
      depots: depots.map((depot) => {
        const brigades = depot.brigades.map((brigade) => ({
          code: brigade.code,
          name: brigade.name,
          employeeCount: brigade._count.users,
        }));
        const employeeCount = brigades.reduce((sum, brigade) => sum + brigade.employeeCount, 0);
        return {
          code: depot.code,
          name: depot.name,
          city: depot.city,
          employeeCount,
          brigades,
        };
      }),
    };
  }
}
