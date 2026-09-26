import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseRules } from './rules.schema';
import { RulesService, rulesPath } from './rules.service';

function service(): RulesService {
  const rules = new RulesService();
  rules.onModuleInit();
  return rules;
}

describe('rules.yaml', () => {
  const rules = service();

  it('валиден и отдаёт параметры формулы', () => {
    expect(rules.scoring()).toEqual({
      difficultyMult: { 1: 1, 2: 1.5, 3: 2 },
      speedBonusMax: 30,
      timeoutPenalty: 20,
      failPoints: 10,
    });
    expect(rules.pointsTtlDays()).toBe(30);
    expect(rules.expiryWarnDays()).toBe(3);
    expect(rules.ewmaAlpha()).toBeCloseTo(0.3);
    expect(rules.weakScore()).toBe(50);
    expect(rules.failScore()).toBe(30);
    expect(rules.gradeRules().map((rule) => [rule.from, rule.to])).toEqual([
      ['TRAINEE', 'CONDUCTOR'],
      ['CONDUCTOR', 'CONDUCTOR_SENIOR'],
      ['CONDUCTOR_SENIOR', 'INSTRUCTOR'],
    ]);
  });

  it('2340 очков — уровень 7, как в демо кабинета', () => {
    expect(rules.levelFor(2340)).toEqual({ level: 7, levelFrom: 2000, levelTo: 3000 });
  });

  it('держит границы полос и потолок 15-го уровня', () => {
    expect(rules.levelFor(0)).toMatchObject({ level: 1, levelFrom: 0 });
    expect(rules.levelFor(-10).level).toBe(1);
    expect(rules.levelFor(1999).level).toBe(6);
    expect(rules.levelFor(2000)).toEqual({ level: 7, levelFrom: 2000, levelTo: 3000 });
    expect(rules.levelFor(2999)).toEqual({ level: 7, levelFrom: 2000, levelTo: 3000 });
    expect(rules.levelFor(3000)).toMatchObject({ level: 8, levelFrom: 3000 });

    const top = rules.levelFor(1_000_000);
    expect(top.level).toBe(15);
    expect(rules.levelFor(top.levelFrom).level).toBe(15);
    expect(rules.levelFor(top.levelFrom - 1).level).toBe(14);
    expect(() => rules.levelFor(Number.NaN)).toThrow(/конечным/);
  });
});

describe('parseRules', () => {
  it('отклоняет дыру между уровнями', () => {
    const raw = parse(readFileSync(rulesPath(), 'utf8')) as { levels: { from: number }[] };
    const band = raw.levels[6];
    if (!band) {
      throw new Error('тест: в rules.yaml нет уровня 7');
    }
    band.from = 1999;
    expect(() => parseRules(raw)).toThrow(/не проходит схему/);
  });
});
