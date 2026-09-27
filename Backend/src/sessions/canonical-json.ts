import { createHash } from 'node:crypto';

/** Стабильный JSON: ключи объектов по алфавиту, порядок массива сохраняется. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function payloadSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (!isPlain(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item !== undefined) {
      sorted[key] = sortValue(item);
    }
  }
  return sorted;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
