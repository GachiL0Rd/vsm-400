# Детерминизм, PRNG и воспроизведение попытки

**Версия документа:** 0.3.0  
**Статус:** Draft  
**Дата редакции:** 2026-09-27

## 1. Требование

Одна и та же `simulationCompatibilityVersion` и совместимые версии контента при одинаковом root seed и одинаковой последовательности authoritative user inputs должны давать одинаковый результат симуляции.

Canonical replay не требует постоянного хранения полного internal event log.

## 2. Явный PRNG

Каждая попытка создаёт explicit deterministic random context из `rootSeed`.

Влияющая на state случайность не использует напрямую:

- `Math.random()`;
- wall-clock entropy;
- случайные UUID, влияющие на порядок/ветвление;
- недетерминированные внешние сервисы.

PRNG может быть библиотечным. Проект не требует писать собственный генератор.

Выбранная библиотека/algorithm закрепляются adapter boundary и regression/golden tests.

Текущая release-реализация использует закреплённый dependency/adapter и regression tests; смена PRNG или derivation semantics требует осознанного compatibility change.

## 3. Derived RNG streams

Независимые подсистемы получают deterministic streams, выводимые из:

```text
rootSeed + stableStreamKey
```

Примеры:

```text
scenario-generation
passenger-generation
incident-generation
npc:<stable-id>:decision
field:<id>:randomness
```

Stream не должен зависеть от порядка создания других streams.

Цель: добавление нового RNG consumer в одной подсистеме не должно сдвигать решения независимой подсистемы.

Конкретная derivation function выбирается при implementation spike и фиксируется test vectors.

## 4. Что хранится для replay

Минимальный persistent source:

```text
simulationCompatibilityVersion
game/content versions
rootSeed
authoritative user inputs with SimTimeUs/order
```

Game Result дополнительно хранит scores и achievement IDs, но они не заменяют replay source.

## 5. Simulation compatibility version

Application release и replay compatibility — разные версии.

Изменение UI может не менять simulation compatibility.

Изменение PRNG derivation, action semantics, movement rules, selector ordering или другого влияющего на state алгоритма требует новой compatibility version.

## 6. Стабильный порядок

Детерминизм требует explicit order для:

- вызовов RNG;
- одинаковых timestamps event queue;
- selector results, если порядок важен;
- sampling candidates;
- tie-breaks;
- distribution rules;
- field iteration, если формула чувствительна к порядку;
- generated IDs, если ID участвует в semantics.

Не допускается неявная зависимость от filesystem/API/DB/container iteration order.

## 7. Checkpoints

Checkpoint не является обязательной частью persistent result.

Он является optimization для replay seek и должен включать достаточно runtime state для deterministic continuation:

```text
SimTime
SimulationState
RNG stream states
scheduled events / generations
runtime counters/IDs
нужный observer/evaluator runtime
```

Удаление checkpoint cache не должно ломать replay: всегда остаётся replay from initial state.

Подробности — `architecture/replay.md`.

## 8. Internal event log

Полный internal event log допускается для:

- debug;
- profiler/tracing;
- hard-guided tooling;
- временной диагностики.

Он не является canonical replay storage и не обязан быть стабильным между simulation compatibility versions.

## 9. Tests

Минимальный набор:

- один seed + inputs повторяется идентично;
- разные scheduler rates дают тот же gameplay result;
- golden vectors PRNG/stream derivation;
- независимые RNG streams не влияют друг на друга;
- selector sampling имеет стабильный порядок;
- checkpoint restore + forward replay совпадает с uninterrupted run;
- несколько end-to-end golden runs.

## 10. Открыто

- конкретная PRNG library/algorithm;
- конкретная stable-key derivation function;
- политика хранения старых content versions для исторического replay.
