import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * И js в dist/<module>, и ts в src/<module> лежат на два уровня ниже Backend.
 * Хелпер сам стоит в src/rules, поэтому корень тот же, что у rules.yaml.
 */
export function contentFile(name: string): string {
  const beside = path.join(__dirname, '..', '..', 'content', name);
  if (existsSync(beside)) {
    return beside;
  }
  return path.join(process.cwd(), 'content', name);
}
