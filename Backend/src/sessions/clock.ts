/**
 * Дедлайны и срок сессии читают эти часы.
 * В тестах подменяется, чтобы не спать до таймаута и не звать Date.now.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
