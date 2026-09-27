import { HttpException } from '@nestjs/common';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client';

export type ProblemError = {
  path: string;
  code: string;
  message: string;
};

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  errors?: ProblemError[];
};

const titles: Record<number, string> = {
  400: 'Некорректный запрос',
  401: 'Нужна аутентификация',
  403: 'Доступ запрещён',
  404: 'Не найдено',
  409: 'Конфликт',
  410: 'Больше не доступен',
  422: 'Некорректные данные',
  500: 'Внутренняя ошибка',
  503: 'Сервис недоступен',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function titleFor(status: number): string {
  return titles[status] ?? 'Ошибка';
}

function problem(status: number, detail: string, code: string, errors?: ProblemError[]): Problem {
  const body: Problem = {
    type: 'about:blank',
    title: titleFor(status),
    status,
    detail,
    code,
  };
  if (errors && errors.length > 0) {
    body.errors = errors;
  }
  return body;
}

/** nestjs-zod кидает HttpException 400, SPEC хочет 422 с errors[]. */
export function extractZodError(exception: unknown): ZodError | undefined {
  if (exception instanceof ZodError) {
    return exception;
  }
  if (!isRecord(exception) || typeof exception.getZodError !== 'function') {
    return undefined;
  }
  const error = exception.getZodError();
  return error instanceof ZodError ? error : undefined;
}

function zodProblem(error: ZodError): Problem {
  const errors = error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
  return problem(422, 'Проверьте переданные поля', 'VALIDATION', errors);
}

function detailFromHttp(response: unknown, status: number): string {
  if (typeof response === 'string' && response.length > 0) {
    return response;
  }
  if (isRecord(response)) {
    if (typeof response.message === 'string' && response.message.length > 0) {
      return response.message;
    }
    if (Array.isArray(response.message)) {
      const messages = response.message.filter((item): item is string => typeof item === 'string');
      if (messages.length > 0) {
        return messages.join('; ');
      }
    }
  }
  return titleFor(status);
}

function codeFromHttp(response: unknown, status: number): string {
  if (isRecord(response) && typeof response.code === 'string' && response.code.length > 0) {
    return response.code;
  }
  return `HTTP_${status}`;
}

function errorsFromHttp(response: unknown): ProblemError[] | undefined {
  if (!isRecord(response) || !Array.isArray(response.errors)) {
    return undefined;
  }
  const errors: ProblemError[] = [];
  for (const item of response.errors) {
    if (!isRecord(item) || typeof item.message !== 'string') {
      continue;
    }
    errors.push({
      path: typeof item.path === 'string' ? item.path : '',
      code: typeof item.code === 'string' ? item.code : 'custom',
      message: item.message,
    });
  }
  return errors.length > 0 ? errors : undefined;
}

function httpProblem(exception: HttpException): Problem {
  const status = exception.getStatus();
  const response = exception.getResponse();
  return problem(
    status,
    detailFromHttp(response, status),
    codeFromHttp(response, status),
    errorsFromHttp(response),
  );
}

function prismaCode(exception: unknown): string | undefined {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }
  return exception.code;
}

export function toProblem(exception: unknown): Problem {
  const zodError = extractZodError(exception);
  if (zodError) {
    return zodProblem(zodError);
  }
  if (exception instanceof HttpException) {
    return httpProblem(exception);
  }
  const code = prismaCode(exception);
  if (code === 'P2002') {
    return problem(409, 'Запись с такими данными уже есть', 'UNIQUE_CONSTRAINT');
  }
  if (code === 'P2025') {
    return problem(404, 'Запись не найдена', 'NOT_FOUND');
  }
  return problem(500, 'Внутренняя ошибка сервера', 'INTERNAL');
}
