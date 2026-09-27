import Phaser from 'phaser';
import { GameScene } from './client/GameScene';
import { InteractionController } from './client/input/interaction-controller';
import { GameWebSocketClient } from './client/network/game-websocket-client';
import { ActionOfferOverlay } from './client/presentation/action-offer-overlay';
import { ConnectionStatus } from './client/presentation/connection-status';
import { PresentationStore } from './client/presentation/presentation-store';
import { GAME_PROTOCOL_VERSION } from './common';
import './style.css';

const gameRoot = document.getElementById('game');
if (gameRoot === null) throw new Error('Game shell is missing.');

let requestSequence = 0;
const nextRequestId = (): string => {
  requestSequence += 1;
  return `browser-${requestSequence}`;
};

let network: GameWebSocketClient;
const store = new PresentationStore({
  send: (command) => network.send(command),
  nextRequestId,
  log: (message, detail) => console.debug(`[presentation] ${message}`, detail),
});
network = new GameWebSocketClient({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  store,
  initialCommands: () => [
    { protocolVersion: GAME_PROTOCOL_VERSION, type: 'hello', requestId: nextRequestId() },
  ],
  log: (message, detail) => console.warn(`[network] ${message}`, detail),
});
const interactions = new InteractionController(store, (command) => network.send(command));

new ConnectionStatus(gameRoot, store);
new ActionOfferOverlay(gameRoot, store, interactions);

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
  scene: [new GameScene({ store, interactions })],
});

network.connect();
