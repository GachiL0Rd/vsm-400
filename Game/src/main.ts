import Phaser from 'phaser';
import { type ClientLogEntry, ClientLogger } from './client/diagnostics/client-log';
import { GameScene } from './client/GameScene';
import { InteractionController } from './client/input/interaction-controller';
import { GameWebSocketClient } from './client/network/game-websocket-client';
import { createBrowserSessionBootstrap } from './client/network/session-bootstrap';
import { PresentationStore } from './client/presentation/presentation-store';
import { hiDpiGameSize } from './client/rendering/view-scale';
import { GAME_WEBSOCKET_PATH } from './common';
import './style.css';

declare global {
  interface Window {
    vsmClientLogs: {
      entries(): readonly ClientLogEntry[];
      download(): void;
      clear(): void;
    };
  }
}

const gameRoot = document.getElementById('game');
if (gameRoot === null) throw new Error('Game shell is missing.');

const logger = new ClientLogger({ storage: availableSessionStorage() });
window.vsmClientLogs = {
  entries: () => logger.getEntries(),
  download: () => logger.download(),
  clear: () => logger.clear(),
};
logger.record('info', 'client', 'page-start', {
  pathname: location.pathname,
  viewport: { width: window.innerWidth, height: window.innerHeight },
});
window.addEventListener('pagehide', () => logger.flush());
window.addEventListener('error', (event) => {
  logger.record('error', 'browser', 'uncaught-error', {
    name: event.error instanceof Error ? event.error.name : 'Error',
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
  });
});
window.addEventListener('unhandledrejection', (event) => {
  logger.record('error', 'browser', 'unhandled-rejection', {
    name: event.reason instanceof Error ? event.reason.name : typeof event.reason,
    message: event.reason instanceof Error ? event.reason.message : 'Non-Error rejection',
  });
});

let requestSequence = 0;
const nextRequestId = (): string => {
  requestSequence += 1;
  return `browser-${requestSequence}`;
};

const sessionBootstrap = createBrowserSessionBootstrap({
  href: window.location.href,
  storage: window.sessionStorage,
  replaceUrl: (url) => window.history.replaceState(null, '', url),
});

let network: GameWebSocketClient;
const store = new PresentationStore({
  send: (command) => network.send(command),
  nextRequestId,
  log: (message, detail) => logger.record('warn', 'presentation', message, { detail }),
});
network = new GameWebSocketClient({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${GAME_WEBSOCKET_PATH}`,
  store,
  initialCommands: () => {
    const hello = sessionBootstrap.helloCommand(nextRequestId());
    return hello === null ? [] : [hello];
  },
  onServerMessage: (message) => {
    sessionBootstrap.observe(message);
    if (message.type === 'error' && message.code === 'authentication-failed') {
      sessionBootstrap.invalidateCredentials();
      // Reconnect after the store has applied this error so the fresh snapshot clears it.
      if (sessionBootstrap.hasCredential) window.setTimeout(() => network.reconnect(), 0);
    }
  },
  log: (message, detail) => logger.record('warn', 'websocket', message, { detail }),
  trace: (entry) => {
    const event = `${String(entry.direction)}.${String(entry.type ?? entry.state)}`;
    const level =
      entry.status === 'rejected' || entry.state === 'error'
        ? 'warn'
        : entry.type === 'delta'
          ? 'debug'
          : 'info';
    logger.record(level, 'websocket', event, entry);
  },
});
const interactions = new InteractionController(
  store,
  (command) => network.send(command),
  (level, event, data) => logger.record(level, 'navigation', event, data),
);

const initialPixels = hiDpiGameSize(
  window.innerWidth,
  window.innerHeight,
  window.devicePixelRatio || 1,
);

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameRoot,
  backgroundColor: '#10222c',
  scale: {
    // RESIZE writes the backing store in CSS pixels and ignores zoom.
    // NONE + zoom 1/dpr keeps one device pixel per backing pixel (ScaleManager.updateScale).
    mode: Phaser.Scale.NONE,
    width: initialPixels.backingWidth,
    height: initialPixels.backingHeight,
    zoom: initialPixels.scaleZoom,
  },
  render: { pixelArt: true },
  scene: [
    new GameScene({
      store,
      interactions,
      log: (source, event, data) => logger.record('info', source, event, data),
    }),
  ],
});

syncHiDpiCanvas();
game.events.once('ready', syncHiDpiCanvas);
window.addEventListener('resize', syncHiDpiCanvas);
new ResizeObserver(() => syncHiDpiCanvas()).observe(gameRoot);
watchPixelRatio(syncHiDpiCanvas);

if (!sessionBootstrap.hasCredential) {
  store.setConnection('error');
  logger.record('error', 'client', 'missing-session-credential');
} else {
  network.connect();
}

function syncHiDpiCanvas(): void {
  const parent = game.scale.parent;
  const cssWidth =
    parent instanceof HTMLElement && parent.clientWidth > 0
      ? parent.clientWidth
      : window.innerWidth;
  const cssHeight =
    parent instanceof HTMLElement && parent.clientHeight > 0
      ? parent.clientHeight
      : window.innerHeight;
  const next = hiDpiGameSize(cssWidth, cssHeight, window.devicePixelRatio || 1);
  const canvas = game.canvas;
  const styleWidth = `${Math.max(1, Math.round(cssWidth))}px`;
  const styleHeight = `${Math.max(1, Math.round(cssHeight))}px`;
  if (
    game.scale.width === next.backingWidth &&
    game.scale.height === next.backingHeight &&
    game.scale.zoom === next.scaleZoom &&
    canvas.style.width === styleWidth &&
    canvas.style.height === styleHeight
  ) {
    return;
  }
  if (game.scale.zoom !== next.scaleZoom) game.scale.zoom = next.scaleZoom;
  if (game.scale.width !== next.backingWidth || game.scale.height !== next.backingHeight) {
    game.scale.resize(next.backingWidth, next.backingHeight);
  }
  canvas.style.width = styleWidth;
  canvas.style.height = styleHeight;
  game.scale.refresh();
}

function watchPixelRatio(onChange: () => void): void {
  const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const listener = (): void => {
    media.removeEventListener('change', listener);
    onChange();
    watchPixelRatio(onChange);
  };
  media.addEventListener('change', listener);
}

function availableSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
