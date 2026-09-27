# Scenario: конфигурация конкретной игровой попытки

**Версия документа:** 0.7.0
**Статус:** Draft / implementation baseline
**Дата редакции:** 2026-09-27

## 1. Ответственность

Scenario отвечает на вопрос:

> Что происходит в выбранной локации в рамках конкретного рейса и в какой последовательности?

Level описывает статическое пространство и допустимые объекты/регионы. Scenario выбирает стартовое состояние, генерирует пассажиров и traits, задаёт предрейсовую приёмку, последовательность поездок/остановок, scripted operations и terminal conditions.

Scenario не описывает поведение конкретного NPC как workflow: после изменения state/traits обычная trait/action машина самостоятельно формирует доступные действия.

## 2. Упрощённая структура Scenario

Для текущего проекта не требуется общий граф произвольных stages. Baseline использует компактную сценарную структуру:

```text
preDeparture
    ↓
originStop / boarding
    ↓
route: travel -> stop -> travel -> stop -> ...
    ↓
normal completion

terminal rules могут завершить попытку из любого допустимого состояния
```

Это намеренно проще универсальной stage-machine.

Концептуально:

```ts
interface ScenarioDefinition {
  preDeparture: PreDepartureDefinition;
  originStop?: StopDefinition;
  route: RouteDefinition;
  servicePlan?: ServicePlanDefinition;
  terminalRules: TerminalRule[];

  initialState?: ScenarioInitialStateDefinition;
  population?: PassengerPopulationDefinition;
  timeline?: ScenarioRule[];
}
```

Точная TypeScript/schema-форма может измениться, но семантическое разделение желательно сохранить.

## 3. Предрейсовая приёмка (`preDeparture`)

`preDeparture` — специальная часть сценария до начала рейса, а не обычная остановка.

В baseline:

- поезд стоит у исходного перрона;
- пассажирского потока нет;
- журнал приёмки находится на заданной точке перрона;
- игрок должен взять журнал, осмотреть вагон, заполнить документ и вернуть журнал в исходную точку;
- на приёмку задано ограниченное время до отправления;
- после истечения времени начинается рейс либо срабатывает terminal rule, если состояние вагона не допускает отправление.

Пример конфигурации:

```yaml
preDeparture:
  duration: 300s
  platformRegion: platform-origin

  passengerFlow: disabled

  acceptanceJournal:
    object: acceptance-journal
    homeAnchor: platform.acceptance-desk
    expectedAtDeparture: homeAnchor
```

Возврат заполненного и принятого журнала является gate перехода из `preDeparture`. Пока журнал не возвращён, `originStop` не начинается. Некритические замечания (например санитарное) могут быть зафиксированы в журнале и не блокируют переход; критическая техническая проблема активирует terminal rule.

Посадка пассажиров на исходной станции выражается отдельной `originStop` после `preDeparture`, а не расширением механики приёмки.

## 4. Переход от приёмки к посадке

Истечение `preDeparture.duration` завершает плановое окно приёмки, но переход к `originStop` происходит только после возврата заполненного и принятого журнала. Если журнал возвращён заранее, переход происходит в плановый момент. Если журнал сдан позже, переход происходит сразу после успешной сдачи, а последующее расписание сдвигается относительно фактического завершения приёмки.

Если `originStop` отсутствует, Scenario может перейти к departure напрямую.

На границе фактического отправления сервер может проверить:

- возвращён ли журнал;
- завершены ли обязательные проверки;
- существует ли критическая неисправность;
- допускает ли текущее состояние вагона начало рейса.

Эти проверки не обязаны запрещать все ошибки игрока. Некритические нарушения могут быть сохранены для assessment.

Критическое состояние может активировать terminal rule и завершить попытку до выезда.


## 5. Исходная остановка / посадка (`originStop`)

`originStop` — обычное окно посадки после завершения предрейсовой приёмки и до фактического отправления.

В этот момент:

- исходный перрон остаётся активным;
- начинается passenger flow;
- игрок проверяет билет/паспорт и принимает пассажиров;
- прибывающие пассажиры сначала размещаются в заданных platform boarding cells;
- игрок проверяет билет/паспорт и для каждого принимает `admit` либо `reject`;
- `admit` переносит пассажира на назначенное место и запускает его обычный NPC behavior loop;
- `reject` удаляет пассажира из текущего passenger flow;
- журнал приёмки уже должен быть возвращён в исходную точку;
- departure наступает не раньше окончания dwell и не раньше обработки всех ожидающих boarding decisions.

Это позволяет не смешивать две разные обязанности: техническую приёмку пустого вагона и обслуживание пассажиров при посадке.

Пример:

```yaml
originStop:
  dwell: 30m
  platformRegion: platform-origin
  passengers:
    board:
      count: 3
      populationPreset: demo-origin
```

В текущем baseline конкретные passenger definitions также содержат `boardingCellId`, public ticket/identity data и server-only `expectedBoardingDecision`, который нужен будущему assessment и не сериализуется клиенту.

Конкретное расписание может дополнительно задавать display-clock начала посадки и отправления. Simulation semantics остаётся основана на `SimTimeUs`.

## 6. Route как последовательность остановок

Основной рейс задаётся упорядоченным списком остановок. Каждая запись одновременно задаёт время поездки до остановки и параметры самой остановки.

Пример:

```yaml
route:
  stops:
    - id: stop-1
      travelBefore: 180s
      dwell: 60s
      platformRegion: platform-standard

      passengers:
        leave:
          count: 1
        board:
          count: { min: 2, max: 4 }
          populationPreset: regular

    - id: stop-2
      travelBefore: 240s
      dwell: 75s
      platformRegion: platform-standard

      passengers:
        leave:
          count: { min: 1, max: 3 }
        board:
          count: 2
```

Семантика:

```text
после originStop / departure
    ↓
travelBefore(stop-1)
    ↓
stop-1 / dwell
    ↓
travelBefore(stop-2)
    ↓
stop-2 / dwell
    ↓
...
```

Такой формат проще общего stage graph и непосредственно отражает текущий игровой цикл.

## 7. Остановка

Во время stop interval:

- активируется указанный platform region;
- открываются разрешённые door/platform connections;
- часть существующих пассажиров может покинуть поезд;
- создаётся заданное число новых пассажиров;
- новые пассажиры получают traits/параметры по population rules;
- после окончания `dwell` соединения с перроном закрываются и начинается следующий travel interval.

Scenario задаёт число и параметры пассажиров, а Level — физическую геометрию перрона и дверных соединений.

Пассажиры, которые должны выйти, выбираются детерминированным selector/sampling rule. Пассажиры на посадку генерируются через тот же deterministic RNG contract, что и остальные случайные элементы попытки.

## 8. Passenger generation

Distribution rules могут задавать:

```text
probability
min
max
selector
trait + optional lifetime parameters
preset/content references
```

Кандидаты перед random sampling имеют stable order. Randomness использует выделенный derived stream.

Если `min` невозможно удовлетворить из-за trait conflicts/selector constraints, generation должна завершаться явной ошибкой конфигурации, а не тихо нарушать правило.

## 9. Fixed passengers

Scenario может задавать фиксированных пассажиров для конкретного задания.

Generated и fixed passengers после создания используют одну runtime-модель `traits + actions + events`.

Fixed passenger не получает отдельную сценарную машину поведения.

## 10. Timeline rules

Scenario может применять изменения независимо от stop sequence:

```text
at simulation time
at preDeparture-relative time
at route-relative time
at stop enter/leave
on predicate/event
```

Rule состоит из:

```text
selector
+ optional deterministic sampling
+ operation
```

Например:

```text
passenger[awake]:not([hungry])
  sample probability/min/max
  -> addTrait(hungry, lifetime=...)
```

Selector semantics вынесены в `simulation/selectors.md`.

## 11. Scripted incidents

Scenario может планировать небольшой набор явных incident definitions отдельно от route stages. Baseline сейчас использует `fire` incident:

```ts
interface FireScenarioIncident {
  id: string;
  kind: "fire";
  startAfterDepartureUs: SimTimeUs;
  failureLocationId: string;
  initialFire: number;
  sourcePerSecond: number;
  criticalFire: number;
}
```

`failureLocationId` обязан ссылаться на Level failure location, разрешающую `fire`. Время отсчитывается от **фактического отправления**, поэтому позднее завершение приёмки сдвигает incident вместе с оставшимся расписанием.

При старте incident GameAttempt включает source и начальную интенсивность, затем планирует periodic field steps. Достижение `criticalFire` подаёт signal в обычный terminal-rule механизм; incident сам по себе не содержит отдельный workflow.

Текущий baseline задаёт один `cabin-fire` через 10 минут после отправления в `fire.cabin`.

## 12. Scenario operations baseline

Baseline operations:

```text
add/remove/change trait
activate/deactivate failure
spawn/despawn entity
change approved object/runtime state
activate/deactivate region or connection
schedule another scenario operation/event
```

Scenario не получает универсальный `patch SimulationState` и не исполняет произвольный JS/TS code.

## 13. Terminal rules

Досрочное завершение не требует отдельного emergency stage.

Scenario содержит набор terminal rules:

```ts
interface TerminalRule {
  id: string;
  when: ScenarioPredicate;
  outcomeId: string;
}
```

Примеры причин завершения:

```text
emergency-brake-used
wagon-unserviceable
critical-predeparture-fault
critical-structural-damage
fire-unsalvageable
```

`outcomeId` описывает факт/причину завершения, а не моральную оценку действия игрока.

Применение аварийного тормоза является управляемым ранним завершением. Во время движения игрок сначала снимает пломбу, а отдельным следующим действием активирует тормоз. Только активация посылает `emergency-brake-used` и завершает попытку через terminal rule.

Например применение аварийного тормоза в правильной аварийной ситуации может:

1. завершить попытку через terminal rule `route-safely-interrupted`;
2. считаться корректным и безопасным решением;
3. привести к высокому `safety`, хотя маршрут физически не завершён.

Сорванная пломба без активации остаётся отдельным наблюдаемым фактом для будущего assessment.

Assessment отдельно определяет качество действий и итоговые `safety`/`customerSatisfaction`.

Это позволяет различать:

```text
рейс завершён штатно
рейс безопасно прерван
рейс завершён из-за критической ошибки/повреждения
```

без превращения каждого варианта в отдельный stage.

## 13. Нормальное завершение

После завершения последней остановки или последнего travel interval Scenario может закончить попытку штатно.

Отдельный post-shift/hand-off stage для baseline не требуется.

Если позднее появятся уборка, сдача вагона или итоговая процедура, они могут быть добавлены отдельным `postRun` разделом без изменения структуры `preDeparture + route`.

## 14. Random generation: eager + lazy

То, что не зависит от будущих действий игрока, желательно разрешать при старте run:

```text
initial passenger definitions
initial traits
initial faults/contamination
fixed random timeline values
```

Runtime-dependent randomness разрешается lazily в соответствующем deterministic RNG stream.

Persistent result хранит root seed + authoritative user input log + compatibility/content versions, а не полный resolved scenario dump.

## 15. Level compatibility

Scenario может объявлять requirements к Level/preset:

```text
required carriage region
required platform region IDs
required door/platform connections
required object IDs/types
required anchors
required field capabilities
required action/content assets
```

Content validation выполняется до создания attempt.


## 16. Уровни обслуживания и план рейса

Scenario назначает пассажиру ровно один service-class trait (`basic`, `comfort` или `business`) и может задавать временные окна обслуживания. Класс участвует в обычной trait/action модели; отдельного `serviceLevelId` нет. Конкретные правила текущего demo описаны в `implementation/service-levels.md`.

Уровень обслуживания не является фильтром допустимых просьб пассажира: NPC может запросить услугу вне своего класса. Service level определяет entitlement и требования assessment к реакции игрока.

Пассажирский generation может задавать распределение уровней обслуживания так же, как другие параметры population:

```yaml
serviceLevels:
  basic: 0.50
  comfort: 0.35
  business: 0.15
```

Точные probability/min/max semantics могут использовать тот же deterministic sampling contract, что и trait distribution.

План рейса не требует новых Stage для каждого сервисного интервала. Scenario может содержать `servicePlan.windows[]`, привязанные к departure/arrival/stop anchors:

```yaml
servicePlan:
  windows:
    - id: meal-service
      start: { afterDeparture: 15m }
      end:   { afterDeparture: 45m }
      passengerSelector: passenger[serviceLevel=comfort], passenger[serviceLevel=business]
      services: [meal, drink]

    - id: arrival-preparation
      start: { beforeFinalArrival: 15m }
```

Service window является context для actions/traits/assessment/coaching, а не собственной state machine.

Примерный конкретный график текущего demo вынесен в `implementation/trip-service-plan.md`.

## 17. Открыто

- точная serialized schema passenger flow/service-level distribution rules;
- насколько гибкими должны быть terminal predicates в первой версии;
- нужен ли отдельный `postRun` позднее;
- окончательные параметры preDeparture/originStop/stop/service-window defaults после первого игрового прогона.
