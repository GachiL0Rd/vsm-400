import Phaser from 'phaser';
import { GameScene } from './client/GameScene';
import './style.css';

const gameRoot = document.getElementById('game');
const uiRoot = document.getElementById('ui');
if (gameRoot === null || uiRoot === null) throw new Error('Game shell is missing.');

const configuredUrl =
  document.querySelector<HTMLMetaElement>('meta[name="game-websocket"]')?.content ||
  import.meta.env.VITE_GAME_WS_URL;
const socketUrl =
  configuredUrl ||
  (import.meta.env.DEV
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game-ws`
    : '');

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameRoot,
  backgroundColor: '#10232c',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  render: { pixelArt: false, antialias: true },
  scene: [new GameScene(uiRoot, socketUrl)],
});
