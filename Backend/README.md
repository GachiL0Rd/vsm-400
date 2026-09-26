# Backend «Перегон»

API тренажёра проводника ВСМ. Каркас: NestJS 11 на Fastify, Prisma 7,
PostgreSQL 18, Valkey 9, Zod 4. Доменная логика смен и прогрессии подключается
следующими фазами поверх `src/engine`.

## Запуск

Нужны Docker и Node.js 24 (минимум 22.12).

```powershell
cd Backend
docker compose up -d
copy .env.example .env
npm ci --include=dev
npm run prisma:migrate
npm run start:dev
```

На macOS и Linux вместо `copy` — `cp .env.example .env`.

- Приложение: `http://127.0.0.1:3000/api/health`
- Swagger: `http://127.0.0.1:3000/api/docs`
- OpenAPI: `http://127.0.0.1:3000/api/openapi.json`

`npm run verify` гоняет Biome, типы, тесты и сборку. База для тестов не нужна:
health e2e подменяет Prisma и Redis.

`npm run prisma:seed` проверяет соединение и печатает число пользователей.
Наполнение депо, бригад и рейсов (SPEC §11) ждёт движок `step()` — история
должна считаться им, а не ручными вставками.

## Версии URL

Доменные контроллеры получают префикс `/api/v1` (URI versioning, версия по
умолчанию `1`). Health и документация без версии: `/api/health`, `/api/docs`.
Позже внутренний API GameServer встанет на `/internal/v1`, вне публичного
префикса.

## Переменные окружения

Файл `.env.example` — только для локальной разработки. Пустые или короткие
секреты роняют процесс до `listen` текстом `Некорректное окружение`.

| Переменная | Смысл |
| --- | --- |
| `NODE_ENV` | `development`, `test` или `production`. По умолчанию `development` |
| `PORT` | HTTP-порт. По умолчанию `3000` |
| `DATABASE_URL` | Строка Postgres (`postgres://` или `postgresql://`) |
| `REDIS_URL` | Redis или Valkey (`redis://` или `rediss://`) |
| `JWT_ACCESS_SECRET` | Секрет access-JWT, минимум 32 символа |
| `GAME_TICKET_SECRET` | Секрет игрового билета, минимум 32 символа |
| `GAME_SERVER_TOKEN` | Секрет заголовка `X-Service-Token`, минимум 16 символов |
| `SEED_ENC_KEY` | 32 байта hex (64 символа), ключ AES-256-GCM для seed сессии |
| `EXT_ID_PEPPER` | Перец HMAC табельного номера, минимум 16 символов. ФИО не хранится |
| `CORS_ORIGINS` | Список origin через запятую |
| `PUBLIC_GAME_WS_URL` | `ws://` или `wss://`, адрес GameServer для клиента |
| `COOKIE_SECURE` | `true` или `false`. В prod — `true` |

Локальные Postgres и Valkey поднимает `docker-compose.yml`: порты
`127.0.0.1:5432` и `127.0.0.1:6379`, пользователь и база `vsm`, пароль `vsm`.

## Скрипты

| Команда | Действие |
| --- | --- |
| `npm run start:dev` | Nest в watch |
| `npm run build` / `npm start` | Сборка и `node dist/main.js` |
| `npm run check:biome` | Формат и lint, предупреждения — ошибка |
| `npm run format` | Записать формат Biome |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, включая e2e |
| `npm run test:e2e` | Только `test/` |
| `npm run prisma:generate` | Клиент в `src/generated/` |
| `npm run prisma:migrate` | `migrate dev` |
| `npm run prisma:deploy` | `migrate deploy` |
| `npm run prisma:seed` | Проверка соединения |
| `npm run verify` | Biome, типы, тесты, сборка |

## Сценарии

`content/scenarios/*.yaml` при старте пишется в `Scenario` и `ScenarioVersion`.
Контрольная сумма — sha256 канонического JSON. Новая версия появляется только
если файл изменился. Сценарии с диска получают статус `PUBLISHED`.

| Метод | Путь | Кто |
| --- | --- | --- |
| GET | `/api/v1/scenarios` | любой залогиненный, без графа |
| GET | `/api/v1/scenarios/:id` | методист и администратор, с графом |
| PUT | `/api/v1/admin/scenarios/:id` | методист и администратор, новая версия |
| POST | `/api/v1/admin/scenarios/:id/status` | методист и администратор, тело `{status}` |
