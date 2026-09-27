import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ZodValidationPipe } from 'nestjs-zod';
import { AchievementsModule } from './achievements/achievements.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CabinetModule } from './cabinet/cabinet.module';
import { ClockModule } from './common/clock';
import { ProblemFilter } from './common/problem.filter';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { IntegrationModule } from './integration/integration.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { LlmModule } from './llm/llm.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrgModule } from './org/org.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgressionModule } from './progression/progression.module';
import { RedisModule } from './redis/redis.module';
import { RulesModule } from './rules/rules.module';
import { ScenariosModule } from './scenarios/scenarios.module';
import { SessionsModule } from './sessions/sessions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    ClockModule,
    RulesModule,
    AuditModule,
    AuthModule,
    UsersModule,
    OrgModule,
    ScenariosModule,
    LlmModule,
    SessionsModule,
    ProgressionModule,
    AchievementsModule,
    CabinetModule,
    AnalyticsModule,
    AssignmentsModule,
    NotificationsModule,
    LeaderboardModule,
    HealthModule,
    IntegrationModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
