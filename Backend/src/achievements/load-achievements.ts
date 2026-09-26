import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { type AchievementsFile, parseAchievements } from './achievement.schema';

/**
 * Сборка кладёт js в dist/achievements, исходник — в src/achievements.
 * Оба пути на два уровня выше упираются в Backend/content.
 */
export function achievementsPath(): string {
  const besideBuild = path.join(__dirname, '..', '..', 'content', 'achievements.yaml');
  if (existsSync(besideBuild)) {
    return besideBuild;
  }
  return path.join(process.cwd(), 'content', 'achievements.yaml');
}

export function loadAchievements(filePath = achievementsPath()): AchievementsFile {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не прочитать ачивки ${filePath}: ${message}`);
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`achievements.yaml не YAML: ${message}`);
  }
  return parseAchievements(raw);
}
