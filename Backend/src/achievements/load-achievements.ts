import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { contentFile } from '../rules/content-file';
import { type AchievementsFile, parseAchievements } from './achievement.schema';

export function achievementsPath(): string {
  return contentFile('achievements.yaml');
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
