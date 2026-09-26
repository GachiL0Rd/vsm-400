import { describe, expect, it } from 'vitest';
import { doorScenario } from '../../test/fixtures/graphs';
import { type ScenarioGraph, ScenarioGraphSchema } from './schema';
import { validateScenario } from './validate';

const end = { end: 'completed' as const, text: 'конец' };

function playable(nodes: ScenarioGraph['nodes'], start = 'n1'): ScenarioGraph {
  return ScenarioGraphSchema.parse({
    id: 'probe',
    title: 'Проба',
    category: 'safety',
    stage: 'enroute',
    carClasses: ['ECONOMY'],
    difficulty: 1,
    competencies: ['safety'],
    init: { loyalty: 50, safety: 50 },
    start,
    nodes,
  });
}

describe('validateScenario', () => {
  it('принимает связный граф фикстуры', () => {
    expect(validateScenario(doorScenario())).toEqual({ ok: true, errors: [] });
  });

  it('ловит битый next, дубль id, таймер без onTimeout и недостижимый узел', () => {
    const broken = playable({
      n1: {
        text: 'узел',
        timer: 5,
        choices: [
          { id: 'a', text: 'раз', next: 'missing' },
          { id: 'a', text: 'два', next: 'end' },
        ],
      },
      end,
      orphan: { text: 'мимо', choices: [{ id: 'z', text: 'z', next: 'end' }] },
    });
    const result = validateScenario(broken);
    expect(result.ok).toBe(false);
    const codes = result.errors.map((issue) => issue.code);
    expect(codes).toContain('NEXT_MISSING');
    expect(codes).toContain('DUPLICATE_CHOICE_ID');
    expect(codes).toContain('TIMEOUT_WITHOUT_HANDLER');
    expect(codes).toContain('UNREACHABLE_NODE');
    expect(result.errors.some((issue) => issue.path === 'nodes.orphan')).toBe(true);
  });

  it('требует финал и существующий start', () => {
    const loop = validateScenario(
      playable({
        n1: { text: 'петля', choices: [{ id: 'a', text: 'a', next: 'n1' }] },
      }),
    );
    expect(loop.ok).toBe(false);
    expect(loop.errors.map((issue) => issue.code)).toContain('NO_FINALE');

    const missing = validateScenario(playable({ end }, 'gone'));
    expect(missing.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['START_MISSING', 'UNREACHABLE_NODE']),
    );
  });

  it('одинаковый id в разных узлах допустим', () => {
    const result = validateScenario(
      playable({
        n1: { text: 'a', choices: [{ id: 'go', text: 'дальше', next: 'n2' }] },
        n2: { text: 'b', choices: [{ id: 'go', text: 'ещё', next: 'end' }] },
        end,
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('requires на флаг, который нигде не set, — предупреждение, граф ещё ok', () => {
    const warned = validateScenario(
      playable({
        n1: {
          text: 'a',
          choices: [
            { id: 'go', text: 'дальше', next: 'end' },
            {
              id: 'late',
              text: 'потом',
              requires: { flags: ['approached', 'ticket'] },
              next: 'end',
            },
          ],
        },
        end,
      }),
    );
    expect(warned.ok).toBe(true);
    expect(warned.errors.map((issue) => issue.code)).toEqual(['FLAG_NEVER_SET', 'FLAG_NEVER_SET']);
    expect(warned.errors[0]?.path).toContain('approached');
  });

  it('флаг, поставленный в onTimeout, предупреждения не даёт', () => {
    const result = validateScenario(
      playable({
        n1: {
          text: 'a',
          timer: 10,
          choices: [{ id: 'go', text: 'дальше', requires: { flags: ['hesitated'] }, next: 'end' }],
          onTimeout: { set: ['hesitated'], next: 'end' },
        },
        end,
      }),
    );
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('onTimeout.next в никуда — ошибка', () => {
    const result = validateScenario(
      playable({
        n1: {
          text: 'a',
          timer: 3,
          choices: [{ id: 'go', text: 'дальше', next: 'end' }],
          onTimeout: { next: 'void' },
        },
        end,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.path === 'nodes.n1.onTimeout.next')).toBe(true);
  });

  it('пустой nodes не ok', () => {
    const result = validateScenario(playable({}, 'n1'));
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['START_MISSING', 'NO_FINALE']),
    );
  });
});
