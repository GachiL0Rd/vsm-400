import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ZodSerializerInterceptor } from 'nestjs-zod';
import { AchievementsModule } from '../achievements/achievements.module';
import { CabinetController } from './cabinet.controller';
import { CabinetService } from './cabinet.service';

@Module({
  imports: [AchievementsModule],
  controllers: [CabinetController],
  providers: [
    CabinetService,
    // Один перехватчик на приложение: сериализует и аналитику, и назначения.
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  ],
})
export class CabinetModule {}
