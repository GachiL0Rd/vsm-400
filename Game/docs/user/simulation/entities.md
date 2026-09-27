# Entities: минимальное состояние игрока и пассажира

**Версия документа:** 0.1.0  
**Статус:** Draft / implementation baseline  
**Дата редакции:** 2026-09-27

## 1. Назначение

Baseline сознательно не использует ECS.

Entity в simulation — только действующий персонаж:

```text
player
passenger
```

Оборудование, документы, переносимые предметы, панели и элементы Level являются world objects/items со своими статически определёнными структурами состояния, но не обязаны становиться Entity.

## 2. Базовое состояние

Минимальная общая форма:

```ts
interface EntityState {
  id: EntityId;
  kind: "player" | "passenger";

  position: Position;
  traits: TraitId[];

  heldItemId?: ItemId;
  currentAction?: CurrentAction;
}
```

Конкретные сущности имеют обычные статически определённые поля, а не произвольный component bag.

Например Passenger может дополнительно содержать:

```text
seat / destination
appearance IDs
document references
NPC-specific state
```

Player — данные, необходимые именно игроку.

## 3. Traits

`traits` — список строковых IDs.

Семантически список является множеством:

- дубликаты запрещены;
- selector проверяет наличие ID;
- порядок не должен влиять на gameplay;
- для deterministic serialization допустим канонический порядок по ID.

Timing/expiry bookkeeping описан в `traits.md` и не превращает элемент списка в `TraitInstance`.

## 4. Current action

У entity в baseline не более одного `currentAction`.

Его lifecycle описан в `actions.md`:

```text
none
instant
running
waiting
```

Decision engine выбирает новое NPC action только когда текущее действие завершено либо прервано.

## 5. Held item

Для baseline entity держит максимум один предмет:

```ts
heldItemId?: ItemId;
```

`ItemId` относится к item/world-object storage, а не к Entity.

Это позволяет одинаково держать:

```text
acceptance journal
extinguisher
food
drink
```

без полноценной inventory system.

## 6. Position

Положение и movement authoritative на Game Server.

Entity может находиться:

```text
в cell
в переходе между cells
в motion segment/path
```

Client получает только public presentation motion.

## 7. Public projection

Внутренний EntityState не сериализуется напрямую.

Projection может раскрывать:

```text
public position/motion
appearance
held item visual ID
visible interaction state
```

и скрывать:

```text
traits
action logits
hidden document facts
future decisions
assessment state
```

Guided/replay modes могут добавлять разрешённые extensions, не меняя базовую модель Entity.

## 8. Инварианты

1. Baseline не требует ECS.
2. Entity — player или passenger.
3. World object/item — отдельная категория runtime state.
4. Traits представлены строками.
5. У Entity один held item и максимум один current action.
6. Сервер владеет position/action state.
7. Типоспецифичные поля задаются обычными интерфейсами/классами.
