import { describe, expect, it } from 'vitest';
import { VisualRegistry } from './visual-registry';

const registry = new VisualRegistry();

describe('VisualRegistry', () => {
  it('resolves stable public IDs without requiring an asset path', () => {
    expect(registry.region({ id: 'carriage-main', visualId: 'region.carriage-main' })).toEqual({
      fillColor: 0x52717c,
      borderColor: 0xdce8e2,
    });
    expect(
      registry.object({
        id: 'extinguisher',
        kind: 'extinguisher',
        visualId: 'item.extinguisher',
        cellId: 'carriage.cabin',
      }),
    ).toMatchObject({ shape: 'square', fillColor: 0xce765e });
  });

  it('keeps an explicit placeholder for unknown public IDs', () => {
    expect(registry.region({ id: 'future-region', visualId: 'region.future' })).toEqual({
      fillColor: 0x40545c,
      borderColor: 0xc7d4d0,
    });
    expect(registry.heldItem('item.future')).toMatchObject({ shape: 'square' });
  });
});
