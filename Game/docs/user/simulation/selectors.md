# Selectors и правила преобразования state

**Версия документа:** 0.2.0  
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

Первая версия должна оставаться небольшой.

Примерный минимальный набор:

```text
entity type / object type
stable id
has trait
not has trait
property equality/comparison
current stage/context
spatial area/cell selector
boolean all / any / not
```

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

Scenario может после deterministic selection выполнять случайную выборку:

```text
probability
min
max
```

До RNG кандидаты приводятся к стабильному порядку, например по stable entity ID.

Random sampling использует выделенный deterministic RNG stream.

## 6. State diff как conceptual output

Operation может мыслиться как `(state) -> state_diff`, но runtime implementation не обязана буквально создавать универсальный JSON diff.

Внутри engine operation может породить typed domain changes/events:

```text
add/remove trait
activate failure
change object state
schedule event
spawn/despawn entity
```

Так сохраняется type safety без необходимости строить универсальный patch language.

## 7. Determinism

Если selector возвращает множество объектов, порядок не должен зависеть от iteration order контейнера.

Любая операция, для которой порядок применения меняет результат, обязана задавать стабильную сортировку явно.

## 8. Открытое

Точный serialized syntax selector expressions выбирается вместе с content schema. Семантика `selector + operation` фиксируется раньше конкретного YAML/JSON представления.
