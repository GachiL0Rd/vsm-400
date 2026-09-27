import { describe, expect, it } from 'vitest';
import { extHashOf, loginFromExtHash } from './ext-hash';

describe('хеш табельного', () => {
  it('зависит от перца и не содержит открытый номер', () => {
    const extId = 'tab-unique-152fz';
    const pepper = 'local-dev-ext-id-pepper';
    const hash = extHashOf(extId, pepper);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(extHashOf(extId, pepper));
    expect(hash).not.toBe(extHashOf(extId, 'other-pepper-value'));
    expect(hash).not.toBe(extHashOf('other-tab', pepper));
    expect(hash).not.toContain(extId);
    const login = loginFromExtHash(hash);
    expect(login).toBe(`e${hash.slice(0, 10)}`);
    expect(login).not.toContain(extId);
  });
});
