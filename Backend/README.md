# Backend «Перегон»

API тренажёра проводника ВСМ. NestJS 11 на Fastify, Prisma 7, PostgreSQL 18,
Valkey 9, Zod 4. Смены и прогрессия уже в коде: словарь сценария и план смены
`src/engine`, сессии `src/sessions`, кабинет `src/cabinet`. Ход симуляции — в `Game/`.

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
`--reset` ничего не пишет, если логин `demo` уже есть. `npm run prisma:seed -- -- --reset`
очищает доменные таблицы и текущую Redis DB, миграции не трогает. Prisma 7
`migrate reset` сам сид не вызывает: после сброса нужен `npm run prisma:seed`.

## Версии URL

Доменные контроллеры получают префикс `/api/v1` (URI versioning, версия по
умолчанию `1`). Health и документация без версии: `/api/health`, `/api/docs`,
`/api/openapi.json`. Game Server ходит без версии: `POST /api/game/sessions/resolve`
и `POST /api/game/sessions/:attemptId/finish`. Полная таблица ручек —
[docs/api.md](docs/api.md). Контракт — [docs/game-server-contract.md](docs/game-server-contract.md).

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
| `GAME_SERVER_TOKEN` | Bearer `/api/game/*`, минимум 16 символов. На Game это `PLATFORM_SERVICE_TOKEN` |
| `SEED_ENC_KEY` | 32 байта hex (64 символа), ключ AES-256-GCM для seed сессии |
| `EXT_ID_PEPPER` | Перец HMAC табельного номера, минимум 16 символов. ФИО не хранится |
| `CORS_ORIGINS` | Список origin через запятую, хотя бы один |
| `PUBLIC_GAME_WS_URL` | Legacy `ws://` или `wss://`. Кабинет кладёт его в `wsUrl` |
| `PUBLIC_GAME_URL` | Абсолютный `http://` или `https://` клиента Game. По умолчанию `http://127.0.0.1:4174/`. Из него собирается `launchUrl` |
| `PUBLIC_APP_URL` | Абсолютный `http://` или `https://` кабинета. По умолчанию `http://127.0.0.1:5173`. Редирект `{URL}/runs/{runId}` |
| `GAME_LEVEL_ID` | Id уровня для Game Server. Пусто — `vsm-baseline-01` |
| `COOKIE_SECURE` | `true` или `false`. По умолчанию `false`. В `production` только `true`, иначе старт падает |
| `TRUST_PROXY` | Пусто, `false` или `0` — не доверять `X-Forwarded-For` (в адаптер уходит `false`). Иначе список через запятую: IP, CIDR или `loopback` / `linklocal` / `uniquelocal`. `true` и число хопов запрещены: Fastify 5.12 их не читает как доверие к заголовку |
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

Профиль `app` (`docker compose --profile app up`) собирает образ API с
`NODE_ENV=production`. Секреты без подстановки по умолчанию: `docker compose config`
падает, пока в `Backend/.env` (compose читает его сам) или в окружении нет
`JWT_ACCESS_SECRET`, `GAME_TICKET_SECRET`, `GAME_SERVER_TOKEN`, `SEED_ENC_KEY`,
`EXT_ID_PEPPER`. Текст: `задайте <ИМЯ>`. Значения из `.env.example` годятся
для своей машины.

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
| `npm run smoke` | Сквозной прогон: demo, открытие смены, билет, resolve и finish. Сервер уже слушает |
| `npm run openapi:export` | Пишет `dist/openapi.json`. `-- -` печатает JSON в stdout. Файл не коммитится |
| `npm run verify` | Biome, типы, тесты, сборка |

## API

### Аутентификация

`POST /api/v1/auth/login` ставит `vsm_access` (JWT HS256, 15 минут, Path=/,
SameSite=Lax) и `vsm_refresh` (32 байта, 7 суток, Path=/api/v1/auth,
SameSite=Strict). Оба HttpOnly, флаг Secure берётся из `COOKIE_SECURE`.
Неверный логин и неверный пароль отвечают одинаково: 401 `INVALID_CREDENTIALS`.
На логин — 20 попыток за 60 с на IP, который видит Fastify (IPv6 до /64),
и 5 за 60 с на логин после trim и обрезки до 64 символов.
`POST /api/v1/auth/password` — 5 за 60 с на пользователя.
Пустой `TRUST_PROXY` оставляет адрес сокета: `X-Forwarded-For` не читается.
Список адресов прокси включает заголовок, и лимит с аудитом считают клиентский IP.
Счётчик лежит в Redis (`auth:throttle:*`, база из `REDIS_URL`).

`POST /api/v1/auth/refresh` вращает refresh. Два запроса одним токеном в окне
10 с: победитель отвечает 200 и пишет новые cookie, проигравший — 409
`REFRESH_RACE` без отзыва сессий и без нового `Set-Cookie`. Фронт не
разлогинивает пользователя и повторяет исходный запрос: access уже обновил
победивший ответ. Повтор заменённого refresh старше 10 с — 401 `REFRESH_REUSE`,
все живые сессии отзываются, в аудит пишется `auth.refresh.reuse`.
`POST /api/v1/auth/logout`
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
Свою роль и `disabled` админ не меняет: 409 `SELF_LOCKOUT`. Если после
изменения не останется активного `ADMIN` — 409 `LAST_ADMIN`.
Позывной — 4 символа `[A-Z0-9]`, пароль новой учётки возвращается один раз.
Оргструктура: `GET /api/v1/org/depots`, `/org/depots/:id/brigades`,
`/org/brigades/:id`. Логины участников видит только ADMIN. CHIEF и CONDUCTOR
открывают состав только своей бригады, METHODIST — любой.

Лимит логина считает `RedisThrottlerStorage` поверх уже созданного `RedisService`.
Пакет `@nest-lab/throttler-storage-redis@1.2.0` совместим с Nest 11, но открывает
второй клиент ioredis и не закрывает его при остановке приложения.

### Рейтинг и уведомления

- `GET /api/v1/leaderboards/:scope` — `brigade`, `depot` или `company`. Query `season` — uuid сезона, иначе текущая неделя МСК. Ответ `{ seasonId, season, endsAt, total, rows }`: `seasonId` тот же uuid, `season` — название («Сезон 39»). Бригада целиком, депо и компания — топ-5 и своя строка. Без бригады scope `brigade` отдаёт пустой список.
- `GET /api/v1/leaderboards/brigades` — место бригады среди бригад депо, `{ rank, total }`. Нет бригады — `{ rank: null, total: 0 }`.
- Уведомление `scenario` — проводникам, у которых рейс или назначение того же класса вагона, что у опубликованной версии. `advice` — понедельник 09:00 МСК, компетенция ниже `weakScore` и ниже среднего депо, в тексте название сценария. `challenge` — понедельник 00:00 МСК, тема недели = самая слабая компетенция депо, бонус `challengePoints` в леджер с причиной `CHALLENGE`. Повтор того же рейса бонус не удваивает. Назначение пишет названия сценариев.
- Подозрительный рейс в рейтинг не входит. Снятие флага (`POST /api/v1/runs/:id/review`, `approve: true`) добавляет очки ровно один раз в сезон, текущий на момент одобрения: рейтинг учитывает рейс, когда он учтён, а не неделю `finishedAt`.
- Закрытие сезона, снимок рангов и тема недели берут Redis-блокировку `SET NX PX` на имя крона и календарное окно МСК, чтобы несколько реплик не сделали одно и то же.
- `GET /api/v1/notifications` — `{ unreadCount, items, nextCursor }`. Элемент: `{ id, kind, title, text, at, unread, link? }`.
- `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all`.
- `GET /api/v1/notifications/stream` — SSE, событие `new-notification`, heartbeat 25 с. На heartbeat сессия access (`sid`) должна быть живой, учётка не отключена: иначе поток закрывается.

### Сценарии

`content/scenarios/*.yaml` при старте сверяется с версиями в базе.
Контрольная сумма — sha256 канонического JSON.

Новая версия из файла появляется, только если сумма файла отличается от
последней версии и последняя версия не от человека (`createdById` пустой).
Иначе рестарт делал бы следующую версию поверх правки методиста. Откат yaml к
старому графу — тоже новая версия.

Если последняя версия человеческая и сумма другая, версия не создаётся. В лог
пишется `сценарий <id> правится в админке, файл пропущен`.

Статус существующей строки синк не меняет. `PUBLISHED` файл ставит только
когда сценария в базе ещё нет. `DRAFT` и `ARCHIVED` прячут сценарий из каталога,
это решение человека, рестарт его не отменяет. Новая версия из файла поэтому не
публикует архив и не поднимает черновик. Уже опубликованный остаётся
`PUBLISHED`: поле статуса синк не переписывает, у файлового хвоста сдвигается
только `currentVersion`.

Вернуть сценарий под файл: `PUT` графа с той же суммой, что у yaml этого id.
Версия пишется без `createdById` — человек подтвердил файл. Следующее изменение
yaml снова становится версией. Пока последняя версия с автором и сумма другая,
файл не главный.

Чтение версии кэшируется в памяти процесса: пара (сценарий, номер) неизменна,
LRU на 64 графа. Наружу отдаётся замороженный объект. Каталог
`GET /api/v1/scenarios` сбрасывается на этом процессе при `PUT`, смене статуса
и синке с диска. Другая реплика о смене не узнает, поэтому каталог живёт не
дольше 30 секунд.

| Метод | Путь | Кто |
| --- | --- | --- |
| GET | `/api/v1/scenarios` | любой залогиненный, без графа |
| GET | `/api/v1/scenarios/:id` | методист и администратор, с графом |
| PUT | `/api/v1/admin/scenarios/:id` | методист и администратор, новая версия |
| POST | `/api/v1/admin/scenarios/:id/status` | методист и администратор, тело `{status}` |

### Интеграция HR/LMS

Ключ `X-API-Key` выпускает ADMIN: `POST /api/v1/admin/api-clients`.
Внешний контур — `/api/integration/v1`: сотрудник по табельному номеру (хранится
только HMAC), прогресс, оргструктура, вебхуки.
`DELETE /api/integration/v1/employees/:extId` (scope `employees:write`) ставит
`disabledAt` и отзывает сессии. Повтор — 204. Неизвестный номер — 404.
`ADMIN` и `METHODIST` — 403 `ROLE_ESCALATION`. Повторный `PUT` по отключённому
номеру — 409 `EMPLOYEE_DISABLED`, ключ HR учётку не включает: это `PATCH`
админа. Уровень в прогрессе — пожизненная сумма положительных `RUN`,
`ACHIEVEMENT` и `CHALLENGE`, баллы — ещё не сгоревшие. Curl и проверка подписи —
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

Рейс пишется по событию `run.completed` (одна транзакция, повтор по `sessionId` ничего не делает). После коммита — `run.recorded`. Ошибка слушателя не отдаётся ходу: она пишется в лог, `Run.effectsAt` остаётся пустым. Раз в минуту сверка берёт такие рейсы старше минуты и шлёт `run.recorded` снова. Слушатели идемпотентны, повтор не удваивает очки. Блокировка сверки — тот же `SET NX PX`, окно в одну минуту.

Подозрительный рейс сохраняется с `points = 0`, пока человек не снимет флаг.

- `GET /api/v1/runs/suspicious` — очередь ещё не разобранных. Начальник видит свою бригаду, администратор — все.
- `POST /api/v1/runs/:id/review` — тело `{ "approve": true|false }`. Начальник своей бригады или администратор, не автор рейса. Чужая бригада — 403 `FORBIDDEN`. Уже рассмотрен — 409 `RUN_REVIEWED`, рейс без флага — 409 `RUN_NOT_SUSPICIOUS`, свой рейс — 403 `SELF_DECISION`. `approve: true` снимает флаг, считает очки тем же `pointsForRun`, пишет `PointLedger` `RUN` и снова публикует `run.recorded`. `approve: false` только помечает разбор. Аудит: `run.review.approved` или `run.review.rejected`.
- `GET /api/v1/promotions?status=PENDING` — очередь рекомендаций. Начальник видит свою бригаду, администратор — все.
- `POST /api/v1/promotions/:id/decision` — тело `{ "approve": true|false }`. Начальник своей бригады или администратор. Своё повышение — 403 `SELF_DECISION`. Утверждение меняет грейд, только если он всё ещё `fromGrade`; иначе 409 `GRADE_CHANGED`, рекомендация остаётся `PENDING`. Уровень для порога — пожизненные положительные `RUN`, `ACHIEVEMENT` и `CHALLENGE` (`lifetimeLevelPoints`), не живые баллы и не `ADJUST`.

`GET /api/v1/me/achievements` отдаёт кабинет. Список собирает `AchievementsService.listForUser`: `code`, `title`, `description`, `earnedAt` или `null`, для незакрытых счётчиков ещё `progress`.

### Игровые сессии

`POST /api/v1/game-sessions` `{transport?: "WS", carClass?}` — любой залогиненный.
`transport` можно не присылать: по умолчанию `WS`. `REST` — 422. Если своя
смена уже `PENDING` или `ACTIVE`, возвращается она и новый билет, в аудит
пишется `session.resumed` (это не флаг). Иначе собирается план, seed шифруется
AES-256-GCM. Новая смена `PENDING`, в `ACTIVE` её переводит `resolve`.
Ответ: `{sessionId, ticket, wsUrl, launchUrl, seedCommit, plan}`. `launchUrl` —
`PUBLIC_GAME_URL` с query `sessionKey`. `wsUrl` остаётся legacy. План публичный,
без графа: поезд, маршрут, вагон, класс, отправление, число перегонов и названия.
Назначенная `PLANNED` смена становится `STARTED`. `POST /:id/abort` ставит
`ABORTED` без рейса.

Итог завершённой смены лежит в `GameSession.result` (`runId`, `suspicious`,
`summary`, для Game Server ещё `platform`). В аудит `session.completed`
пишутся только `runId` и `suspicious`.

`POST /api/game/sessions/resolve` и `POST /api/game/sessions/:attemptId/finish`
— Platform Server для Game Server: Bearer `GAME_SERVER_TOKEN`, без префикса
`v1`. `resolve` гасит jti в Redis (`vsm:ticket:<jti>`). Повтор — 410
`session-consumed` и флаг `ticket-reused`. Статусы и маппинг итога — в
[docs/game-server-contract.md](docs/game-server-contract.md).
Раз в минуту просроченные `PENDING`/`ACTIVE` становятся `EXPIRED`.

### Перефразы LLM

Пул формулировок для сценариев с блоком `llm`. Провайдер `LLM_PROVIDER`:
`none` (по умолчанию, очередь не пополняется), `openai-compatible`, `gigachat` или `yandex`.
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

История рейсов собирается как `RunSummary` (`generateShift` и тот же rng) и пишется тем же `run.completed`, что прод. Время рейса пишется в `finishedAt` сессии до события, серия считается по нему. Срок баллов и `createdAt` леджера сервисы берут от `new Date()` — после записи сид сдвигает их к `finishedAt` и заново применяет правило «рейс продлевает живые начисления на 30 суток». У demo ближайшие 120 баллов сгорают через 3 дня.
