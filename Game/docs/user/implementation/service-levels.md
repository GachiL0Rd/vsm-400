# Уровни обслуживания пассажиров

**Версия документа:** 0.2.0  
**Статус:** Draft / concrete demo implementation  
**Дата редакции:** 2026-09-27

## 1. Назначение

Уровень обслуживания в текущем demo выражается через обычный trait пассажира.

Baseline использует ровно один из:

```text
basic
comfort
business
```

Отдельное поле `serviceLevelId` не требуется.

Это сохраняет одну общую модель:

```text
traits
  → selectors
  → candidate actions
  → logit corrections
  → assessment rules
```

## 2. Базовый уровень

Trait:

```text
basic
```

Включённые ожидания обслуживания:

- проезд;
- информирование;
- стандартное обслуживание.

## 3. Комфорт

Trait:

```text
comfort
```

Включает всё базовое, а также:

- напиток;
- лёгкий набор питания.

Ожидания к времени и качеству реакции строже, чем у `basic`.

## 4. Бизнес

Trait:

```text
business
```

Включает всё базовое, а также:

- питание;
- напитки;
- дополнительное обслуживание.

Для `business` требования к скорости/качеству выше.

Кроме entitlement, сам trait может немного повышать logits более требовательного поведения:

```text
request-drink
request-food
remind-service
complain-delay
```

Это не отдельная система «наглости»: обычный trait просто корректирует behavior weights.

## 5. Взаимоисключение

Scenario при создании пассажира обязан назначить ровно один service-class trait.

Baseline не вводит category/exclusive-group metadata. Проверка может быть обычной content validation для набора:

```text
basic | comfort | business
```

При runtime-попытке назначить несовместимый класс используется обычная trait conflict/reject logic либо явная замена.

## 6. Запросы вне класса

Класс обслуживания не является hard whitelist запросов.

Пассажир `basic` всё ещё может попросить напиток или еду, если другие traits/context сделали соответствующее действие candidate.

Например:

```text
basic
+ hungry
+ impatient
    ↓
request-food всё ещё возможен
```

Класс влияет на:

- logit modifiers запросов;
- entitlement;
- ожидания по скорости/качеству;
- последствия корректного/некорректного ответа.

## 7. Запрос как waiting action

Отдельный `ServiceRequest` runtime object для baseline не нужен.

Конкретный запрос выражается состоянием пассажира и текущим action.

Пример:

```text
traits:
  business
  thirsty

request-drink selected
    ↓
+ waiting-drink

currentAction:
  request-drink / waiting
```

`request-drink` ждёт подходящего события (`DrinkGiven` пассажиру) либо timeout.

После success/timeout action меняет traits и завершается. Дальнейшее поведение снова выбирается через обычный decision cycle.

Таким образом факт «пассажир №17 ждёт напиток» выражается непосредственно:

```text
passenger-17 has trait waiting-drink
```

и его ожидающим action.

## 8. Assessment

Assessment определяет класс по trait:

```text
passenger[basic]
passenger[comfort]
passenger[business]
```

И может учитывать:

```text
service included?
response time
resolution time
resolution quality
refusal correctness
communication outcome
```

Более высокий класс означает более строгую content policy, а не автоматическую потерю/прибавку satisfaction.

Safety не зависит от цены класса сама по себе.

## 9. Selectors

Класс используется обычной selector system:

```text
passenger[business]
passenger[comfort]:not([angry])
passenger[basic][waiting-drink]
```

Никакого дополнительного service metadata layer на пассажире не требуется.

## 10. Tuning

Точные значения logits и временных ожиданий не являются engine constants.

Они относятся к versioned game content/assessment config и уточняются после gameplay прогонов.
