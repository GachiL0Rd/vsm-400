import { describe, expect, it } from 'vitest';
import {
  buildJudgeMessages,
  JUDGE_SYSTEM,
  judgeJsonSchema,
  parseJudge,
  reviewStatus,
} from './judge';

const ids = ['radio', 'walk'];

describe('судья смысла', () => {
  it('все same=true проходит', () => {
    const parsed = parseJudge(
      {
        situation: { same: true, reason: 'тот же свист' },
        choices: [
          { id: 'walk', same: true, reason: 'дойти' },
          { id: 'radio', same: true, reason: 'доклад' },
        ],
      },
      ids,
    );
    expect(parsed).toEqual({ ok: true, passed: true, reason: 'смысл совпал' });
  });

  it('хотя бы один same=false отклоняет и сохраняет причину', () => {
    const parsed = parseJudge(
      JSON.stringify({
        situation: { same: false, reason: 'таблетка стала пилкой' },
        choices: [
          { id: 'radio', same: true, reason: 'ок' },
          { id: 'walk', same: false, reason: 'зевать стало топтаться' },
        ],
      }),
      ids,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.passed).toBe(false);
    expect(parsed.reason).toContain('таблетка стала пилкой');
    expect(parsed.reason).toContain('walk: зевать стало топтаться');
  });

  it('пропущенный выбор и мусор не считаются прохождением', () => {
    expect(
      parseJudge(
        {
          situation: { same: true, reason: 'ок' },
          choices: [{ id: 'radio', same: true, reason: 'ок' }],
        },
        ids,
      ),
    ).toMatchObject({ ok: true, passed: false });
    expect(parseJudge('не json', ids)).toEqual({
      ok: false,
      reason: 'судья вернул неразборчивый ответ',
    });
  });

  it('checks с enum id читается так же, как старый объект', () => {
    const parsed = parseJudge(
      {
        checks: [
          { id: 'text', same: true, reason: 'тот же свист' },
          { id: 'radio', same: true, reason: 'доклад' },
          { id: 'walk', same: false, reason: 'другое действие' },
        ],
      },
      ids,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.passed).toBe(false);
    expect(parsed.reason).toContain('walk: другое действие');
  });

  it('пропуск id text — отказ, а не мусор', () => {
    const parsed = parseJudge(
      {
        checks: [
          { id: 'radio', same: true, reason: 'доклад' },
          { id: 'walk', same: true, reason: 'дойти' },
        ],
      },
      ids,
    );
    expect(parsed).toMatchObject({ ok: true, passed: false });
    if (!parsed.ok) {
      return;
    }
    expect(parsed.reason).toContain('нет пункта text');
  });

  it('схема фиксирует text и id выборов', () => {
    const schema = judgeJsonSchema(ids);
    const checks = (
      schema.properties as {
        checks: {
          minItems: number;
          maxItems: number;
          items: { properties: { id: { enum: string[] } } };
        };
      }
    ).checks;
    expect(schema.required).toEqual(['checks']);
    expect(checks.minItems).toBe(3);
    expect(checks.maxItems).toBe(3);
    expect(checks.items.properties.id.enum).toEqual(['text', 'radio', 'walk']);
  });

  it('тот же смысл другими словами не просит same=false', () => {
    expect(JUDGE_SYSTEM).toContain(
      'same=true, если действие и адресат те же, отличаются только слова',
    );
    expect(
      buildJudgeMessages(
        { text: 'Таблетка уже во рту.', choices: [{ id: 'radio', text: 'Сказать начальнику' }] },
        { text: 'Таблетка во рту.', choices: [{ id: 'radio', text: 'Доложить начальнику' }] },
      )[0]?.content,
    ).toContain('медицинском узле');
  });

  it('autoApprove работает только вместе с судьёй', () => {
    expect(reviewStatus(true, true)).toBe('APPROVED');
    expect(reviewStatus(true, false)).toBe('PENDING_REVIEW');
    expect(reviewStatus(false, true)).toBe('PENDING_REVIEW');
  });
});
