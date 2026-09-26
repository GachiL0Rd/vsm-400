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

## API

### Аутентификация

`POST /api/v1/auth/login` ставит `vsm_access` (JWT HS256, 15 минут, Path=/,
SameSite=Lax) и `vsm_refresh` (32 байта, 7 суток, Path=/api/v1/auth,
SameSite=Strict). Оба HttpOnly, флаг Secure берётся из `COOKIE_SECURE`.
Неверный логин и неверный пароль отвечают одинаково: 401 `INVALID_CREDENTIALS`.
На логин — 5 попыток в минуту на пару IP и логин. Счётчик лежит в Redis
(`auth:throttle:*`, база из `REDIS_URL`).

`POST /api/v1/auth/refresh` вращает refresh. Повтор уже заменённого токена
отзывает все сессии пользователя и пишет аудит. `POST /api/v1/auth/logout`
отзывает текущую сессию и очищает cookies. `POST /api/v1/auth/password`
принимает `{current, next}` (next от 10 символов), снимает `mustChangePassword`
и отзывает остальные сессии. `GET /api/v1/auth/session` возвращает текущего
пользователя.

Пока `mustChangePassword=true`, доступны только пути `/auth/` и `/me`
(403 `PASSWORD_CHANGE_REQUIRED`).

Если в базе нет ни одного `ADMIN`, старт создаёт логин `admin`
(`mustChangePassword=true`) и один раз печатает логин, пароль и
`http://localhost:PORT/api/docs`. Пароль — `crypto.randomBytes(18)` в base64url,
либо строка из `BOOTSTRAP_ADMIN_PASSWORD`. Этой переменной нет в zod-схеме
`src/config`: схема чужая, bootstrap читает `process.env` напрямую.
При `NODE_ENV=test` bootstrap не запускается, чтобы health-тесты с моком Prisma
не падали.

Админ: `POST/GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/:id`,
`POST /api/v1/admin/users/:id/reset-password`, `GET /api/v1/admin/audit`.
Позывной — 4 символа `[A-Z0-9]`, пароль новой учётки возвращается один раз.
Оргструктура: `GET /api/v1/org/depots`, `/org/depots/:id/brigades`,
`/org/brigades/:id`. Логины участников видит только ADMIN. CHIEF и CONDUCTOR
открывают состав только своей бригады, METHODIST — любой.

Внутренние ручки помечаются `@InternalService()`: это `@Public()`,
`ServiceTokenGuard` (заголовок `X-Service-Token`, сверка через `timingSafeEqual`)
и схема Swagger `service-token`. Guard и декоратор экспортирует `AuthModule`.

Лимит логина считает `RedisThrottlerStorage` поверх уже созданного `RedisService`.
Пакет `@nest-lab/throttler-storage-redis@1.2.0` совместим с Nest 11, но открывает
второй клиент ioredis и не закрывает его при остановке приложения.

### Рейтинг и уведомления

- `GET /api/v1/leaderboards/:scope` — `brigade`, `depot` или `company`. Query `season` — id, иначе текущая неделя МСК. Ответ `{ season, endsAt, total, rows: [{ rank, callsign, points, move, me? }] }`: бригада целиком, депо и компания — топ-5 и своя строка.
- `GET /api/v1/leaderboards/brigades` — место бригады среди бригад депо, `{ rank, total }`.
- `GET /api/v1/notifications` — `{ unreadCount, items, nextCursor }`. Элемент: `{ id, kind, title, text, at, unread, link? }`.
- `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all`.
- `GET /api/v1/notifications/stream` — SSE, событие `new-notification`, heartbeat 25 с.

### Сценарии

`content/scenarios/*.yaml` при старте пишется в `Scenario` и `ScenarioVersion`.
Контрольная сумма — sha256 канонического JSON. Новая версия появляется только
если файл изменился. Сценарии с диска получают статус `PUBLISHED`.

| Метод | Путь | Кто |
| --- | --- | --- |
| GET | `/api/v1/scenarios` | любой залогиненный, без графа |
| GET | `/api/v1/scenarios/:id` | методист и администратор, с графом |
| PUT | `/api/v1/admin/scenarios/:id` | методист и администратор, новая версия |
| POST | `/api/v1/admin/scenarios/:id/status` | методист и администратор, тело `{status}` |

### Интеграция HR/LMS

Ключ `X-API-Key` выпускает ADMIN: `POST /api/v1/admin/api-clients`.
Внешний контур — `/api/integration/v1`: сотрудник по табельному номеру (хранится
только HMAC), прогресс, оргструктура, вебхуки. Curl и проверка подписи —
в [docs/integration.md](docs/integration.md).
