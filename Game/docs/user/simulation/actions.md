# Actions: переходы состояния и цикл поведения

**Версия документа:** 0.4.0  
**Статус:** Draft / implementation baseline  
**Дата редакции:** 2026-09-27

## 1. Назначение

Action — единица поведения сущности и один семантический переход её состояния.

Поведение пассажира не описывается отдельным FSM-графом. Машина состояний возникает динамически из текущего состояния сущности:

```text
traits
  ↓
candidate actions
  ↓
hard filtering
  ↓
logit corrections
  ↓
softmax + deterministic RNG
  ↓
selected action
  ↓
action lifecycle
  ↓
state / traits changed
  ↓
new decision
```

Для игрока используется та же action system, но action выбирает пользователь, а не decision engine.

## 2. Entity state

Для baseline не требуется ECS или произвольный component store. Общая модель сущности вынесена в `entities.md`.

Сущность — обычный объект/класс с заранее определённым состоянием. Минимальная общая часть может выглядеть так:

```ts
interface Entity {
  id: EntityId;
  kind: "player" | "passenger";

  position: EntityPosition;
  traits: string[];

  heldItemId?: ItemId;
  currentAction?: CurrentAction;
}
```

Конкретные типы сущностей могут иметь дополнительные статически определённые поля.

### 2.1. Traits в runtime

В runtime trait — строковый ID в `entity.traits`:

```text
business
hungry
waiting-drink
impatient
```

Смысл trait находится в Content Registry. В самой сущности не требуется `TraitInstance`, metadata bag или ECS-component.

Временное добавление/удаление trait реализуется обычными событиями timeline. Если trait должен исчезнуть через некоторое время, движок планирует событие его удаления.

## 3. Action Definition и Action Handler

Action разделяется на сериализуемое определение и реализацию в коде.

### 3.1. Action Definition

Action Definition является content asset:

```ts
interface ActionDefinition<P> {
  id: string;
  handler: string;
  baseLogit: number;
  params: P;
}
```

Пример:

```yaml
id: request-drink
handler: request-item
baseLogit: -2.0
params:
  itemKind: drink
  waitingTrait: waiting-drink
  timeoutSeconds: 120
```

Definition не содержит исполняемый код и не описывает workflow.

### 3.2. Action Handler

Handler зарегистрирован в движке и реализует семантику типа действия.

Примеры handler-типов:

```text
move
wait
request-item
give-item
consume-item
inspect
open-close
use-object
edit-document
submit-document
```

Utility libraries внутри handler разрешены. Движок не требует самостоятельно реализовывать типовые алгоритмы, если выбранная библиотека удовлетворяет deterministic contract там, где это необходимо.

## 4. Candidate actions

Автономная сущность может начать новое действие, только если у неё отсутствует `currentAction`.

Candidate set строится из:

- базовых actions типа сущности;
- actions, добавленных текущими traits;
- actions, доступных из текущего окружения;
- контекстных interactions с объектами/другими сущностями.

После этого применяются:

1. hard restrictions traits;
2. `handler.canStart(...)`;
3. проверки target/context;
4. logit corrections traits и контекста.

Итоговый выбор NPC выполняется stable softmax:

```text
P(action_i) = exp(logit_i - maxLogit)
              / Σ exp(logit_j - maxLogit)
```

После чего используется deterministic RNG stream сущности/decision domain.

Hard restriction никогда не заменяется большим отрицательным logit.

## 5. Player actions

Для игрока candidate actions проходят те же server-side проверки, но softmax не используется.

Архитектурно Server projection должен предоставлять клиенту opaque runtime action handles.
В текущем release это не отдельный универсальный action-handle protocol: часть взаимодействий
экспортируется специализированными public interaction DTO. Поэтому схема ниже описывает целевой
unified action boundary, а не буквальный wire contract `0.1.0`:

```text
available action
    ↓
client renders button / dialogue option / interaction
    ↓
invoke(actionId)
    ↓
server validates again
    ↓
start action
```

Client не определяет доступность или результат action самостоятельно.

## 6. Action lifecycle

Baseline поддерживает три формы action.

### 6.1. Instant

Действие полностью завершается в момент запуска:

```text
start → finished
```

Примеры:

```text
поставить отметку в журнале
нажать кнопку обновления
переключить простой объект
```

Такой action не сохраняется в `entity.currentAction`.

### 6.2. Running

Действие занимает известное simulation time:

```text
start → running → complete
```

Примеры:

```text
перемещение
осмотр
приём пищи
```

Runtime:

```ts
interface RunningAction {
  kind: "running";
  completesAt: SimTimeUs;
}
```

### 6.3. Waiting

Действие началось, но его результат определяется внешним simulation event или timeout:

```text
start → waiting ── matching event ──→ success
              └── timeout ─────────→ timeout
              └── interrupt ───────→ interrupted
```

Примеры:

```text
попросить напиток и ждать его
ожидать ответа на обращение
ожидать результата другого участника взаимодействия
```

Runtime:

```ts
interface WaitingAction {
  kind: "waiting";
  timeoutAt?: SimTimeUs;
}
```

Какие события завершают waiting-action, определяет его typed handler и параметры Action Definition. Произвольный scripting matcher внутри content asset не требуется.

## 7. CurrentAction

Для baseline у сущности может быть не более одного активного action.

```ts
interface CurrentAction {
  actionId: string;
  generation: number;
  startedAt: SimTimeUs;

  targetId?: string;

  phase:
    | { kind: "running"; completesAt: SimTimeUs }
    | { kind: "waiting"; timeoutAt?: SimTimeUs };
}
```

`generation` используется для lazy invalidation запланированных completion/timeout events.

Action Definition повторно получается по `actionId` из Content Registry; нет необходимости копировать его параметры в entity state.

## 8. Один Action — одна семантическая операция

Action не обязан быть мгновенным, но он не содержит собственную branching state machine.

Допустимо:

```text
request-drink
  start
  ↓
waiting
  ├─ DrinkGiven → success
  └─ timeout    → timeout
```

Недопустимо как один action:

```text
request-drink
  → wait
  → if delivered then eat
  → else complain
  → if complaint ignored then leave
```

После terminal outcome action заканчивается. Дальнейшее поведение снова определяется новым набором traits/state и обычным decision cycle.

## 9. Action outcomes

Единый минимальный набор исходов:

```ts
type ActionOutcome =
  | "success"
  | "timeout"
  | "interrupted";
```

`rejected` не является outcome запущенного action: если действие не прошло runtime validation, оно не стартует.

Handler может применять разные terminal effects для разных outcome, но после них action обязан завершиться.

## 10. Action mutation boundary

Запуск и завершение action являются атомарными simulation transitions.

Семантически handler работает так:

```text
validate
  ↓
compute mutation
  ↓
commit atomically
```

Если validation не прошла, частичных изменений мира быть не должно.

Handler может через ограниченный simulation API:

- добавить/remove trait;
- изменить статически определённое состояние сущности/объекта;
- передать/удалить held item;
- изменить position/motion state;
- запланировать simulation event;
- создать presentation-observable факт через обычное изменение public state;
- завершить или прервать текущий action.

Универсальный Effect DSL baseline не требуется.

## 11. Waiting action и events

Waiting-action не создаёт отдельный `ServiceRequest` или workflow object, если его состояние полностью выражается через entity traits и текущий action.

Пример запроса напитка.

### 11.1. Начальное состояние

```text
passenger traits:
  business
  thirsty
```

Trait `thirsty` делает `request-drink` candidate action.

### 11.2. RequestDrink.start

Handler:

```text
+ waiting-drink
currentAction = request-drink / waiting
timeoutAt = now + 120s
```

Публичная проекция может показать реплику/запрос пассажира.

### 11.3. Доступность действия игрока

У игрока появляется `give-drink`, если одновременно выполняются условия:

```text
player holds drink
AND
near passenger
AND
passenger has waiting-drink
```

Это обычный player action, а не специальный request protocol.

### 11.4. Доставка

`give-drink` изменяет состояние предмета и создаёт domain event, например:

```text
ItemGiven {
  giverId: player,
  targetId: passenger-17,
  itemKind: drink
}
```

Ожидающий `request-drink` handler видит совпадающий event для своего actor и планирует resolution того же simulation time с более поздним sequence.

### 11.5. Success

При resolution:

```text
- waiting-drink
+ has-drink      // если это нужно модели
currentAction = none
```

После этого passenger снова проходит decision cycle. Например `has-drink` может сделать candidate action `drink`.

### 11.6. Timeout

Если matching event не пришёл:

```text
RequestDrinkTimeout(actionGeneration)
```

при совпадающей generation приводит к terminal outcome `timeout`:

```text
- waiting-drink
+ annoyed        // если определено handler/config
currentAction = none
```

После этого следующий action снова выбирается обычным decision engine. `complain` не вызывается напрямую из `request-drink`.

## 12. Event matching

После обработки domain event движок может проверить, соответствует ли он текущему waiting-action затронутых сущностей.

Чтобы порядок оставался детерминированным:

```text
#100 ItemGiven
    ↓ apply
#101 ResolveWaitingAction(passenger-17, generation=4, success)
```

Resolution создаётся как обычное событие timeline с тем же `SimTime`, но большим `sequence`.

Timeout events также содержат `generation`, поэтому уже завершившееся или заменённое действие автоматически игнорирует старый timeout.

## 13. Interrupt

Некоторые внешние события могут прервать текущий action.

Примеры:

```text
пожарная тревога
эвакуация
потеря доступности target
критическое изменение пути
```

Baseline не требует универсальной сложной interrupt policy. Handler должен объявлять, допускает ли action interrupt определённого класса.

При interrupt:

```text
apply interrupt effects
clear currentAction
increment generation
new decision if entity remains autonomous
```

Для первой версии ожидается небольшое число явно поддержанных причин прерывания.

## 14. Running action и непрерывное состояние

Running action не требует mutation каждый tick.

Например `move` может хранить серверный motion segment:

```text
from
path / next target
action startedAt
completion time
```

Position в произвольный `SimTime` вычисляется из серверного movement state. Completion event завершает action и запускает следующий decision.

## 15. Actions и Traits

Trait не владеет action implementation.

```text
Action Handler
      ↓
Action Definition
      ↑
Trait может добавить его в candidates
      ↑
Trait может изменить его logit
      ↑
Trait может запретить его
```

Пример:

```text
business:
  request-drink +1.0
  request-food  +1.0
  complain      +0.4

thirsty:
  add request-drink
  request-drink +4.0

waiting-drink:
  blacklist request-drink
  wait          +2.0
```

Trait runtime остаётся обычной строкой в `entity.traits`.

## 16. Dialogue

Dialogue не является отдельной state machine.

NPC action может породить публичную реплику или interaction state. Player-facing dialogue option является представлением обычного доступного action.

```text
simulation action
      ↓
public interaction / text
      ↓
client renders dialogue
      ↓
player invokes opaque action
      ↓
server action handler
```

## 17. Content validation

При загрузке content проверяется:

- существует ли указанный handler;
- соответствует ли `params` schema handler-а;
- существуют ли action IDs, на которые ссылаются traits;
- корректны ли base logits;
- существуют ли referenced traits/items/object IDs, если handler schema требует статическую ссылку.

State-dependent validation выполняется повторно непосредственно перед `start`.

## 18. Инварианты baseline

1. У сущности не более одного `currentAction`.
2. Trait runtime — строка в `traits[]`.
3. Новый NPC action выбирается только при отсутствии `currentAction`.
4. Action является одним семантическим переходом, а не workflow.
5. Action может быть `instant`, `running` или `waiting`.
6. Waiting action завершается matching event, timeout или interrupt.
7. Action terminal outcome всегда очищает `currentAction`.
8. Action не выбирает следующее поведение напрямую; после завершения снова работает decision engine.
9. Player и NPC по возможности используют общий handler registry.
10. Все state-dependent проверки authoritative и выполняются на server.
11. Completion/timeout events используют generation для lazy invalidation.
12. Внешний event и resolution waiting-action имеют детерминированный sequence order.
13. Action mutations применяются атомарно.
14. Baseline не требует ECS, ServiceRequest abstraction или Effect DSL.

## 19. Открытые вопросы после реализации baseline

Эти вопросы не блокируют первую реализацию:

- понадобится ли когда-либо несколько параллельных actions одной сущности;
- какие interrupt classes окажутся реально необходимыми после первых сценариев;
- потребуется ли action-specific runtime data кроме `target` и стандартной phase;
- нужен ли waiting-action без timeout как постоянный режим;
- понадобится ли впоследствии общий сериализуемый effect layer для authoring tools.
