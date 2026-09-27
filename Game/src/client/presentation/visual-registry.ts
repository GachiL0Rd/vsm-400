import type { PublicEntityView, PublicObjectView, PublicWorldView } from '../../common';

export interface RegionPlaceholderVisual {
  readonly fillColor: number;
  readonly borderColor: number;
}

export interface ObjectPlaceholderVisual {
  readonly fillColor: number;
  readonly borderColor: number;
  readonly shape: 'circle' | 'document' | 'square';
}

export interface EntityPlaceholderVisual {
  readonly fillColor: number;
  readonly borderColor: number;
}

const FALLBACK_REGION: RegionPlaceholderVisual = {
  fillColor: 0x40545c,
  borderColor: 0xc7d4d0,
};

const REGION_VISUALS: Readonly<Record<string, RegionPlaceholderVisual>> = {
  'region.carriage-main': { fillColor: 0x52717c, borderColor: 0xdce8e2 },
  'region.platform': { fillColor: 0x697d82, borderColor: 0xe3d5b1 },
};

const FALLBACK_OBJECT: ObjectPlaceholderVisual = {
  fillColor: 0xbcc8c0,
  borderColor: 0x183440,
  shape: 'square',
};

const OBJECT_VISUALS: Readonly<Record<string, ObjectPlaceholderVisual>> = {
  'item.acceptance-journal': { fillColor: 0xe3d5b1, borderColor: 0x604b32, shape: 'document' },
  'item.drink': { fillColor: 0x72b5d0, borderColor: 0x183440, shape: 'circle' },
  'item.extinguisher': { fillColor: 0xce765e, borderColor: 0x4f2421, shape: 'square' },
  'item.food': { fillColor: 0xe4b561, borderColor: 0x62451d, shape: 'circle' },
  'object.climate-control': { fillColor: 0x78b7b5, borderColor: 0x173f48, shape: 'square' },
  'object.driver-comms': { fillColor: 0x7d98ba, borderColor: 0x25384f, shape: 'square' },
  'object.emergency-brake': { fillColor: 0xe17f5c, borderColor: 0x5c271f, shape: 'square' },
  'object.service-point': { fillColor: 0x8db995, borderColor: 0x245142, shape: 'square' },
};

const PLAYER_VISUAL: EntityPlaceholderVisual = { fillColor: 0x78dce8, borderColor: 0x183440 };
const PASSENGER_VISUAL: EntityPlaceholderVisual = {
  fillColor: 0xe69b8d,
  borderColor: 0x4d2730,
};

/**
 * Browser-local placeholder registry. Stable IDs select a visual treatment;
 * no asset path or domain state is stored here.
 */
export class VisualRegistry {
  region(region: PublicWorldView['regions'][number]): RegionPlaceholderVisual {
    return (
      (region.visualId === undefined ? undefined : REGION_VISUALS[region.visualId]) ??
      FALLBACK_REGION
    );
  }

  object(object: PublicObjectView): ObjectPlaceholderVisual {
    return OBJECT_VISUALS[object.visualId] ?? FALLBACK_OBJECT;
  }

  entity(entity: PublicEntityView): EntityPlaceholderVisual {
    return entity.kind === 'player' ? PLAYER_VISUAL : PASSENGER_VISUAL;
  }

  heldItem(visualId: string): ObjectPlaceholderVisual {
    return OBJECT_VISUALS[visualId] ?? FALLBACK_OBJECT;
  }
}
