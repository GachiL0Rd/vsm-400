import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RulesModule } from '../rules/rules.module';
import { ApiClientsController } from './api-clients.controller';
import { ApiClientsService } from './api-clients.service';
import { ApiKeyGuard } from './api-key.guard';
import { EmployeesService } from './employees.service';
import { IntegrationController } from './integration.controller';
import { OrgService } from './org.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [ConfigModule, PrismaModule, RulesModule],
  controllers: [ApiClientsController, IntegrationController],
  providers: [
    ApiKeyGuard,
    ApiClientsService,
    EmployeesService,
    OrgService,
    WebhooksService,
    WebhookDispatchService,
  ],
})
export class IntegrationModule {}
