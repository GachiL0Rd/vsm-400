# Диаграммы архитектуры Game

**Версия документа:** 0.1.0
**Статус:** Handoff / current implementation
**Дата редакции:** 2026-09-27

## 1. Назначение

Этот документ является визуальной картой текущей реализации `Game` для передачи серверной части другому разработчику.

Диаграммы показывают фактические границы текущего release-кода. Deferred/baseline возможности не изображаются как уже реализованные, если они не нужны для понимания extension point.

Основные текстовые контракты остаются нормативными:

- [`repository-structure.md`](repository-structure.md) — направление зависимостей;
- [`client-server.md`](client-server.md) — Browser ↔ Game Server ↔ Platform Server;
- [`../api/websocket-protocol.md`](../api/websocket-protocol.md) — wire protocol v1;
- [`platform-contract.md`](platform-contract.md) — Platform API semantics;
- [server logging](../deployment/server-configuration.md#9-logging) — structured diagnostics.

## 2. System context

```mermaid
flowchart LR
    Platform[Platform Server\nauth / attempts / persistent results]
    Browser[Browser Client\nPhaser / UI / interpolation]
    Game[Game Server\nauthoritative attempt runtime]
    Content[(Server-side content bundle\nLevel / Scenario / Actions / Assessment)]
    Assets[(Client presentation assets\nlocal registry / future HTTP asset storage)]

    Platform -->|SessionKey + launch metadata| Browser
    Browser <-->|WebSocket protocol v1| Game
    Game <-->|resolveSession / finishSession| Platform
    Game -->|load by gameLevelId| Content
    Browser -->|resolve visualId / appearanceId| Assets

    classDef authoritative stroke-width:2px;
    class Game,Content authoritative;
```

### Ownership

- Platform Server владеет пользовательской авторизацией, созданием попытки и постоянным результатом.
- Game Server владеет authoritative runtime конкретной попытки.
- Browser Client владеет только presentation/input state.
- Server-side content задаёт конфигурацию уровня и сценария, но не переносится целиком в browser.

## 3. Архитектурные слои приложения

```mermaid
flowchart TB
    subgraph ClientLayer[client]
        GWC[GameWebSocketClient]
        PS[PresentationStore]
        IC[InteractionController]
        Scene[GameScene / Renderer / UI]
    end

    subgraph CommonLayer[common]
        Wire[game-wire.ts\nZod schemas + DTO]
    end

    subgraph ServerLayer[server]
        HTTP[HTTP / WebSocket transport]
        PA[CommonGameProtocolAdapter]
        Host[GameSessionHost]
        Worker[GameSessionWorker]
        PlatformGateway[PlatformGateway]
        Registry[GameContentRegistry]
        Resume[ResumeTokenRegistry]
    end

    subgraph ProjectionLayer[projection]
        Projection[PublicGameProjection]
    end

    subgraph SimulationLayer[simulation]
        Attempt[GameAttempt]
        Sim[Clock / Events / Spatial / Entities / Items / Assessment]
    end

    Scene --> IC
    IC --> PS
    PS --> GWC
    GWC <--> Wire

    HTTP --> PA
    PA --> Wire
    PA --> Host
    Host --> Worker
    Host --> Registry
    Host --> Resume
    Host --> PlatformGateway
    Worker --> Projection
    Worker --> PlatformGateway
    Worker --> Resume
    Projection --> Wire
    Projection --> Attempt
    Attempt --> Sim

    ClientLayer -. forbidden .-> SimulationLayer
    SimulationLayer -. no transport dependency .-> ServerLayer
```

Ключевая граница — `projection`. Это безопасное промежуточное звено между private authoritative state и browser-facing DTO. `server` управляет lifecycle/transport, но не должен сериализовать внутреннее состояние simulation напрямую.

## 4. Внутренняя архитектура Game Server

```mermaid
flowchart LR
    Main[main.ts\ncomposition root]
    Config[parseServerConfig]
    Logger[Pino ServerLogger]
    HTTP[createGameHttpServer]
    Adapter[CommonGameProtocolAdapter]
    Host[GameSessionHost]
    Gateway[HttpPlatformGateway]
    Content[FileGameContentRegistry]
    Tokens[InMemoryResumeTokenRegistry]

    subgraph PerAttempt[per attempt]
        Worker[GameSessionWorker]
        Projection[PublicGameProjection]
        Attempt[GameAttempt]
        SimClock[SimulationClock]
    end

    Main --> Config
    Main --> Logger
    Main --> HTTP
    Main --> Adapter
    Main --> Host
    Main --> Gateway
    Main --> Content
    Main --> Tokens

    HTTP -->|opens GameProtocolConnection| Adapter
    Adapter -->|authenticate / dispatch / detach| Host
    Host -->|resolve launch| Gateway
    Host -->|resolve gameLevelId| Content
    Host -->|issue / resolve| Tokens
    Host -->|create / reuse| Worker
    Worker --> Projection
    Worker --> Attempt
    Worker --> SimClock
    Worker -->|finishSession| Gateway
    Worker -->|rotate / expire / revoke| Tokens
    Worker -->|delta + session-state| Adapter
```

`GameSessionWorker` принадлежит `attemptId`, а не WebSocket. Соединение может исчезнуть и появиться снова, пока worker сохраняет authoritative attempt в пределах reconnect lifecycle.

## 5. Запуск и reconnect сессии

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser Client
    participant T as HTTP/WS transport
    participant P as ProtocolAdapter
    participant H as GameSessionHost
    participant PG as PlatformGateway
    participant C as ContentRegistry
    participant W as GameSessionWorker
    participant R as ResumeTokenRegistry

    B->>T: WebSocket /game-ws
    T->>P: open(connection)
    B->>P: hello(sessionKey)
    P->>H: attachWithSessionKey(...)
    H->>PG: resolveSession(sessionKey)
    PG-->>H: attemptId + gameLevelId + mode

    alt worker does not exist
        H->>C: resolve(gameLevelId)
        C-->>H: ResolvedGameContent
        H->>W: create(attempt + projection)
    else worker already exists
        H->>H: verify same level + mode
    end

    H->>W: attach(connectionId)
    W->>R: issue/rotate resume token
    W-->>H: SessionAttachment
    H-->>P: attachment
    P-->>B: session-ready + snapshot + resumeToken

    Note over B,W: Normal gameplay

    B-xT: network disconnect
    T->>P: close
    P->>H: detach(attemptId, connectionId)
    H->>W: detach(connectionId)
    W->>R: set expiry from disconnect grace
    W->>W: debounce -> paused -> abort after grace

    opt reconnect before grace expires
        B->>P: hello(resumeToken)
        P->>H: attachWithResumeToken(...)
        H->>R: resolve(resumeToken)
        R-->>H: attemptId
        H->>W: attach(new connectionId)
        W->>R: rotate token
        P-->>B: session-ready + fresh snapshot + new token
    end
```

## 6. Обработка команды и public projection

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as ProtocolAdapter
    participant W as GameSessionWorker
    participant P as PublicGameProjection
    participant G as GameAttempt

    C->>A: ClientCommand(requestId, knownRevision, ...)
    A->>W: synchronizeNow()
    W->>G: advance authoritative time
    G-->>W: current state

    alt revision-sensitive command is stale
        A-->>C: command-result(stale, currentRevision)
    else query-actions
        A->>P: queryActions(target)
        P->>G: inspect current authoritative state
        P-->>A: opaque action handles
        A-->>C: action-offer
    else invoke-action
        A->>P: invoke(actionHandle, input)
        P->>G: revalidate action against current state
        P->>G: apply domain operation
        G-->>P: mutated authoritative state
        P-->>A: command-result + delta
        A-->>C: command-result
        A->>W: acceptProjectionResult(...)
        W-->>C: delta
    else move-to / set-time-scale
        A->>P: apply command
        P->>G: authoritative mutation
        P-->>A: command-result + delta
        A-->>C: command-result
        W-->>C: delta
    end
```

Инварианты интеграции:

1. Client передаёт intent, а не готовое изменение domain state.
2. `knownRevision` защищает revision-sensitive операции от применения к заведомо устаревшему public state.
3. `actionHandle` opaque и повторно авторизуется при `invoke`, даже если public revision формально не изменилась.
4. Authoritative mutation происходит до построения нового public projection.
5. Для accepted mutation клиент получает `command-result`, затем public `delta`.

## 7. `move-to`: дальняя цель и промежуточные delta

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as ProtocolAdapter
    participant P as PublicGameProjection
    participant G as GameAttempt
    participant S as SpatialWorld
    participant W as GameSessionWorker

    C->>A: move-to(targetCellId = FINAL)
    A->>W: synchronizeNow()
    A->>P: moveTo(final target)
    P->>G: movePlayerTo(final target)
    G->>S: route(currentCell, finalCell)
    S-->>G: edge1, edge2, ... edgeN
    G->>S: startMovement(edge1)
    P-->>A: accepted + initial moving delta
    A-->>C: command-result accepted
    W-->>C: delta(position = moving on edge1)

    loop every authoritative worker tick
        W->>P: advanceTo(simulation time)
        P->>G: advanceTo(...)
        G->>S: materialize(time)

        alt current edge completed and destination not reached
            G->>S: route(currentCell, finalCell)
            S-->>G: remaining route
            G->>S: startMovement(next edge)
        end

        G-->>P: authoritative position
        P-->>W: public delta if changed
        W-->>C: delta(cell/moving position)
    end

    Note over C,W: Client renders/interpolates server-provided public motion.\nClient does not have to synthesize intermediate move-to commands.
```

Если маршрут после промежуточной клетки больше недоступен, authoritative movement прекращается в последней достигнутой клетке; worker/tick не должен аварийно останавливаться из-за невозможности продолжить route.

## 8. Lifecycle попытки

```mermaid
stateDiagram-v2
    [*] --> initializing
    initializing --> active: first attach

    active --> paused: disconnect debounce elapsed
    paused --> active: reconnect
    active --> active: connection takeover / new attach

    active --> finishing: terminal simulation state
    paused --> finishing: terminal state already reached
    finishing --> finishing: transient finishSession retry
    finishing --> finished: Platform persisted result

    paused --> aborted: reconnect grace expired
    active --> aborted: shutdown / explicit abort path

    finished --> [*]: worker released from host
    aborted --> [*]: worker released from host
```

Connection lifecycle существует отдельно:

```mermaid
stateDiagram-v2
    [*] --> detached
    detached --> attached: attach(connectionId)
    attached --> attached: connection takeover
    attached --> detached: socket close
    detached --> [*]: worker finished / aborted
```

## 9. Class diagram: server + projection

Диаграмма показывает важные runtime relationships, а не каждый private helper.

```mermaid
classDiagram
    direction LR

    class GameSessionHost {
      -Map~attemptId, HostedWorker~ workers
      +attachWithSessionKey(sessionKey, connectionId) Promise~SessionAttachment~
      +attachWithResumeToken(resumeToken, connectionId) SessionAttachment
      +detach(attemptId, connectionId) void
      +worker(attemptId) GameSessionWorker
      +shutdown() void
    }

    class GameSessionWorker {
      -AttemptLifecycle lifecycleState
      -ConnectionLifecycle connectionState
      -SimulationClock simulationClock
      -RecordedGameplayCommand[] userInputs
      +projection PublicGameProjection
      +synchronizeNow() void
      +setTimeScale(scale) GameDeltaMessage
      +recordUserInput(command) void
      +attach(connectionId) SessionAttachment
      +detach(connectionId) void
      +subscribePublications(listener) unsubscribe
      +acceptProjectionResult(result) void
      +shutdown() void
    }

    class CommonGameProtocolAdapter {
      +open(connection) void
      +shutdown() void
      -dispatchAuthenticated(...) void
      -sendInvokeResult(...) void
    }

    class GameProtocolConnection {
      <<interface>>
      +onMessage(listener)
      +onClose(listener)
      +send(data)
      +close(code, reason)
    }

    class PlatformGateway {
      <<interface>>
      +resolveSession(sessionKey) Promise~ResolvedPlatformSession~
      +finishSession(attemptId, result) Promise~FinishSessionResponse~
    }

    class HttpPlatformGateway {
      +resolveSession(sessionKey)
      +finishSession(attemptId, result)
    }

    class GameContentRegistry {
      <<interface>>
      +resolve(gameLevelId) ResolvedGameContent
    }

    class FileGameContentRegistry {
      +resolve(gameLevelId) ResolvedGameContent
    }

    class ResumeTokenRegistry {
      <<interface>>
      +issue(attemptId) string
      +expireAttemptAt(attemptId, expiresAtMs) void
      +resolve(token, nowMs) string
      +revokeAttempt(attemptId) void
    }

    class InMemoryResumeTokenRegistry

    class PublicGameProjection {
      -revisionValue number
      -actionHandles RuntimeAction[]
      +snapshot(clock) GameSnapshotMessage
      +advanceTo(target, clock) GameDeltaMessage
      +refresh(clock) GameDeltaMessage
      +moveTo(command, clock) InvokeResult
      +queryActions(command) ActionOfferMessage
      +invoke(command, clock) InvokeResult
      +applyReplayCommand(command, clock) InvokeResult
    }

    class GameAttemptPort {
      <<interface>>
      +termination AttemptTermination
      +snapshot() GameAttemptSnapshot
      +assessmentResult() AssessmentResult
    }

    CommonGameProtocolAdapter --> GameSessionHost : auth / dispatch
    CommonGameProtocolAdapter --> GameProtocolConnection : owns connection state
    GameSessionHost *-- GameSessionWorker : one per attemptId
    GameSessionHost --> PlatformGateway : resolveSession
    GameSessionHost --> GameContentRegistry : resolve level content
    GameSessionHost --> ResumeTokenRegistry : resume lookup
    GameSessionWorker --> PlatformGateway : finishSession
    GameSessionWorker --> ResumeTokenRegistry : token lifecycle
    GameSessionWorker *-- PublicGameProjection : public boundary
    GameSessionWorker --> GameAttemptPort : authoritative attempt
    PublicGameProjection --> GameAttemptPort : reads / invokes domain state

    PlatformGateway <|.. HttpPlatformGateway
    GameContentRegistry <|.. FileGameContentRegistry
    ResumeTokenRegistry <|.. InMemoryResumeTokenRegistry
```

## 10. Class diagram: simulation core

```mermaid
classDiagram
    direction TB

    class GameAttempt {
      -LoadedLevel level
      -LoadedScenario scenario
      -EventQueue events
      -EntityStore entities
      -SpatialWorld spatial
      +snapshot() GameAttemptSnapshot
      +advanceTo(target) void
      +movePlayer(edgeId) MovementReservation
      +movePlayerTo(targetCellId) MovementReservation
      +playerPosition() SpatialSample
      +editJournal(edit) void
      +inspectClimate() ClimateObservation
      +activateEmergencyBrake() void
      +assessmentResult() AssessmentResult
    }

    class EventQueue~T~ {
      +schedule(at, value) number
      +scheduleReplacing(at, key, value) number
      +peek() ScheduledEvent
      +dequeue() ScheduledEvent
    }

    class EntityStore {
      <<interface>>
      +addPlayer(input) EntityState
      +addPassenger(input) EntityState
      +get(id) EntityState
      +grantTrait(...) EntityState
      +removeTrait(...) EntityState
      +setHeldItem(...) EntityState
      +setCurrentAction(...) EntityState
      +setPosition(...) EntityState
      +select(selector) EntityId[]
    }

    class SpatialWorld {
      <<interface>>
      +addEntity(id, cellId) void
      +startMovement(entityId, edgeId, at) MovementReservation
      +cancelMovement(entityId, at) void
      +materialize(time) void
      +positionAt(entityId, time) SpatialSample
      +route(fromCellId, toCellId, options) EdgeDefinition[]
    }

    class SimulationClock {
      -timeScale number
      -paused boolean
      +advanceTo(wallUs) SimTimeUs
      +setTimeScale(scale, wallUs) void
      +pause(wallUs) void
      +resume(wallUs) void
    }

    class SimulationScheduler~T~ {
      +receiptTime(wallUs) SimTimeUs
      +service(receivedAtWallUs, callback) ServiceResult
    }

    class LoadedLevel {
      <<interface>>
      +definition LevelDefinition
    }

    class LoadedScenario {
      <<interface>>
      +definition ScenarioDefinition
      +normalEndTime SimTimeUs
    }

    class AssessmentResult {
      <<data>>
      +scores
      +achievements
    }

    GameAttempt *-- EventQueue : scheduled domain events
    GameAttempt *-- EntityStore : entities / traits / held state
    GameAttempt *-- SpatialWorld : occupancy / movement / routing
    GameAttempt --> LoadedLevel : static world config
    GameAttempt --> LoadedScenario : scenario config
    GameAttempt --> AssessmentResult : computes terminal result
    SimulationScheduler --> SimulationClock : maps wall time to sim time
```

`GameAttempt` является основным domain aggregate. Детали items, field/environment runtime, NPC decisions и action runtime находятся внутри simulation слоя и не экспортируются напрямую в transport.

## 11. Данные и trust boundaries

```mermaid
flowchart LR
    Private[Private simulation state\ntraits / RNG / future events / answers]
    Projection[PublicGameProjection]
    DTO[common wire DTO\nsnapshot / delta / offers]
    Client[Browser presentation state]

    Intent[Client intent\nmove-to / query / invoke]
    Validate[Protocol + revision + action revalidation]
    Domain[Authoritative domain operation]

    Private -->|explicit projection only| Projection
    Projection --> DTO
    DTO --> Client

    Client --> Intent
    Intent --> Validate
    Validate --> Domain
    Domain --> Private

    Private -. never serialized directly .-> Client
```

При расширении сервера безопаснее всего сохранять эту форму: новый private state сначала появляется в simulation, затем явно выбирается его public representation в projection и только после этого попадает в `common`/wire schema.

## 12. Где искать код

| Зона | Основные файлы |
|---|---|
| composition/config | `src/server/main.ts`, `src/server/config.ts` |
| HTTP/WebSocket transport | `src/server/http-server.ts` |
| wire command dispatch | `src/server/protocol-adapter.ts` |
| attempt registry/auth/reconnect | `src/server/session-host.ts`, `src/server/resume-token-registry.ts` |
| wall-time/tick/finalization | `src/server/game-session-worker.ts` |
| Platform integration | `src/server/platform-gateway.ts`, `src/server/types.ts` |
| content loading | `src/server/content-registry.ts` |
| public state/action boundary | `src/projection/public-game-session.ts` |
| authoritative aggregate | `src/simulation/game-attempt.ts` |
| spatial routing/movement | `src/simulation/spatial-world.ts` |
| entities/traits | `src/simulation/entity-store.ts` |
| event ordering | `src/simulation/event-queue.ts` |
| Browser transport/store/input | `src/client/network/`, `src/client/presentation/`, `src/client/input/` |
| shared schemas | `src/common/game-wire.ts` |
