import Phaser from 'phaser';
import { GameConnection } from './client/connection';
import { ClientScene } from './client/scene';
import { ClientUI } from './client/ui';
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

let ui: ClientUI;
const connection = new GameConnection(socketUrl, (state, status) => {
  scene.setStatus(status);
  if (state.snapshot !== null)
    scene.sync(state.snapshot, status, state.notice, state.snapshotSerial);
  ui.render(state, status);
});
const scene = new ClientScene(
  (selection) => ui.select(selection),
  (zoneId) => connection.sendCommand({ kind: 'move-zone', zoneId }),
  (message) => ui.say(message),
);

ui = new ClientUI(uiRoot, connection, scene);
new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameRoot,
  backgroundColor: '#10232c',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  render: { pixelArt: false, antialias: true },
  scene: [scene],
});

connection.connect();
window.addEventListener('beforeunload', () => connection.stop());
