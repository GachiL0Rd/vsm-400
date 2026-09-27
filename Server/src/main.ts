import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { openDatabase, seedDemoData } from './db.ts';

const port = Number(process.env.PORT ?? 3000);
const dbPath =
  process.env.DB_PATH ?? fileURLToPath(new URL('../data/cabinet.sqlite', import.meta.url));
const clientDir = process.env.CLIENT_DIR ?? fileURLToPath(new URL('../../Client', import.meta.url));
const gameUrl = process.env.GAME_URL ?? 'http://localhost:5173/';

const db = openDatabase(dbPath);
seedDemoData(db);

serve({ fetch: createApp({ db, gameUrl, clientDir }).fetch, port }, (info) => {
  console.log(`Кабинет: http://localhost:${info.port}/`);
  console.log(`Игра: ${gameUrl}`);
});
