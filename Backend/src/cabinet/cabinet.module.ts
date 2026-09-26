import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ZodSerializerInterceptor } from 'nestjs-zod';
import { AccessGuard } from './access.guard';
import { CabinetController } from './cabinet.controller';
import { CabinetService } from './cabinet.service';

@Module({
  controllers: [CabinetController],
  providers: [
    CabinetService,
    AccessGuard,
    // Один перехватчик на приложение: сериализует и аналитику, и назначения.
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  ],
  exports: [AccessGuard],
})
export class CabinetModule {}
