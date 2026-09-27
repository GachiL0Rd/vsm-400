# Архитектура Backend «Перегон»

Каркас этой ветки: NestJS 11 на Fastify, Prisma 7, Postgres, Redis-клиент,
health, схема движка, событие `run.completed`. Таблица модулей ниже — границы
из SPEC §2. Доменные модули подключаются в той же интеграции, пустыми
папками их нет.

GameServer в репозитории нет. Пространственный клиент уже говорит по
WebSocket v1 (`Game/docs/agent/game-websocket-contract.md` на `origin/main`).
Backend этот протокол не подменяет.

## Компоненты

```mermaid
flowchart LR
  subgraph browsers [Браузер]
    SPA["Frontend SPA"]
    Game["Game client"]
  end
  GS["GameServer"]
  subgraph api [Backend]
    Auth[auth]
    Sessions[sessions]
    Engine[engine]
    Prog[progression]
    Ach[achievements]
    Board[leaderboard]
    Notes[notifications]
    Integ[integration]
  end
  PG[("Postgres")]
  RD[("Redis / Valkey")]
  HR["HR / LMS"]

  SPA -->|"REST /api/v1"| Auth
  SPA -->|"REST /api/v1"| Sessions
  Game -->|"WS /game-ws"| GS
  GS -->|"HTTP /api/internal/v1 + X-Service-Token"| Sessions
  Sessions --> Engine
  Sessions --> PG
  Sessions --> RD
  GS -.->|"pub/sub vsm:game:sessionId"| RD
  RD -.-> GS
  Auth --> PG
  Prog --> PG
  Prog --> RD
  Board --> RD
  Integ -->|"вебхуки HMAC"| HR
  HR -->|"X-API-Key"| Integ
```

Кабинет (`Frontend/`) ходит только в Backend. Игра ходит только в GameServer.
GameServer в Postgres не пишет. Учётки HR заводит сама, саморегистрации нет.

В dev-compose брокер — Valkey 9. Протокол клиентский — Redis (`ioredis`).
Отдельного Redis-сервиса в проде SPEC не требует: тот же URL.

Концепт (`concept.html`) рисовал ещё BullMQ, S3/MinIO, xAPI и Web Push.
В SPEC v1 этого нет: фон — `@nestjs/schedule`, медиа в отдельное хранилище
не выносятся, в LMS уходит вебхук, не xAPI.

## Модули Backend

Глобальный префикс `/api` (`src/configure-app.ts`). Версия URI, по умолчанию
`1`: доменная ручка без своего `version` становится `/api/v1/...`.
`GET /api/health`, `/api/docs`, `/api/openapi.json` вне версии.
Внутренний API монтируется как `/api/internal/v1/...`
(`VERSION_NEUTRAL`, путь `internal/v1/...`): при обычном `version: '1'`
Nest поставил бы `/api/v1/internal/...`, это не путь SPEC §13.

| Модуль | Ответственность |
| --- | --- |
| `config` | Схема env (zod). Пустой или короткий секрет роняет процесс до `listen`. |
| `prisma` | Единственная точка записи в Postgres. Адаптер `@prisma/adapter-pg`. |
| `redis` | ZSET рейтинга, jti билетов, rate limit, pub/sub. |
| `health` | `GET /api/health`: ping Postgres и Redis. |
| `engine` | Чистый TypeScript: граф сценария, `step`, `view`, `summarize`, HMAC-счётчик. Без Nest, Prisma, Redis, файлов. |
| `auth` | Логин, ротация refresh, пароль argon2id, игровой билет. Регистрации нет. |
| `users`, `org` | Учётка, депо, бригада. Позывной, не ФИО. |
| `scenarios` | YAML → версия графа в БД. Прогон ссылается на версию. |
| `sessions` | Смена, REST-рантайм, билет, internal API для GameServer. |
| `progression` | `Run`, леджер очков, уровень, EWMA компетенций, streak. |
| `achievements` | Правила из `content/achievements.yaml`, прогресс, бонус. |
| `leaderboard` | ZSET сезона и копия `SeasonScore`. |
| `notifications` | Запись и SSE `GET /api/v1/notifications/stream`. |
| `analytics` | Теплокарта и пробелы бригады. |
| `cabinet` | Read-API экранов `/me/*`. |
| `integration` | `ApiClient`, сотрудники по `extHash`, вебхуки. |
| `audit` | `AuditLog`: USER, API_CLIENT, SYSTEM, GAME_SERVER. |

`common` — problem+json (RFC 9457) и декораторы доступа, не домен.

## Шина

В процессе один `EventEmitter2`. Подписчики — `@OnEvent(..., { async: true })`,
обработчик идемпотентен по `runId`.

Сейчас в коде объявлено одно имя: `run.completed`
(`src/common/events.ts`). Полезная нагрузка: `runId`, `userId`, `sessionId`,
`summary` (`RunSummary`), `suspicious`.

Дальше по SPEC §8, строго после записи рейса:

1. `progression` — `Run`, `RunDecision`, `PointLedger` (`expiresAt` +30 дней), уровень, EWMA, streak.
2. `achievements` — правила YAML. Коды ачивок из отчёта игры игнорируются.
3. `leaderboard` — `ZINCRBY` в `lb:<season>:brigade:<id>`, `…:depot:<id>`, `…:company`, upsert `SeasonScore`. Подозрительный рейс в рейтинг не идёт.
4. `notifications` — запись и SSE. Сосед снизу по рейтингу получает «вас обогнал».
5. `promotion` — условия грейда → `PromotionRecommendation` (PENDING). Подтверждает человек.
6. `integration` — вебхуки `run.completed`, `achievement.granted`, `promotion.recommended`. Подпись `X-VSM-Signature` (HMAC-SHA256). Повтор — cron, не pub/sub.

Redis pub/sub (`vsm:game:<sessionId>`) — не эта шина. Это сигнал GameServer
(отмена сессии). Доставка at-most-once: кто не был подписан, сообщение не
догонит. Итог рейса туда не кладётся.

Cron (`@nestjs/schedule`): сгорание баллов раз в час, предупреждение за 3 дня,
закрытие сезона в понедельник 00:00 МСК, ретраи вебхуков. BullMQ в v1 нет.

## Вход

```mermaid
sequenceDiagram
  participant SPA as Frontend SPA
  participant API as Backend
  participant PG as Postgres
  participant RD as Redis
  SPA->>API: POST /api/v1/auth/login
  API->>RD: rate limit логина
  API->>PG: пользователь по login
  Note over API: argon2id, один ответ на неверный логин и пароль
  API->>PG: AuthSession, хеш refresh
  API->>PG: AuditLog
  API-->>SPA: профиль и cookies vsm_access, vsm_refresh
  SPA->>API: POST /api/v1/auth/refresh
  API->>PG: ротация, старый refresh гасится
  Note over API: повтор старого refresh отзывает цепочку
```

Access — JWT на 15 минут, cookie `vsm_access` (HttpOnly, SameSite=Lax,
Path=/, Secure при `COOKIE_SECURE=true`). Для Swagger и интеграций тот же
токен в `Authorization: Bearer`. Refresh — opaque 32 байта, 7 дней,
cookie `vsm_refresh` (HttpOnly, SameSite=Strict, Path=/api/v1/auth).
В базе лежит хеш, не сам токен.

Учётку создаёт ADMIN или HR. Если в базе нет ни одного ADMIN, старт создаёт
`admin` со случайным паролем (CSPRNG), `mustChangePassword=true`, и один раз
печатает логин, пароль и URL в лог.

## «Играть» через GameServer

```mermaid
sequenceDiagram
  participant SPA as Frontend SPA
  participant Game as Game client
  participant API as Backend
  participant RD as Redis
  participant GS as GameServer
  SPA->>API: POST /api/v1/game-sessions
  Note over API: seed 32 байта, commit sha256, план смены, JWT билета
  API-->>SPA: sessionId, ticket, wsUrl, seedCommit, план
  Note over SPA: cookie vsm_game, HttpOnly, SameSite=Strict
  Game->>GS: WS /game-ws, hello v1 и ticket или cookie
  GS->>API: POST /api/internal/v1/tickets/verify
  API->>RD: SET vsm:ticket:jti NX EX
  API-->>GS: userId, sessionId, plan
  GS-->>Game: snapshot protocolVersion 1
  Game->>GS: command v1, намерение
  GS->>API: POST /api/internal/v1/game-sessions/id/decisions
  API-->>GS: view узла без эффектов
  GS->>API: POST /api/internal/v1/game-sessions/id/events
  Game->>GS: command finish
  GS->>API: POST /api/internal/v1/game-sessions/id/report
  Note over API: RunSummary, очки считает Backend
  API-->>API: событие run.completed
  Note over API: прогрессия, рейтинг, уведомления, вебхуки HR
```

Диалоговый перегон и пространственная симуляция — разные входы в один итог.
Решения перегона GameServer проводит через `decisions`. Окончание симуляции —
`report` с `RunReport` v1. Оба пути публикуют `run.completed`. Подробности
полей — в `game-server-contract.md`.

Канал `vsm:game:<sessionId>`: Backend публикует отмену, GameServer закрывает
сокет. Подписчик, которого не было в момент `PUBLISH`, кадр не получит.

## REST без GameServer

Тот же движок, транспорт `REST`. Клиент кабинета или тонкий клиент.

```mermaid
sequenceDiagram
  participant SPA as Frontend SPA
  participant API as Backend
  participant PG as Postgres
  SPA->>API: POST /api/v1/game-sessions
  API-->>SPA: sessionId, seedCommit, план, deadlineAt
  SPA->>API: GET /api/v1/game-sessions/id
  API-->>SPA: view, шкалы, seq, deadlineAt
  SPA->>API: POST /api/v1/game-sessions/id/decisions
  Note over API: seq, дедлайн сервера, step
  API->>PG: состояние и GameEvent
  API-->>SPA: следующий view
  Note over API: финал узла публикует run.completed
  SPA->>API: GET /api/v1/me/runs/id
  API-->>SPA: разбор, seed раскрыт
```

`POST .../abort` снимает сессию. Опоздание относительно `nodeDeadlineAt`
(допуск 500 мс на сеть) — переход `timeout`, не ошибка HTTP. Повтор того же
`seq` возвращает тот же ответ. Другой `seq`, чем ждёт сервер, — 409.
Чужая сессия — 404. Выбор с невыполненным `requires` — 422
`CHOICE_NOT_AVAILABLE`.

Итог с клиента не принимается: нет ручки «вот мои очки».

## Почему источник истины — Backend

Очки, уровень, компетенции, рейтинг, ачивки и рекомендации к грейду пишет
только Backend. Клиент и GameServer присылают намерение или нормализуемый
отчёт. `view()` не отдаёт эффекты, вердикт и `better` до разбора.

Два писателя в ZSET на ретрае засчитают рейс дважды. Поэтому GameServer без
`DATABASE_URL` и без `ZINCRBY`. Повтор `report` по тому же `sessionId` не
публикует `run.completed` второй раз.

Seed смены генерирует сервер (`crypto.randomBytes(32)`). Наружу уходит
`sha256(seed)`. Сам seed лежит в `seedEnc` (AES-256-GCM, ключ `SEED_ENC_KEY`)
и раскрывается в разборе. Клиентский `Math.random` на результат не влияет.

Дедлайн диалогового узла — `nodeDeadlineAt` в базе. Часы телефона не
продлевают ход. В симуляции мягкий и жёсткий дедлайн задачи считает
GameServer в игровых секундах; клиент только рисует HUD (контракт v1).

## Масштабирование

REST-API без состояния в процессе: access-JWT, сессия refresh в Postgres,
jti и лимиты в Redis. Несколько реплик Backend за одним прокси делят Postgres
и Redis. Pub/sub для отмены сессии при двух репликах API достаточен: сообщение
не хранит мир.

GameServer держит мир рейса в памяти. Вторая реплика без привязки сокета к
процессу разъедет ревизии. На этот контур — один процесс GameServer.
Горизонтально его не клонируем, пока мир не вынесен из памяти.

`src/engine/` не импортирует Nest и Prisma, чтобы позже отдать `step()`
процессу GameServer. Общий пакет не заводится, пока этот процесс не появился:
так сказано в `docs/user/project_direction.md`. Доменная логика самой игры
пока живёт в `Game/` и в рантайм сцены не вшита; границей интеграции служит
`RunReport`, а не общий package.
