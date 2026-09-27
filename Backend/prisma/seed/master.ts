import { createHash, createHmac } from 'node:crypto';

/** Фиксированный корень: повтор сида с --reset даёт те же рейсы. */
export const MASTER_SEED = createHash('sha256').update('vsm-seed-v1').digest();

/** Тот же HMAC, что у Rng.fork: метка не сдвигает счётчик родителя. */
export function childSeed(parent: Buffer, label: string): Buffer {
  return createHmac('sha256', parent).update(`fork:${label}`, 'utf8').digest();
}
