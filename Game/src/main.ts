import Phaser from 'phaser';
import { GameScene } from './client/GameScene';
import './style.css';

const gameRoot = document.getElementById('game');
if (gameRoot === null) throw new Error('Game shell is missing.');

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameRoot,
  backgroundColor: '#10232c',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: { pixelArt: false, antialias: true },
  scene: [GameScene],
});
