# Игровые объекты и взаимодействия текущего demo

**Версия документа:** 0.4.0
**Статус:** Draft
**Дата редакции:** 2026-09-27

## 1. Назначение

Документ связывает конкретный demo-контент с общей Action/State архитектурой.

Это не заменяет `simulation/actions.md`: здесь перечислены конкретные сущности, их минимальный state и ожидаемые действия.

## 2. Сводная таблица

| Объект | Пространственный тип | Можно держать | Детальная модалка | Основные действия |
|---|---|---:|---:|---|
| Журнал приёмки | platform/held document | да | да | взять, открыть, редактировать, вернуть |
| Огнетушитель | mounted/held item | да | да | осмотреть, взять, вернуть, подготовить, использовать |
| Климат-контроль | stationary system | нет | да | открыть, обновить данные |
| Стоп-кран | stationary object | нет | да | осмотреть, сорвать пломбу/активировать по правилам |
| Связь с машинистом | stationary system | нет | опционально | проверить связь, вызвать/доложить |
| Точка обслуживания | stationary service point | нет | да, простая | взять еду, взять напиток |
| Билет | passenger-bound document | нет | да | открыть/закрыть/сравнить |
| Паспорт | passenger-bound document | нет | да | открыть/закрыть/сравнить |

## 3. Журнал приёмки

### Runtime state

Примерно:

```ts
interface AcceptanceJournalState {
  communication: CheckState;
  extinguisher: CheckState;
  climate: CheckState;
  emergencyBrake: CheckState;
  sanitation: SanitationCheckState;
  note: string;
  accepted: boolean;
  submitted: boolean;
}
```

Где checklist values являются выбором игрока, а не автоматически вычисленным отражением мира.

### Actions

```text
open-journal
set-journal-entry
set-journal-note
mark-wagon-accepted
return-journal
```

`return-journal` фиксирует документ для текущего этапа.

## 4. Огнетушитель

### Runtime state

Минимально:

```ts
interface ExtinguisherState {
  location: "mounted" | "held" | "world";
  holderId?: string;
  pin: "present" | "removed";
  seal: "intact" | "broken";
  pressure: "low" | "normal" | "high";
  bodyDamage: "none" | "scratch" | "dent";
  used: boolean;
}
```

Конкретные enums могут быть изменены при реализации.

### Actions

```text
inspect-extinguisher
take-extinguisher
return-extinguisher
prepare-extinguisher
use-extinguisher
```

Mounted и held варианты используют один domain item, но разные interaction targets:

- когда огнетушитель установлен на стене, игрок кликает по самому объекту и может осмотреть либо взять его;
- когда огнетушитель находится в руке, игрок кликает по собственной entity и получает `inspect-extinguisher` form action;
- inspection modal показывает чеку, пломбу, давление, состояние корпуса и признак использования;
- снять чеку можно только у held extinguisher через input модального action;
- `use-extinguisher` появляется только рядом с публичным fire target, если чека снята и огнетушитель ещё не использован.

Fire target является публичным runtime object вида `fire:<cellId>`. Применение огнетушителя является server-authoritative: оно помечает огнетушитель использованным, выключает локальный source и уменьшает fire field.

## 5. Климат-контроль

### Runtime state

Следует различать source state и panel reading.

```ts
interface ClimateSystemState {
  temperature: number;
  cabinPressureState: "normal" | "unstable" | "critical";
  smokeState: "normal" | "detected";
  connection: "online" | "offline";
}

interface ClimatePanelState {
  lastReading?: ClimateReading;
  lastUpdatedAt?: SimTimeUs;
}
```

### Actions

Клик по `climate-control` выдаёт form-action `climate-control`. Modal показывает последнее сохранённое наблюдение:

```text
connection
temperatureC
pressureKPa
smokeDetected
updatedAt
```

Кнопка `Обновить данные` отправляет `{ refresh: true }` через тот же opaque action handle. Сервер заново вычисляет средние показания вагона и обновляет `updatedAt`. Пока connection baseline всегда `connected`; offline/error semantics остаются будущим расширением.

## 6. Стоп-кран

### Runtime state

```ts
interface EmergencyBrakeState {
  seal: "intact" | "broken";
  handle: "normal" | "activated";
}
```

### Actions

```text
inspect-emergency-brake
remove-emergency-brake-seal
activate-emergency-brake
```

Осмотр доступен и во время приёмки. Во время движения modal сначала позволяет сорвать пломбу; только после этого отдельным действием становится доступна активация. Снятие пломбы само по себе поезд не останавливает. Активация завершает попытку через `emergency-brake-used` / `route-safely-interrupted`.

## 7. Связь с машинистом

> **Baseline/deferred:** gameplay-взаимодействие со связью с машинистом не входит в release `0.1.0`. Ниже зафиксирован целевой interaction contract, чтобы content/scenario могли опираться на стабильное направление реализации.

### Runtime state

Минимально:

```ts
interface DriverCommunicationState {
  connection: "available" | "fault";
}
```

### Actions

```text
test-driver-communication
report-ready
report-incident
```

Конкретный набор report-actions определяется scenario/content.

## 8. Пассажирские документы

Билет и паспорт принадлежат взаимодействию с пассажиром и содержат публичные display fields.

Hidden state может включать:

```text
expected decision
data mismatch type
document validity
scenario-specific flags
```

Клиент этих значений не получает.

### Actions

Минимально:

```text
open-ticket
open-identity-document
admit-passenger
reject-passenger
```

Сами `open-*` могут быть чисто presentation commands, если они не имеют simulation cost. Решение о пассажире является server-authoritative action.



## 9. Точка обслуживания

Baseline использует простой stationary service point/storage без отдельной логистической системы запасов.

Действия:

```text
take-food
take-drink
```

Если held slot игрока свободен, action выдаёт простой Item соответствующего типа. Отдельные запасы, посуда, мусор и возврат упаковки не моделируются.


## 10. Санитарное состояние

> **Baseline/deferred:** release `0.1.0` сохраняет sanitation как поле журнала, но ещё не публикует отдельное spatial sanitation state/overlay. Ниже описана целевая baseline-модель наблюдаемого загрязнения.

Санитарное состояние относится к world/zone observation и журналу, а не к отдельному интерактивному объекту.

В baseline конкретные загрязнения представлены runtime overlay state на cells/локальных областях. Client отображает их поверх базовых tiles по `visualId`.

Пример:

```text
clean
trash-small-01
spill-01
stain-seat-01
```

Уборка в baseline не реализуется: состояние статично, а игрок должен заметить его и корректно заполнить журнал. Подробнее — `environment-state.md`.

## 11. Доменная и визуальная модель

Один domain object может иметь несколько representations:

```text
Extinguisher domain object
    ├── world-mounted sprite
    ├── held sprite/layer
    └── close-up modal
```

Нельзя создавать отдельный simulation object только потому, что один и тот же предмет выглядит по-разному в разных UI contexts.
