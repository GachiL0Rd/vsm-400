import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth-user';
import type { PrismaService } from '../prisma/prisma.service';
import { OrgService } from './org.service';

const depotId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';
const otherDepot = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5c';
const brigadeId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d';

function actor(
  role: AuthUser['role'],
  ownDepot: string | null,
  ownBrigade: string | null,
): AuthUser {
  return { id: 'user', role, depotId: ownDepot, brigadeId: ownBrigade };
}

describe('границы списков депо', () => {
  it('проводнику отдаёт только своё депо и свою бригаду', async () => {
    const depotFind = vi.fn(async () => [{ id: depotId }]);
    const brigadeFind = vi.fn(async () => [{ id: brigadeId }]);
    const depotOne = vi.fn(async () => ({ id: depotId }));
    const service = new OrgService({
      depot: { findMany: depotFind, findUnique: depotOne },
      brigade: { findMany: brigadeFind },
    } as unknown as PrismaService);
    const conductor = actor('CONDUCTOR', depotId, brigadeId);
    await service.listDepots(conductor);
    expect(depotFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: depotId } }));
    await service.listBrigades(depotId, conductor);
    expect(brigadeFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { depotId, id: brigadeId } }),
    );
    await expect(service.listBrigades(otherDepot, conductor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(depotOne).toHaveBeenCalledTimes(1);
  });

  it('методист видит все депо', async () => {
    const depotFind = vi.fn(async () => []);
    const service = new OrgService({
      depot: { findMany: depotFind },
    } as unknown as PrismaService);
    await service.listDepots(actor('METHODIST', null, null));
    expect(depotFind).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });
});
