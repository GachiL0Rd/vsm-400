# Взаимодействие клиента, игрового сервера и Platform Server

**Версия документа:** 0.5.0
**Статус:** Draft
**Дата редакции:** 2026-09-27

## 1. Область документа

Документ определяет границу Browser Client, Game Server и внешнего Platform Server. Он описывает архитектурную границу и baseline extension points; обязательные возможности конкретного выпуска определяются `../release-scope-0.1.0.md`.

Детальный Browser ↔ Game Server wire contract зафиксирован в [`../api/websocket-protocol.md`](../api/websocket-protocol.md). HTTP/service contract Platform Server вынесен в `architecture/platform-contract.md` и [`../api/platform-openapi.yaml`](../api/platform-openapi.yaml). Режимы live/guided/replay — в `architecture/session-modes.md`.

## 2. Ответственность компонентов

### Platform Server

Отвечает за:

- пользовательскую авторизацию;
- меню/профиль/историю;
- создание и идентификацию попытки;
- выдачу `SessionKey`;
- назначение `gameLevelId` и режима сессии;
- постоянное хранение результата;
- страницу результата и redirect после finish.

### Game Server

Отвечает за:

- lifecycle одной игровой попытки;
- разрешение `SessionKey` через Platform Server;
- загрузку локального game config по `gameLevelId`;
- authoritative simulation;
- режим сессии и input policy;
- WebSocket protocol;
- public projection/serialization gate;
- deterministic replay;
- assessment и achievements;
- baseline coaching observers/presentation extensions;
- финализацию результата через Platform Server.

Game Server не реализует меню и постоянную профильную бизнес-логику.

### Game Client

Отвечает за:

- input;
- отображение public presentation state/events;
- interpolation;
- локальное UI-state;
- mode-specific UI для доступных session capabilities (в baseline — guided hints и расширенные replay controls);
- reconnect.

Client не содержит authoritative domain logic.

## 3. Session startup

Предпочтительный flow:

```text
Browser --authenticated request--> Platform Server
Browser <--SessionKey------------- Platform Server
Browser --WebSocket--------------> Game Server
Browser --hello(SessionKey)------> Game Server
Game Server --resolveSession-----> Platform Server
Game Server <--attempt + level + mode-- Platform Server
Game Server --load local config--> Content Registry
Game Server --session-ready + ResumeToken--> Browser
```

Game Server получает внешний `gameLevelId`; полный config хранится и версионируется на стороне Game Server/content bundle.

После первичной platform validation Game Server может выдать собственный короткоживущий `ResumeToken`, привязанный к `attemptId` и текущему worker. Он используется только для reconnect в пределах grace period и не заменяет Platform SessionKey для нового запуска. Конкретная реализация токена остаётся transport detail.

## 4. GameAttempt и WebSocket — разные lifecycle

Simulation worker принадлежит попытке, а не соединению.

```text
GameAttempt
   └── GameSessionWorker
          ├── Simulation
          ├── event queue / clock
          ├── mode policy
          ├── feedback observers
          ├── public projection
          └── attached connection?
```

Attempt state:

```text
initializing -> active <-> paused -> finishing -> finished
                            \-> aborted
```

Connection state ортогонален:

```text
attached / detached
```

## 5. Disconnect/reconnect

При потере WebSocket:

1. connection становится detached;
2. короткий debounce переживает краткий сетевой сбой;
3. после debounce simulation может перейти в paused;
4. сохранённый `ResumeToken` получает expiry относительно disconnect (`debounce + reconnect grace`), а не относительно момента первоначального подключения;
5. worker сохраняется на reconnect grace;
6. новый socket предъявляет валидный `ResumeToken` (или проходит повторную platform validation, если transport implementation выбрала этот путь);
7. socket attach к той же попытке и получает новый rotated token;
8. client получает актуальный snapshot;
9. session продолжает работу.

Точные интервалы являются runtime config.

## 6. Serialization gate

Simulation state никогда не сериализуется напрямую.

```text
SimulationState
    ↓ explicit projection
PublicPresentationState
    ↓ mode extensions
Wire DTO
    ↓ serializer
WebSocket
```

Обратно:

```text
WebSocket
    ↓ deserialize/schema validation
ClientCommand
    ↓ SessionMode InputPolicy
    ↓ semantic validation
Simulation / Replay controller
```

## 7. Server → Client

Protocol разделяет долговечное presentation state, transient presentation events и request/response.

### 7.1. Durable state

`snapshot` и `delta` описывают состояние, которое должно сохраняться до следующего изменения. Protocol v1 не определяет `delta-batch`:

```text
entity position / motion
held item
active regions
world objects and observable object state
current time scale / session state
persistent modal/view data при необходимости
```

Server не должен отправлять императивное `move sprite X`; он меняет public motion/state, а Client интерполирует его.

### 7.2. Transient presentation events

Кратковременные эффекты передаются отдельными events:

```text
speech bubble show/hide
guided hint (baseline/deferred в release 0.1.0)
notification
short-lived visual/audio effect
optional open/focus presentation request
```

Они не являются authoritative simulation events. Release `0.1.0` эмитит `speech` из content, `notification` публичной смены фазы и `achievement-unlocked` при завершении попытки. `hint` остаётся deferred.

### 7.3. Request/response

Некоторые операции удобнее моделировать как запрос клиента к серверу, а не как постоянно публикуемое состояние. Текущий release-пример — запрос доступных действий после клика по объекту/сущности.

```text
Client:  query-actions(requestId, targetId)
Server:  action-offer(requestId, targetId, revision, actions[])
Client:  invoke-action(actionHandle, optionalInput)
Server:  command-result + subsequent state diff/events
```

`actionHandle` opaque и повторно проверяется при invoke против текущего simulation state. Offer может стать невалидным не только после изменения public revision, но и после скрытого authoritative state transition.

Internal simulation events автоматически наружу не передаются.

## 8. Hint events

Protocol предусматривает transient `hint` events для guided mode. Release `0.1.0` server их пока не генерирует; это baseline/deferred capability. Они являются presentation output, а не state mutation.

## 9. Replay extensions

Replay использует тот же базовый presentation stream, но может получать расширения:

```text
hidden trait state
action logits/decision explanation
assessment marker
additional debug state
```

Обычный live mode эти extensions не получает.


## 9.1. Client asset registry

Визуальные ассеты персонажей, предметов, документов и модалок могут храниться целиком на стороне клиента.

Game Server передаёт только стабильные public visual IDs и runtime state. В release `0.1.0` public entity использует `appearanceId`, а held item — отдельный `visualId`; layered appearance (`bodyId`, `clothingIds` и т.п.) остаётся deferred до фиксации клиентского контракта. Остальные presentation values могут включать состояния форм/приборов и modal document fields.

Client разрешает эти IDs через локальный asset registry и композитит слои. Локальность изображения не делает соответствующее состояние client-authoritative.

Один simulation object может иметь несколько presentation forms (`world`, `held`, `modal`) без дублирования domain entity.

## 9.2. Client world

Клиент не держит свою сетку и не считает маршрут. Публичная клетка `(x, y)` рисуется на тайле `(x, y)` размером 64×64. Для `vsm-train2-01` это конечная карта `train2-long.map.json`, собранная из `assets/map/train2-long.tmx`; origin берётся из свойств карты `originX` / `originY`. Уровень без префикса `map.train2-long` получает квадрат на каждую публичную клетку, origin — минимум координат. Клик по клетке отправляет один `move-to` с id этой клетки. Сервер сам строит путь и публикует `moving` по рёбрам.

## 10. Client → Server intents

Release `0.1.0` client input сводится к небольшому набору intent/request сообщений:

```text
move-to(final target cell; Server owns pathfinding and intermediate edge traversal)
query-actions(target)
invoke-action(actionHandle, optionalInput)
set-time-scale(requestedScale)
resync
```

В replay mode `set-time-scale` выполняет роль текущего playback control. Seek/inspect и дополнительные replay-команды остаются baseline/deferred.

Клик по объекту сам по себе не выполняет доменное действие: он может только запросить доступные server actions.

Client не посылает команды вида `give-item-state`, `remove-scene-object` или `move-NPC`: это Server → Client public state changes.

Mode-specific commands проходят через отдельную input policy.

## 11. Input time

Authoritative timestamp назначает Game Server по моменту получения команды относительно simulation clock.

Client timestamp допускается только как telemetry.

Input может попадать внутрь processing interval с subtick precision.

## 12. Revisions/resync

Public state имеет монотонную revision.

Первая реализация не требует delta ring buffer. При reconnect или серьёзном рассогласовании отправляется snapshot.

Ring buffer можно добавить позднее как optimization.

## 13. Slow client

Client lag не замедляет authoritative simulation.

Допустимо:

- объединять presentation updates;
- пропускать устаревшие визуальные промежуточные состояния;
- отправлять новый snapshot.

Недопустимо использовать client ACK как условие продвижения игрового времени.

## 14. Finish

После terminal simulation state:

```text
build GameResult
    ↓
PlatformGateway.finishSession
    ↓ receipt
session-state: finished + redirect
    ↓
Client navigates to Platform result page
```

До подтверждения Platform Server попытка находится в `finishing`.
