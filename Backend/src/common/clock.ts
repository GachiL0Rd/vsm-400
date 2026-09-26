import { Global, Module } from '@nestjs/common';

/**
 * Единые часы домена. В проде это системное время,
 * в тестах подменяется, чтобы срок баллов и cron не звали Date.now.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class ClockModule {}
