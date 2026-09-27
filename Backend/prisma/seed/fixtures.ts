import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type FinishedGameResult, finishedGameResultSchema } from '../../src/sessions/platform.dto';

export function loadGameResults(): FinishedGameResult[] {
  const file = join(process.cwd(), 'prisma', 'seed', 'fixtures', 'game-results.json');
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return finishedGameResultSchema.array().parse(raw);
}
