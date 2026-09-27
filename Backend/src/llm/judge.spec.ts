import { describe, expect, it } from 'vitest';
import { parseJudge, reviewStatus } from './judge';

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

  it('autoApprove работает только вместе с судьёй', () => {
    expect(reviewStatus(true, true)).toBe('APPROVED');
    expect(reviewStatus(true, false)).toBe('PENDING_REVIEW');
    expect(reviewStatus(false, true)).toBe('PENDING_REVIEW');
  });
});
