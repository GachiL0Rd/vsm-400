import type Phaser from 'phaser';
import clothesFront1 from '../../../assets/characters/npc/clothes/одедла1-шаг1.png?url';
import clothesFront2 from '../../../assets/characters/npc/clothes/одедла1-шаг2.png?url';
import clothesLeft0 from '../../../assets/characters/npc/clothes/одежда1-лево.png?url';
import clothesLeft1 from '../../../assets/characters/npc/clothes/одежда1-лево-шаг1.png?url';
import clothesLeft2 from '../../../assets/characters/npc/clothes/одежда1-лево-шаг2.png?url';
import clothesRight0 from '../../../assets/characters/npc/clothes/одежда1-право.png?url';
import clothesRight1 from '../../../assets/characters/npc/clothes/одежда1-право-шаг1.png?url';
import clothesRight2 from '../../../assets/characters/npc/clothes/одежда1-право-шаг2.png?url';
import clothesFront0 from '../../../assets/characters/npc/clothes/одежда1-прямо.png?url';
import clothesSitLeft from '../../../assets/characters/npc/clothes/одежда1-сидя-лево.png?url';
import clothesSitRight from '../../../assets/characters/npc/clothes/одежда1-сидя-право.png?url';
import clothesBack0 from '../../../assets/characters/npc/clothes/одежда1-спина.png?url';
import clothesBack1 from '../../../assets/characters/npc/clothes/одежда1-спина-шаг1.png?url';
import clothesBack2 from '../../../assets/characters/npc/clothes/одежда1-спина-шаг2.png?url';
import eyes1Left from '../../../assets/characters/npc/eyes/глаза-1-оево.png?url';
import eyes1Right from '../../../assets/characters/npc/eyes/глаза-1-право.png?url';
import eyes1Front from '../../../assets/characters/npc/eyes/глаза-1-прямо.png?url';
import eyes2Left from '../../../assets/characters/npc/eyes/глаза2-лево.png?url';
import eyes2Right from '../../../assets/characters/npc/eyes/глаза2-право.png?url';
import eyes2Front from '../../../assets/characters/npc/eyes/глаза2-прямо.png?url';
import eyes3Left from '../../../assets/characters/npc/eyes/глаза3-лево.png?url';
import eyes3Right from '../../../assets/characters/npc/eyes/глаза3-право.png?url';
import eyes3Front from '../../../assets/characters/npc/eyes/глаза3-прямо.png?url';
import eyes4Left from '../../../assets/characters/npc/eyes/глаза4-лево.png?url';
import eyes4Right from '../../../assets/characters/npc/eyes/глаза4-право.png?url';
import eyes4Front from '../../../assets/characters/npc/eyes/глаза4-прямо.png?url';
import bodyFront1 from '../../../assets/characters/npc/mainbody/тало-лицо-шаг1.png?url';
import bodyLeft0 from '../../../assets/characters/npc/mainbody/тело-лево-1.png?url';
import bodyLeft1 from '../../../assets/characters/npc/mainbody/тело-лево-шаг1.png?url';
import bodyLeft2 from '../../../assets/characters/npc/mainbody/тело-лево-шаг2.png?url';
import bodyFront0 from '../../../assets/characters/npc/mainbody/тело-лицо-1.png?url';
import bodyFront2 from '../../../assets/characters/npc/mainbody/тело-лицо-шаг2.png?url';
import bodyRight0 from '../../../assets/characters/npc/mainbody/тело-право-1.png?url';
import bodyRight2 from '../../../assets/characters/npc/mainbody/тело-право-шаг2.png?url';
import bodyRight1 from '../../../assets/characters/npc/mainbody/тело-прво-шаг1.png?url';
import bodySitLeft from '../../../assets/characters/npc/mainbody/тело-сидя-лево.png?url';
import bodySitRight from '../../../assets/characters/npc/mainbody/тело-сидя-право.png?url';
import bodyBack0 from '../../../assets/characters/npc/mainbody/тело-спина-1.png?url';
import bodyBack1 from '../../../assets/characters/npc/mainbody/тело-спина-шаг1.png?url';
import bodyBack2 from '../../../assets/characters/npc/mainbody/тело-спина-шаг2.png?url';
import type { PublicPosition } from '../../common';
import { actorFacing } from './actor-facing';
import type { Direction, Step } from './character-art';

export type NpcPose =
  | { readonly kind: 'stand'; readonly direction: Direction; readonly step: Step }
  | { readonly kind: 'sit'; readonly direction: 'left' | 'right' };

export interface NpcLayerKeys {
  readonly body: string;
  readonly clothes: string;
  readonly eyes: string | null;
}

const EYE_SET_COUNT = 4;

const bodyUrls: Readonly<Record<string, string>> = {
  'front:0': bodyFront0,
  'front:1': bodyFront1,
  'front:2': bodyFront2,
  'back:0': bodyBack0,
  'back:1': bodyBack1,
  'back:2': bodyBack2,
  'left:0': bodyLeft0,
  'left:1': bodyLeft1,
  'left:2': bodyLeft2,
  'right:0': bodyRight0,
  'right:1': bodyRight1,
  'right:2': bodyRight2,
  'sit:left': bodySitLeft,
  'sit:right': bodySitRight,
};

const clothesUrls: Readonly<Record<string, string>> = {
  'front:0': clothesFront0,
  'front:1': clothesFront1,
  'front:2': clothesFront2,
  'back:0': clothesBack0,
  'back:1': clothesBack1,
  'back:2': clothesBack2,
  'left:0': clothesLeft0,
  'left:1': clothesLeft1,
  'left:2': clothesLeft2,
  'right:0': clothesRight0,
  'right:1': clothesRight1,
  'right:2': clothesRight2,
  'sit:left': clothesSitLeft,
  'sit:right': clothesSitRight,
};

const eyeUrls: readonly Readonly<Record<'front' | 'left' | 'right', string>>[] = [
  { front: eyes1Front, left: eyes1Left, right: eyes1Right },
  { front: eyes2Front, left: eyes2Left, right: eyes2Right },
  { front: eyes3Front, left: eyes3Left, right: eyes3Right },
  { front: eyes4Front, left: eyes4Left, right: eyes4Right },
];

export function stableModulo(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) % 1_000_003;
  }
  return hash % modulo;
}

export function isSeatCell(cellId: string): boolean {
  return cellId.startsWith('carriage.seat.') || cellId.startsWith('carriage.seat-');
}

export function seatDirection(cellId: string): 'left' | 'right' {
  if (cellId.endsWith('_L') || cellId.endsWith('-L')) return 'left';
  if (cellId.endsWith('_R') || cellId.endsWith('-R')) return 'right';
  return stableModulo(cellId, 2) === 0 ? 'left' : 'right';
}

export function poseKey(pose: NpcPose): string {
  return pose.kind === 'sit' ? `sit:${pose.direction}` : `${pose.direction}:${pose.step}`;
}

export function npcBodyKey(pose: NpcPose): string {
  return `npc:body:${poseKey(pose)}`;
}

export function npcClothesKey(pose: NpcPose): string {
  return `npc:clothes:${poseKey(pose)}`;
}

export function npcEyesKey(set: number, direction: 'front' | 'left' | 'right'): string {
  return `npc:eyes:${set}:${direction}`;
}

export function eyeSetIndex(appearanceId: string, entityId: string): number {
  const seed = appearanceId.length > 0 ? appearanceId : entityId;
  return stableModulo(seed, EYE_SET_COUNT);
}

export function passengerPose(
  position: PublicPosition,
  cells: readonly { readonly id: string; readonly x: number; readonly y: number }[],
  visualTimeUs: number,
): NpcPose {
  if (position.kind === 'cell' && isSeatCell(position.cellId)) {
    return { kind: 'sit', direction: seatDirection(position.cellId) };
  }
  return { kind: 'stand', ...actorFacing(position, cells, visualTimeUs) };
}

export function npcLayers(appearanceId: string, entityId: string, pose: NpcPose): NpcLayerKeys {
  const direction = pose.direction === 'back' ? null : pose.direction;
  return {
    body: npcBodyKey(pose),
    clothes: npcClothesKey(pose),
    eyes: direction === null ? null : npcEyesKey(eyeSetIndex(appearanceId, entityId), direction),
  };
}

export function passengerBadge(index: number): string {
  return `П${index}`;
}

export function preloadNpcArt(scene: Phaser.Scene): void {
  for (const [key, url] of Object.entries(bodyUrls)) scene.load.image(`npc:body:${key}`, url);
  for (const [key, url] of Object.entries(clothesUrls)) scene.load.image(`npc:clothes:${key}`, url);
  eyeUrls.forEach((set, index) => {
    scene.load.image(npcEyesKey(index, 'front'), set.front);
    scene.load.image(npcEyesKey(index, 'left'), set.left);
    scene.load.image(npcEyesKey(index, 'right'), set.right);
  });
}
