import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { contentFile } from '../rules/content-file';

export function loadRoutesFile(): unknown {
  const filePath = contentFile('routes.yaml');
  if (!existsSync(filePath)) {
    throw new Error(`Нет справочника маршрутов: ${filePath}`);
  }
  return parse(readFileSync(filePath, 'utf8'));
}
