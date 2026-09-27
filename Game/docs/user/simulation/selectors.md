# Selectors и правила преобразования state

**Версия документа:** 0.3.0
**Статус:** Draft  
**Дата редакции:** 2026-09-27

## 1. Идея

Selectors используют CSS-подобную концепцию: декларативно найти объекты по текущему state, а затем применить к выбранным объектам operation.

Это не CSS и не система стилей. Общая форма:

```text
selector(state) -> targets
operation(state, targets) -> state changes / events
```

или визуально:

```text
passenger[hungry]:not([sleeping])
    -> addTrait(impatient, lifetime=5m)
```

## 2. Где используются selectors

Текущий runtime уже использует плоский `EntitySelector` для entity/trait filtering,
`Trait.rejectIf` и action preconditions. Более широкий selector mechanism ниже является baseline
extension для Scenario и других content-driven rules.

Один и тот же conceptual mechanism может использоваться для:

- Scenario trait distribution;
- timeline operations;
- выбора пассажиров;
- Trait `rejectIf`;
- action targeting/preconditions;
- achievement/coaching checks;
- выбора cells/objects для scripted failures.

При этом разные подсистемы могут ограничивать доступный набор predicates/operations.

## 3. Базовые predicates

Текущий `EntitySelector` release runtime поддерживает:

```text
entity kind
stable entity id
has trait
boolean all / any / not
```

То есть фактическая структура соответствует `kind | id | trait | all | any | not`.

Baseline может расширить selector vocabulary predicates для object type, property comparison,
current stage/context и spatial area/cell. Эти predicates не следует считать уже реализованными
только потому, что они перечислены как целевая модель.

Literal CSS grammar не является требованием. Важна плоская и читаемая декларативная semantics.

## 4. Selection и mutation разделены

Selector сам не меняет state.

Rule состоит из:

```text
selector
+
operation
```

Это позволяет один selector переиспользовать в разных действиях и не смешивать поиск с mutation semantics.

## 5. Sampling

Deterministic sampling является baseline extension. Текущая Scenario schema release `0.1.0`
не содержит общего `selector + sampling + operation` runtime. После его добавления Scenario может
после deterministic selection выполнять случайную выборку:

```text
probability
min
max
```

До RNG кандидаты приводятся к стабильному порядку, например по stable entity ID.

Random sampling использует выделенный deterministic RNG stream.

## 6. State diff как conceptual output

Operation может мыслиться как `(state) -> state_diff`, но runtime implementation не обязана буквально создавать универсальный JSON diff.

В целевом Scenario rule runtime operation может породить typed domain changes/events, например:

```text
add/remove trait
activate failure
change object state
schedule event
spawn/despawn entity
```

Это baseline vocabulary, а не перечень уже доступных generic operations release `0.1.0`.

Так сохраняется type safety без необходимости строить универсальный patch language.

## 7. Determinism

Если selector возвращает множество объектов, порядок не должен зависеть от iteration order контейнера.

Любая операция, для которой порядок применения меняет результат, обязана задавать стабильную сортировку явно.

## 8. Открытое

- Serialized syntax общего Scenario `selector + operation` пока не входит в schema `1`.
- Нужно определить, какие baseline predicates действительно нужны сверх текущего `EntitySelector`.
- Семантика selection и mutation должна оставаться разделённой независимо от конкретного YAML/JSON представления.
