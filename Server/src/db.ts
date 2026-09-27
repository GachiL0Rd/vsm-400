import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.ts';

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    login TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    position TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS achievements (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_achievements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_code TEXT NOT NULL REFERENCES achievements(code),
    earned_at TEXT NOT NULL,
    PRIMARY KEY (user_id, achievement_code)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scenario_id TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'incident', 'terminated')),
    safety_score INTEGER NOT NULL CHECK (safety_score BETWEEN 0 AND 100),
    service_score INTEGER NOT NULL CHECK (service_score BETWEEN 0 AND 100),
    errors INTEGER NOT NULL CHECK (errors >= 0)
  );
`;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

// Тестовые данные для демонстрации кабинета. Не являются продуктовыми требованиями.
const ACHIEVEMENTS = [
  ['early-find', 'Зоркий глаз', 'Обнаружить неисправность до начала посадки'],
  ['before-complaint', 'На опережение', 'Заметить проблему раньше обращения пассажира'],
  ['pressure', 'Слышу свист', 'Распознать признак нарушения герметичности и вовремя доложить'],
  ['clean-run', 'По инструкции', 'Завершить рейс без пропущенных обязательных проверок'],
  ['deep-inspection', 'Дьявол в деталях', 'Найти проблему только благодаря детальному осмотру'],
] as const;

export function seedDemoData(db: DatabaseSync): void {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (row !== undefined && Number(row.count) > 0) {
    return;
  }

  const insertAchievement = db.prepare(
    'INSERT OR IGNORE INTO achievements (code, title, description) VALUES (?, ?, ?)',
  );
  for (const [code, title, description] of ACHIEVEMENTS) {
    insertAchievement.run(code, title, description);
  }

  const insertUser = db.prepare(
    `INSERT INTO users (login, password_hash, display_name, position, created_at)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  );
  const demo = insertUser.get(
    'demo',
    hashPassword('demo'),
    'Анна Смирнова',
    'Проводник ВСМ',
    '2026-09-01T09:00:00.000Z',
  );
  insertUser.run(
    'novice',
    hashPassword('novice'),
    'Павел Соколов',
    'Стажёр',
    '2026-09-20T09:00:00.000Z',
  );
  const demoId = Number(demo?.id);

  const insertEarned = db.prepare(
    'INSERT INTO user_achievements (user_id, achievement_code, earned_at) VALUES (?, ?, ?)',
  );
  insertEarned.run(demoId, 'early-find', '2026-09-10T11:20:00.000Z');
  insertEarned.run(demoId, 'clean-run', '2026-09-18T15:05:00.000Z');

  const insertRun = db.prepare(
    `INSERT INTO runs (user_id, scenario_id, finished_at, outcome, safety_score, service_score, errors)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertRun.run(demoId, 'baseline-fire', '2026-09-10T11:40:00.000Z', 'incident', 55, 70, 3);
  insertRun.run(demoId, 'baseline-pressure', '2026-09-14T10:15:00.000Z', 'completed', 72, 81, 2);
  insertRun.run(demoId, 'baseline-fire', '2026-09-18T15:10:00.000Z', 'completed', 94, 88, 0);
}
