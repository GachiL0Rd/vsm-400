# Документация симулятора проводника ВСМ

**Версия набора:** 0.9.0
**Статус:** Draft / release and baseline specifications
**Дата редакции:** 2026-09-27

Этот каталог содержит действующие продуктовые, архитектурные и implementation-документы модуля Game и является его нормативным источником.

## Release и Baseline

В документации различаются два уровня scope:

- **Release** — обязательный набор для текущего принимаемого release candidate. Невыполнение release-требования блокирует выпуск.
- **Baseline** — целевой вертикальный срез текущего направления: реализованные возможности плюс желаемые дополнения. Невыполненная baseline-возможность не блокирует текущий release, если она явно отложена release scope.

Текущий критерий приёмки зафиксирован в [`release-scope-0.1.0.md`](release-scope-0.1.0.md). Baseline остаётся целевым верхним ориентиром: после его полного закрытия текущую функциональную итерацию можно считать завершённой.

Документы из `../agent/` являются рабочими инструкциями, а `../backlog/` — историческим контекстом. Ни те, ни другие не заменяют требования из этого каталога.

## Порядок чтения

1. [`release-scope-0.1.0.md`](release-scope-0.1.0.md) — обязательный scope текущего release candidate.
2. [`project_direction.md`](project_direction.md) — общая граница модулей.
3. [`vsm_conductor_game_concept.md`](vsm_conductor_game_concept.md) — продуктовая концепция.
4. [`vsm_baseline_vertical_slice.md`](vsm_baseline_vertical_slice.md) — целевой вертикальный срез, включая deferred возможности.
5. [`architecture/repository-structure.md`](architecture/repository-structure.md) — границы `common / simulation / projection / server / client`.
6. [`architecture/client-server.md`](architecture/client-server.md) — Browser ↔ Game Server ↔ Platform Server.
7. [`api/websocket-protocol.md`](api/websocket-protocol.md) — фактический Browser ↔ Game Server protocol v1.
8. [`api/platform-openapi.yaml`](api/platform-openapi.yaml) — Swagger/OpenAPI Game Server ↔ Platform Server.
9. [`architecture/platform-contract.md`](architecture/platform-contract.md) — семантика внешнего platform contract.
10. [`architecture/session-modes.md`](architecture/session-modes.md) — live/guided/replay и protocol extensions.
11. [`architecture/replay.md`](architecture/replay.md) — deterministic replay, seek и checkpoints.
12. [`simulation/README.md`](simulation/README.md) — карта документов движка, включая минимальную Entity/Traits/Actions модель и assessment.
13. [`implementation/README.md`](implementation/README.md) — конкретная реализация текущего demo: объекты, модалки, held-items, ассеты, environment-state, уровни обслуживания и план рейса.
14. [`deployment/server-configuration.md`](deployment/server-configuration.md) — запуск и environment configuration Game Server.
15. [`deployment/content-bundle.md`](deployment/content-bundle.md) — release-format server-side Level/Scenario/Actions/Assessment config.
16. [`deployment/container-layout.md`](deployment/container-layout.md) — контейнерные/service boundaries и reference topology.

## Нормативная граница

Документы `architecture/` и `simulation/` задают общие архитектурные и simulation-инварианты.

`implementation/` задаёт конкретную реализацию текущего demo и подчиняется этим инвариантам.


## Иерархия источников

При конфликте:

1. текущий явно версионированный release scope — для вопроса о том, что блокирует принимаемый release;
2. более новая явно версионированная architecture/simulation specification — для технических инвариантов и контрактов;
3. product concept и baseline — для целевого поведения и дальнейшего развития;
4. фактическая research base;
5. исторические `agent/` материалы.

## Версионирование

- patch — формулировки/уточнения без semantic change;
- minor — совместимое расширение архитектуры;
- major — изменение основных инвариантов/границ.

Отдельно существуют protocol/content/simulation compatibility versions; они не обязаны совпадать с номером документа.

## Связанные документы

- фактическая исследовательская база верхнего уровня: [`../../../docs/user/`](../../../docs/user/README.md);
- актуальные working guide и integration status: [`../agent/`](../agent/README.md);
- архив старого demo и предыдущих планов: [`../backlog/`](../backlog/README.md).
