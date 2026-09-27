# Взаимодействие клиента, игрового сервера и Platform Server

**Версия документа:** 0.4.0
**Статус:** Draft
**Дата редакции:** 2026-09-27

## 1. Область документа

Документ определяет границу Browser Client, Game Server и внешнего Platform Server.

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
- assessment, achievements и coaching;
- финализацию результата через Platform Server.

Game Server не реализует меню и постоянную профильную бизнес-логику.

### Game Client

Отвечает за:

- input;
- отображение public presentation state/events;
- interpolation;
- локальное UI-state;
- mode-specific UI (guided hints/replay controls);
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
4. worker сохраняется на reconnect grace;
5. новый socket предъявляет валидный `ResumeToken` (или проходит повторную platform validation, если transport implementation выбрала этот путь);
6. socket attach к той же попытке;
7. client получает актуальный snapshot;
8. session продолжает работу.

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

`snapshot` и `delta/delta-batch` описывают состояние, которое должно сохраняться до следующего изменения:

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
guided hint
notification
short-lived visual/audio effect
optional open/focus presentation request
```

Они не являются authoritative simulation events.

### 7.3. Request/response

Некоторые операции удобнее моделировать как запрос клиента к серверу, а не как постоянно публикуемое состояние. Baseline пример — запрос доступных действий после клика по объекту/сущности.

```text
Client:  query-actions(requestId, targetId)
Server:  action-offer(requestId, targetId, revision, actions[])
Client:  invoke-action(actionHandle, optionalInput)
Server:  command-result + subsequent state diff/events
```

`actionHandle` opaque и проверяется повторно при invoke. Offer может стать невалидным после изменения revision/state.

Internal simulation events автоматически наружу не передаются.

## 8. Hint events

Guided mode может выдавать специальные transient `hint` events.

Они являются presentation output, а не state mutation.

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

Game Server передаёт только стабильные public visual IDs и runtime state, например:

```text
bodyId / clothingIds
heldItemVisualId
pin state
gauge value
handle state
modal document fields
```

Client разрешает эти IDs через локальный asset registry и композитит слои. Локальность изображения не делает соответствующее состояние client-authoritative.

Один simulation object может иметь несколько presentation forms (`world`, `held`, `modal`) без дублирования domain entity.

## 10. Client → Server intents

Baseline client input сводится к небольшому набору intent/request сообщений:

```text
move-to(target position/cell)
query-actions(targetId)
invoke-action(actionHandle, optionalInput)
set-time-scale(requestedScale)
replay controls: play/pause/seek/inspect (только replay policy)
```

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
