# Контракт Backend и GameServer

Черновик для команды игры. Пространственный WebSocket уже есть, этот документ
его не заменяет и не вводит второй игровой протокол.

Источник типов: `Game/src/client/protocol.ts`, `PROTOCOL_VERSION = 1`
(ветка `origin/main`). Текст кадров: `Game/docs/agent/game-websocket-contract.md`.
Dev-стенд: `Game/dev/demo-server.ts`, путь `/game-ws`. Стенд без
аутентификации и в production-сборку не входит.

## Что остаётся протоколом v1

Клиент после `open` шлёт `hello`. Дальше `command` и при пропуске ревизии
`resync`. Сервер отвечает `snapshot`, `delta`, `ack`, `reject`.

Команды клиента: `move-zone`, `inspect`, `interact`, `talk`,
`dialogue-choice`, `take-item`, `use-item`, `report`, `complete-task`,
`finish`. `dev-control` только у стенда. В проде GameServer эту команду не
принимает.

Кадр не содержит путь, пиксели, скрытую сетку, RNG, точные баллы до раскрытия
и серверный журнал. `metrics` и `debrief` — числа и строки, которые уже
посчитал сервер симуляции. Клиент их не выводит сам.

Ревизия дельты строго `+1`. Повтор `requestId` мир второй раз не применяет.
Неподтверждённые команды после обрыва клиент не переигрывает: новый `snapshot`
снимает расхождение.

Конверт `{v, type, seq}` поверх этого не добавляется. Версия кадра —
поле `protocolVersion`. Чужая версия — `reject`, сокет можно закрыть.

## Что добавляет Backend

### Куда подключаться

Путь сокета, который уже зашит в клиент, — `/game-ws`. Адрес сборки: мета
`game-websocket` или `VITE_GAME_WS_URL`.

`PUBLIC_GAME_WS_URL` в env Backend — строка, которую кабинет отдаёт кнопке
«Играть». В `.env.example` сейчас `ws://127.0.0.1:3001/game`. Это не путь
контракта v1. В проде переменная должна указывать на тот же `/game-ws`,
который проксирует Caddy. Пока значения расходятся, команда игры ориентируется
на `/game-ws`, не на суффикс `/game` из примера env.

Только `wss://` снаружи. Билет в query не передаётся: он осядет в access-log
прокси. Заголовок `Sec-WebSocket-Protocol` как переноска секрета не
используется.

### Билет на hello

Кнопка «Играть»: `POST /api/v1/game-sessions` (cookie `vsm_access`).
Backend создаёт `GameSession`, подписывает JWT билета секретом
`GAME_TICKET_SECRET`:

- `iss`: `vsm-backend`
- `aud`: `vsm-game`
- `sub`: userId
- `sid`: sessionId
- `jti`: уникальный id
- `exp`: 2 минуты

Ответ: `{sessionId, ticket, wsUrl, seedCommit, plan}`. План — публичная часть
смены (поезд, маршрут, вагон, класс, список сценариев без эффектов).
`seedCommit` — hex SHA-256 серверного seed. Сам seed в этот ответ не входит.

Та же выдача ставит cookie `vsm_game`: HttpOnly, SameSite=Strict, Path=`/game`,
Secure при `COOKIE_SECURE=true`. Access-JWT кабинета в сокет не кладётся.

Ограничение cookie. По RFC 6265 путь `/game` совпадает с `/game` и `/game/...`,
но не с `/game-ws`: следующий символ после `/game` — `-`, не `/`. Браузер не
отправит `vsm_game` на `/game-ws`, пока Path не покрывает этот URL. Надёжный
канал, который не зависит от Path, — поле `ticket` в первом `hello`. Cookie
имеет смысл, если Path выставлен так, что браузер реально пошлёт её на
`/game-ws` (например Path=`/game-ws`). SPEC §6 пишет Path=`/game`; из-за
расхождения с `/game-ws` GameServer обязан принимать поле `ticket`.

Первый кадр клиента:

```json
{"type":"hello","protocolVersion":1,"ticket":"<jwt>"}
```

`sessionId` в этом hello — по правилам v1, если клиент восстанавливает сессию.
Поля сверх v1 старый стенд может не знать; production GameServer поле `ticket`
читает.

Порядок проверки:

1. Нет ни cookie `vsm_game`, ни `hello.ticket` — сокет не принимает `command`.
   Ждать hello дольше 5 секунд не нужно, соединение закрывается.
2. Подпись, `aud`, `exp`. Секрет тот же `GAME_TICKET_SECRET`, алгоритм HS256.
3. Погашение одним местом: `POST /api/internal/v1/tickets/verify`.
   Backend делает `SET vsm:ticket:<jti> NX EX` на остаток жизни билета.
   Ключ уже есть — билет потрачен, verify отвечает отказом.
   GameServer сам этот ключ не пишет: иначе verify увидит повтор.
   Локальная проверка подписи до HTTP допустима, погашение — только verify
   (или только SET на стороне GameServer, если HTTP verify не вызывается).
   Оба способа вместе не используются.
4. Неверный сервисный токен, просрочка и повтор снаружи не различаются текстом.
   Ответ problem+json, статус 401.
5. Origin браузера сверяется со списком `CORS_ORIGINS`. Нет Origin у
   не-браузера — решение GameServer, запрос с чужим Origin не принимается.

Успешный verify:

```json
{"userId":"...","sessionId":"...","plan":{}}
```

Дальше сокет привязан к `sessionId`. Билет на каждый `command` не перечитывается.

### Internal HTTP

Префикс `/api/internal/v1`. Глобальный префикс приложения уже `/api`
(`src/main.ts`, `configure-app.ts`). Снаружи прокси на этот префикс отвечает
404, в обход Backend. Заголовок на каждом вызове: `X-Service-Token`,
значение `GAME_SERVER_TOKEN`, сравнение постоянного времени.

| Метод и путь | Зачем |
| --- | --- |
| `POST /api/internal/v1/tickets/verify` | Подпись и погашение билета. Тело `{ticket}`. |
| `POST /api/internal/v1/game-sessions/:id/decisions` | Ход смены `transport=WS`. REST-смена — 409 `WRONG_TRANSPORT`. |
| `POST /api/internal/v1/game-sessions/:id/events` | Пачка телеметрии в `game_telemetry`. `seq` не общий с ходами. |
| `POST /api/internal/v1/game-sessions/:id/complete` | Финал диалогового движка, если отчёта симуляции нет. |
| `POST /api/internal/v1/game-sessions/:id/report` | `RunReport` v1 пространственной симуляции. |

`decisions`: `{seq, choiceId, clientTs?}`. Ручка internal принимает только
смену `transport=WS`. Смена `REST` — 409 `WRONG_TRANSPORT`. Ход кабинета
`POST /api/v1/game-sessions/:id/decisions` — только `transport=REST`, иначе
тот же 409. `seq` равен ожидаемому ходу, не номеру телеметрии. Повтор того
же `seq` и `choiceId` возвращает прежний ответ и `step()` не вызывает. Иной
`seq` — 409 `SEQ_MISMATCH` и информационный флаг `seq-jump`. Сервер сравнивает
свои часы с `nodeDeadlineAt`, допуск 500 мс. Позже — вход `timeout`, не
HTTP-ошибка. `clientTs` — метка журнала; больше 8.64e15 мс — 422. Выбор с
невыполненным `requires` — 422 `CHOICE_NOT_AVAILABLE`. В ответе `view`: текст,
доступные ходы, таймер, шкалы. Эффектов, вердикта и `better` нет. Просроченный
дедлайн на `GET /api/v1/game-sessions/:id` сервер закрывает сам только у
`REST`. У `WS` GET показывает узел, timeout присылает GameServer ходом.

`events`: массив `{seq, type, payload, clientAt?}`. Пишется в `game_telemetry`.
Уникальность `(sessionId, seq)` внутри телеметрии, не вместе с ходами.
Нумерация своя: событие `seq=1` и ход `seq=1` — разные ряды, телеметрия
не даёт ходу 409 `SEQ_MISMATCH`. `serverAt` ставит Backend. Журнал решений
остаётся в `game_event` (`type=decision`). Это не начисление очков.

`complete` и `report` принимаются для сессии `ACTIVE`, один раз.
Повтор по тому же `sessionId` — тот же результат, без второго
`run.completed`.

### RunReport v1

`POST /api/internal/v1/game-sessions/:id/report`:

```json
{
  "contractVersion": 1,
  "protocolVersion": 1,
  "scenarioId": "pressure",
  "simulationSeconds": 40,
  "outcome": "completed",
  "outcomeNote": "Неисправность доложена",
  "safety": 89,
  "loyalty": 87,
  "facts": {
    "prevented": 1,
    "incidents": 0,
    "complaints": 0,
    "interventions": 0
  },
  "decisions": [],
  "checks": []
}
```

`decisions[]`: `id`, `time`, `stage`, `situation?`, `action?`, `verdict`,
`safety`, `loyalty`, `reactionSec?`, `lucky?`, `consequence?`, `better?`,
`basis?`.

`checks[]`: `id`, `detected`, `reportRequired`, `reported`, `actionCorrect`,
`consequenceRolled`.

Маппинг вердиктов симуляции в `Verdict` Backend:

| В отчёте игры | В Backend |
| --- | --- |
| `correct` | `best` |
| `late` | `ok` |
| `incorrect` | `worse` |
| `missed` | `missed` |

Фазы кадра v1 → `Stage`:

| Фаза snapshot | Stage |
| --- | --- |
| `boarding` | `boarding` |
| `ride` | `enroute` |

`finished` стадией не является: это конец сессии, не этап смены.
Для `acceptance`, `stop`, `handover` маппинга из протокола v1 нет — этих фаз
в snapshot нет. Если отчёт их присылает уже как `Stage` Backend, они
проходят как есть.

`outcome` отчёта: `completed`, `incident`, `terminated`.

Backend собирает из отчёта `RunSummary` и публикует `run.completed`.
Очки, ачивки и компетенции считает он. Поле с кодами ачивок, если его
пришлют, игнорируется. Числа `safety` и `loyalty` из отчёта — вход
нормализации, не готовый `PointLedger`.

Итог рейса по-прежнему не принимается от браузера. Только этот маршрут и
только с сервисным токеном.

### Redis

Канал `vsm:game:<sessionId>`. Издатель — Backend, подписчик — GameServer.

Черновик кадра отмены:

```json
{"type":"abort","sessionId":"..."}
```

Других типов канал пока не несёт. История не хранится. Для итога рейса канал
не используется: итог — HTTP `report` или `complete`, с ретраем на стороне
GameServer. Пока HTTP не ответил успехом, отчёт не считается сданным.

Ключ билета `vsm:ticket:<jti>` живёт до `exp` и только как отметка «уже
погашен».

### Реконнект и таймауты

Пока процесс GameServer жив, повторное соединение — обычный v1 `hello` с тем
же `sessionId`. Сервер отдаёт snapshot текущего мира. Новый билет не нужен:
сокет уже был привязан, а jti тратить второй раз нельзя. Неподтверждённые
`command` клиент не шлёт заново.

Если процесс GameServer перезапущен, память мира пропала. Погашенный билет
verify не примет. Повторный `POST /api/v1/game-sessions` вторую смену не
открывает: возвращается уже открытая и подписывается новый билет. В аудит
пишется `session.resumed`, флаг античита не ставится. Старый jti остаётся
погашенным.

Диалоговый дедлайн — часы Backend. Дедлайны задач симуляции (`softDeadline`,
`hardDeadline`) — игровые секунды GameServer, клиент их не администрирует.
Пропуск жёсткого дедлайна переводит задачу в fail на сервере симуляции, как
на стенде.

### Чего GameServer не делает

- Не пишет Postgres и не вызывает `ZINCRBY`.
- Не считает очки, уровень, ачивки, грейд.
- Не верит `safety` / `loyalty` / баллам из кадра клиента. В v1 клиент их и
  не шлёт.
- Не кладёт seed диалогового движка в snapshot. Seed смены остаётся в Backend.
- Не публикует итог в pub/sub.

Один процесс GameServer на контур: мир в памяти, вторая реплика без
привязки сокета разойдётся с ревизиями.
