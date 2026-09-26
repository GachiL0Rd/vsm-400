import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { RulesModule } from '../rules/rules.module';
import { UsersModule } from '../users/users.module';
import { ApiClientsController } from './api-clients.controller';
import { ApiClientsService } from './api-clients.service';
import { ApiKeyGuard } from './api-key.guard';
import { EmployeesService } from './employees.service';
import { IntegrationController } from './integration.controller';
import { OrgService } from './org.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { webhookPostFor } from './webhook-post';
import { WEBHOOK_POST, WEBHOOK_RESOLVE, webhookResolveFor } from './webhook-url';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [ConfigModule, PrismaModule, RulesModule, UsersModule],
  controllers: [ApiClientsController, IntegrationController],
  providers: [
    ApiKeyGuard,
    ApiClientsService,
    EmployeesService,
    OrgService,
    {
      provide: WEBHOOK_RESOLVE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => webhookResolveFor(config),
    },
    {
      provide: WEBHOOK_POST,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => webhookPostFor(config),
    },
    WebhooksService,
    WebhookDispatchService,
  ],
})
export class IntegrationModule {}
