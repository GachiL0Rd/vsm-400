# Направление развития и границы модулей

**Версия документа:** 0.7.0
**Статус:** Draft
**Дата редакции:** 2026-09-27

## 1. Текущее направление

Игра строится как authoritative server-side simulation с тонким browser client.

Client отвечает за input, presentation и interpolation. Game Server владеет состоянием мира, navigation, actions, NPC decisions, scenario, randomness, assessment и lifecycle игровой попытки.

Пользовательская авторизация, меню, профиль, назначение задания и постоянное хранение результатов принадлежат отдельному Platform Server.

## 2. Основные компоненты

```text
Platform Server
  auth / menu / profiles / attempts / results
          │
          │ SessionKey + gameLevelId + mode
          ▼
Game Server
  session lifecycle
  simulation workers
  feedback/replay
  serialization gate
          │
          │ WebSocket presentation protocol
          ▼
Game Client
  input / presentation store / renderer / UI
```

Статический игровой content хранится у Game Server:

```text
Game level/preset registry
Level assets
Scenario assets
Trait definitions
Action definitions
Dialogue/presentation assets
```

Внутри `Game` код разделяется на `common / simulation / server / client`. `server` является composition root: он использует authoritative `simulation` и browser-safe `common`; Client импортирует `common`, но никогда не импортирует `simulation`. Подробности — `architecture/repository-structure.md`.

Platform Server передаёт внешний `gameLevelId`, а Game Server разрешает его в локальный versioned config.

## 3. Trust boundary

Browser недоверен.

Он не является источником истины для:

- положения;
- допустимости и результата action;
- времени симуляции;
- hidden traits/state;
- future scenario events;
- scores/achievements;
- RNG decisions.

Client сообщает intent. Server валидирует его и только затем меняет simulation.

## 4. Simulation core

Simulation не зависит от Phaser, DOM, WebSocket, HTTP, cookies, Platform API или конкретного wire serializer.

Он получает content/config, seed и authoritative inputs и производит новое state/events/result.

## 5. Runtime behavior model

Ключевая композиция:

```text
Traits = state + behavior modifiers
Actions = semantic state transitions
Events  = external/scheduled transitions
```

NPC FSM возникает динамически из этой композиции, а не описывается отдельным большим графом.

Candidate actions после hard filtering выбираются по logits через deterministic softmax/RNG policy.

Baseline state model остаётся обычной объектной: Entity — player/passenger со статически определёнными полями `position`, `traits[]`, `heldItem`, `currentAction`. ECS не требуется; оборудование и предметы являются отдельными world objects/items.

## 6. Spatial model

Game Server содержит крупную logical grid с cells и explicit directed edges.

Cells описывают локальную occupancy/environment state. Edges — movement/transfer properties.

Диагонали являются explicit corner edges, а не глобальным правилом pathfinding.

Fire/pressure baseline используют простые periodic neighbour/stencil updates.

## 7. Session modes

Один game runtime поддерживает:

```text
live
guided
replay
```

Modes различаются input policy, observers и разрешёнными protocol extensions, а не отдельными копиями domain state.

Guided добавляет hint events.

Replay запрещает gameplay commands и может раскрывать дополнительные diagnostic extensions/inspection handlers.

## 8. Feedback

Game Server формирует:

- итоговые `safety` и `customerSatisfaction` scores;
- achievement IDs;
- guided hints при включённом coaching policy.

Platform Server хранит итог и выполняет межсессионную/profile логику.

## 9. Replay/determinism

Canonical replay source:

```text
simulation/content versions
root seed
authoritative user input log
```

Полный internal event log не обязателен.

Seek оптимизируется checkpoints; обратимость каждого simulation event не является baseline требованием.

## 10. Platform contract

Для baseline Game Server требуется только:

```text
resolveSession(key)
finishSession(result)
```

`finishSession` идемпотентен и возвращает result redirect.

Подробности — `architecture/platform-contract.md`.

## 11. Документация движка

Подсистемы вынесены в отдельные документы:

- entities;
- event loop;
- determinism;
- grid/world;
- selectors;
- actions;
- traits;
- scenario;
- level;
- assessment/achievements/coaching.

## 12. CI

```text
simulation tests ─────┐
protocol tests ───────┤
game-server tests ────┼──> integration / deterministic replay / E2E
client tests ─────────┤
content validation ───┘
```

Критические simulation rules проверяются без browser runtime.


## 13. Конкретный implementation layer

Текущий demo-контент вынесен в `implementation/` и не должен размывать общие simulation abstractions.

Раздел фиксирует:

- конкретные интерактивные объекты;
- содержимое close-up/modal UI;
- переносимые предметы;
- client-side character/asset composition;
- требования к художнику и разбиению ассетов на слои.

Статические изображения находятся на клиенте. Game Server передаёт стабильные visual/appearance IDs и публичный runtime state, но не texture data.

Один domain object может иметь несколько presentation forms (`world`, `held`, `modal`) без создания нескольких simulation entities.
## 14. Passenger service content

Конкретный demo выражает класс обслуживания обычным passenger trait (`basic`, `comfort`, `business`) и использует сценарные service windows. Отдельного `serviceLevelId` нет.

Класс-trait одновременно участвует в selectors/logit corrections и служит входом для entitlement/assessment. Он не запрещает NPC создавать запросы вне своего класса.

