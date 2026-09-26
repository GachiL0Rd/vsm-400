# Level: статическая локация и пространственные параметры

**Версия документа:** 0.3.0  
**Статус:** Draft  
**Дата редакции:** 2026-09-27

## 1. Ответственность

Level отвечает на вопрос:

> Где происходит симуляция и какими статическими свойствами обладает это пространство?

`LevelDefinition` — внутренняя spatial сущность simulation content. Внешний `gameLevelId`, приходящий от Platform Server, разрешается Game Server в локальный versioned preset/config.

Level не определяет конкретный passenger flow и timeline рейса — это ответственность Scenario.

## 2. Состав Level

Level может содержать:

- regions;
- grid cells и topology;
- explicit/generated edges;
- directionality/passability;
- capacity и movement modifiers;
- простые material/field coefficients;
- статические объекты;
- anchors;
- допустимые места неисправностей;
- region connections;
- references на client visual assets.

## 3. Regions

Level может быть разбит на логические spatial regions.

Baseline минимум:

```text
carriage-main      всегда активная основная область
platform-origin    исходный перрон для приёмки
platform-standard  регион перрона, подключаемый на остановках
```

Region является частью статического Level и может быть активирован/деактивирован Scenario.

Неактивный region:

- не участвует в navigation;
- не принимает новых entities;
- не обязан отправляться клиенту как видимая часть сцены;
- его connections считаются закрытыми.

## 4. Перрон как подключаемая область

Для baseline выбран вариант временно подключаемого перрона.

Перрон не является движущимся фоном и не требует анимации приезда/отъезда поезда.

На остановке:

```text
activate platform region
open configured carriage <-> platform connections
spawn/retain platform passengers
```

При отправлении:

```text
close connections
deactivate platform region
continue route
```

Client может показывать перрон как дополнительную «комнату», пристыкованную к двери вагона.

Во время движения внешний фон может быть нейтральным/пустым. Анимация движения поезда не является требованием baseline.

Один generic platform region может повторно использоваться разными остановками, если сценарий не требует уникальной геометрии станции.

## 5. Cells и edges

Runtime engine работает с отдельными cells и edges.

Authoring не обязан перечислять каждый обычный edge вручную. Content compiler может автоматически построить стандартное соседство и применить sparse overrides.

Baseline допускает диагональные переходы как explicit corner edges. Геометрическая диагональность сама по себе не разрешает движение.

## 6. Статические объекты

Level задаёт существование и начальное пространственное размещение:

```text
doors
seats
panels
climate-control
emergency-brake
extinguisher mounts
communication device
journal anchors on platform
service points
```

Mutable runtime state создаётся при старте попытки отдельно.

## 7. Anchors

Anchor — стабильная именованная точка/место внутри Level, используемая Scenario и object placement.

Примеры:

```text
platform.acceptance-desk
carriage.extinguisher-1
carriage.driver-comms
carriage.door-left
```

Для журнала приёмки Scenario может задать один anchor как исходную и ожидаемую конечную позицию.

## 8. Initial runtime state

Level может задавать default initial state объекта, но Scenario имеет право выбрать допустимый вариант или переопределить его в рамках конкретного задания.

Следует различать:

```text
allowed/configurable states
конкретно выбранный state этой попытки
```

## 9. Failure locations

Level описывает, где физически возможно возникновение неисправности/источника и какие spatial components она затрагивает.

Scenario определяет, возникает ли она в конкретном run, когда и в каком допустимом месте.

## 10. Санитарные overlay locations

Загрязнения относятся к runtime world state, но Level может задавать cells/anchors, где допустимы санитарные overlays.

Само загрязнение не запекается в background tile и не требует отдельной геометрии Level.

Client получает stable visual ID и отображает overlay поверх базового пространства.

## 11. Простые material parameters

Первая версия не описывает полную физику материалов.

Level хранит только коэффициенты, реально используемые gameplay-моделью, например:

```text
fire growth/spread coefficient
pressure permeability
movement modifier
```

Новые параметры добавляются вместе с механикой, которая их использует.

## 12. Authoring и canonical data

Canonical LevelDefinition должен быть JSON-compatible и иметь schema/version.

Authoring source может быть:

```text
JSON
YAML
экспорт будущего editor
```

Build/content step валидирует source и преобразует его в canonical representation. Engine не зависит от конкретного authoring syntax.

## 13. Client assets и coordinates

Visual asset reference не означает, что весь LevelDefinition отправляется browser.

Server-side logical grid и public presentation coordinates разделены projection gate.

Client может получить публичную геометрию активных regions/объектов, необходимую для рендера, но не получает скрытые navigation/field coefficients.

## 14. Совместимость со Scenario

Желательно, чтобы один Level поддерживал несколько scenarios.

Scenario может объявлять requirements/capabilities Level, включая region IDs и connections, используемые для preDeparture и stops.

## 15. Validation

До запуска проверяются:

- topology;
- region definitions;
- ссылки объектов/anchors на cells;
- edges/directionality;
- connections;
- численные параметры;
- уникальность IDs;
- object placement;
- Scenario requirements;
- schema/version compatibility.

## 16. Открытые вопросы

- первый authoring format: YAML или JSON;
- public world coordinates для Phaser;
- нужен ли отдельный level editor после стабилизации schema;
- достаточно ли одного reusable platform region или позже понадобятся разные station presets.
