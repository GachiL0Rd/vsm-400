# Replay, seek и checkpoints

**Версия документа:** 0.1.0
**Статус:** Baseline forward replay implemented; seek/checkpoints planned
**Дата редакции:** 2026-09-27

## 1. Цель

Replay должен позволять восстановить прохождение, управлять временем и показывать расширенную диагностическую информацию без хранения полного журнала внутренних simulation events как обязательной части результата.

Canonical replay source:

```text
simulation/content versions
root seed
authoritative user input log
```

## 2. Forward replay

Минимальная реализация replay:

1. загрузить соответствующую версию game content;
2. создать simulation с сохранённым root seed;
3. повторно подать user inputs на сохранённых `SimTimeUs/order`;
4. детерминированно продвигать simulation вперёд.

Это baseline и должно работать без checkpoints.

Текущая серверная реализация `0.1.0` выполняет именно этот forward replay: входной log валидируется, версии content/simulation должны совпадать, а команды повторно применяются в сохранённые `SimTimeUs`. Доступные скорости playback — `1x`, `2x`, `4x`. После достижения terminal state replay останавливается локально и не вызывает Platform `finishSession`.

`seek`, checkpoints, replay inspection и раскрытие hidden state в `0.1.0` пока не реализованы и не рекламируются через public replay capabilities.

## 3. Почему event rollback не требуется baseline

Не требуется общий контракт:

```text
apply(event)
revert(event)
```

для каждого simulation event.

Обратимость быстро усложняет:

- RNG context;
- создание/удаление entities;
- scheduled event queue;
- path/motion generation;
- field state;
- trait/action transitions;
- external side effects.

Поэтому simulation гарантирует deterministic restore + forward execution, а не обратимость каждого события.

## 4. Checkpoint

Checkpoint — оптимизация seek, а не новый источник истины.

Conceptually checkpoint содержит достаточно runtime state, чтобы продолжить симуляцию детерминированно:

```text
simulation time
SimulationState
RNG stream states
scheduled event queue / generations
runtime IDs/counters
relevant evaluator/observer runtime if он нужен replay
```

Public projection можно построить заново после restore.

## 5. Seek

Seek к времени `T`:

```text
find nearest checkpoint <= T
        ↓
restore checkpoint
        ↓
replay stored user inputs/events forward
        ↓
advanceTo(T)
        ↓
rebuild projection
```

Если checkpoint отсутствует, используется initial state at time zero.

## 6. Checkpoint policy

Точная стратегия не является simulation semantics.

Варианты:

- каждые N simulation seconds;
- каждые N processed events;
- adaptive checkpoints возле значимых assessment markers;
- ephemeral cache, создаваемый во время replay.

Первая реализация может начать с редких periodic checkpoints либо вообще без них, если runs короткие.

## 7. Хранение checkpoints

Checkpoint не обязан входить в persistent Platform result.

Он может быть:

- runtime cache;
- временным replay cache;
- позднее — оптимизационным persistent artifact.

Удаление всех checkpoints не должно делать replay невозможным, только более медленным.

## 8. Optional internal event log

Для debug/hard-guided tooling Game Server может временно логировать больше внутренних events.

Такой журнал является diagnostic artifact и не заменяет canonical replay source `seed + user inputs + versions`.

Его формат не обязан быть стабильным между simulationCompatibilityVersion.

## 9. Timeline markers

Replay UI может получать отдельные markers:

```text
player action
assessment error
achievement unlock
complaint
incident
important NPC decision
hint/coaching marker
```

Markers ускоряют разбор и навигацию, но не являются обязательными simulation events.

## 10. Guided rewind

Будущая guided capability может позволить вернуться к checkpoint перед ошибкой и попробовать ещё раз.

Baseline не требует её реализации.

Если capability появляется, рекомендуется считать повтор отдельной training branch, чтобы исходная последовательность действий и официальный result оставались доступны для разбора.
