# Деплой

Известно из постановки: закрытый контур, VPS, сдача в Docker. Неизвестно и
здесь не додумывается: адрес, число машин, наличие ACME, куда заказчик
складывает бэкапы, какая архитектура CPU. Образ собирается под ту платформу,
на которой идёт `docker build`: schema-engine Prisma скачивается postinstall'ом
под неё. Чужой CPU — пересборка или buildx, не копирование `node_modules` с
ноутбука.

В репозитории compose поднимает Postgres 18, Valkey 9 и, по профилю `app`,
только Backend. GameServer, статика игры и SPA в этот compose не входят:
их процессов в модуле Backend нет.

## Вариант A. Compose и один вход

Рекомендуется. Снаружи слушает только Caddy (или другой один прокси).
Postgres, Valkey, Backend и GameServer портов на хост не публикуют.
Статику отдаёт прокси, не Node.

Порядок `handle` важен: `/api/internal` раньше `/api`, `/game-ws` раньше
`/game` и раньше fallback SPA. Caddy проксирует WebSocket без ручных
`Upgrade` и `Connection`. nginx их требует; на один VPS отдельный Traefik
не нужен.

Пример. Имена сервисов — цель контура, не текущий `docker-compose.yml`.
Сертификат файлом: в закрытой сети ACME может не быть. Каталоги `/srv/game`
и `/srv/spa` — артефакты сборки, которые на сервер кладёт выкладка.

```caddyfile
:443 {
	tls /certs/fullchain.pem /certs/privkey.pem

	handle /api/internal/* {
		respond 404
	}

	handle /api/* {
		reverse_proxy backend:3000
	}

	handle /game-ws* {
		reverse_proxy game:3001
	}

	handle /game/* {
		root * /srv/game
		file_server
	}

	handle {
		root * /srv/spa
		try_files {path} /index.html
		file_server
	}
}
```

Backend за Caddy видит адрес контейнера прокси, не клиента. В окружении
сервиса `backend` задайте `TRUST_PROXY` адресом или подсетью Caddy в сети
compose, например `172.28.0.0/16`, если сеть такая, или конкретный IP сервиса
`caddy`. `true` и число хопов не подходят: Fastify 5.12 при числе хопов не
читает `X-Forwarded-For`, и лимит входа 20/мин становится общим. `loopback`
для этого варианта тоже не подходит: Caddy приходит из соседнего контейнера,
не с `127.0.0.1`. Пустое значение оставляет адрес сокета.

`/api/*` уводит на Backend и `/api/docs`, и `/api/openapi.json`. Внутренний
префикс до приложения не доходит. Путь сокета игры — `/game-ws`, как в
контракте v1. `PUBLIC_GAME_WS_URL` должен совпасть с этим URL
(`wss://<хост>/game-ws`). Значение `ws://127.0.0.1:3001/game` из
`.env.example` — локальная заготовка, на прокси его не переносить.

Один процесс GameServer: мир рейса в памяти. Вторая реплика без привязки
клиента к процессу разъедет ревизии. Реплики Backend допустимы: JWT и Redis
общие, Postgres один.

Лимит CPU на процесс симуляции задаётся в compose (`cpus`), отдельно от API.
Образ Postgres в образ приложения не кладётся.

## Вариант B. Один образ и supervisord или s6

Один контейнер: прокси, API, GameServer, статика. Плюс один артефакт и одна
команда `docker run`. Минус для этого продукта: общий рестарт, один
healthcheck не показывает, кто умер, падение симуляции роняет API и
наоборот. Вторая копия симуляции тащит второй толстый образ. Postgres внутрь
того же образа всё равно не кладут, compose для базы остаётся. Получается
два способа запуска вместо одного, без выигрыша по секретам и бэкапам.

Для сдачи и для VPS берётся вариант A.

## Секреты

В образ не копируются. `.dockerignore` отсекает `.env`. На сервере — файл
окружения рядом с compose, права только у пользователя выкладки, не в git.

Обязательные переменные — схема `src/config/env.ts`: `DATABASE_URL`,
`REDIS_URL`, `JWT_ACCESS_SECRET` (от 32 символов), `GAME_TICKET_SECRET`
(от 32), `GAME_SERVER_TOKEN` (от 16), `SEED_ENC_KEY` (64 hex, AES-256-GCM),
`EXT_ID_PEPPER` (от 16), `CORS_ORIGINS`, `PUBLIC_GAME_WS_URL`,
`COOKIE_SECURE`. Пустое значение роняет процесс до `listen` текстом
`Некорректное окружение`.

Значения из `.env.example` только для своей машины. В контуре другие.
`COOKIE_SECURE=true`, `NODE_ENV=production`, `PUBLIC_GAME_WS_URL` на `wss`.
Профиль `app` локального compose не подставляет секреты: без
`JWT_ACCESS_SECRET`, `GAME_TICKET_SECRET`, `GAME_SERVER_TOKEN`, `SEED_ENC_KEY`
и `EXT_ID_PEPPER` в `.env` рядом с compose `docker compose config` останавливается.

Ротация `GAME_SERVER_TOKEN` и секретов JWT — смена env и рестарт Backend и
GameServer. Отдельного менеджера секретов заказчик не называл.

Первый пустой контур: если ADMIN в базе нет, процесс один раз печатает
логин `admin`, случайный пароль и URL. Пароль из лога забирают и меняют
(`mustChangePassword`). Лог после этого не раздают.

## Бэкапы

Дамп с хоста, без остановки записи на время эксперимента:

```sh
docker compose exec -T postgres pg_dump -U vsm -d vsm --format=custom > vsm.dump
```

Куда класть файл и какой срок хранить, постановка не говорит. Минимум —
копия не на том же диске, что том Docker. Восстановление в пустую базу:

```sh
docker compose exec -T postgres pg_restore -U vsm -d vsm --no-owner < vsm.dump
```

`--clean` на живой базе, где уже идут смены, сам по себе не запускать:
он сносит объекты. Тот Valkey, что в dev-compose, рейтинг дублирует в
`SeasonScore`. Потеря Redis после дампа Postgres восстанавливается из этой
таблицы пересборкой ZSET, не из AOF, которого в текущем compose нет.
AOF для контура включается явно, если pub/sub и jti надо переживать рестарт
брокера. Для jti рестарт без AOF значит только то, что непогашенные билеты
двухминутного срока забудутся.

`docker compose down` без `-v` том Postgres не удаляет. `-v` удаляет.

## Обновление

1. Снять дамп.
2. Собрать образ на машине контура (или привезти уже собранный под её CPU).
3. `docker compose up -d`. Entrypoint Backend: `prisma migrate deploy`, затем
   `node dist/main.js`. Миграции только вперёд, из `prisma/migrations`, они
   в git.
4. Дождаться healthy у `/api/health` (Postgres и Redis). Потом смотреть
   логин.

Откат приложения — предыдущий образ. Откат миграции, которая уже применилась,
отдельным down не делается: нужен дамп до шага 3. Seed на проде повторно не
гоняется: `migrate deploy` его не вызывает. Синтетика — для стенда,
`npm run prisma:seed`.

## Локальный профиль app

`docker compose up -d` поднимает Postgres и Valkey, как раньше.
API:

```sh
docker compose --profile app up --build -d
curl -fsS http://127.0.0.1:3000/api/health
docker compose --profile app down
```

Порт хоста `3000` занят профилем. `npm run start:dev` рядом не слушает тот же
порт. `DATABASE_URL` контейнера — `postgres:5432` внутри сети compose, не
`127.0.0.1` из `.env` разработчика. Пароль `vsm` у сервиса `postgres` — только
эта dev-база.

Образ: multi-stage `node:24-bookworm-slim`, пользователь `node`, в runtime
зависимости production и CLI `prisma` (он нужен `migrate deploy` и в
`dependencies` приложения не входит). Каталог `content/` копируется в образ.
`GET /api/health` — HEALTHCHECK.
