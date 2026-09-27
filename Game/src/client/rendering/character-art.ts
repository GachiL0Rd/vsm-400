import type Phaser from 'phaser';
import backIdle from '../../../assets/characters/provodnik/проводни-спина.png?url';
import frontIdle from '../../../assets/characters/provodnik/проводник-1-перед.png?url';
import leftIdle from '../../../assets/characters/provodnik/проводник-лево.png?url';
import rightIdle from '../../../assets/characters/provodnik/проводник-право.png?url';
import leftStep1 from '../../../assets/characters/provodnik/проводник-шаг1-лево.png?url';
import frontStep1 from '../../../assets/characters/provodnik/проводник-шаг1-перед.png?url';
import rightStep1 from '../../../assets/characters/provodnik/проводник-шаг1-право.png?url';
import backStep1 from '../../../assets/characters/provodnik/проводник-шаг1-спина.png?url';
import leftStep2 from '../../../assets/characters/provodnik/проводник-шаг2-лево.png?url';
import frontStep2 from '../../../assets/characters/provodnik/проводник-шаг2-перед.png?url';
import rightStep2 from '../../../assets/characters/provodnik/проводник-шаг2-право.png?url';
import backStep2 from '../../../assets/characters/provodnik/проводник-шаг2-спина.png?url';

export type Direction = 'front' | 'back' | 'left' | 'right';
export type Step = 0 | 1 | 2;

const conductorFrames: Record<Direction, readonly [string, string, string]> = {
  front: [frontIdle, frontStep1, frontStep2],
  back: [backIdle, backStep1, backStep2],
  left: [leftIdle, leftStep1, leftStep2],
  right: [rightIdle, rightStep1, rightStep2],
};

export function conductorTextureKey(direction: Direction, step: Step): string {
  return `conductor:${direction}:${step}`;
}

export function preloadCharacterArt(scene: Phaser.Scene): void {
  for (const [direction, frames] of Object.entries(conductorFrames) as [
    Direction,
    readonly string[],
  ][]) {
    frames.forEach((url, step) => {
      scene.load.image(conductorTextureKey(direction, step as Step), url);
    });
  }
}
