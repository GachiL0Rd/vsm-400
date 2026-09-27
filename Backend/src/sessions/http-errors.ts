import {
  BadRequestException,
  ConflictException,
  GoneException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EngineError } from '../engine/errors';

export function notFound(): NotFoundException {
  return new NotFoundException({ message: 'Сессия не найдена', code: 'NOT_FOUND' });
}

export function sessionClosed(): ConflictException {
  return new ConflictException({ message: 'Смена уже закрыта', code: 'SESSION_CLOSED' });
}

export function invalidSession(): NotFoundException {
  return new NotFoundException({
    message: 'Ключ сессии недействителен',
    code: 'invalid-session',
  });
}

export function sessionExpired(): GoneException {
  return new GoneException({ message: 'Ключ сессии истёк', code: 'session-expired' });
}

export function sessionConsumed(): GoneException {
  return new GoneException({ message: 'Ключ сессии уже использован', code: 'session-consumed' });
}

export function sessionUnavailable(): ConflictException {
  return new ConflictException({
    message: 'Смена сейчас недоступна для запуска',
    code: 'session-unavailable',
  });
}

export function resultConflict(): ConflictException {
  return new ConflictException({
    message: 'Для этой смены уже сохранён другой итог',
    code: 'result-conflict',
  });
}

export function attemptMismatch(): BadRequestException {
  return new BadRequestException({
    message: 'attemptId в пути и в теле не совпадают',
    code: 'attempt-mismatch',
  });
}

export function attemptNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Попытка не найдена', code: 'attempt-not-found' });
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
