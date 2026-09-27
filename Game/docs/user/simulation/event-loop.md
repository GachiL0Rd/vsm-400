# Simulation timeline и цикл событий

**Версия документа:** 0.2.0  
**Статус:** Draft  
**Дата редакции:** 2026-09-27

## 1. Цель

Игровая логика как можно меньше привязана к частоте server loop. Основной единицей является событие на simulation timeline, а не номер кадра или тика.

```text
12.000000  NPC начал действие
12.183420  пришла команда игрока
12.417000  изменилось состояние мира
12.800000  завершилось перемещение
```

Scheduler периодически продвигает simulation horizon, но события сохраняют собственное время внутри интервала.

## 2. Simulation time

Внутреннее время — целое число микросекунд от начала попытки:

```ts
type SimTimeUs = number;
```

Для ожидаемой длительности игровых попыток диапазона точных integer JavaScript `number` достаточно. Floating-point seconds не используются как canonical timestamp.

## 3. Очередь событий

Запланированное событие содержит как минимум:

```ts
interface ScheduledEvent<T = SimulationEvent> {
  at: SimTimeUs;
  order: number;
  payload: T;
}
```

Сортировка выполняется по `(at, order)`.

`order` монотонен внутри попытки и обеспечивает стабильное разрешение событий с одинаковым timestamp.

Priority queue может быть библиотечной; её comparator и observable semantics должны быть покрыты тестами.

## 4. Основной primitive

```text
advanceTo(targetTime)
```

Концептуально:

```text
while nextEvent.time <= targetTime:
    materialize relevant state to nextEvent.time
    apply nextEvent
    enqueue events produced by it

materialize relevant state to targetTime
```

## 5. Tick rate

Scheduler может обслуживать simulation примерно 4–16 раз в секунду или использовать иной период. Частота не является частью правил.

В частности:

- user input не округляется к номеру tick;
- изменение scheduler rate не должно менять probabilistic policy NPC;
- duration задаётся simulation time;
- публикационная частота WebSocket может отличаться от scheduler rate.

## 6. Subtick input

WebSocket принимает input асинхронно. Game server фиксирует момент получения и переводит его в authoritative simulation time относительно текущего clock anchor.

Клиентский timestamp допустим как telemetry, но не определяет игровое время команды.

## 7. Применение действий к движущимся объектам

Перед validation action движок материализует релевантное spatial state на timestamp события.

Если игрок/NPC движется между cells, сервер вычисляет положение на этот момент и только затем проверяет interaction distance и другие spatial preconditions.

## 8. Time scale

Simulation clock связывает wall time и simulation time через `timeScale`:

```text
simDelta = wallDelta × timeScale
```

Изменение `timeScale` меняет mapping clock anchor, но не durations уже запланированных simulation events.

## 9. Pause

При pause simulation time перестаёт продвигаться. Scheduled events сохраняют timestamps.

После resume создаётся новый wall/simulation anchor; массовый пересчёт очереди не требуется.

Disconnect/reconnect относится к lifecycle session worker и может приводить к pause, но потеря WebSocket сама по себе не является событием игрового мира.

## 10. Server lag и catch-up

Небольшое отставание scheduler может обрабатываться bounded catch-up.

Если lag превышает допустимый wall-time budget, сервер не обязан мгновенно проигрывать большой кусок критического gameplay. Он может считать период фактически paused, re-anchor clock и продолжить с текущего simulation time.

Численные thresholds являются конфигурацией runtime и будут подбираться измерениями.

## 11. Event cancellation/replacement

Базовый механизм — lazy invalidation через generation/version token.

Например completion движения содержит:

```text
entityId
movementGeneration = 4
```

После изменения маршрута entity получает generation `5`. Старое completion event остаётся в heap, но при извлечении игнорируется как устаревшее.

Тот же принцип может использоваться для action completion и других заменяемых schedules.

## 12. Continuous и periodic state

Подсистемы используют подход, соответствующий их природе:

- аналитически вычислимое состояние материализуется на нужный timestamp (`motion`);
- дискретные переходы оформляются events;
- простые spatial fields вроде fire/pressure могут обновляться периодическими field-step events.

Event loop не требует единого способа обновления всех подсистем.

## 13. Dynamic processing horizon

Scheduler может выбирать горизонт обработки динамически. Для защиты runtime допускаются:

- максимальный simulation horizon за одну итерацию;
- максимальное число events;
- максимальный wall-time budget обработки.

Это implementation policy, не simulation semantics.

## 14. Publication не является simulation tick

```text
simulation advancement
        ↓
public projection/diff
        ↓
network publication
```

Медленный клиент не участвует в lockstep и не замедляет simulation clock.

## 15. Открытые вопросы

- Конкретные значения scheduler rate и lag thresholds после профилирования.
- Нужны ли специализированные очереди/батчи для очень частых field-step events после появления реальной физической модели.
