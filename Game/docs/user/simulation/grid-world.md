# Grid/World: пространственная модель симуляции

**Версия документа:** 0.6.0
**Статус:** Draft
**Дата редакции:** 2026-09-27

## 1. Назначение

Game Server содержит authoritative пространственную модель. Client не является источником position, navigation, passability или occupancy.

Основой служит крупная логическая сетка, ориентированная на gameplay, а не пиксельную геометрию.

## 2. Масштаб клетки

Ориентир baseline:

- обычная cell — пространство порядка 2–3 стоящих людей;
- либо площадь одного кресла/локального объекта.

Размер клетки не обязан быть фиксированной физической единицей.

`capacity` дополняет геометрию:

```text
узкий проход  -> 1
обычная зона  -> 2..3
широкая зона  -> больше
кресло/место  -> согласно Level
```

Если понадобится привязка к метрам, Level может добавить scale без изменения логических coordinates.

## 3. Definition и runtime

Статические параметры и состояние попытки разделены.

```ts
interface CellDefinition {
  capacity: number;
  movementSpeedMultiplier?: number;
  material?: MaterialParameters;
}

interface CellRuntimeState {
  occupants: EntityId[];
  fire?: number;
  pressure?: number;
  contamination?: ContaminationOverlay[];
}
```

Storage layout не фиксируется документом.

## 4. Cells и directed edges

Cell хранит локальные свойства области.

Edge хранит свойства перехода/обмена:

```text
from / to
movement allowed
movement cost/speed
transition capacity
fire transfer weight
pressure transfer weight
```

Edges могут быть асимметричными/направленными.

Authoring compiler может автоматически создавать стандартные edges и применять sparse overrides.

## 4.1 Координаты train2: одна клетка = один тайл

Для `vsm-train2-01` геометрия берётся из `assets/map/train2-long.tmx`, а не из отдельной абстрактной сетки.

- 1 server cell = 1 тайл Tiled 64×64.
- `x` и `y` клетки — координаты тайла. Они могут быть отрицательными: перрон занимает x −6…−1.
- Обычный переход — 4-сосед внутри одного региона. Цена одного тайла в этом бандле — `movementCostPerTile` 0.25 (около 250 мс).
- Нос вагона (x 0…5) непроходим. Платформа и тамбур соединены явным door-link: направленные рёбра с id на `:door`. Цена = манхэттен в тайлах × 0.25.
- `platform-origin` и `platform-standard` — одни и те же тайлы, разные клетки. Сценарий включает один из регионов, как в baseline.

Клиент переводит клетку в пиксели как `((x − originX) · 64, (y − originY) · 64)`. Для текущей карты `originX` = −16, `originY` = 0.

Движок по-прежнему считает дистанцию pressure как `hypot(dx, dy) × 0.5` м на шаг координаты. Арт-масштаб тайла — 32 см. Этот коэффициент симуляции для train2 не переопределяется.

`vsm-baseline-01` остаётся короткой абстрактной сеткой и этим правилом не описывается.

## 5. Диагонали как corner edges

Baseline допускает диагональные переходы, но не вводит глобальную магию «8 соседей» и corner-cutting heuristic внутри pathfinding.

Диагональ трактуется как обычный explicit edge между cells, соприкасающимися углом/краем допустимого прохода:

```text
A .
. B

A -> B существует только если Level/compiler явно разрешил этот corner transition.
```

То, что две координаты геометрически диагональны, само по себе не делает переход допустимым.

Это позволяет описывать несимметричную геометрию вагона и не усложняет navigation engine специальными диагональными правилами.

## 6. Entities и world objects отделены от Grid

Entity в baseline — только player/passenger. Переносимые предметы и оборудование являются отдельными world objects/items.

```text
Entities
  player/passenger state + position/motion

World objects/items
  equipment/documents/held items

Grid
  cells + edges + environment

Spatial index
  cell/edge -> entity/object IDs
```

Это обычные статически определённые структуры состояния, а не ECS/component store.

## 7. Motion

Entity может быть:

```text
at cell
moving along edge/path segment
attached to another entity/object
```

Server умеет материализовать её position на произвольный `SimTimeUs`.

Client получает presentation motion и интерполирует.

## 8. Navigation

Pathfinding полностью server-side и может использовать utility library через adapter.

Он учитывает:

- directed topology;
- static/dynamic passability;
- cell capacity;
- edge transition capacity;
- movement cost/speed;
- entity-specific restrictions при необходимости.

## 9. Capacity

Baseline максимально простой:

- `cell.capacity` ограничивает simultaneous occupancy;
- `edge.transitionCapacity` ограничивает simultaneous transitions;
- начало движения резервирует необходимые ресурсы;
- при отсутствии capacity движение ждёт/перепланируется/становится недоступным согласно navigation policy.

Более сложную crowd-density модель не вводим без gameplay необходимости.

## 10. Простые spatial fields

Огонь, давление и похожие величины моделируются локальными полями поверх cells/edges.

Baseline — простой periodic stencil/convolution-like update:

```text
next(cell) =
    selfContribution
  + Σ neighbourValue * edgeTransfer
  + source
  - damping
```

Материал/Level задаёт коэффициенты, runtime — текущие значения.

Для огня baseline использует конечный запас топлива и периодический field-step:

```text
flammability
growth / decay
initialFuel / burnRate
spreadFuelScale / spreadGateThreshold / spreadGain
edge transfer weight
```

Для клетки с топливом `fuel` и интенсивностью `fire` один шаг приблизительно имеет семантику:

```text
fuel' = max(0, fuel - burnRate * dt * fire)
spreadGate = max(0, spreadGateThreshold - spreadFuelScale * fuel')
fire' = max(0, fire + growth * dt * fire - decay * dt
                 + transferredFire * spreadGain * spreadGate
                 + source * dt)
```

Если fuel для материала не задан, runtime сохраняет прежний простой режим без исчерпания топлива. Это позволяет использовать тот же `FieldWorld` для более простых тестовых полей.

Для давления `FieldWorld` всё ещё поддерживает простой stencil `source/leak + permeability/transfer`, но baseline pressure incident использует более прямой профиль, записывая pressure-loss по клеткам из евклидова расстояния до failure location:

```text
loss(cell) = max(0, sourceStageLoss - attenuationPerMeter * distance(cell, source))
```

Такой runtime проще интерпретируется как локальная потеря давления и не требует настройки искусственной диффузии для короткого вагона. Оба режима остаются gameplay-моделями, а не CFD.

## 11. Fields и discrete events

Дискретные изменения могут менять field coefficients/sources:

```text
door opened -> edge transfer changed
fire source appeared -> source changed
extinguisher used -> local fire reduced
```

Field step может породить discrete event при достижении threshold.


## 12. Санитарное состояние как overlay

> **Baseline/deferred:** spatial contamination overlay не входит в release `0.1.0`. Раздел фиксирует целевую модель, совместимую с текущим grid/runtime design.

Для baseline санитарная обстановка не является отдельной непрерывной simulation field.

Загрязнение — дискретное runtime state клетки/локальной области:

```ts
interface ContaminationOverlay {
  id: string;
  visualId: string;
  severity?: number;
}
```

Scenario/initial state определяет, где загрязнение существует. Level может ограничивать допустимые cells/anchors.

После реализации projection этого состояния Client должен получать только публичный overlay ID и накладывать соответствующий локальный tile/asset поверх базовой карты.

В baseline уборка не моделируется, поэтому contamination может оставаться статичным всю попытку. Если позднее появится `clean` action, он просто удаляет/изменяет этот runtime state entry.

## 13. Активные spatial regions

Grid может содержать несколько regions, часть которых неактивна в текущий момент.

Scenario управляет активацией regions/connections, но topology самих regions принадлежит Level.

Это используется для перрона:

```text
travel:
    carriage active
    platform inactive

stop:
    carriage active
    platform active
    door/platform connections enabled
```

Деактивация region не требует физической анимации перемещения поезда. Для simulation это изменение доступной topology.

## 14. Публичная проекция

Client не получает hidden navigation/field coefficients.

Он получает только визуализируемые результаты: motion, object state, видимый fire/smoke, public sensor readings и т.д.

## 15. Открыто

- формулы и frequency fire/pressure field-step; pressure distance в движке — 0.5 м на шаг координаты, а тайл train2 в арте — 32 см;
- точная navigation library/adapter policy.
