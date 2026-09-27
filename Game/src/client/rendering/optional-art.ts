import type Phaser from 'phaser';

// Existing art is bundled as an optional backdrop. Server cells remain the
// only source of gameplay coordinates and interaction targets.
const characterFiles = import.meta.glob('../assets/characters/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;
const conductorFiles = import.meta.glob('../../../assets/characters/provodnik/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;
const mapFiles = import.meta.glob('../../../assets/map/train2-long.tmx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;
const tilesetFiles = import.meta.glob('../../../assets/map/*.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;
const tilesetImages = import.meta.glob('../../../assets/map/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

const mapXml = Object.values(mapFiles)[0];
const TILE_SIZE = 64;
const BACKGROUND_SCALE = 0.22;

export type Direction = 'front' | 'back' | 'left' | 'right';

interface TilesetSource {
  firstGid: number;
  tileCount: number;
  key: string;
  imageUrl: string;
  tileWidth: number;
  tileHeight: number;
}

const conductorNames: Record<Direction, readonly [string, string, string]> = {
  front: ['проводник-1-перед', 'проводник-шаг1-перед', 'проводник-шаг2-перед'],
  back: ['проводни-спина', 'проводник-шаг1-спина', 'проводник-шаг2-спина'],
  left: ['проводник-лево', 'проводник-шаг1-лево', 'проводник-шаг2-лево'],
  right: ['проводник-право', 'проводник-шаг1-право', 'проводник-шаг2-право'],
};

export function characterTextureKey(appearanceId: string): string {
  return `character:${appearanceId}`;
}

export function conductorTextureKey(direction: Direction, step: 0 | 1 | 2): string {
  return `conductor:${direction}:${step}`;
}

export function preloadOptionalArt(scene: Phaser.Scene): void {
  for (const [path, url] of Object.entries(characterFiles)) {
    scene.load.image(characterTextureKey(fileStem(path)), url);
  }
  const byName = new Map(
    Object.entries(conductorFiles).map(([path, url]) => [fileStem(path), url]),
  );
  for (const direction of Object.keys(conductorNames) as Direction[]) {
    conductorNames[direction].forEach((name, step) => {
      const url = byName.get(name);
      if (url !== undefined)
        scene.load.image(conductorTextureKey(direction, step as 0 | 1 | 2), url);
    });
  }
  for (const tileset of parseTilesets()) {
    scene.load.spritesheet(tileset.key, tileset.imageUrl, {
      frameWidth: tileset.tileWidth,
      frameHeight: tileset.tileHeight,
    });
  }
}

/** Draws the TMX layers as scaled, non-interactive decoration. */
export function createOptionalTiledBackground(
  scene: Phaser.Scene,
  originX: number,
  originY: number,
): boolean {
  const document = parseXml(mapXml);
  const tilesets = parseTilesets()
    .filter((tileset) => scene.textures.exists(tileset.key))
    .sort((left, right) => right.firstGid - left.firstGid);
  if (document === null || tilesets.length === 0) return false;
  let created = false;
  Array.from(document.querySelectorAll('map > layer')).forEach((layer, layerIndex) => {
    const blitters = new Map<string, Phaser.GameObjects.Blitter>();
    for (const chunk of Array.from(layer.querySelectorAll('data > chunk'))) {
      const chunkX = Number(chunk.getAttribute('x'));
      const chunkY = Number(chunk.getAttribute('y'));
      const width = Number(chunk.getAttribute('width'));
      if (!Number.isFinite(chunkX) || !Number.isFinite(chunkY) || width <= 0) continue;
      const gids = (chunk.textContent ?? '').split(',').map((value) => Number(value.trim()));
      gids.forEach((rawGid, index) => {
        // Tiled reserves the highest bits for optional tile flips.
        const gid = rawGid & 0x0fffffff;
        if (gid === 0) return;
        const tileset = tilesets.find(
          (candidate) =>
            gid >= candidate.firstGid && gid < candidate.firstGid + candidate.tileCount,
        );
        if (tileset === undefined) return;
        let blitter = blitters.get(tileset.key);
        if (blitter === undefined) {
          blitter = scene.add.blitter(originX, originY, tileset.key);
          blitter
            .setScale(BACKGROUND_SCALE)
            .setAlpha(0.62)
            .setDepth(-30 + layerIndex);
          blitters.set(tileset.key, blitter);
        }
        const x = (chunkX + (index % width)) * TILE_SIZE;
        const y = (chunkY + Math.floor(index / width)) * TILE_SIZE;
        blitter
          .create(x, y, gid - tileset.firstGid)
          .setFlip((rawGid & 0x80000000) !== 0, (rawGid & 0x40000000) !== 0);
        created = true;
      });
    }
  });
  return created;
}

function parseTilesets(): TilesetSource[] {
  const document = parseXml(mapXml);
  if (document === null) return [];
  return Array.from(document.querySelectorAll('map > tileset')).flatMap((reference) => {
    const source = reference.getAttribute('source');
    const firstGid = Number(reference.getAttribute('firstgid'));
    if (source === null || !Number.isFinite(firstGid)) return [];
    const xml = Object.entries(tilesetFiles).find(([path]) => path.endsWith(`/${source}`))?.[1];
    const tileset = parseXml(xml)?.documentElement;
    const imageName = tileset?.querySelector('image')?.getAttribute('source');
    const imageUrl = Object.entries(tilesetImages).find(([path]) =>
      path.endsWith(`/${imageName}`),
    )?.[1];
    if (tileset == null || imageUrl === undefined) return [];
    return [
      {
        firstGid,
        tileCount: Number(tileset.getAttribute('tilecount')),
        key: `tiled:${source}`,
        imageUrl,
        tileWidth: Number(tileset.getAttribute('tilewidth')),
        tileHeight: Number(tileset.getAttribute('tileheight')),
      },
    ];
  });
}

function parseXml(source: string | undefined): Document | null {
  if (source === undefined) return null;
  const document = new DOMParser().parseFromString(source, 'application/xml');
  return document.querySelector('parsererror') === null ? document : null;
}

function fileStem(path: string): string {
  const filename = path.split('/').at(-1) ?? path;
  return filename.slice(0, filename.lastIndexOf('.'));
}
