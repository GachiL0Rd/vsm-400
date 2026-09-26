import { readFileSync } from 'node:fs';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { parse } from 'yaml';
import { contentFile } from './content-file';
import {
  type GradeRule,
  type LevelBand,
  parseRules,
  type Rules,
  type ScoringParams,
} from './rules.schema';

export function rulesPath(): string {
  return contentFile('rules.yaml');
}

export function loadRules(filePath = rulesPath()): Rules {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не прочитать правила ${filePath}: ${message}`);
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`rules.yaml не YAML: ${message}`);
  }
  return parseRules(raw);
}

@Injectable()
export class RulesService implements OnModuleInit {
  private rules: Rules | null = null;

  onModuleInit(): void {
    this.rules = loadRules();
  }

  scoring(): ScoringParams {
    const scoring = this.current().scoring;
    return { ...scoring, difficultyMult: { ...scoring.difficultyMult } };
  }

  /**
   * Полоса [levelFrom, levelTo). Выше потолка 15-го уровня остаётся 15-й:
   * levelTo остаётся порогом полосы, чтобы шкала кабинета не теряла знаменатель.
   */
  levelFor(totalPoints: number): LevelBand {
    if (!Number.isFinite(totalPoints)) {
      throw new Error('Очки должны быть конечным числом');
    }
    const points = Math.max(0, totalPoints);
    const levels = this.current().levels;
    let band = levels[0];
    if (!band) {
      throw new Error('В правилах нет уровней');
    }
    for (const candidate of levels) {
      if (points >= candidate.from) {
        band = candidate;
      }
    }
    return { level: band.level, levelFrom: band.from, levelTo: band.to };
  }

  pointsTtlDays(): number {
    return this.current().pointsTtlDays;
  }

  expiryWarnDays(): number {
    return this.current().expiryWarnDays;
  }

  ewmaAlpha(): number {
    return this.current().ewmaAlpha;
  }

  gradeRules(): GradeRule[] {
    return this.current().grades.map((rule) => ({
      ...rule,
      requiredCategories: [...rule.requiredCategories],
    }));
  }

  weakScore(): number {
    return this.current().weakScore;
  }

  failScore(): number {
    return this.current().failScore;
  }

  challengePoints(): number {
    return this.current().challengePoints;
  }

  private current(): Rules {
    if (!this.rules) {
      throw new Error('Правила не загружены');
    }
    return this.rules;
  }
}
