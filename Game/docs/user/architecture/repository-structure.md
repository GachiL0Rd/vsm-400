# Структура модулей Game

**Версия документа:** 0.1.0
**Статус:** Draft / implementation direction
**Дата редакции:** 2026-09-27

## 1. Цель

Game остаётся самостоятельным приложением, но код внутри него разделяется на четыре явных слоя:

```text
common      browser-safe shared contract
simulation  authoritative game rules
server      session/orchestration/transport/platform integration
client      Phaser presentation and input
```

На первом этапе это могут быть каталоги одного npm package. Отдельные npm workspaces/packages вводятся только если реальная сборка или параллельная разработка начнут от этого выигрывать.

## 2. Направление зависимостей

```text
client ───────────────► common
                         ▲
                         │
server ───────────────► common
  │
  └───────────────────► simulation

simulation ──► common/foundation   (только при необходимости)
```

Критические ограничения:

- `client` никогда не импортирует `simulation`;
- `simulation` не импортирует WebSocket/HTTP/Phaser и transport DTO;
- `server` является composition root и связывает simulation с transport/platform integration;
- `common` содержит только данные, которые безопасно включить в browser bundle.

Если `simulation` использует что-либо из `common`, это должны быть только нейтральные foundation primitives (например branded IDs), а не wire messages.

## 3. `common`

Предназначен для совместного использования Client и Server.

Baseline содержимое:

```text
protocol version
wire schemas / DTO
request-response envelopes
public presentation types
stable public visual/action IDs
runtime validation schemas для wire input
```

В `common` запрещено помещать:

```text
hidden traits
scenario internals
RNG state
correct answers
assessment internals
future events
server-only Level coefficients
```

## 4. `simulation`

Содержит authoritative domain/runtime:

```text
GameAttempt
clock / event queue
entities / traits / actions
level / scenario runtime
grid / navigation / fields
items / world object state
assessment inputs
RNG / replay semantics
```

Simulation работает без WebSocket и Platform Server.

## 5. `server`

Server использует `simulation` и `common` и отвечает за внешнюю жизнь игровой попытки:

```text
GameSessionWorker
WebSocket endpoint
command serialization
public projection
interaction query/response
SessionKey / ResumeToken
PlatformGateway
resolveSession / finishSession
static client delivery
runtime config
```

Game Server не содержит меню, профиль пользователя и историю попыток платформы.

## 6. `client`

Client использует только `common` и client-side content/assets.

Он отвечает за:

```text
WebSocket connection
presentation store
snapshot/diff application
interpolation/rendering
input
interaction/menu/modal UI
guided/replay presentation
asset registry
```

Client не рассчитывает navigation, action availability, scores, NPC decisions или hidden state.

## 7. Static client delivery

Game Server может отдавать собранный Browser Client по HTTP endpoint, но сам frontend build остаётся отдельным слоем и не получает доступа к server/simulation modules.

Раздача статического клиента является обязанностью server package, а не simulation.

## 8. Platform API

Контракт Platform Server описывается отдельно от его реализации. Для параллельной разработки предполагается versioned OpenAPI/Swagger specification поверх `resolveSession` и `finishSession`.

Game repository является владельцем ожидаемого client contract к Platform Server до выделения platform-разработки в отдельную ветку/репозиторий.
