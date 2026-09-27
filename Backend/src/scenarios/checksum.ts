import { createHash } from 'node:crypto';

/** Порядок ключей в YAML и в JSON редактора не должен плодить новую версию. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function graphChecksum(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}
