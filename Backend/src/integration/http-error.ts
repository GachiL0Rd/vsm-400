import { HttpException } from '@nestjs/common';

/** Фильтр problem+json забирает `message` как detail и `code` как код. */
export function httpError(status: number, detail: string, code: string): HttpException {
  return new HttpException({ message: detail, code }, status);
}
