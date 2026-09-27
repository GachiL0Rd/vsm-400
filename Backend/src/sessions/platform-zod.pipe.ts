import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodType } from 'zod';

/**
 * Глобальный ZodValidationPipe на ZodDto превращается в 422.
 * Game Server читает 400 как ошибку контракта, тело ему не важно.
 */
export class PlatformZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw invalidBody(parsed.error);
    }
    return parsed.data;
  }
}

function invalidBody(error: ZodError): BadRequestException {
  return new BadRequestException({
    message: 'Проверьте переданные поля',
    code: 'invalid-body',
    errors: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    })),
  });
}
