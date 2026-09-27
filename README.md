# VSM Moscow

Многомодульный проект обучающего симулятора проводника высокоскоростного
поезда. Пользователь работает с личным кабинетом (`Frontend/` + `Backend/`),
видит профиль, статистику и достижения и оттуда запускает игру. Модуль `Game/`
объединяет Browser Game Client и authoritative Game Server. Backend выполняет
роль Platform Server для игры: выдаёт ключ запуска и принимает итог попытки
(`Backend/docs/game-server-contract.md`).

## Карта репозитория

| Путь | Содержимое |
| --- | --- |
| `Game/` | Browser client и Game Server; запуск описан в `Game/README.md` |
| `Game/docs/` | Нормативные требования и рабочие guide модуля Game |
| `Backend/` | API тренажёра (NestJS, Prisma, PostgreSQL); см. `Backend/README.md` |
| `Frontend/` | React-клиент кабинета (React 19 + Vite); запуск описан в `Frontend/README.md` |
| `docs/` | Кросс-проектный workflow и исследования; карта — в `docs/README.md` |
| `deploy/` | Продовый контур: Docker Compose, Caddy — `deploy/README.md` |
| `scripts/` | Релизные проверки и сборка ветки `release` |

Правила участия — в [`CONTRIBUTING.md`](CONTRIBUTING.md), выбор модуля — в
[`AGENTS.md`](AGENTS.md). Каждый модуль самостоятельно определяет
зависимости, команды и проверки; корень связывает модули документацией и CI.

## Локальный запуск для разработки

Нужны Git, Node.js **24** (минимум 22.12) и Docker (для Postgres и Valkey).
Три терминала, все пути от корня репозитория.

**1. Backend** — API на `http://127.0.0.1:3000`, Swagger на `/api/docs`.

```sh
cd Backend
docker compose up -d          # Postgres 18 и Valkey 9
cp .env.example .env          # локальные значения; секреты для dev уже заполнены
npm ci --include=dev
npm run prisma:migrate
npm run prisma:seed           # демо: проводники demo1…demo5, пароль = логин
npm run start:dev
```

**2. Game Server** — игра на `http://127.0.0.1:4174`, связана с Backend.
`PLATFORM_SERVICE_TOKEN` равен `GAME_SERVER_TOKEN` из `Backend/.env`.

```sh
cd Game
npm ci --include=dev
npm run build
PLATFORM_API_URL=http://127.0.0.1:3000 \
PLATFORM_SERVICE_TOKEN=local-dev-game-server-token \
node dist/server/main.mjs
```

Без `PLATFORM_*` Game Server работает автономно (mock Platform): игра
открывается сразу на `http://127.0.0.1:4174` без кабинета, в режиме с
подсказками. Для правок клиента с hot reload — `npm run dev` + `npm run server`
(см. `Game/README.md`).

**3. Frontend** — кабинет на `http://127.0.0.1:5173`, `/api` проксируется на Backend.

```sh
cd Frontend
npm ci --include=dev
npm run dev
```

Войдите как `demo1` / `demo1` и нажмите «Начать смену»: кабинет откроет игру
с одноразовым ключом, после завершения рейса игра вернёт на разбор рейса.
Адрес игры для кнопки задаёт `PUBLIC_GAME_URL` в `Backend/.env`
(по умолчанию `http://127.0.0.1:4174/`).

Проверки модулей: `npm run verify` в `Game/`, `Backend/` и `Frontend/`.

## Релизный запуск в Docker

Весь контур поднимается одним `docker compose` на одном сервере: Caddy
(HTTPS Let's Encrypt), кабинет, Backend, Game Server, Postgres, Valkey.
Снаружи открыты только 80 и 443.

Что нужно:

- сервер с Docker Engine и плагином Compose (`docker compose version`),
  2+ CPU, 4+ ГБ RAM, открытые порты 80/443;
- домен: записи `A @` и `A www` указывают на IP сервера (без этого Caddy не
  получит сертификат);
- копия ветки `release` на сервере.

```sh
git clone -b release <repo-url> /opt/vsm
cd /opt/vsm/deploy
cp .env.example .env
```

Заполните `deploy/.env`. Секреты генерируются командой `openssl rand -hex 32`
(`SEED_ENC_KEY` — ровно 64 hex-символа):

| Переменная | Значение |
| --- | --- |
| `DOMAIN` | домен без схемы, например `wibblywobbly.ru` |
| `POSTGRES_PASSWORD` | пароль базы |
| `JWT_ACCESS_SECRET`, `GAME_TICKET_SECRET` | ≥ 32 символов |
| `GAME_SERVER_TOKEN` | общий секрет Backend ↔ Game Server, ≥ 16 символов |
| `SEED_ENC_KEY`, `EXT_ID_PEPPER` | ключи Backend |
| `GAME_LEVEL_ID` | уровень игры, `vsm-train2-01` |
| `GAME_SESSION_MODE` | `guided` (с подсказками) или `live` |

Запуск:

```sh
docker compose --env-file .env up -d --build
docker compose --env-file .env run --rm seed    # демо-данные, один раз
docker compose --env-file .env ps
curl -fsS https://$DOMAIN/api/health
```

Маршруты: `/` — кабинет, `/api/*` — Backend, `/game/` и `/game-ws` — игра.
Service-to-service ручки `/api/game/*` и `/api/internal/*` снаружи отвечают
404. Миграции базы применяются при каждом старте Backend.

Обновление:

```sh
cd /opt/vsm && git pull --ff-only
cd deploy && docker compose --env-file .env up -d --build
```

Бэкап базы:

```sh
docker compose --env-file .env exec -T postgres pg_dump -U vsm vsm | gzip > vsm-$(date +%F).sql.gz
```

Подробности контура — в [`deploy/README.md`](deploy/README.md).

## Выпуск

`main` — интеграционная ветка, `release` — проверенные снимки для выпуска.
Снимок собирается скриптом из `main` без служебных файлов
(`scripts/release-exclude.txt`):

```sh
scripts/release-check.sh          # чистая установка и verify всех модулей
scripts/make-release.sh 0.1.0     # коммит в release и тег v0.1.0
git push origin release v0.1.0
```
