# Правила работы с модулем Backend

## Контекст и границы

`Backend/` — API тренажёра «Перегон»: сценарии, сессии, прогрессия, кабинет.
Игра ходит в GameServer по WebSocket, GameServer — в этот API. GameServer в
репозитории ещё нет. `Game/`, `Frontend/`, `Server/` и `Client/` отсюда не
импортируются.

Фаза каркаса держит инфраструктуру и контракт движка. Доменные модули
(`auth`, `sessions`, `progression` и остальные из SPEC §2) появляются вместе с
рабочим кодом, не пустыми папками.

`src/engine/` — чистый TypeScript. Разрешены только `zod` и `node:crypto`.
Nest, Prisma, Redis, Fastify и файловый IO туда не входят: пакет потом уедет
в GameServer. `step()` в этой фазе нет, есть схема графа и типы состояния.

## Среда и команды

- Node.js: минимум **22.12.0** (`package.json#engines`), рекомендуемая
  LTS-major **24** (`.nvmrc`).
- npm, версии точные (`.npmrc`: `save-exact`), `package-lock.json` коммитится.
- NestJS **11.2.6** + Fastify. Prisma **7.10.0** (не ORM 8 RC) + PostgreSQL 18.
- Valkey **9** (протокол Redis) через ioredis. Zod **4.6.5**, валидация DTO —
  `nestjs-zod` **5.5.0**.
- TypeScript **5.9.3** (линия `experimentalDecorators`, на которой собран Nest 11).
- Vitest **5** + `unplugin-swc` (декораторы). Biome **2.5.14**.
- Клиент Prisma генерируется в `src/generated/` и в Git не входит.
  `npm ci` вызывает `prisma generate` (нужен `DATABASE_URL`, живая БД не нужна).

Из каталога `Backend/`:

```powershell
docker compose up -d
copy .env.example .env
npm ci --include=dev
npm run prisma:migrate
npm run start:dev
npm run verify
```

`verify` = `check:biome` + `tsc --noEmit` + `vitest run` + `nest build`.
Юнит-тесты и e2e health ходят в моки, Postgres для них не поднимается.

## HTTP

Глобальный префикс `/api`. Версия доменных контроллеров — URI, по умолчанию
`v1`: ручка без своего `version` станет `/api/v1/...`. `GET /api/health` и
Swagger (`/api/docs`, `/api/openapi.json`) вне версии (`VERSION_NEUTRAL` и
явные пути). Внутренний префикс `/internal/v1` из SPEC §7 сюда не входит.

Ошибки — `application/problem+json` (RFC 9457): `type`, `title`, `status`,
`detail`, `code`, у Zod ещё `errors[]`. Zod и обёртка nestjs-zod дают 422.
Prisma `P2002` → 409, `P2025` → 404. Остальное — 500 без текста исключения.

Тело запроса ограничено 1 МиБ. CORS берётся из `CORS_ORIGINS`. Cookie secure
в prod включает `COOKIE_SECURE=true`.

## Проверка

- После законченного изменения — `npm run verify`.
- Миграции коммитятся (`prisma/migrations`). Сгенерированный клиент — нет.
- Секреты только в env. В сиде и логах нет ФИО: позывные и хеш табельного.
