# Продовый контур VSM Moscow

Один сервер, Docker Compose, один домен. Снаружи слушает только Caddy
(80/443, сертификат Let's Encrypt). Postgres, Valkey, Backend и Game Server
портов на хост не публикуют.

| Путь | Куда |
| --- | --- |
| `/` | кабинет (`Frontend/`, статика в образе Caddy) |
| `/api/*` | Backend |
| `/game/`, `/game-ws` | Game Server: браузерный клиент и WebSocket |
| `/api/game/*`, `/api/internal/*` | 404 снаружи; контракт Game ↔ Backend ходит внутри сети compose |

Game Server обращается к Backend по `http://backend:3000` с `Bearer`
`GAME_SERVER_TOKEN` (см. `Backend/docs/game-server-contract.md`).
Кнопка «Начать смену» ведёт на `https://<DOMAIN>/game/?sessionKey=…`.

## Первый запуск

DNS: записи `A @` и `A www` домена указывают на IP сервера, иначе Caddy не
получит сертификат.

```sh
git clone <repo> /opt/vsm && cd /opt/vsm/deploy
cp .env.example .env   # заполнить секреты: openssl rand -hex 32
docker compose --env-file .env up -d --build
docker compose --env-file .env run --rm seed   # демо-данные, один раз
```

Миграции Prisma применяет entrypoint Backend при каждом старте.

## Обновление

```sh
cd /opt/vsm && git pull --ff-only
cd deploy && docker compose --env-file .env up -d --build
```

## Проверка

```sh
docker compose --env-file .env ps
curl -fsS https://<DOMAIN>/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/api/game/sessions/resolve   # 404
```

## Бэкап

Данные — в томах `vsm_postgres` и `vsm_valkey`. Дамп базы:

```sh
docker compose --env-file .env exec -T postgres pg_dump -U vsm vsm | gzip > vsm-$(date +%F).sql.gz
```
