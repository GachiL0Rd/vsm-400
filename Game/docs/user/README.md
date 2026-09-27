# Документация симулятора проводника ВСМ

**Версия набора:** 0.8.0
**Статус:** Draft / implementation baseline
**Дата редакции:** 2026-09-27

Этот каталог содержит действующие продуктовые, архитектурные и implementation-документы модуля Game и является его нормативным источником.

Документы из `../agent/` являются рабочими инструкциями, а `../backlog/` — историческим контекстом. Ни те, ни другие не заменяют требования из этого каталога.

## Порядок чтения

1. [`project_direction.md`](project_direction.md) — общая граница модулей.
2. [`vsm_conductor_game_concept.md`](vsm_conductor_game_concept.md) — продуктовая концепция.
3. [`vsm_baseline_vertical_slice.md`](vsm_baseline_vertical_slice.md) — первый вертикальный срез.
4. [`architecture/repository-structure.md`](architecture/repository-structure.md) — границы `common / simulation / server / client`.
5. [`architecture/client-server.md`](architecture/client-server.md) — Browser ↔ Game Server ↔ Platform Server.
6. [`architecture/platform-contract.md`](architecture/platform-contract.md) — минимальный контракт внешней платформы.
7. [`architecture/session-modes.md`](architecture/session-modes.md) — live/guided/replay и protocol extensions.
8. [`architecture/replay.md`](architecture/replay.md) — deterministic replay, seek и checkpoints.
9. [`simulation/README.md`](simulation/README.md) — карта документов движка, включая минимальную Entity/Traits/Actions модель.
10. [`implementation/README.md`](implementation/README.md) — конкретная реализация текущего demo: объекты, модалки, held-items, ассеты, environment-state, уровни обслуживания и план рейса.
11. [`engineering/library-candidates.md`](engineering/library-candidates.md) — ненормативные dependency candidates.

## Нормативная граница

Документы `architecture/` и `simulation/` задают общие архитектурные и simulation-инварианты.

`implementation/` задаёт конкретную реализацию текущего demo и подчиняется этим инвариантам.

`engineering/` — research: список кандидатов и экспериментов, а не обязательные зависимости.

## Иерархия источников

При конфликте:

1. более новая явно версионированная architecture/simulation specification;
2. product concept и baseline;
3. фактическая research base;
4. исторические `agent/` материалы.

## Версионирование

- patch — формулировки/уточнения без semantic change;
- minor — совместимое расширение архитектуры;
- major — изменение основных инвариантов/границ.

Отдельно существуют protocol/content/simulation compatibility versions; они не обязаны совпадать с номером документа.

## Связанные документы

- фактическая исследовательская база верхнего уровня: [`../../../docs/user/`](../../../docs/user/README.md);
- актуальный implementation checklist: [`../agent/iteration-07-remaining-work.md`](../agent/iteration-07-remaining-work.md);
- архив старого demo и предыдущих планов: [`../backlog/`](../backlog/README.md).
