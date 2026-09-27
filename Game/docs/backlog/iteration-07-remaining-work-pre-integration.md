# Что осталось реализовать по baseline 0.7

> Исторический snapshot до H1–H3 hardening и нормативной integration
> documentation. Не использовать как текущий backlog; актуальные working guide
> находятся в [`../agent/`](../agent/README.md).

**Состояние на 2026-09-27.** Проверены текущая ветка
`feature/vsm-docs-iteration-07-wip`, код `Game/` и требования в
[индексе документации](../user/README.md). Этот список описывает недостающую
**работающую связку**, а не только отсутствие отдельных файлов. Более ранняя
таблица расхождений находится в
[`iteration-07-gap-analysis.md`](iteration-07-gap-analysis.md).

## Cleanup перед интеграцией

- [x] Удалён старый mechanics-playground из `src/` вместе с его изолированными тестами/content.
- [x] Удалён встроенный zone-based `dev/demo-server.ts` и старые browser smoke/flow/lifecycle scripts.
- [x] Vite больше не поднимает скрытый demo WebSocket plugin.
- [x] Старый zone-based Phaser presentation layer (`protocol/state/connection`, локальный pathfinding и demo managers) удалён; оставлена минимальная `GameScene`-оболочка.
- [ ] После подготовки Linux dependencies прогнать Knip по оставшемуся проекту и использовать его дальше как regression-аудит dead code.

## Что уже есть и почему этого пока недостаточно

В `Game/src/simulation/` реализованы независимые примитивы времени в целых микросекундах, очереди событий, планировщика, RNG, grid/navigation, движения по edges, полей, EntityStore, выбора NPC action и ItemStore. Базовый `ActionRuntime` уже связывает выбранное действие с `currentAction`, generation invalidation, running/waiting completion, timeout/interrupt и external-event resolution. Пока реализованы только фундаментальные handlers (`wait`, `request-item`); полный набор player/world handlers и новый decision point на уровне `GameAttempt` ещё предстоит связать.

Старый mechanics-playground, встроенный `dev/demo-server.ts` и связанные browser-flow/lifecycle/smoke scripts удалены как несовместимые с новым authoritative runtime. Старый zone-based Phaser-клиент удалён; `src/client/GameScene.ts` сейчас является минимальной presentation shell до появления `GameAttempt` и новой public projection. Поэтому успешные unit-тесты примитивов не подтверждают готовность вертикального среза.

## 1. Единый runtime попытки — обязательно

- [ ] **Level.** Versioned JSON-compatible `LevelDefinition`, Zod-validation и baseline preset уже есть: `carriage-main`, `platform-origin`, `platform-standard`, cells/edges, anchors, object/failure/sanitation locations и region-based route constraints. Осталось подключить mutable active-region state к `GameAttempt`, чтобы стоянка/отправление реально включали и отключали перрон в authoritative runtime. Основание: [level.md](../user/simulation/level.md), [grid-world.md](../user/simulation/grid-world.md).
- [ ] **Scenario и конкретный рейс.** Versioned `ScenarioDefinition`, Zod-validation и baseline preset уже описывают `preDeparture`, `originStop`, travel/route stops, 3 пассажиров, service windows, terminal signals и штатное время завершения; совместимость с Level проверяется до запуска. Осталось реализовать Scenario runtime: scheduling переходов/flow, journal departure check, incident activation и terminal-rule evaluation. Основание: [scenario.md](../user/simulation/scenario.md), [trip-service-plan.md](../user/implementation/trip-service-plan.md), [baseline](../user/vsm_baseline_vertical_slice.md).
- [ ] **GameAttempt/worker.** Первый authoritative `GameAttempt` уже связывает одну event queue, RNG, EntityStore, SpatialWorld, ItemStore, ActionRuntime, NPC decisions, active regions и переходы `preDeparture → originStop → travel/stop → finish`; player movement и interaction range проверяются на сервере, позиции EntityStore/SpatialWorld синхронизируются orchestration-слоем. Осталось подключить поля/инциденты/assessment, оформить player actions вместо временных прямых item methods и добавить wall-clock worker вокруг sim-time core. Основание: [event-loop.md](../user/simulation/event-loop.md), [determinism.md](../user/simulation/determinism.md), [client-server.md](../user/architecture/client-server.md).
- [ ] **ActionRuntime и полный цикл действий.** Orchestration core уже реализован и подключён к `GameAttempt`: running/waiting completion автоматически создаёт новый NPC decision point, baseline request/consume loop работает через traits и external `ItemGiven`. Осталось завернуть movement/items/world interactions игрока в handlers/runtime handles вместо временных методов `GameAttempt` и расширить registry остальными baseline actions. Основание: [actions.md](../user/simulation/actions.md), [traits.md](../user/simulation/traits.md), [selectors.md](../user/simulation/selectors.md).
- [ ] **Данные пассажиров и услуг.** Минимальный baseline action/trait content уже существует: `basic/comfort/business`, `hungry/thirsty/impatient`, request/wait/consume loop и class logit corrections; Scenario гарантирует ровно один class trait. Осталось вынести этот content в полноценные валидируемые assets, добавить документы/entitlement/assessment rules и остальные действия. Основание: [service-levels.md](../user/implementation/service-levels.md), [traits.md](../user/simulation/traits.md).
- [ ] **Мир и предметы.** Подключить ItemStore к реальным взаимодействиям: взять/заполнить/вернуть журнал; осмотреть, подготовить и применить огнетушитель; взять еду/напиток в service point и передать пассажиру при одном held slot. Реализовать mutable state и server actions для климата, стоп-крана, связи с машинистом, дверей и санитарных overlays. Панель показывает наблюдаемое, а не скрытое фактическое состояние. Основание: [interactables.md](../user/implementation/interactables.md), [held-items.md](../user/implementation/held-items.md), [environment-state.md](../user/implementation/environment-state.md).
- [ ] **Нештатная ситуация.** Связать источник пожара/давления с periodic field updates, доступными признаками, NPC реакциями, действиями игрока и последствиями. Для baseline достаточно простой модели, но изменение поля и исход должны происходить в authoritative runtime. Основание: [grid-world.md](../user/simulation/grid-world.md), [baseline](../user/vsm_baseline_vertical_slice.md).

## 2. Граница сервера, режимы и результат — обязательно

- [ ] **Platform gateway.** Ввести `SessionKey → resolveSession`, локальное разрешение `gameLevelId` в preset, `ResumeToken`, сервисную аутентификацию, mock adapter для локального запуска и идемпотентный `finishSession`. Формировать `FinishedGameResult` и `FinishReceipt`; replay не отправляет новый официальный результат. Старый demo WebSocket удалён; новый transport/lifecycle ещё не реализован. Основание: [platform-contract.md](../user/architecture/platform-contract.md).
- [ ] **Lifecycle сессии и WebSocket.** Отделить GameAttempt от соединения: создание/подключение, detach/reconnect, resume, политика паузы/времени без клиента, сериализация команд одного attempt, revision/resync и обработка медленного клиента. Сохранить одну встраиваемую WebSocket границу. Основание: [client-server.md](../user/architecture/client-server.md).
- [ ] **Public projection и новый wire contract.** Строить сообщения только из наблюдаемого состояния и разрешённых контекстных действий с runtime handles; не отправлять latent traits, RNG, скрытые неисправности и входы оценщика. Передавать видимые cells/regions, объекты, движение, модальные данные и presentation events; версионировать протокол и проверять команды на сервере. Старый zone-based DTO этим требованиям не соответствует. Основание: [client-server.md](../user/architecture/client-server.md), [modal-content.md](../user/implementation/modal-content.md).
- [ ] **Режимы и replay.** Одна simulation для `live`, `guided`, `replay`; server-side `InputPolicy` запрещает gameplay commands в replay. Записывать canonical source: версии simulation/content, root seed и authoritative user inputs с `SimTimeUs`/порядком. Сделать детерминированное forward replay, playback controls, seek через повтор от начала и разрешённую inspection/reveal policy. Checkpoints могут ускорять seek, но не являются обязательным источником истины. Основание: [session-modes.md](../user/architecture/session-modes.md), [replay.md](../user/architecture/replay.md).
- [ ] **Оценка и завершение.** Считать `safety`, `customerSatisfaction`, achievements и отдельный `terminalReason` из событий попытки; выдавать run achievements один раз. Guided hints должны быть presentation events, не менять simulation и не раскрывать hidden state без policy. Разделить досрочное завершение и оценку безопасности. Основание: [feedback.md](../user/simulation/feedback.md), [scenario.md](../user/simulation/scenario.md).

## 3. Клиент Phaser — обязательно для проходимого среза

- [ ] **Построить presentation layer от новой проекции.** Отобразить server-controlled grid/regions и координаты, игрока и NPC, перемещение, контекстные действия, состояние стоянки/поездки и события без локального принятия игровых решений. Старые zone-based managers удалены; новый клиент строить непосредственно от public projection. Основание: [client-server.md](../user/architecture/client-server.md), [environment-state.md](../user/implementation/environment-state.md).
- [ ] **Дать игроку весь baseline interaction UI.** Нужны один held slot, журнал с ручным checklist, close-up огнетушителя, климата и стоп-крана, связь с машинистом, service point, билет и удостоверение пассажира, решение о посадке, диалоговые server-provided варианты и понятные причины недоступности действий. Текущие POI/dialogue/task экраны реализуют другой scripted demo. Основание: [modal-content.md](../user/implementation/modal-content.md), [held-items.md](../user/implementation/held-items.md), [baseline](../user/vsm_baseline_vertical_slice.md).
- [ ] **Режимы и представление объектов.** Добавить guided hints, replay controls/markers/inspection, reconnect/resync UI и реестр стабильных asset/state IDs. Для текущей работы изображения можно заменить простыми фигурами и подписями; при этом разные world/held/modal представления и видимые состояния объекта должны соответствовать одному server domain object. Основание: [session-modes.md](../user/architecture/session-modes.md), [character-appearance.md](../user/implementation/character-appearance.md), [asset-requirements.md](../user/implementation/asset-requirements.md).

## 4. Проверка готовности

- [ ] Пройти в браузере короткую смену: перрон → журнал и приёмка → отдельная посадка → поездка/остановка → пассажиры и документы → техническая или пожарная ситуация → штатный или досрочный итог.
- [ ] Проверить на сервере отклонение недоступного действия, слишком далёкого взаимодействия, входа в отключённый перрон и gameplay command в replay; отсутствие hidden state в обычной проекции.
- [ ] Повторить сохранённый ввод с тем же seed/versions и получить тот же итог, NPC decisions и ключевые события; проверить reconnect/resync и однократный `finishSession`.
- [ ] Запустить `npm run verify` из `Game/` после интеграции и провести ручную браузерную проверку. Текущая проверка примитивов не заменяет эти сквозные сценарии.

**Критерий закрытия списка:** весь путь из [baseline vertical slice](../user/vsm_baseline_vertical_slice.md) работает на новом authoritative GameAttempt через public projection, даёт воспроизводимый replay source и официальный результат. Несколько типов вагонов, полноценный поезд, многослотовый inventory, точная физика пожара/давления, runtime LLM, reversible event log и сохранённые checkpoints в baseline не требуются.

## 5. Предпочтительный порядок ближайших коротких итераций

`common`, public projection, server skeleton и первый client foundation уже
существуют. Дальше приоритет смещался с изолированной реализации модулей на
укрепление их реальной связки. Детальный historical checklist и последующий
documentation gate находятся в
[`integration-hardening-2026-09-27.md`](integration-hardening-2026-09-27.md).

Ближайший порядок:

1. **H1 — protocol correctness.** Auth/bootstrap/resume клиента, корректный delta upsert, revision/resync и полный protocol contract test.
2. **H2 — authoritative runtime/lifecycle.** Wall-clock worker, pause/resume, simulation-originated deltas, terminal/finalization flow.
3. **H3 — transport/operational hardening.** Backpressure/message limits, cleanup/shutdown, health/readiness и startup/config behavior.
4. **Integration documentation.** После стабилизации H1–H3 зафиксировать WebSocket reference, Platform OpenAPI/Swagger и подробную server/container deployment documentation.

Не объединять H1–H3 в один большой patch без необходимости. Визуальный Phaser-клиент может развиваться параллельно поверх `common`, пока его изменения не переносят игровые правила обратно на клиент.
