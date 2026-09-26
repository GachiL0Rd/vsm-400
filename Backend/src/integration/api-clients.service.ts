import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatApiKey, generateApiSecret, hashApiSecret } from './api-key';
import type { CreateApiClientDto } from './dto';
import { parseUuid } from './dto';
import { httpError } from './http-error';

const clientSelect = {
  id: true,
  name: true,
  scopes: true,
  createdAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class ApiClientsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateApiClientDto): Promise<{
    id: string;
    name: string;
    scopes: string[];
    createdAt: Date;
    key: string;
  }> {
    const secret = generateApiSecret();
    const row = await this.prisma.apiClient.create({
      data: {
        name: input.name,
        scopes: [...input.scopes],
        keyHash: hashApiSecret(secret),
      },
      select: clientSelect,
    });
    return { ...row, scopes: [...row.scopes], key: formatApiKey(row.id, secret) };
  }

  list() {
    return this.prisma.apiClient.findMany({
      orderBy: { createdAt: 'desc' },
      select: clientSelect,
    });
  }

  async revoke(rawId: string): Promise<{ id: string; revokedAt: Date }> {
    const id = parseUuid(rawId, 'API_CLIENT_NOT_FOUND');
    const existing = await this.prisma.apiClient.findUnique({
      where: { id },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      throw httpError(404, 'Клиент API не найден', 'API_CLIENT_NOT_FOUND');
    }
    if (existing.revokedAt) {
      return { id: existing.id, revokedAt: existing.revokedAt };
    }
    const revokedAt = new Date();
    await this.prisma.apiClient.update({
      where: { id },
      data: { revokedAt },
    });
    return { id, revokedAt };
  }
}
