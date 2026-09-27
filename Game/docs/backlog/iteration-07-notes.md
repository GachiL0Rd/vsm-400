# Архивные заметки baseline 0.7

> История формирования baseline. Текущие требования находятся в `../user/`.

# Заметки итерации документации 0.7

**Дата:** 2026-09-27

## Цель

Зафиксировать development baseline для простой объектной модели сущностей и окончательно синхронизировать `Traits + Actions + service gameplay` перед началом реализации core.

Эта итерация сознательно уменьшает число runtime-абстракций: ECS, сложные TraitInstance и отдельный ServiceRequest больше не являются частью baseline.

## Entity model

Entity — только действующий персонаж:

```text
player
passenger
```

Entity является обычным статически типизированным объектом с минимумом состояния:

```text
position
traits[]
heldItem
currentAction
```

Оборудование, документы, панели и held items являются world objects/items, но не ECS entities.

Добавлен `simulation/entities.md`.

## Traits

Runtime trait теперь строго является строковым ID в `entity.traits`.

```text
business
hungry
waiting-drink
impatient
```

Отдельного `TraitInstance` нет.

Trait может:

- быть добавлен без срока;
- быть выдан с lifetime;
- истечь по scheduler event;
- быть удалён внешним action/event/scenario operation.

Для time-dependent modifiers/expiry engine может держать минимальный служебный `grantedAt + generation/token` вне списка traits. Это bookkeeping, а не новая доменная форма trait.

## Actions

`simulation/actions.md` заменён новой action-моделью.

Основной NPC loop:

```text
traits
→ candidate actions
→ hard filtering
→ logit corrections
→ stable softmax
→ deterministic RNG
→ action lifecycle
→ state/traits changed
→ new decision
```

Action является одним семантическим переходом и может быть:

```text
instant
running
waiting
```

Waiting action ждёт подходящего domain event, timeout либо interrupt. Он не превращается во внутренний workflow.

## Service requests

Отдельный `ServiceRequest` object удалён из baseline.

Пример запроса напитка:

```text
thirsty
    ↓ request-drink
+ waiting-drink
currentAction = request-drink / waiting
    ↓ DrinkGiven или timeout
terminal action effects
    ↓
new decision
```

Таким образом факт ожидания услуги выражается trait + currentAction.

## Класс обслуживания

Отдельное поле `serviceLevelId` удалено.

Класс — обычный взаимоисключающий trait:

```text
basic
comfort
business
```

Class trait:

- используется selectors;
- корректирует logits запросов/напоминаний/жалоб;
- используется assessment для entitlement;
- определяет относительную строгость ожиданий по времени/качеству.

Класс не является hard whitelist запросов.

## Food/drink baseline

Добавлена простая service point модалка:

```text
[ Взять еду ]
[ Взять напиток ]
```

Еда и напиток — простые held items. Игрок держит максимум один предмет.

В baseline сознательно отсутствуют:

```text
запасы
подносы
посуда
мусор/упаковка
сбор посуды
отдельная уборка после питания
```

Для еды/напитка допускаются placeholder UI/icon assets.

## Совместимость с предыдущими документами

Обновлены ссылки/формулировки в:

- `project_direction.md`;
- `vsm_conductor_game_concept.md`;
- `vsm_baseline_vertical_slice.md`;
- `simulation/README.md`;
- `simulation/grid-world.md`;
- `simulation/selectors.md`;
- `simulation/scenario.md`;
- `simulation/feedback.md`;
- `implementation/service-levels.md`;
- `implementation/held-items.md`;
- `implementation/interactables.md`;
- `implementation/modal-content.md`;
- `implementation/trip-service-plan.md`;
- `implementation/asset-requirements.md`.

## Baseline для разработки

Версию 0.7.0 можно использовать как исходную документационную базу для реализации server simulation core.

Оставшиеся вопросы считаются implementation/tuning questions, если они не нарушают зафиксированные инварианты.
