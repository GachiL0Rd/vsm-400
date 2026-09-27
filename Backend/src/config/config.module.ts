import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig, loadConfig } from './env';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
