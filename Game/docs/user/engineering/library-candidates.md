# Библиотеки-кандидаты для simulation/game server

**Версия документа:** 0.1.0  
**Статус:** Research (ненормативный)  
**Дата редакции:** 2026-09-27

Этот документ не фиксирует зависимости проекта. Его задача — не писать утилитарные велосипеды там, где готовая библиотека лучше, и заранее сформулировать критерии проверки.

Версии ниже отражают состояние, проверенное на дату документа, и не являются обязательными pins.

## 1. Принцип выбора

Библиотека допустима, если:

- её API подходит архитектуре, а не заставляет менять архитектуру под библиотеку;
- состояние/порядок, влияющие на simulation, можно сделать детерминированными;
- есть TypeScript types либо простой typed adapter;
- поведение критичных частей можно покрыть regression/golden tests;
- зависимость не тащит лишний browser/runtime coupling в simulation core;
- производительности достаточно после небольшого benchmark на реальной нагрузке.

Для critical deterministic primitive предпочтительно иметь небольшой adapter boundary, чтобы библиотеку можно было заменить.

## 2. PRNG

### `pure-rand`

На дату документа npm показывает версию `8.4.2`.

Плюсы:

- явные PRNG objects вместо глобального `Math.random()`;
- функциональная/pure модель состояния;
- предоставляет xoroshiro/xorshift-подобные генераторы и distributions;
- подходит для оборачивания в собственный `SimulationRandom` adapter.

Проверить перед выбором:

- удобно ли детерминированно derive stream из `(rootSeed, stableKey)`;
- стабильность sequence между нужными версиями;
- golden vectors при upgrade.

Статус: **основной кандидат для prototype**.

## 3. Priority queue

### `heap-js`

На дату документа npm показывает версию `2.7.1`.

Плюсы:

- TypeScript declarations;
- custom comparator;
- обычные `push/peek/pop` primitives, которых достаточно event queue;
- не навязывает event-loop abstraction.

Для simulation comparator должен быть нашим и сравнивать `(at, order)`.

Статус: **хороший кандидат**.

## 4. Pathfinding

Нужен adapter над серверной graph/grid topology. Выбор библиотеки не должен протекать в Level/Simulation API.

### `graphology` + `graphology-shortest-path`

На дату документа `graphology-shortest-path` на npm — `2.1.0`.

Поддерживает weighted graph shortest paths, Dijkstra и A*. Особенно интересен из-за того, что наша runtime topology уже естественно выражается directed weighted edges, а не только bitmap grid.

Минус: возможно избыточен для небольшого вагона.

Статус: **кандидат, хорошо совпадающий с explicit-edge моделью**.

### `pathfinding` / PathFinding.js

Зрелая grid-oriented библиотека с несколькими алгоритмами. Подходит как reference/prototype для обычной клеточной навигации.

Проверить:

- directed/asymmetric edge semantics;
- dynamic capacity/occupancy integration;
- стоимость адаптации наших runtime weights.

Статус: **кандидат для сравнительного prototype**.

### EasyStar.js

Простой asynchronous A* API для grid games. Полезен как reference, но прежде чем принимать зависимость, нужно отдельно проверить актуальность пакета и соответствие server-side explicit-edge модели.

Статус: **вторичный кандидат/reference**.

## 5. Runtime schema validation

### Zod

На дату документа npm показывает Zod `4.6.5`.

Плюсы:

- TypeScript-first schemas;
- runtime parsing/validation;
- большая экосистема;
- JSON Schema conversion.

Подходит для wire DTO и content validation, если размер/скорость приемлемы.

### Valibot

На дату документа npm показывает `1.5.0`.

Плюсы:

- TypeScript inference;
- modular API;
- небольшой runtime/bundle footprint;
- подходит для config/wire validation.

Статус: **Zod и Valibot сравнить на ergonomics + generated schema workflow; заранее победителя не фиксировать**.

## 6. Serialization

### JSON

Baseline по умолчанию: максимально простой, диагностируемый и удобный для development protocol.

Переходить на binary format имеет смысл только после измерения traffic/CPU.

### `msgpackr`

На дату документа npm показывает `2.1.0`.

MessagePack implementation для Node/browser с TypeScript declarations. Может рассматриваться, если JSON действительно станет узким местом.

Статус: **не нужен baseline, кандидат для оптимизации**.

## 7. Что пока не выбирать

До прототипа не фиксировать:

- ECS framework;
- spatial index library;
- physics engine;
- generic workflow/state-machine library.

Текущая trait/action модель намеренно не является generic workflow engine, поэтому сторонняя FSM-библиотека пока не требуется.

## 8. Следующий шаг для библиотек

Перед принятием runtime dependency сделать маленькие compatibility spikes:

1. PRNG: root seed -> stable derived streams -> golden vectors.
2. Heap: одинаковый timestamp + explicit order + lazy invalidation.
3. Pathfinding: directed edges + capacity + dynamic blockage + replan на маленькой карте вагона.
4. Schema library: Level/Trait/Action asset validation и readable error output.

Результаты benchmark/spikes можно добавлять сюда отдельными секциями, не меняя normative simulation docs.

## 9. Принятые utility dependencies для ближайшей реализации

На baseline 0.7 в `Game/package.json` заранее закреплены:

- `zod 4.6.5` — для ближайших Level/Scenario/content и wire validation;
- `heap-js 2.7.1` — как готовый heap/priority-queue utility при следующем рефакторинге event queue;
- `knip 6.38.0` — только dev-аудит dead code/dependencies, не часть runtime.

Наличие зависимости не означает, что существующий код обязан немедленно переписываться под неё. До подключения в runtime сохраняются текущие проверенные реализации и тесты.
