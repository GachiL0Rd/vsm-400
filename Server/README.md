# Server

Тестовый backend личного кабинета: вход, профиль, достижения, история рейсов и
статистика. Стек: Node.js, [Hono](https://hono.dev) с `@hono/zod-openapi`,
встроенный `node:sqlite`.
TypeScript запускается напрямую через type stripping Node.js — сборки нет.

Сервер также раздаёт статический кабинет из `../Client`, поэтому фронт и API
живут на одном origin без CORS.

## Требования

- Node.js 22.18.0 или новее (type stripping без флага); рекомендуемая версия в
  `.nvmrc`;
- npm.

## Запуск

Из каталога `Server/`:

```powershell
npm ci --include=dev
npm run dev
```

Кабинет: <http://localhost:3000/>. Тестовые учётные записи: `demo` / `demo`
(с историей и достижениями) и `novice` / `novice` (пустой профиль).

Кнопка «Играть» ведёт на `GAME_URL`. Для локальной проверки запустите игру
отдельно: `npm run dev` в `Game/`.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `PORT` | `3000` | Порт HTTP-сервера |
| `DB_PATH` | `Server/data/cabinet.sqlite` | Файл SQLite; `:memory:` — без сохранения |
| `CLIENT_DIR` | `../Client` | Каталог статического кабинета |
| `GAME_URL` | `http://localhost:5173/` | Адрес игры для кнопки «Играть» |

База создаётся и заполняется тестовыми данными при первом запуске. Чтобы
сбросить данные, удалите `Server/data/`.

## API

Интерактивная документация: <http://localhost:3000/api/docs> (Swagger UI),
спецификация OpenAPI 3.1: `/api/openapi.json`. Для закрытых маршрутов получите
токен через `POST /api/auth/login` и вставьте его в **Authorize**.

Все ответы — JSON. Закрытые маршруты требуют `Authorization: Bearer <token>`.

| Метод | Путь | Доступ | Ответ |
| --- | --- | --- | --- |
| `GET` | `/api/health` | открыт | `{ ok }` |
| `GET` | `/api/config` | открыт | `{ gameUrl }` |
| `GET` | `/api/docs` | открыт | Swagger UI |
| `GET` | `/api/openapi.json` | открыт | OpenAPI 3.1 |
| `POST` | `/api/auth/login` | открыт | `{ token, expiresAt }`; тело `{ login, password }` |
| `POST` | `/api/auth/logout` | токен | `204` |
| `GET` | `/api/me` | токен | профиль |
| `GET` | `/api/me/achievements` | токен | все достижения, `earnedAt: null` у неполученных |
| `GET` | `/api/me/runs` | токен | история рейсов, новые первыми |
| `GET` | `/api/me/stats` | токен | агрегаты по рейсам и достижениям |

Сессия живёт 7 дней. В БД хранится только SHA-256 токена, пароли — scrypt.

## Проверка

```powershell
npm run verify
```

`verify` = Biome CI + `tsc --noEmit` + тесты `node:test`.
