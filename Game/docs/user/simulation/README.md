# Simulation documentation map

**Версия документа:** 0.2.0  
**Статус:** Draft  
**Дата редакции:** 2026-09-27

Simulation documentation разделена по независимым подсистемам, чтобы не превращать один общий engine document в смесь runtime semantics, content schema и transport concerns.

## Основные документы

- [`entities.md`](entities.md) — минимальное состояние player/passenger без ECS.
- [`event-loop.md`](event-loop.md) — timeline, subtick events, pause/time scale, scheduling.
- [`determinism.md`](determinism.md) — root seed, derived RNG streams, replay compatibility, checkpoints.
- [`grid-world.md`](grid-world.md) — cells, edges, movement, capacity и простые spatial fields.
- [`selectors.md`](selectors.md) — CSS-like selection + typed operations.
- [`actions.md`](actions.md) — actions как semantic transitions.
- [`traits.md`](traits.md) — traits как state/selectors/behavior modifiers и softmax action choice.
- [`scenario.md`](scenario.md) — preDeparture, origin boarding, route stops, passenger flow, service windows, timeline и terminal rules.
- [`level.md`](level.md) — статическая локация и spatial/material config.
- [`feedback.md`](feedback.md) — scores, achievements и coaching/hints.

## Связанные architecture docs

- [`../architecture/client-server.md`](../architecture/client-server.md)
- [`../architecture/platform-contract.md`](../architecture/platform-contract.md)
- [`../architecture/session-modes.md`](../architecture/session-modes.md)
- [`../architecture/replay.md`](../architecture/replay.md)

## Главные инварианты

1. Simulation state server-authoritative.
2. Tick rate не является semantic clock resolution.
3. `seed + versions + authoritative user inputs` достаточно для deterministic replay.
4. Client получает projection, а не domain state.
5. Traits/Actions/Events формируют runtime state machine без отдельного NPC workflow graph.
6. Level описывает пространство, Scenario — конкретный run, Engine — semantics.
7. Feedback/replay наблюдают или расширяют presentation, но не создают вторую simulation model.


## Конкретный demo content

Общие simulation documents не перечисляют UI-состав каждого объекта. Конкретные состояния, модалки, held-items и asset decomposition текущего demo находятся в `../implementation/`.

- [`assessment.md`](assessment.md) — итоговые safety/customer scores и achievements как observer над simulation facts.
