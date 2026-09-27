# Assessment, achievements и coaching

**Версия документа:** 0.3.0  
**Статус:** Draft  
**Дата редакции:** 2026-09-27

## 1. Общий принцип

Assessment, achievements и coaching наблюдают за authoritative simulation, но не должны становиться источником правил мира.

```text
Simulation state/events
      ├── Assessment
      ├── Achievement checks
      └── Coaching checks
```

У них могут быть общие факты/условия, но разные выходы.

## 2. Assessment

Итог baseline состоит из двух чисел:

```ts
interface GameScores {
  safety: number;               // 0..100
  customerSatisfaction: number; // 0..100
}
```

Точный алгоритм начисления относится к конкретному game content/assessment implementation и может меняться по versioned rules.

Для passenger-service assessment класс определяется обычным trait (`basic`, `comfort`, `business`). Более высокий класс допускает более строгие ожидания к скорости и качеству обслуживания. Запрос услуги вне entitlement не считается автоматически ошибкой игрока — оценивается корректность его реакции.

Типичные факты для `customerSatisfaction`:

```text
request entitlement
acknowledgement / refusal
response time
resolution time
resolution quality
communication outcome
```

Safety не должен зависеть от стоимости класса сам по себе.

Итог формируется только Game Server.

## 3. Achievements

Achievement — постоянная кодовая проверка/observer с стабильным ID.

Baseline не требует отдельного achievement DSL.

Примеры:

```text
no-complaints
fast-fire-response
all-passengers-served
```

Проверка может смотреть на текущий state, simulation/domain events и небольшой собственный progress runtime.

При выполнении condition achievement становится unlocked один раз.

## 4. Achievement runtime

Минимально:

```ts
interface AchievementRuntime {
  unlocked: Set<string>;
  progress?: Map<string, number>;
}
```

Внутренний progress не обязан отправляться Platform Server.

При finish передаются:

```text
achievement set version
unlocked achievement IDs
```

Platform Server отвечает за пользовательский каталог, картинки, тексты и межсессионную агрегацию достижений.

## 5. Run achievements и profile achievements

Game Server определяет только достижения, проверяемые внутри одной попытки.

Например:

```text
потушить пожар до ухудшения
закончить рейс без жалоб
```

Межсессионные достижения:

```text
пройти 10 попыток
три успешных рейса подряд
получить все достижения
```

принадлежат Platform Server.

## 6. Coaching/Hints

Coaching активируется SessionMode policy и выдаёт transient presentation events.

Он может реагировать на:

- ошибочное действие;
- пропущенное важное наблюдение;
- слишком долгое бездействие;
- приближающийся критический момент;
- возможность выполнить полезный следующий шаг.

## 7. Типы помощи

Baseline presentation может различать:

```text
feedback    — сообщить о уже совершённой ошибке/успехе
suggestion  — навести на возможный следующий шаг
attention   — указать на объект/область без прямого ответа
```

Wire representation может быть сведено к `HintEvent` с presentation type.

## 8. Hidden state

Coaching не получает право автоматически сериализовать скрытый SimulationState.

Каждая подсказка формируется явно как разрешённый presentation object.

Например вместо раскрытия hidden trait:

```text
passenger.fraudulentDocument = true
```

может быть показано:

```text
"Проверьте реквизиты документа внимательнее"
```

## 9. Детерминизм

Включение/выключение hints не должно менять simulation result при одинаковых seed и gameplay inputs.

Coaching может иметь собственный runtime/cooldowns, но его output находится вне authoritative gameplay state.

Если пользователь после hint выбирает другое действие, изменяется уже входной user log, а не сама механика режима.

## 10. Replay

Achievement/assessment markers могут повторно вычисляться при deterministic replay.

Replay может показывать их как timeline markers/extensions.

Coaching hints исходной guided попытки могут быть восстановлены, если это полезно для разбора, но persistent result не обязан хранить полный hint stream.
