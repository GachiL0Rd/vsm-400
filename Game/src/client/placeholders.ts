import type Phaser from 'phaser';

interface Block {
  key: string;
  label: string;
  width: number;
  height: number;
  fill: string;
}

const FLOORS = [
  { key: 'floor_car', fill: '#c4c9ca' },
  { key: 'floor_aisle', fill: '#e0dfd6' },
  { key: 'floor_platform', fill: '#94a5ad' },
  { key: 'floor_service', fill: '#b8cec5' },
  { key: 'floor_door', fill: '#d5b978' },
];

const BLOCKS: Block[] = [
  { key: 'seat', label: 'КР', width: 66, height: 46, fill: '#8294ae' },
  { key: 'window_wall', label: 'ОКНО', width: 96, height: 60, fill: '#a4b7c1' },
  { key: 'door', label: 'ДВЕРЬ', width: 88, height: 84, fill: '#c8a874' },
  { key: 'panel', label: 'ПАНЕЛЬ', width: 64, height: 76, fill: '#83aaa8' },
  { key: 'extinguisher', label: 'ОГН', width: 54, height: 76, fill: '#d48580' },
  { key: 'service', label: 'СЕРВИС', width: 74, height: 58, fill: '#8fb3a8' },
  { key: 'toilet', label: 'WC', width: 62, height: 76, fill: '#adb9bf' },
  { key: 'fire', label: 'ОЧАГ', width: 72, height: 76, fill: '#e09a77' },
  { key: 'smoke', label: 'ДЫМ', width: 72, height: 58, fill: '#a6a9ad' },
];

const ACTORS = [
  { key: 'conductor', label: 'П', fill: '#edc27b' },
  { key: 'passenger_1', label: '1', fill: '#9cbdd5' },
  { key: 'passenger_2', label: '2', fill: '#c5a4d1' },
  { key: 'passenger_3', label: '3', fill: '#a5c9a6' },
  { key: 'passenger_4', label: '4', fill: '#d7a2aa' },
];

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d');
  if (context === null) throw new Error('Canvas 2D is unavailable for game placeholders.');
  return [element, context];
}

function floorTexture(scene: Phaser.Scene, key: string, fill: string): void {
  if (scene.textures.exists(key)) return;
  const [element, context] = canvas(96, 48);
  context.beginPath();
  context.moveTo(48, 1);
  context.lineTo(95, 24);
  context.lineTo(48, 47);
  context.lineTo(1, 24);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = '#42535b';
  context.lineWidth = 2;
  context.setLineDash([6, 4]);
  context.stroke();
  scene.textures.addCanvas(key, element);
}

function blockTexture(scene: Phaser.Scene, block: Block): void {
  if (scene.textures.exists(block.key)) return;
  const [element, context] = canvas(block.width, block.height);
  const x = 5;
  const y = 4;
  const width = block.width - 10;
  const height = block.height - 15;
  context.fillStyle = '#25343c66';
  context.fillRect(x + 3, block.height - 10, width, 6);
  context.fillStyle = block.fill;
  context.fillRect(x, y, width, height);
  context.strokeStyle = '#263945';
  context.lineWidth = 3;
  context.strokeRect(x, y, width, height);
  context.strokeStyle = '#f3f4ed';
  context.lineWidth = 2;
  context.setLineDash([6, 4]);
  context.strokeRect(x + 5, y + 5, width - 10, height - 10);
  context.setLineDash([]);
  context.fillStyle = '#192b35';
  context.font = 'bold 12px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(block.label, block.width / 2, y + height / 2, width - 8);
  scene.textures.addCanvas(block.key, element);
}

function actorTexture(scene: Phaser.Scene, key: string, label: string, fill: string): void {
  if (scene.textures.exists(key)) return;
  const frameWidth = 48;
  const frameHeight = 76;
  const [element, context] = canvas(frameWidth * 4, frameHeight);
  for (let frame = 0; frame < 4; frame += 1) {
    const left = frame * frameWidth;
    context.fillStyle = '#172d3966';
    context.fillRect(left + 7, 68, 34, 5);
    context.fillStyle = fill;
    context.fillRect(left + 5, 13, 38, 54);
    context.strokeStyle = '#243641';
    context.lineWidth = 3;
    context.strokeRect(left + 5, 13, 38, 54);
    context.strokeStyle = '#fff9e8';
    context.lineWidth = 2;
    context.setLineDash([5, 3]);
    context.strokeRect(left + 10, 18, 28, 44);
    context.setLineDash([]);
    context.fillStyle = '#192b35';
    context.font = 'bold 25px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, left + 24, 40);
    if (frame === 1 || frame === 2) {
      context.fillStyle = '#fff9e8';
      context.fillRect(left + (frame === 1 ? 8 : 29), 62, 11, 5);
    }
    if (frame === 3) {
      context.fillStyle = '#fff9e8';
      context.fillRect(left + 29, 3, 14, 15);
      context.fillStyle = '#192b35';
      context.font = 'bold 13px Arial';
      context.fillText('!', left + 36, 11);
    }
  }
  const texture = scene.textures.addCanvas(key, element);
  if (texture === null) throw new Error(`Cannot create placeholder texture: ${key}`);
  scene.textures.addSpriteSheet('', texture, { frameWidth, frameHeight });
}

/** Temporary shapes generated at runtime; no image assets are loaded by the client. */
export function installPlaceholderTextures(scene: Phaser.Scene): void {
  for (const floor of FLOORS) floorTexture(scene, floor.key, floor.fill);
  for (const block of BLOCKS) blockTexture(scene, block);
  for (const actor of ACTORS) actorTexture(scene, actor.key, actor.label, actor.fill);
}
