import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

/** Рядом с dist и с src: оба на два уровня выше лежат в Backend/content. */
export function loadRoutesFile(): unknown {
  const beside = path.join(__dirname, '..', '..', 'content', 'routes.yaml');
  const filePath = existsSync(beside) ? beside : path.join(process.cwd(), 'content', 'routes.yaml');
  if (!existsSync(filePath)) {
    throw new Error(`Нет справочника маршрутов: ${filePath}`);
  }
  return parse(readFileSync(filePath, 'utf8'));
}
