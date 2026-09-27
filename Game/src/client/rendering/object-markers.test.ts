import { describe, expect, it } from 'vitest';
import { MARKER_STEP, markerOffsetX, objectLabel } from './object-markers';

describe('object markers', () => {
  it('offsets objects that share a cell and leaves a lone object centered', () => {
    const offsets = markerOffsetX([
      { id: 'driver-comms', cellId: 'carriage.x74y8' },
      { id: 'climate-control', cellId: 'carriage.x74y8' },
      { id: 'extinguisher', cellId: 'carriage.x67y8' },
    ]);

    expect(offsets.get('climate-control')).toBe(-MARKER_STEP / 2);
    expect(offsets.get('driver-comms')).toBe(MARKER_STEP / 2);
    expect(offsets.get('extinguisher')).toBe(0);
  });

  it('keeps short Russian labels', () => {
    expect(objectLabel('emergency-brake')).toBe('СТОП');
    expect(objectLabel('acceptance-journal')).toBe('ЖУРНАЛ');
    expect(objectLabel('unknown-kind')).toBe('unknown-kind');
  });
});
