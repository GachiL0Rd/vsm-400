import { describe, expect, it } from 'vitest';
import { challengeText, lowestAverage, runMatchesTheme } from './challenge';

describe('тема недели', () => {
  it('берёт компетенцию с наименьшим средним, при равенстве — более раннюю ось', () => {
    expect(
      lowestAverage([
        { competency: 'safety', value: 70 },
        { competency: 'escalation', value: 40 },
        { competency: 'escalation', value: 44 },
        { competency: 'service', value: 50 },
      ]),
    ).toBe('escalation');
    expect(
      lowestAverage([
        { competency: 'service', value: 40 },
        { competency: 'safety', value: 40 },
      ]),
    ).toBe('safety');
    expect(lowestAverage([])).toBeNull();
  });

  it('рейс подходит, если сценарий или дельта содержит тему', () => {
    expect(runMatchesTheme('escalation', [['safety'], ['escalation', 'service']], {})).toBe(true);
    expect(runMatchesTheme('reaction', [['safety']], { reaction: 2 })).toBe(true);
    expect(runMatchesTheme('reaction', [['safety']], { service: 1 })).toBe(false);
    expect(challengeText('Эскалация')).toBe(
      'Неделя Эскалация — бригады депо соревнуются до воскресенья',
    );
  });
});
