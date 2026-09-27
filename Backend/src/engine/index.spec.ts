import { describe, expect, it } from 'vitest';
import { doorScenario } from '../../test/fixtures/graphs';
import { routeName } from '../../test/fixtures/route-name';
import { createRng, politenessOf, validateScenario } from './index';

describe('engine index', () => {
  it('собирает публичный прогон через баррель', () => {
    const door = doorScenario();
    expect(validateScenario(door).ok).toBe(true);
    expect(routeName('Москва', 'Санкт-Петербург')).toContain('Москва');
    expect(politenessOf(80, [], [])).toBe(80);
    expect(createRng(Buffer.alloc(32, 1)).int(1, 1)).toBe(1);
  });
});
