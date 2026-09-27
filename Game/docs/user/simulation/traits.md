# Traits: состояние и модификаторы поведения сущности

**Версия документа:** 0.4.0  
**Статус:** Draft / implementation baseline  
**Дата редакции:** 2026-09-27

## 1. Принцип

Trait остаётся максимально плоским.

На сущности trait представлен только строковым ID:

```ts
traits: string[]
```

Примеры:

```text
business
hungry
waiting-drink
impatient
sleeping
```

Trait одновременно может быть:

- фактом/состоянием сущности;
- selector target (`hasTrait(hungry)`);
- источником candidate actions;
- hard restriction действий;
- источником logit corrections;
- negative condition для назначения другого trait.

Не вводятся categories, metadata tags, positive/negative classes, inheritance или ECS-components без конкретной необходимости.

Сам trait ID является semantic tag.

## 2. Trait Definition

Смысл trait хранится в Content Registry:

```ts
interface TraitDefinition {
  id: string;

  addActions?: ActionAssetRef[];
  blacklistActions?: ActionSelector[];
  whitelistActions?: ActionSelector[];

  logitModifiers?: LogitModifierDefinition[];
  rejectIf?: SelectorExpression[];
}
```

Trait Definition — сериализуемый content asset. Runtime entity не копирует его поля к себе.

## 3. Runtime representation

Runtime state сущности хранит только уникальный список trait IDs:

```ts
interface EntityState {
  traits: string[];
}
```

Семантически это множество. Для deterministic serialization/iteration рекомендуется хранить IDs в каноническом стабильном порядке.

Отдельный `TraitInstance` в baseline не нужен.

Если движку требуется служебная информация для time-dependent modifier или expiry, он может хранить минимальный внутренний bookkeeping по ключу `(entityId, traitId)`:

```text
grantedAt
expiry generation/token
```

Этот bookkeeping не меняет семантическую модель: для остальных подсистем trait остаётся строкой в `entity.traits`.

## 4. Добавление, удаление и истечение

Trait может исчезнуть двумя способами:

1. быть удалён внешним action/event/scenario operation;
2. автоматически истечь по заданному lifetime.

Операция добавления может выглядеть концептуально так:

```text
addTrait(entity, hungry)
addTrait(entity, hungry, lifetime = 10m)
```

Если указан lifetime, scheduler ставит `ExpireTrait(entityId, traitId, generation)`.

При expiry:

```text
ExpireTrait
    ↓
проверить generation/token
    ↓
remove trait from entity.traits
```

Старый expiry не должен удалить trait, который уже был снят и выдан заново. Для этого используется обычная lazy invalidation через generation/token scheduler-а.

Повторное добавление существующего trait:

- без lifetime — idempotent no-op;
- с lifetime — обновляет срок действия и инвалидирует старый expiry.

Внешнее `removeTrait` также инвалидирует ожидающий expiry.

## 5. Conflicts

`rejectIf` — отрицательный selector, проверяемый перед добавлением trait.

Пример:

```text
sleeping.rejectIf = hasTrait(awake)
```

Если selector совпал, trait не устанавливается.

Baseline не вводит отдельные группы взаимоисключения. Если переход должен заменить состояние, action/event явно удаляет один trait и добавляет другой.

## 6. Candidate actions

Trait может:

- добавить action в candidate set;
- запретить action;
- ограничить допустимый набор actions whitelist-ом;
- изменить logit action.

Несколько whitelist являются hard constraints и объединяются пересечением. После них применяется blacklist.

Системный fallback `idle/wait` должен сохранять entity в валидном runtime state, даже если обычный candidate set пуст.

## 7. Logits и выбор действия

После hard filtering каждый candidate получает итоговый logit:

```text
finalLogit(action) =
    baseLogit(action)
    + Σ trait contributions
    + Σ context contributions
```

Первая версия использует stable softmax:

```text
p_i = exp(logit_i - maxLogit)
      / Σ exp(logit_j - maxLogit)
```

Затем выбор выполняется deterministic RNG stream соответствующей сущности/decision domain.

Hard restriction всегда применяется до softmax и не кодируется огромным отрицательным logit.

## 8. Time-dependent modifiers

Trait modifier может зависеть от времени.

Baseline достаточно небольшого набора curve presets:

```text
constant
linear
sigmoid
window
```

Источник времени задаётся явно, например:

```text
traitAge
routeTime
timeOfDay
serviceWindowTime
```

Для `traitAge` движок использует внутренний `grantedAt`, не превращая trait на сущности в сложный object.

Произвольный executable code в content asset не требуется.

## 9. Traits и Action FSM

Traits описывают текущее состояние и вероятности поведения, Actions — переходы.

Пример:

```text
thirsty
   ↓ request-drink selected
thirsty + waiting-drink
   ↓ DrinkGiven event resolves waiting action
thirsty + has-drink
   ↓ drink
satisfied
```

Отдельный FSM graph не хранится. Он динамически возникает из:

```text
traits
+ world state
+ current action
+ available actions
+ events
```

## 10. Класс обслуживания как trait

Для текущего demo принадлежность к классу обслуживания выражается обычными взаимоисключающими traits:

```text
basic
comfort
business
```

Они используются так же, как любые другие traits:

- selectors выбирают пассажиров по классу;
- trait корректирует logits запросов/жалоб;
- assessment определяет entitlement и требования к скорости обслуживания по наличию trait.

Например `business` может немного повысить logits повторного запроса или жалобы при задержке, не создавая отдельного поля `serviceLevelId`.

Scenario должен гарантировать, что пассажиру назначен ровно один service-class trait.

## 11. Selectors

Traits используются напрямую в CSS-like selector logic:

```text
passenger[business][hungry]:not([sleeping])
```

Второй metadata/tag слой не требуется.

## 12. Validation

Content validation должна проверять:

- существование referenced actions;
- уникальность trait ID;
- корректность selector expressions;
- очевидно бессмысленные whitelist/blacklist combinations;
- curve params;
- ссылки на неизвестные traits/actions;
- service-class constraints конкретного Scenario, если они заданы.

## 13. Инварианты baseline

1. Trait runtime — строка в `entity.traits`.
2. У сущности нет общего metadata bag для traits.
3. Список traits не содержит дубликатов.
4. Trait может истечь автоматически либо быть удалён извне.
5. Lifetime задаётся при выдаче trait, а не хранится в TraitDefinition.
6. Служебный timer/generation не является частью публичного trait state.
7. Traits формируют candidate actions и logits, но не исполняют поведение сами.
8. Дальнейшее поведение после изменения traits снова определяется обычным action decision cycle.

## 14. Открыто после baseline

Не блокирует первую реализацию:

- точный serialized schema curve presets;
- нужен ли отдельный API для `refreshTrait`, если поведения `addTrait(..., lifetime)` окажется недостаточно;
- потребуется ли оптимизировать хранение большого числа timed traits после реальных нагрузочных тестов.
