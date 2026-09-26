import { chromium } from 'playwright';

const url = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.addInitScript(() => {
  const NativeSocket = window.WebSocket;
  window.__vsmSockets = [];
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      if (String(args[0]).includes('/game-ws')) window.__vsmSockets.push(this);
    }
  };
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  window.__vsmIntervals = new Set();
  window.setInterval = (fn, delay, ...args) => {
    const id = nativeSetInterval(fn, delay, ...args);
    if (delay === 500) window.__vsmIntervals.add(id);
    return id;
  };
  window.clearInterval = (id) => {
    window.__vsmIntervals.delete(id);
    return nativeClearInterval(id);
  };
});

const state = () =>
  page.evaluate(async () => {
    const entry = document.querySelector('script[src*="/src/main.ts"]');
    const { game } = await import(entry.src);
    const scene = game.scene.getScene('GameScene');
    return {
      panels: document.querySelectorAll('.game-panel').length,
      detailPanels: document.querySelectorAll('.detail-panel').length,
      canvases: document.querySelectorAll('canvas').length,
      activeScenes: game.scene.getScenes(true).length,
      resizeListeners: game.scale.listenerCount('resize'),
      pointerListeners: scene.input.listenerCount('pointerup'),
      clockIntervals: window.__vsmIntervals.size,
      openGameSockets: window.__vsmSockets.filter((socket) => socket.readyState === 1).length,
      socketCount: window.__vsmSockets.length,
      playerTile: scene.player.getTile(),
      npcCount: scene.npcs.shapes.size,
      poiObjectCount: scene.poi.shapes.length,
      displayCount: scene.children.list.length,
    };
  });

try {
  await page.goto(url);
  await page.getByText('Связь есть').waitFor();
  await page.mouse.click(585, 470);
  await page.waitForFunction(async () => {
    const entry = document.querySelector('script[src*="/src/main.ts"]');
    const { game } = await import(entry.src);
    return game.scene.getScene('GameScene').player.getTile().y === 3;
  });
  await page.mouse.click(650, 337);
  await page.locator('.details').getByText('Дверь', { exact: false }).waitFor();
  await page.evaluate(async () => {
    const entry = document.querySelector('script[src*="/src/main.ts"]');
    const { game } = await import(entry.src);
    game.scene
      .getScene('GameScene')
      .connection.sendCommand({ kind: 'inspect', targetId: 'missing', inspection: 'full' });
  });
  await page.getByText('Действие отклонено', { exact: false }).waitFor();

  await page.getByRole('button', { name: 'Пауза' }).click();
  await page.locator('.clock').getByText('×0', { exact: false }).waitFor();
  await page.waitForTimeout(400);
  const pausedClock = await page.locator('.clock').innerText();
  await page.waitForTimeout(1200);
  if ((await page.locator('.clock').innerText()) !== pausedClock)
    throw new Error('The displayed server time advanced while paused.');
  await page.evaluate(async () => {
    const entry = document.querySelector('script[src*="/src/main.ts"]');
    const { game } = await import(entry.src);
    const sound = game.scene.getScene('GameScene').soundManager;
    sound.beep();
    window.__oldAudioContext = sound.audio;
  });

  const baseline = await state();
  for (let restart = 1; restart <= 2; restart += 1) {
    await page.evaluate(async () => {
      const entry = document.querySelector('script[src*="/src/main.ts"]');
      const { game } = await import(entry.src);
      game.scene.getScene('GameScene').scene.restart();
    });
    await page.waitForFunction(
      (expected) =>
        window.__vsmSockets.length >= expected &&
        window.__vsmSockets.filter((socket) => socket.readyState === 1).length === 1 &&
        document.querySelector('.connection-state')?.dataset.state === 'ready',
      baseline.socketCount + restart,
    );
    const current = await state();
    for (const key of [
      'panels',
      'detailPanels',
      'canvases',
      'activeScenes',
      'resizeListeners',
      'pointerListeners',
      'clockIntervals',
      'openGameSockets',
      'npcCount',
      'poiObjectCount',
      'displayCount',
    ]) {
      if (current[key] !== baseline[key])
        throw new Error(`${key} changed after scene restart: ${baseline[key]} -> ${current[key]}`);
    }
    if (current.playerTile.x !== 2 || current.playerTile.y !== 2)
      throw new Error('A full snapshot did not reset the local player presentation.');
    if (restart === 1)
      await page.waitForFunction(() => window.__oldAudioContext?.state === 'closed');
  }
  await page.evaluate(async () => {
    const entry = document.querySelector('script[src*="/src/main.ts"]');
    const { game } = await import(entry.src);
    game.destroy(true);
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.game-panel, .detail-panel').length === 0 &&
      window.__vsmIntervals.size === 0 &&
      window.__vsmSockets.every((socket) => socket.readyState !== 1),
  );

  const touchPage = await browser.newPage({
    viewport: { width: 430, height: 850 },
    hasTouch: true,
    isMobile: true,
  });
  touchPage.on('pageerror', (error) => errors.push(error.message));
  await touchPage.goto(url);
  await touchPage.locator('.connection-state[data-state="ready"]').waitFor();
  await touchPage.touchscreen.tap(288, 390);
  await touchPage.locator('.details').getByText('Дверь', { exact: false }).waitFor();
  await touchPage.touchscreen.tap(213, 543);
  await touchPage.waitForFunction(async () => {
    const entry = document.querySelector('script[src*="/src/main.ts"]');
    const { game } = await import(entry.src);
    return game.scene.getScene('GameScene').player.getTile().y === 3;
  });
  await touchPage.close();
  if (errors.length > 0) throw new Error(errors.join('\n'));
  console.log('input, reject, pause, touch, scene resources, two restarts and game destroy passed');
} finally {
  await browser.close();
}
