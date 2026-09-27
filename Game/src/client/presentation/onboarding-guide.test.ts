import { describe, expect, it } from 'vitest';
import {
  advanceGuide,
  closeGuide,
  GUIDE_STEPS,
  initialGuideState,
  readGuideSeen,
  reopenGuide,
  rewindGuide,
  writeGuideSeen,
} from './onboarding-guide';

describe('onboarding guide', () => {
  it('opens on the first launch and stays closed once the flag is stored', () => {
    expect(initialGuideState(false)).toEqual({ open: true, index: 0 });
    expect(initialGuideState(true)).toEqual({ open: false, index: 0 });
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    expect(readGuideSeen(memory)).toBe(false);
    writeGuideSeen(memory);
    expect(readGuideSeen(memory)).toBe(true);
  });

  it('ignores storage that throws', () => {
    const storage = {
      getItem: (): string => {
        throw new Error('denied');
      },
      setItem: (): void => {
        throw new Error('denied');
      },
    };
    expect(readGuideSeen(storage)).toBe(false);
    expect(() => writeGuideSeen(storage)).not.toThrow();
    expect(readGuideSeen(null)).toBe(false);
  });

  it('walks the steps, clamps back, and can reopen after dismiss', () => {
    let state = initialGuideState(false);
    expect(GUIDE_STEPS).toHaveLength(5);
    expect(GUIDE_STEPS[0]?.body).toContain('Приёмка вагона');
    expect(GUIDE_STEPS[1]?.body).toContain('Клик или тап');
    expect(GUIDE_STEPS[2]?.spotlight).toEqual(['tasks', 'feed', 'items']);
    expect(GUIDE_STEPS[3]?.body).toContain('×1');
    expect(GUIDE_STEPS[4]?.body).toContain('журналу приёмки');
    expect(rewindGuide(state).index).toBe(0);
    state = advanceGuide(state);
    expect(state).toEqual({ open: true, index: 1 });
    state = rewindGuide(state);
    expect(state.index).toBe(0);
    for (let step = 0; step < GUIDE_STEPS.length; step += 1) state = advanceGuide(state);
    expect(state).toEqual(closeGuide());
    expect(reopenGuide()).toEqual({ open: true, index: 0 });
  });
});
