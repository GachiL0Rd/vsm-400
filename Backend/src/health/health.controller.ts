import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../auth/public.decorator';
import { PrismaPingIndicator } from './prisma-ping.indicator';
import { RedisPingIndicator } from './redis-ping.indicator';

@ApiTags('health')
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  // @Inject оставляет класс значением: иначе Biome пишет import type, и Nest теряет токен.
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(PrismaPingIndicator) private readonly database: PrismaPingIndicator,
    @Inject(RedisPingIndicator) private readonly redis: RedisPingIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Postgres и Redis' })
  check() {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
