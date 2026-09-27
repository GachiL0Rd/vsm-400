import { describe, expect, it } from 'vitest';
import {
  buildJudgeMessages,
  JUDGE_SYSTEM,
  judgeOutcome,
  parseJudgeText,
  reviewStatus,
  SITUATION_KEY,
} from './judge';

const ids = ['radio', 'walk'];

const clean = ['ситуация: да', 'radio: да', 'walk: да'].join('\n');

describe('parseJudgeText', () => {
  it('чистые строки: ситуация и id', () => {
    expect(parseJudgeText(clean, ids)).toEqual({
      situation: { same: true },
      choices: { radio: { same: true }, walk: { same: true } },
      missing: [],
    });
  });

  it('нет с причиной, да без причины', () => {
    const parsed = parseJudgeText(
      ['ситуация: нет — таблетка стала пилкой', 'radio: да', 'walk: нет — другое действие'].join(
        '\n',
      ),
      ids,
    );
    expect(parsed.missing).toEqual([]);
    expect(parsed.situation).toEqual({ same: false, reason: 'таблетка стала пилкой' });
    expect(parsed.choices.walk).toEqual({ same: false, reason: 'другое действие' });
    expect(parsed.choices.radio).toEqual({ same: true });
  });

  it('терпит регистр, пробелы, маркеры, жирный и кавычки', () => {
    const raw = [
      'лишняя шапка',
      '  1. **СИТУАЦИЯ**:   Да.  ',
      '- "Radio": да',
      '* «walk» — нет, топчется',
      'подвал не читаем',
    ].join('\n');
    expect(parseJudgeText(raw, ids)).toEqual({
      situation: { same: true },
      choices: {
        radio: { same: true },
        walk: { same: false, reason: 'топчется' },
      },
      missing: [],
    });
  });

  it('ё и е в ключе и в «нет» — одно и то же', () => {
    const parsed = parseJudgeText('ситуация: да\nеж: нёт — другой предмет', ['ёж']);
    expect(parsed.missing).toEqual([]);
    expect(parsed.choices.ёж).toEqual({ same: false, reason: 'другой предмет' });
  });

  it('двоеточие, тире и « - » равноправны', () => {
    const parsed = parseJudgeText(
      ['ситуация — да', 'radio - нет — чужой адресат', 'walk: нет: щель'].join('\n'),
      ids,
    );
    expect(parsed.situation).toEqual({ same: true });
    expect(parsed.choices.radio).toEqual({ same: false, reason: 'чужой адресат' });
    expect(parsed.choices.walk).toEqual({ same: false, reason: 'щель' });
  });

  it('дефис внутри id не становится разделителем', () => {
    const parsed = parseJudgeText('ситуация: да\nradio-now: нет — доклад сорван', ['radio-now']);
    expect(parsed.choices['radio-now']).toEqual({ same: false, reason: 'доклад сорван' });
    expect(parsed.missing).toEqual([]);
  });

  it('«Да.» и «нет,» без причины, причина приклеена запятой', () => {
    const parsed = parseJudgeText(
      ['ситуация: Да.', 'radio: нет,', 'walk: нет,другое'].join('\n'),
      ids,
    );
    expect(parsed.situation).toEqual({ same: true });
    expect(parsed.choices.radio).toEqual({ same: false });
    expect(parsed.choices.walk).toEqual({ same: false, reason: 'другое' });
  });

  it('yes и no не считаются да и нет', () => {
    const parsed = parseJudgeText(['ситуация: yes', 'radio: no', 'walk: YES'].join('\n'), ids);
    expect(parsed.situation).toBeNull();
    expect(parsed.choices).toEqual({});
    expect(parsed.missing).toEqual([SITUATION_KEY, 'radio', 'walk']);
  });

  it('ищет строку по каждому ключу и помнит пропуски по порядку', () => {
    const parsed = parseJudgeText('radio: да\nхвост: да\n', ids);
    expect(parsed.choices).toEqual({ radio: { same: true } });
    expect(parsed.missing).toEqual([SITUATION_KEY, 'walk']);
  });

  it('пустой ответ и JSON — все ключи пропущены', () => {
    const empty = parseJudgeText('  \n', ids);
    expect(empty.missing).toEqual([SITUATION_KEY, 'radio', 'walk']);
    const json = parseJudgeText('{"checks":[{"id":"text","same":true}]}', ids);
    expect(json.missing).toEqual([SITUATION_KEY, 'radio', 'walk']);
    expect(json.situation).toBeNull();
  });

  it('первая годная строка ключа побеждает, чужой id молчит', () => {
    const parsed = parseJudgeText(
      ['radio: нет — первое', 'radio: да', 'чужой: нет — мимо', 'ситуация: да'].join('\n'),
      ids,
    );
    expect(parsed.choices.radio).toEqual({ same: false, reason: 'первое' });
    expect(parsed.missing).toEqual(['walk']);
  });

  it('причина обрезается на 100 символах', () => {
    const reason = 'я'.repeat(120);
    const parsed = parseJudgeText(`ситуация: нет — ${reason}\nradio: да\nwalk: да`, ids);
    expect(parsed.situation?.reason).toHaveLength(100);
    expect(parsed.situation?.reason).toBe('я'.repeat(100));
  });

  it('кавычки вокруг «нет» не мешают вердикту', () => {
    const parsed = parseJudgeText(['ситуация: «да»', 'radio: «нет» — чужой адресат'].join('\n'), [
      'radio',
    ]);
    expect(parsed.situation).toEqual({ same: true });
    expect(parsed.choices.radio).toEqual({ same: false, reason: 'чужой адресат' });
  });

  it('звёздочки вокруг ответа и маркер 2) снимаются', () => {
    const parsed = parseJudgeText(
      ['2) ситуация: **да**', '**radio**: **нет** — другой адресат'].join('\n'),
      ['radio'],
    );
    expect(parsed.situation).toEqual({ same: true });
    expect(parsed.choices.radio).toEqual({ same: false, reason: 'другой адресат' });
  });
});

describe('judgeOutcome', () => {
  it('все да — прошёл', () => {
    expect(judgeOutcome(parseJudgeText(clean, ids))).toEqual({
      passed: true,
      reason: 'смысл совпал',
    });
  });

  it('любое нет даёт judge: id: причина', () => {
    const parsed = parseJudgeText(
      ['ситуация: нет — таблетка стала пилкой', 'radio: да', 'walk: нет — действие другое'].join(
        '\n',
      ),
      ids,
    );
    expect(judgeOutcome(parsed)).toEqual({
      passed: false,
      reason: 'judge: ситуация: таблетка стала пилкой; judge: walk: действие другое',
    });
  });

  it('нет без причины и пропуск ключа', () => {
    const noReason = parseJudgeText('ситуация: да\nradio: нет\nwalk: да', ids);
    expect(judgeOutcome(noReason).reason).toBe('judge: radio: смысл другой');
    const missed = parseJudgeText('ситуация: да\nradio: да', ids);
    expect(judgeOutcome(missed)).toEqual({ passed: false, reason: 'judge-unparsed' });
  });
});

describe('промпт судьи', () => {
  it('требует текст, да и нет, и не просит JSON', () => {
    expect(JUDGE_SYSTEM).toContain('Ровно одна строка на пункт');
    expect(JUDGE_SYSTEM).toContain('Без JSON');
    expect(JUDGE_SYSTEM).toContain(
      '«да», если действие, адресат и смысл те же и отличаются только слова.',
    );
    expect(JUDGE_SYSTEM).toContain(
      '«нет», если изменились действие, адресат или факты, либо добавлены детали.',
    );
    expect(JUDGE_SYSTEM).not.toContain('same=');
    expect(JUDGE_SYSTEM).not.toContain('Верни только JSON');
  });

  it('напоминание повторяет ключи и запрет JSON', () => {
    const messages = buildJudgeMessages(
      { text: 'Таблетка уже во рту.', choices: [{ id: 'radio', text: 'Сказать начальнику' }] },
      { text: 'Таблетка во рту.', choices: [{ id: 'radio', text: 'Доложить начальнику' }] },
      true,
    );
    const user = messages[1]?.content ?? '';
    expect(messages[0]?.content).toContain('отличаются только слова');
    expect(user).toContain('Таблетка уже во рту.');
    expect(user).toContain('Прошлый ответ не разобран.');
    expect(user).toContain('ситуация: да');
    expect(user).toContain('radio: да');
    expect(user).toContain('Без JSON');
  });

  it('autoApprove работает только вместе с судьёй', () => {
    expect(reviewStatus(true, true)).toBe('APPROVED');
    expect(reviewStatus(true, false)).toBe('PENDING_REVIEW');
    expect(reviewStatus(false, true)).toBe('PENDING_REVIEW');
  });
});
