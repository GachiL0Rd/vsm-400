export const MARKER_STEP = 48;

const LABELS: Readonly<Record<string, string>> = {
  'acceptance-journal': 'ЖУРНАЛ',
  'climate-control': 'ПАНЕЛЬ',
  'driver-comms': 'СВЯЗЬ',
  'emergency-brake': 'СТОП',
  extinguisher: 'ОГН',
  fire: 'ОГОНЬ',
  'service-point': 'СЕРВИС',
};

export function objectLabel(kind: string): string {
  return LABELS[kind] ?? kind.slice(0, 12);
}

/** Several objects in one cell sit side by side, stable by id. */
export function markerOffsetX(
  objects: readonly { readonly id: string; readonly cellId: string }[],
): Map<string, number> {
  const grouped = new Map<string, string[]>();
  for (const object of objects) {
    const ids = grouped.get(object.cellId);
    if (ids === undefined) grouped.set(object.cellId, [object.id]);
    else ids.push(object.id);
  }
  const offsets = new Map<string, number>();
  for (const ids of grouped.values()) {
    ids.sort(compareIds);
    const half = (ids.length - 1) / 2;
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      if (id === undefined) continue;
      offsets.set(id, (index - half) * MARKER_STEP);
    }
  }
  return offsets;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
