import { createHmac } from 'node:crypto';

/**
 * Pepper — ключ HMAC, табельный — сообщение. Наоборот короткий табельный
 * стал бы ключом и ослабил бы хеш. Открытый extId в базу не пишем (152-ФЗ).
 */
export function extHashOf(extId: string, pepper: string): string {
  return createHmac('sha256', pepper).update(extId, 'utf8').digest('hex');
}

/** Логин стабилен для одного хеша и не содержит табельный номер. */
export function loginFromExtHash(hash: string): string {
  return `e${hash.slice(0, 10)}`;
}
