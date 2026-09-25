import { describe, expect, it } from 'vitest';
import {
  applyFireExtinguisher,
  createEquipmentState,
  prepareFireExtinguisher,
  takeFireExtinguisher,
} from './equipment';

describe('fire extinguisher', () => {
  it('moves through the stored, held, and prepared states', () => {
    const stored = createEquipmentState();
    const held = takeFireExtinguisher(stored);
    const prepared = prepareFireExtinguisher(held.state);

    expect(held.accepted).toBe(true);
    expect(held.state.extinguisher.position).toBe('held');
    expect(prepared.accepted).toBe(true);
    expect(prepared.state.extinguisher.readiness).toBe('prepared');
  });

  it('does not allow a second held item', () => {
    const held = takeFireExtinguisher(createEquipmentState()).state;
    const secondTake = takeFireExtinguisher(held);

    expect(secondTake.accepted).toBe(false);
    expect(secondTake.state).toBe(held);
    expect(secondTake.message).toContain('второй предмет');
  });

  it('rejects application until the held extinguisher is prepared', () => {
    const held = takeFireExtinguisher(createEquipmentState()).state;
    const application = applyFireExtinguisher(held);

    expect(application.accepted).toBe(false);
    expect(application.state).toBe(held);
    expect(application.message).toContain('не подготовлен');
  });
});
