import { describe, expect, it } from 'vitest';
import { avoidForJob } from './pool-plan';
import { buildMessages, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt';
import { similarityHit, wordJaccard } from './similarity';

describe('разнообразие формулировок', () => {
  it('джаккард не смотрит на порядок и регистр, порог строгий', () => {
    expect(wordJaccard('Свист из Тамбура', 'свист из тамбура')).toBe(1);
    expect(wordJaccard('раз два три четыре', 'пять шесть семь восемь')).toBe(0);
    expect(wordJaccard('раз два три четыре', 'раз два три пять')).toBeCloseTo(0.6);
    const same = { text: 'раз два три четыре', choices: [] as { id: string; text: string }[] };
    expect(similarityHit(same, same, [], 0.75)?.against).toBe('исходник');
    const near = { text: 'раз два три пять', choices: [] as { id: string; text: string }[] };
    expect(similarityHit(near, same, [], 0.75)).toBeNull();
    expect(similarityHit(same, near, [{ id: 'v1', payload: same }], 0.75)?.against).toBe('v1');
  });

  it('в промпт попадают до пяти формулировок, сначала персона задачи', () => {
    const rows = [
      { persona: 'громко', text: 'чужая-1' },
      { persona: 'тихо', text: 'своя-старая' },
      { persona: 'громко', text: 'чужая-2' },
      { persona: 'громко', text: 'чужая-3' },
      { persona: 'громко', text: 'чужая-4' },
      { persona: 'громко', text: 'чужая-5' },
      { persona: 'тихо', text: 'своя-новая' },
    ];
    expect(avoidForJob(rows, 'тихо').map((row) => row.text)).toEqual([
      'своя-старая',
      'своя-новая',
      'чужая-1',
      'чужая-2',
      'чужая-3',
    ]);
    const messages = buildMessages({
      persona: 'тихо',
      keep: ['свист'],
      forbid: [],
      text: 'Свист из тамбура.',
      choices: [{ id: 'radio', text: 'Доложить' }],
      avoid: [{ text: 'Не эту фразу', choices: [{ id: 'radio', text: 'Иной доклад' }] }],
    });
    expect(messages[1]?.content).toContain('Персона пассажира: тихо');
    expect(messages[1]?.content).toContain('Исходный узел JSON:');
    expect(messages[1]?.content).toContain('Не повторяй эти формулировки:');
    expect(messages[1]?.content).toContain('Не эту фразу');
    expect(SYSTEM_PROMPT).toContain('зевать остаётся зевотой');
    expect(SYSTEM_PROMPT).toContain('уже во рту не становится в руке');
    expect(PROMPT_VERSION).toBe('2026-09-27.3');
  });
});
