import { FastifyAdapter } from '@nestjs/platform-fastify';

export const BODY_LIMIT_BYTES = 1_048_576;

/** trustProxy — false или строка адресов прокси: число хопов fastify 5.12 не читает. */
export function createFastifyAdapter(trustProxy: false | string = false): FastifyAdapter {
  return new FastifyAdapter({ bodyLimit: BODY_LIMIT_BYTES, trustProxy });
}
