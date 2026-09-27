# Backend «Перегон»

API тренажёра проводника ВСМ. NestJS 11 на Fastify, Prisma 7, PostgreSQL 18,
Valkey 9, Zod 4. Смены и прогрессия уже в коде: движок `src/engine`, сессии
`src/sessions`, кабинет `src/cabinet`.

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

Образ API — отдельный профиль, dev-базу он не заменяет:

```powershell
docker compose --profile app up --build -d
```

У сервиса `backend` в сети compose свои `DATABASE_URL` (`postgres`) и
`REDIS_URL` (`valkey`), `NODE_ENV=production` и `COOKIE_SECURE=true`.
С хоста: `http://127.0.0.1:3000/api/health`.
Остановка без удаления томов: `docker compose --profile app down`.

`npm run prisma:seed` наполняет депо, бригады и историю рейсов. Повтор без
`--reset` ничего не пишет, если логин `demo` уже есть. `npm run prisma:seed -- --reset`
очищает доменные таблицы и текущую Redis DB, миграции не трогает. Prisma 7
`migrate reset` сам сид не вызывает: после сброса нужен `npm run prisma:seed`.

## Версии URL

Доменные контроллеры получают префикс `/api/v1` (URI versioning, версия по
умолчанию `1`). Health и документация без версии: `/api/health`, `/api/docs`,
`/api/openapi.json`. Внутренний API GameServer — `/api/internal/v1`, раздел
ниже. Полная таблица ручек — [docs/api.md](docs/api.md).

## Переменные окружения

Файл `.env.example` — только для локальной разработки. Пустые или короткие
секреты роняют процесс до `listen` текстом `Некорректное окружение`.

| Переменная | Смысл |
| --- | --- |
| `NODE_ENV` | `development`, `test` или `production`. По умолчанию `development` |
| `PORT` | HTTP-порт, целое 1..65535. По умолчанию `3000` |
| `DATABASE_URL` | Строка Postgres (`postgres://` или `postgresql://`) |
| `REDIS_URL` | Redis или Valkey (`redis://` или `rediss://`) |
| `JWT_ACCESS_SECRET` | Секрет access-JWT, минимум 32 символа |
| `GAME_TICKET_SECRET` | Секрет игрового билета, минимум 32 символа |
| `GAME_SERVER_TOKEN` | Секрет заголовка `X-Service-Token`, минимум 16 символов |
| `SEED_ENC_KEY` | 32 байта hex (64 символа), ключ AES-256-GCM для seed сессии |
| `EXT_ID_PEPPER` | Перец HMAC табельного номера, минимум 16 символов. ФИО не хранится |
| `CORS_ORIGINS` | Список origin через запятую, хотя бы один |
| `PUBLIC_GAME_WS_URL` | `ws://` или `wss://`, адрес GameServer для клиента |
| `COOKIE_SECURE` | `true` или `false`. По умолчанию `false`. В `production` только `true`, иначе старт падает |
| `TRUST_PROXY` | Целое 0..32, по умолчанию `0`. Значение читается, но в Fastify уходит `false`: с 5.12.1 число хопов не включает доверие к `X-Forwarded-For`. Лимит считает адрес сокета |
| `WEBHOOK_ALLOWED_HOSTS` | Hostname через запятую. Пусто — пустой список, фильтр хоста не включается. Непустое значение — только эти хосты. URL сводится к hostname |
| `BOOTSTRAP_ADMIN_PASSWORD` | Не поле zod-объекта, проверяет `loadConfig`. Пусто — случайный пароль. Иначе минимум 10 символов. В `production` любое значение роняет старт |

Локальные Postgres и Valkey поднимает `docker-compose.yml`. На хост
публикуются `127.0.0.1:${POSTGRES_PORT:-5432}` и
`127.0.0.1:${REDIS_PORT:-6379}`: внутри сети контейнеры по-прежнему слушают
5432 и 6379, сервис `backend` ходит к ним по именам `postgres` и `valkey`.
Пользователь и база `vsm`, пароль `vsm`. Если 5432 занят другим Postgres,
`POSTGRES_PORT=5433 docker compose up -d` и тот же порт в `DATABASE_URL`.
`REDIS_PORT` — то же для Valkey. Переменные читает compose из `.env`, приложению
они не нужны.

## Скрипты

| Команда | Действие |
| --- | --- |
| `npm run start:dev` | Nest в watch |
| `npm run build` / `npm start` | Сборка и `node dist/main.js` |
| `npm run check:biome` | Формат и lint, предупреждения — ошибка |
| `npm run format` | Записать формат Biome |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, включая e2e |
| `npm run test:e2e` | Проект `db`: кабинет, прогрессия, auth, сценарии, сессии |
| `npm run prisma:generate` | Клиент в `src/generated/` |
| `npm run prisma:migrate` | `migrate dev` |
| `npm run prisma:deploy` | `migrate deploy` |
| `npm run prisma:seed` | Синтетические депо, бригады и рейсы |
| `npm run smoke` | Сквозной прогон: demo, REST-смена, билет и отчёт. Сервер уже слушает |
| `npm run openapi:export` | Пишет `dist/openapi.json`. `-- -` печатает JSON в stdout. Файл не коммитится |
| `npm run verify` | Biome, типы, тесты, сборка |

## API

### Аутентификация

`POST /api/v1/auth/login` ставит `vsm_access` (JWT HS256, 15 минут, Path=/,
SameSite=Lax) и `vsm_refresh` (32 байта, 7 суток, Path=/api/v1/auth,
SameSite=Strict). Оба HttpOnly, флаг Secure берётся из `COOKIE_SECURE`.
Неверный логин и неверный пароль отвечают одинаково: 401 `INVALID_CREDENTIALS`.
На логин — 20 попыток за 60 с на IP (IPv6 до /64) и 5 за 60 с на логин
после trim и обрезки до 64 символов. `POST /api/v1/auth/password` — 5 за 60 с
на пользователя. `X-Forwarded-For` не учитывается: в адаптер уходит `false`.
Счётчик лежит в Redis (`auth:throttle:*`, база из `REDIS_URL`).

`POST /api/v1/auth/refresh` вращает refresh. Повтор уже заменённого токена
отзывает все сессии пользователя и пишет аудит. `POST /api/v1/auth/logout`
отзывает текущую сессию и очищает cookies. `POST /api/v1/auth/password`
принимает `{current, next}` (next от 10 символов), снимает `mustChangePassword`
и отзывает остальные сессии. `GET /api/v1/auth/session` возвращает текущего
пользователя.

Пока `mustChangePassword=true`, открыты только `POST /api/v1/auth/password`,
`POST /api/v1/auth/logout` и `GET /api/v1/auth/session`
(403 `PASSWORD_CHANGE_REQUIRED`). Refresh при этом флаге не ротирует сессию
и не выдаёт access.

Если в базе нет ни одного `ADMIN`, старт создаёт логин `admin`
(`mustChangePassword=true`) и один раз печатает логин, пароль и
`http://localhost:PORT/api/docs`. Пароль — `crypto.randomBytes(18)` в base64url,
либо строка из `BOOTSTRAP_ADMIN_PASSWORD`. `loadConfig` роняет процесс, если
значение короче 10 символов или задано при `NODE_ENV=production`. Пустое
значение оставляет случайный пароль. При `NODE_ENV=test` bootstrap не
запускается, чтобы health-тесты с моком Prisma не падали.

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

- `GET /api/v1/leaderboards/:scope` — `brigade`, `depot` или `company`. Query `season` — uuid сезона, иначе текущая неделя МСК. Ответ `{ seasonId, season, endsAt, total, rows }`: `seasonId` тот же uuid, `season` — название («Сезон 39»). Бригада целиком, депо и компания — топ-5 и своя строка. Без бригады scope `brigade` отдаёт пустой список.
- `GET /api/v1/leaderboards/brigades` — место бригады среди бригад депо, `{ rank, total }`. Нет бригады — `{ rank: null, total: 0 }`.
- Уведомление `scenario` — проводникам, у которых рейс или назначение того же класса вагона, что у опубликованной версии. `advice` — понедельник 09:00 МСК, компетенция ниже `weakScore` и ниже среднего депо, в тексте название сценария. `challenge` — понедельник 00:00 МСК, тема недели = самая слабая компетенция депо, бонус `challengePoints` в леджер с причиной `CHALLENGE`. Назначение пишет названия сценариев.
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

### Кабинет

`GET /api/v1/me`, `/me/stats`, `/me/next-shift`, `/me/runs`, `/me/runs/:id`,
`/me/achievements`, `/me/compare`. Имена полей — как у `Frontend/src/model.ts`,
в профиле дополнительно `grade`, у смены — `departureAt` (ISO) рядом с
`departure` (`HH:mm`). Баллы профиля — несгоревшие `RUN`, `ACHIEVEMENT` и
`CHALLENGE`. Уровень — пожизненная сумма положительных начислений тех же
причин. `EXPIRE` и `ADJUST` в оба счёта не входят. Сезонный рейтинг сюда не
входит. Журнал — `{ total, runs, nextCursor }`, не массив. `total` — число
всех рейсов («5 из 38»).

### Аналитика

`GET /api/v1/analytics/brigades/:id/heatmap` и `/gaps`: CHIEF своей бригады,
METHODIST и ADMIN любой. `GET /api/v1/analytics/scenarios/:id` — воронка узлов
для METHODIST и ADMIN.

### Назначения

`POST /api/v1/assignments` создаёт `ShiftAssignment` на каждого сотрудника и
публикует `assignment.created`. CHIEF назначает только свою бригаду.
`GET /api/v1/assignments?brigadeId`, `DELETE /api/v1/assignments/:id` ставит
`CANCELLED`.

### Прогрессия

Рейс пишется по событию `run.completed` (одна транзакция, повтор по `sessionId` ничего не делает). После коммита — `run.recorded`.

- `GET /api/v1/promotions?status=PENDING` — очередь рекомендаций. Начальник видит свою бригаду, администратор — все.
- `POST /api/v1/promotions/:id/decision` — тело `{ "approve": true|false }`. Начальник своей бригады или администратор. Утверждение меняет грейд.

`GET /api/v1/me/achievements` отдаёт кабинет. Список собирает `AchievementsService.listForUser`: `code`, `title`, `description`, `earnedAt` или `null`, для незакрытых счётчиков ещё `progress`.

### Игровые сессии

`POST /api/v1/game-sessions` `{transport, carClass?}` — любой залогиненный.
Если смена уже `PENDING` или `ACTIVE`, возвращается она, в аудит пишется
`anticheat.multi-session`. Иначе собирается план, seed шифруется AES-256-GCM,
в cookie `vsm_game` (HttpOnly, SameSite=Strict, Path=/game-ws, 2 минуты) и в
тело кладётся билет. Ответ: `{sessionId, ticket, wsUrl, seedCommit, plan}` —
публичный план без графа: поезд, маршрут, вагон, класс, отправление, число
перегонов и названия. Назначенная `PLANNED` смена становится `STARTED`.

`GET /api/v1/game-sessions/:id` — узел, шкалы, дедлайн, seq. Просроченный
дедлайн на GET сервер закрывает сам. `POST /:id/decisions` `{seq, choiceId,
clientTs?}`: опоздание больше 500 мс — timeout; повтор того же seq и choiceId
отдаёт прежний ответ, иной — 409 `SEQ_MISMATCH`. `POST /:id/abort` ставит
`ABORTED` без рейса. `GET /:id/reveal` после `COMPLETED` отдаёт seed и commit.

Внутренний контур `/api/internal/v1` (заголовок `X-Service-Token`):
`POST /tickets/verify` гасит jti в Redis (`vsm:ticket:<jti>`, 300 с), повтор —
409 `TICKET_REUSED`, сессия `PENDING` становится `ACTIVE`.
`POST /game-sessions/:id/decisions`, `/events`, `/report`. Отчёт v1 нормализуется
в итог рейса (correct→best, late→ok, incorrect→worse, missed→missed,
ride→enroute). Повтор отчёта — 200 и тот же `runId`. Отмена и истечение
публикуют `vsm:game:<sessionId>`. Раз в минуту просроченные `PENDING`/`ACTIVE`
становятся `EXPIRED`.

### Перефразы LLM

Пул формулировок для сценариев с блоком `llm`. Провайдер `LLM_PROVIDER`:
`none` (по умолчанию, очередь не пополняется), `openai-compatible` или `gigachat`.
Методист и администратор: `GET /api/v1/admin/scenarios/:id/variants`,
`POST .../variants/:variantId/approve`, `POST .../variants/:variantId/reject`,
`POST .../variants/generate`, `GET /api/v1/admin/llm/status`.
Подробности, промпт и сертификат GigaChat — в [docs/llm.md](docs/llm.md).

## Демо-учётки

Сид печатает те же логины. `mustChangePassword=false` только у них. Админа сид не создаёт: если ADMIN нет, его заводит старт приложения и один раз печатает пароль.

| Логин | Пароль | Кто |
| --- | --- | --- |
| `demo` | `demo` | Проводник A7F3, бригада 12, депо Москва-Октябрьская |
| `chief` | `chief` | Начальник поезда бригады 12 |
| `methodist` | `methodist` | Методист |

История рейсов считается движком (`generateShift`, `step`, `summarize`) и тем же `run.completed`, что прод. Время рейса пишется в `finishedAt` сессии до события, серия считается по нему. Срок баллов и `createdAt` леджера сервисы берут от `new Date()` — после записи сид сдвигает их к `finishedAt` и заново применяет правило «рейс продлевает живые начисления на 30 суток». У demo ближайшие 120 баллов сгорают через 3 дня.
