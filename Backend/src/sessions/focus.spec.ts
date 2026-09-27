import { describe, expect, it } from 'vitest';
import { weakest } from './focus';

describe('фокус смены', () => {
  it('берёт две слабейшие, пустая шкала считается нулём', () => {
    expect(
      weakest(
        [
          { competency: 'safety', value: 80 },
          { competency: 'service', value: 10 },
        ],
        2,
      ),
    ).toEqual(['detection', 'escalation']);
    expect(weakest([{ competency: 'detection', value: 5 }], 2)).toEqual([
      'escalation',
      'procedure',
    ]);
  });
});
