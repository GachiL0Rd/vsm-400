import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EngineError } from '../engine/errors';

export function notFound(): NotFoundException {
  return new NotFoundException({ message: 'Сессия не найдена', code: 'NOT_FOUND' });
}

export function seqMismatch(): ConflictException {
  return new ConflictException({ message: 'Номер хода не совпал', code: 'SEQ_MISMATCH' });
}

export function sessionClosed(): ConflictException {
  return new ConflictException({ message: 'Смена уже закрыта', code: 'SESSION_CLOSED' });
}

export function revealClosed(): ConflictException {
  return new ConflictException({
    message: 'Seed раскрывается после завершения смены',
    code: 'REVEAL_CLOSED',
  });
}

export function sessionNotActive(): ConflictException {
  return new ConflictException({
    message: 'Отчёт принимается только для активной смены',
    code: 'SESSION_NOT_ACTIVE',
  });
}

export function runMissing(): ConflictException {
  return new ConflictException({ message: 'Итог рейса не найден', code: 'RUN_MISSING' });
}

export function ticketReused(): ConflictException {
  return new ConflictException({ message: 'Билет уже использован', code: 'TICKET_REUSED' });
}

export function invalidTicket(): UnauthorizedException {
  return new UnauthorizedException({ message: 'Билет недействителен', code: 'INVALID_TICKET' });
}

export function fromEngine(error: EngineError): Error {
  if (error.code === 'CHOICE_NOT_AVAILABLE') {
    return new UnprocessableEntityException({
      message: 'Выбор сейчас недоступен',
      code: error.code,
    });
  }
  if (error.code === 'UNKNOWN_CHOICE') {
    return new UnprocessableEntityException({ message: 'Такого выбора нет', code: error.code });
  }
  if (error.code === 'TIMEOUT_UNHANDLED') {
    return new UnprocessableEntityException({
      message: 'У узла нет перехода по таймауту',
      code: error.code,
    });
  }
  if (error.code === 'SESSION_FINISHED') {
    return sessionClosed();
  }
  if (error.code === 'EMPTY_PLAN' || error.code === 'CAR_CLASS_EMPTY') {
    return new UnprocessableEntityException({
      message: 'Не из чего собрать смену',
      code: error.code,
    });
  }
  return new InternalServerErrorException({
    message: 'Движок не смог сделать шаг',
    code: error.code,
  });
}
