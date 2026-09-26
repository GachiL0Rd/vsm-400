import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWebhook } from './dto';
import { parseUuid } from './dto';
import { httpError } from './http-error';
import {
  screenWebhookUrl,
  WEBHOOK_RESOLVE,
  type WebhookResolve,
  webhookUrlDetail,
} from './webhook-url';

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(WEBHOOK_RESOLVE) private readonly resolve: WebhookResolve,
  ) {}

  async create(apiClientId: string, input: CreateWebhook) {
    const screened = await screenWebhookUrl(
      input.url,
      { nodeEnv: this.config.nodeEnv, allowedHosts: this.config.webhookAllowedHosts },
      this.resolve,
    );
    if (!screened.ok) {
      throw httpError(422, webhookUrlDetail(screened.reason), 'WEBHOOK_URL');
    }
    // Секрет храним: без него не подписать исходящий POST. Клиенту отдаём один раз.
    const secret = randomBytes(32).toString('hex');
    const row = await this.prisma.webhookSubscription.create({
      data: {
        url: screened.url.href,
        events: [...input.events],
        secret,
        apiClient: { connect: { id: apiClientId } },
      },
      select: { id: true, url: true, events: true, active: true },
    });
    return { ...row, events: [...row.events], secret };
  }

  async list(apiClientId: string) {
    const rows = await this.prisma.webhookSubscription.findMany({
      where: { apiClientId },
      orderBy: { id: 'asc' },
      select: { id: true, url: true, events: true, active: true },
    });
    return rows.map((row) => ({ ...row, events: [...row.events] }));
  }

  async remove(apiClientId: string, rawId: string): Promise<void> {
    const id = parseUuid(rawId, 'WEBHOOK_NOT_FOUND');
    const row = await this.prisma.webhookSubscription.findFirst({
      where: { id, apiClientId },
      select: { id: true },
    });
    if (!row) {
      throw httpError(404, 'Подписка не найдена', 'WEBHOOK_NOT_FOUND');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.webhookDelivery.deleteMany({ where: { subscriptionId: id } });
      await tx.webhookSubscription.delete({ where: { id } });
    });
  }
}
