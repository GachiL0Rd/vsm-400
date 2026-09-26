import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from '../audit/audit.module';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { RedisService } from '../redis/redis.service';
import { AccessGuard } from './access.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BootstrapService } from './bootstrap.service';
import { ACCESS_TTL_SEC, AuthCookies } from './cookies';
import { PasswordService } from './password.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { RolesGuard } from './roles.guard';
import { ServiceTokenGuard } from './service-token.guard';
import { authThrottlers } from './throttle';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtAccessSecret,
        signOptions: { algorithm: 'HS256', expiresIn: ACCESS_TTL_SEC },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        errorMessage: 'Слишком много попыток',
        throttlers: authThrottlers(),
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    AuthCookies,
    BootstrapService,
    ServiceTokenGuard,
    ThrottlerGuard,
    AccessGuard,
    RolesGuard,
    // useExisting, чтобы e2e мог подменить класс через overrideProvider.
    { provide: APP_GUARD, useExisting: AccessGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
  exports: [ServiceTokenGuard, PasswordService, JwtModule],
})
export class AuthModule {}
