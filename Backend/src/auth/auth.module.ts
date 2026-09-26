import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { loginTracker } from './request';
import { RolesGuard } from './roles.guard';
import { ServiceTokenGuard } from './service-token.guard';

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
        errorMessage: 'Слишком много попыток входа',
        throttlers: [{ name: 'login', limit: 5, ttl: seconds(60) }],
        storage: new RedisThrottlerStorage(redis),
        getTracker: (req) => loginTracker(req),
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
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [ServiceTokenGuard, PasswordService, JwtModule],
})
export class AuthModule {}
