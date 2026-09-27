# Контракт Backend как Platform Server

Backend принимает два вызова Game Server: разрешить ключ запуска и записать
итог попытки. Игровой WebSocket, кадры и симуляция здесь не описываются.
Норматив стороны Game — [`platform-contract.md`](../../Game/docs/user/architecture/platform-contract.md)
и [`platform-openapi.yaml`](../../Game/docs/user/api/platform-openapi.yaml).
Клиент, который ходит в эти ручки, — `Game/src/server/platform-gateway.ts`.
Он читает у ошибки только HTTP-статус, тело не разбирает.

`contractVersion` ответа — `1`. Успех — `200`. Тело ошибки остаётся
`application/problem+json` (`type`, `title`, `status`, `detail`, `code`,
у Zod ещё `errors[]`). Код в `code` стабильный.

## Запуск смены

1. Кабинет: `POST /api/v1/game-sessions` (cookie `vsm_access`). Ответ
   `OpenedSessionDto`: прежние `sessionId`, `ticket`, `wsUrl`, `seedCommit`,
   `plan` и новое `launchUrl`.
2. `launchUrl` — `PUBLIC_GAME_URL` плюс query `sessionKey=<ticket>`
   (`URL.searchParams`, билет закодирован). Браузер открывает клиент Game.
3. Клиент Game читает `sessionKey` и передаёт его Game Server в hello.
4. Game Server: `POST /api/game/sessions/resolve` с этим ключом.
5. Игра идёт на Game Server. По ходу Backend не вызывается.
6. Финал: `POST /api/game/sessions/{attemptId}/finish`.
7. В ответе `redirectUrl` = `{PUBLIC_APP_URL}/runs/{runId}`. Клиент уходит
   на страницу рейса кабинета. `resultId` — это `runId`.

`wsUrl` в ответе кабинета остаётся. `PUBLIC_GAME_WS_URL` — legacy, из env
не убран. Новый клиент Game на него не опирается.

Билет — JWT `GAME_TICKET_SECRET`, `iss=vsm-backend`, `aud=vsm-game`,
`sub` = userId, `sid` = id `GameSession`, `jti`, срок `TICKET_TTL_SEC`
(2 минуты). Повторный `POST /api/v1/game-sessions` на открытую смену
(`PENDING` или `ACTIVE`) отдаёт ту же сессию и новый билет. После рестарта
Game Server повторный resolve с новым билетом проходит.

## Аутентификация сервиса

```http
Authorization: Bearer <GAME_SERVER_TOKEN>
```

На Game это `PLATFORM_SERVICE_TOKEN`. Сравнение — `tokenEquals` (SHA-256 и
`timingSafeEqual`). Нет заголовка, не `Bearer` или чужой секрет — `401`,
код `INVALID_PLATFORM_TOKEN`.

`401` и `403` только про credential Game Server. Битый пользовательский ключ
не даёт `401`.

`X-Service-Token` не принимается. Сервисный секрет только Bearer.

Ручки вне версии URI: контроллер `version: VERSION_NEUTRAL`, глобальный
префикс `/api`. Итого точно:

- `POST /api/game/sessions/resolve`
- `POST /api/game/sessions/{attemptId}/finish`

Тело — strict object (`additionalProperties: false`). Невалидное тело этих
ручек — `400`, код `invalid-body`, не `422`. Глобальный pipe Nest на
остальных ручках по-прежнему становится `422`.

## `POST /api/game/sessions/resolve`

Тело: `{ "key": "<jwt>" }`.

| Условие | Статус | `code` |
| --- | --- | --- |
| Подпись, issuer, audience или claims не сошлись | 404 | `invalid-session` |
| JWT истёк | 410 | `session-expired` |
| `jti` уже погашен | 410 | `session-consumed` |
| Сессии нет или `sub` билета не равен `session.userId` | 404 | `invalid-session` |
| `transport = REST` | 409 | `session-unavailable` |
| Статус не `PENDING` и не `ACTIVE` (`COMPLETED`, `ABORTED`, `EXPIRED`) | 409 | `session-unavailable` |
| Иначе | 200 | — |

Погашение — Redis `SET NX` (`vsm:ticket:<jti>`). Повторный `jti`
ставит флаг `ticket-reused`. Истёкший и битый JWT не
гасятся. Сначала проверка билета, потом сессия: чужой `sid` с живой подписью
билет всё равно сжигает.

Успех гасит `jti`, переводит `PENDING` → `ACTIVE` (уже `ACTIVE` не трогает)
и отвечает:

```json
{
  "contractVersion": 1,
  "attemptId": "<GameSession.id>",
  "gameLevelId": "<GAME_LEVEL_ID>",
  "mode": {
    "kind": "guided",
    "hints": { "immediateFeedback": true, "suggestions": true, "highlights": true, "explanations": true }
  }
}
```

`gameLevelId` Backend не резолвит в контент. Его читает Game Server.
Guided и replay в этом адаптере не выдаются.

## `POST /api/game/sessions/{attemptId}/finish`

`attemptId` пути обязан совпасть с телом, иначе `400`, код `attempt-mismatch`.
Тело — `FinishedGameResult`. `userInputs` — `unknown[]`, пишется как пришло,
не интерпретируется.

| Условие | Статус | `code` |
| --- | --- | --- |
| Тело не по схеме или путь ≠ тело | 400 | `invalid-body` или `attempt-mismatch` |
| Сессии нет, id не uuid, или `transport = REST` | 404 | `attempt-not-found` |
| `ACTIVE` | 200 | запись |
| `COMPLETED`, sha256 канонического JSON совпал | 200 | тот же чек |
| `COMPLETED`, хеш другой | 409 | `result-conflict`, запись не затирается |
| `PENDING`, `ABORTED`, `EXPIRED` | 404 | `attempt-not-found` |

Запись: транзакция `updateMany` где
`status = ACTIVE` → `COMPLETED`, аудит `session.completed` от
`GAME_SERVER`. Проигравший гонку читает уже сохранённый чек. Победитель
шлёт `run.completed`. Если строки `run` ещё нет (процесс умер между commit
и событием), повтор с тем же хешем шлёт `run.completed` один раз.
`RunRecorder` по `sessionId` второй рейс не создаёт. Когда строка `run`
уже есть, повтор событие не шлёт.

Хеш — SHA-256 канонического JSON: ключи объектов по алфавиту, порядок
массива сохраняется. Лежит в `GameSession.result` рядом с прежней формой,
отдельной миграции нет:

```json
{
  "runId": "<uuid>",
  "suspicious": false,
  "summary": {},
  "platform": {
    "payloadSha256": "<hex>",
    "result": {}
  }
}
```

`result` внутри `platform` — сырой `FinishedGameResult`, включая id ачивок
игры. Эти id в ачивки Backend не мапятся: Backend считает свои по `summary`.

Ответ:

```json
{
  "contractVersion": 1,
  "resultId": "<runId>",
  "redirectUrl": "http://127.0.0.1:5173/runs/<runId>"
}
```

Хвостовой слэш `PUBLIC_APP_URL` не удваивает слэш. Query и hash базы в
редирект не входят.

Поезд, маршрут, вагон и `playSeconds` в рейс берёт `RunRecorder` из сессии,
как для отчёта legacy. `startedAt` ставит активация `PENDING`.

## `FinishedGameResult` → `RunSummary`

Чистое отображение, без Nest. Без `assessment` журнал пуст. С полем —
раздел «Оценочные факты». Шкалы и `outcome` из фактов заново не считаются.

| Поле `RunSummary` | Откуда |
| --- | --- |
| `safety` | `clamp(scores.safety)`, затем целое |
| `loyalty` | `clamp(scores.customerSatisfaction)`, затем целое |
| `politeness` | `politenessOf(loyalty, [], [])` |
| `outcome` | Если `safety` после clamp и округления `< 30` (`FINISH_FAIL_SAFETY`, тот же порог, что `gates.failIf.safety.lt` и `rules.failScore`) → `terminated`. Иначе `route-completed` → `completed`. Иначе `terminal-rule` и `outcomeId = route-safely-interrupted` → `completed`. Любой другой `terminal-rule` (`wagon-unserviceable`, `wagon-unsalvageable`, неизвестный id) → `incident` |
| `decisions` | `[]`, если `assessment` нет |
| `competencyDelta` | `{}`, если `assessment` нет |
| `timeouts`, `reactionAvgMs` | `0`, если `assessment` нет |
| `facts.prevented`, `facts.complaints` | `0`, если `assessment` нет |
| `facts.incidents` | `1`, если `assessment` нет и `outcome = incident`, иначе `0` |
| `facts.interventions` | `1`, если `assessment` нет и `outcomeId = route-safely-interrupted`, иначе `0` |

Сначала шкала: `safety` ниже 30 даёт `terminated` при любом `termination`.
Иначе `route-completed` не смотрит на `outcomeId`. Без `assessment`
`interventions` смотрит только на `outcomeId`, в том числе когда низкая шкала
уже дала `terminated`. С `assessment` счётчики `facts` берутся из фактов,
даже если все нули.

## Оценочные факты (`assessment`)

Необязательное поле `FinishedGameResult`. Тело без него принимается как раньше.
`contractVersion` остаётся `1`.

Контракт на стороне Game —
[`platform-contract.md`](../../Game/docs/user/architecture/platform-contract.md).
Поле туда допишет команда Game. Порядок выката: сначала Backend принимает
`assessment`, затем Game начинает его слать.

`kind` — непустая строка. Известные виды мапятся по таблицам. Неизвестный вид
принимается: этап `enroute`, текст «Событие рейса» / «Факт зафиксирован»,
без дельты компетенций. `verdict` — только `correct | late | incorrect | missed`.
`detail` — плоский объект JSON-примитивов. В теле не больше 500 фактов.

| `kind` | `stage` | компетенции |
| --- | --- | --- |
| `journal-submission` | `acceptance` | `procedure`, `detection` |
| `boarding-decision` | `boarding` | `procedure`, `safety` |
| `service-request` | `enroute` | `service` |
| `fire` | `enroute` | `safety`, `reaction` |
| `pressure` | `enroute` | `safety`, `reaction`, `escalation` |
| `emergency-brake` | `enroute` | `safety`, `escalation` |
| прочий | `enroute` | нет |

| `verdict` Game | `Verdict` | величина на каждую компетенцию вида |
| --- | --- | --- |
| `correct` | `best` | +2 |
| `late` | `ok` | +1 |
| `incorrect` | `worse` | −1 |
| `missed` | `missed` | −2 |

Сумма по фактам копится как `addSkills`: отдельного потолка нет.

| Поле `JournalEntry` | Откуда |
| --- | --- |
| `scenarioId` | `content.gameLevelId` |
| `nodeId` | `id` факта |
| `choiceId` | `kind` |
| `safetyDelta`, `loyaltyDelta` | `scoreDelta.safety`, `scoreDelta.customerSatisfaction`, округление до целого |
| `reactionMs` | `round(reactionUs / 1000)`. Поля нет — `null` |
| `timerSec` | `null` |
| `gameTime` | `at` (микросекунды симуляции от старта попытки) как `HH:MM`, тот же `formatClock` |
| `situation`, `action` | короткий русский текст по виду и `detail`. Номера пунктов не выдумываются |
| `better` | короткая подсказка для `incorrect` и `missed`, иначе `null`. Ложная отметка в журнале: «Отмечать неисправность только после проверки оборудования» |
| `basis`, `consequence` | `null` |
| `lucky`, `deviation` | `false` |

`timeouts` — число фактов с вердиктом `missed`. `reactionAvgMs` — среднее
заданных `reactionMs`, `0` если таких нет.

| `facts` при наличии `assessment` | Откуда |
| --- | --- |
| `incidents` | `fire` и `pressure`, у которых `detail.critical === true` |
| `prevented` | `fire` и `pressure` с `verdict = correct` |
| `interventions` | `emergency-brake` с `detail.activated === true` |
| `complaints` | `service-request` с `verdict = missed` |

`RunRecorder` пишет `summary.decisions` в `RunDecision`. Дольше 80 решений
итог помечается подозрительным и режется до 80:
это прежний потолок смены, не отдельное правило фактов.

## Переменные

| Переменная | Смысл |
| --- | --- |
| `GAME_SERVER_TOKEN` | Секрет Bearer. На Game — `PLATFORM_SERVICE_TOKEN`. Минимум 16 символов |
| `PUBLIC_GAME_URL` | Абсолютный `http://` или `https://` клиента Game. По умолчанию `http://127.0.0.1:4174/` |
| `PUBLIC_APP_URL` | Абсолютный `http://` или `https://` кабинета. По умолчанию `http://127.0.0.1:5173`. Хвост слэша допустим |
| `GAME_LEVEL_ID` | Строка уровня для resolve. Пусто — `vsm-train2-01` |
| `GAME_SESSION_MODE` | `guided` (по умолчанию: Game Server выдаёт подсказки) или `live` (без подсказок) |
| `PUBLIC_GAME_WS_URL` | Legacy `wsUrl` в ответе кабинета. Не удалять |

`ws://` для `PUBLIC_GAME_URL` и `PUBLIC_APP_URL` не принимается.

## Локально

Backend на порту 3000 (из `Backend/`):

```sh
npm run start:dev
```

Game Server (из `Game/`):

```sh
PLATFORM_API_URL=http://127.0.0.1:3000 \
PLATFORM_SERVICE_TOKEN=<GAME_SERVER_TOKEN> \
npm run build && node dist/server/main.mjs
```

`<GAME_SERVER_TOKEN>` — значение из `Backend/.env`. Кабинет — dev-сервер
`Frontend/`. `PUBLIC_GAME_URL` должен указывать на URL, который открывает
этот клиент. `PUBLIC_APP_URL` — на кабинет.

## Ограничения

- Без `assessment` решений по ходам нет: `RunDecision` пустой,
  `competencyDelta` пустой. С `assessment` факты становятся решениями.
  `userInputs` Backend не разбирает.
- Id ачивок Game в каталог Backend не входят. Они остаются в сыром `result`.
- `resolve` продлевает попытку до `GAME_ATTEMPT_TTL_MS` (3 часа от запуска):
  `expiresAt` становится `now + 3 ч`, только если новый срок позже текущего.
  Повторный resolve `ACTIVE` продлевает снова. Крон по-прежнему переводит в
  `EXPIRED` попытки, которые Game не завершил; finish после этого — `404`.
- Прокси снаружи не публикует `/api/game/*`. Иначе Bearer Game Server торчит
  в интернет. См. `docs/deploy.md`.
