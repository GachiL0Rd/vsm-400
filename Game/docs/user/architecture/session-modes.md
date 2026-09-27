# Режимы игровой сессии и protocol extensions

**Версия документа:** 0.3.0
**Статус:** Draft  
**Дата редакции:** 2026-09-27

## 1. Назначение

Live play, обучение с подсказками и replay используют один Simulation Engine и один базовый client protocol.

Не создаются параллельные модели `LiveState`, `GuidedState`, `ReplayState`. Различия задаются server-side режимом сессии: policy входных команд, дополнительными observers и разрешёнными presentation extensions.

В TypeScript режим выражается discriminated union (аналог sealed class):

```ts
type SessionModeConfig =
  | LiveModeConfig
  | GuidedModeConfig
  | ReplayModeConfig;
```

## 2. Live

```ts
interface LiveModeConfig {
  kind: "live";
}
```

Policy:

- gameplay commands разрешены;
- public projection содержит только обычные наблюдаемые данные;
- hidden simulation state не раскрывается;
- assessment и achievements могут работать в фоне;
- coaching/hints не публикуются.

## 3. Guided

```ts
interface GuidedModeConfig {
  kind: "guided";
  hints: HintPolicy;
}
```

Guided использует ту же simulation semantics, что live.

Подсказки не меняют seed, NPC decisions, правила мира или результат action. Они являются дополнительным presentation output.

Пример policy:

```ts
interface HintPolicy {
  immediateFeedback: boolean;
  suggestions: boolean;
  highlights: boolean;
  explanations: boolean;
}
```

Конкретные пресеты интерфейса могут быть сформированы Platform Server без появления новых simulation modes.

Флаги:

- `immediateFeedback` — toast после уже совершённой ошибки: ложная критическая отметка в журнале, допуск пассажира которого надо было не пускать, отказ пассажиру которого надо было пустить, активация аварийного тормоза без активной угрозы;
- `suggestions` — сообщение о текущем шаге приёмки и повтор этого текста при бездействии;
- `highlights` — отдельные события `presentation: "highlight"` по объектам осмотра. В public wire то же поле называется `objectHighlights`;
- `explanations` — добавляет `text` к feedback-toast. Если флаг выключен, toast уходит без текста.

Запрос пассажира, который не обработан дольше порога из каталога, не имеет отдельного флага и выпускается в любой guided-сессии, где каталог содержит этот trigger.

Game Server читает каталог `hints.json` и выпускает hint events только при `kind: "guided"`. Live их не выпускает. Локальный mock по умолчанию стартует как guided со всеми четырьмя флагами.

## 4. Replay

```ts
interface ReplaySource {
  simulationCompatibilityVersion: string;
  gameLevelVersion: string;
  rootSeed: string;
  userInputs: RecordedUserInput[];
}

interface ReplayRevealPolicy {
  traits: boolean;
  actionLogits: boolean;
  hiddenObjectState: boolean;
  assessment: boolean;
  explanations: boolean;
}

interface ReplayModeConfig {
  kind: "replay";
  source: ReplaySource;
  reveal: ReplayRevealPolicy;
}
```

Replay восстанавливает simulation из сохранённых версий, root seed и user input log.

Gameplay commands запрещены. В release `0.1.0` реализованы forward playback, `resync` и смена скорости `1x/2x/4x`. `seek`, step/markers и replay inspection остаются baseline/deferred расширениями следующего этапа и поэтому возвращаются клиенту как недоступные capabilities.

Replay никогда не формирует новый официальный GameResult для исходной попытки.

## 5. InputPolicy

Mode является authoritative server-side policy.

Наличие кнопки в UI не является разрешением команды.

```text
ClientCommand
    ↓
Mode InputPolicy
    ↓
transport/domain validation
    ↓
Simulation / ReplayController
```

Live/Guided принимают gameplay commands.

Replay отвергает их даже если модифицированный client вручную отправил корректно сформированный packet.

## 6. Базовые presentation events

Client получает общий поток presentation events/state diffs.

```ts
interface ClientPresentationEvent {
  type: string;
  at: SimTimeUs;
  payload: unknown;
  extensions?: ClientEventExtension[];
}
```

`extensions` является точкой расширения, но не заменяет базовый payload.

Архитектурный тест:

> Если удалить все `extensions`, оставшийся поток должен всё ещё быть корректной обычной визуальной интерпретацией игры.

## 7. Replay extensions

Baseline replay design допускает расширенные данные к обычному событию:

```text
entity motion changed
  + replay.action-analysis
  + replay.hidden-state
  + replay.assessment-marker
```

Например:

```ts
interface ReplayActionAnalysisExtension {
  type: "replay.action-analysis";
  selectedActionId: string;
  candidates: Array<{
    actionId: string;
    logit: number;
  }>;
}
```

Эти данные никогда не существуют в ordinary live projection.

## 8. On-demand replay inspection

Не все hidden/debug data нужно отправлять постоянно.

Baseline replay design допускает read-only inspect commands:

```text
inspect entity
inspect event
inspect cell
inspect action decision
```

И отвечать mode-specific presentation event с данными, разрешёнными `ReplayRevealPolicy`.

Это позволяет наставнику исследовать конкретный момент без постоянной передачи полного скрытого state всех сущностей.

## 9. Hint events

Hints лучше моделируются не как поле обычного state diff, а как специальные transient presentation events:

```ts
interface HintEvent {
  kind: "hint";
  hintId: string;
  presentation: "message" | "toast" | "highlight";
  text?: string;
  target?: { kind: "cell"; cellId: string } | { kind: "entity"; entityId: string } | { kind: "object"; objectId: string };
}
```

Coaching observer в guided-сессии выпускает эти события по каталогу и `HintPolicy`. У них общий `sequence` с `speech`, `notification` и `achievement-unlocked`. Внутри одного шага порядок: реплики, затем hints, затем phase/termination notice, затем achievements.

Hint не является simulation event, не пишется в `userInputs` и не меняет seed, assessment или achievements. Один trigger выпускается не больше одного раза за попытку, кроме `inactivity` и каждого нового неотвеченного запроса пассажира. Replay-сессия hints не выпускает: режим replay не guided.

## 10. Achievement events

Если UI должен мгновенно показать achievement, server может отправить:

```text
achievement-unlocked(id)
```

Официальный набор полученных achievement IDs всё равно входит в финальный GameResult для Platform Server.

## 11. Guided + расширенные данные

Guided mode может позднее разрешать ограниченные diagnostic extensions, например объяснение ошибки или раскрытие конкретного показателя.

Это делается теми же extension points, что replay, но policy должна явно разрешить конкретный тип данных.

Наличие extension schema не означает, что она доступна всем modes.

## 12. Перемещение по timeline

Replay обязан проектироваться так, чтобы `seek` можно было добавить без изменения simulation events.

Baseline стратегия описана в `architecture/replay.md`: deterministic forward replay + optional checkpoints.

Для Guided возможность отката к ошибке считается будущей capability, а не обязательным baseline поведением.

Если она появится, restore создаёт обучающую ветку/повтор, а не переписывает уже зафиксированный официальный результат молча.
