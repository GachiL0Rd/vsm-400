import type Phaser from 'phaser';
import exteriorUrl from '../../../assets/map/image-8b50ae40f4214c4f39341cc6144e6a5b3aa8ae2390f69db4c1625364003b5d3d.png?url';
import interiorUrl from '../../../assets/map/image-4566526f381e102bf509cdfb4785e9be7356c4b95936e09882e380416a2d44ec.png?url';
import noseUrl from '../../../assets/map/image-e385d2ceafa1d700e4c752f857f318ac13dfc7e03bcad2eb6df55f451c6ea01f.png?url';
import mapUrl from '../assets/map/train2-long.map.json?url';

export const TRAIN2_MAP_KEY = 'map.train2-long';
export const TRAIN2_VISUAL_PREFIX = 'map.train2-long';

export const TRAIN2_TILESETS = [
  { name: 'VSM long car interior', key: 'tileset:vsm-long-car-interior', url: interiorUrl },
  { name: 'VSM long car exterior', key: 'tileset:vsm-long-car-exterior', url: exteriorUrl },
  { name: 'VSM streamlined nose', key: 'tileset:vsm-streamlined-nose', url: noseUrl },
] as const;

export function usesTrain2Map(
  regions: readonly { readonly visualId?: string | undefined }[],
): boolean {
  return regions.some((region) => region.visualId?.startsWith(TRAIN2_VISUAL_PREFIX) === true);
}

export function preloadTrain2Map(scene: Phaser.Scene): void {
  if (!scene.cache.tilemap.exists(TRAIN2_MAP_KEY)) {
    scene.load.tilemapTiledJSON(TRAIN2_MAP_KEY, mapUrl);
  }
  for (const tileset of TRAIN2_TILESETS) {
    if (!scene.textures.exists(tileset.key)) scene.load.image(tileset.key, tileset.url);
  }
}
