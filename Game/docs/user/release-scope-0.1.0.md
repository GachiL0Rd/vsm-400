# Release scope 0.1.0

**Версия документа:** 0.1.0  
**Статус:** Release acceptance scope  
**Дата редакции:** 2026-09-27

## 1. Назначение

Этот документ определяет обязательный scope текущего release candidate `0.1.0`.

В документации Game используются два разных уровня требований:

- **Release** — минимальный набор возможностей, который принимается сейчас и блокирует выпуск при нарушении.
- **Baseline** — целевой вертикальный срез текущего направления разработки. Он содержит как уже реализованные возможности, так и желаемые дополнения. Невыполненный baseline сам по себе не блокирует `0.1.0`.

Разделение появилось из-за ограничения сроков: часть первоначального baseline сознательно перенесена после первого release, а не считается дефектом текущего release candidate.

При проверке готовности `0.1.0` этот документ имеет приоритет над формулировками baseline, которые описывают более полный целевой срез.

## 2. Что обязательно для release 0.1.0

Release candidate должен обеспечивать следующий работающий контур:

1. Platform session разрешается в Game Server attempt с versioned server-side content.
2. Game Server владеет authoritative simulation, временем, RNG, actions, scenario и результатом попытки.
3. Browser работает только через public projection/common protocol и не становится источником доменных решений.
4. WebSocket lifecycle поддерживает initial attach, snapshot/delta flow, authoritative commands, resync и reconnect/resume в пределах runtime grace period.
5. Игрок может пройти реализованный сценарный путь текущего demo, включая:
   - authoritative movement;
   - приёмку с журналом;
   - пассажирские документы и решение о посадке;
   - базовые food/drink service interactions;
   - пожарный сценарий и использование огнетушителя;
   - pressure/climate incident;
   - аварийный тормоз;
   - завершение попытки.
6. Завершение формирует versioned assessment, achievements, terminal outcome и canonical replay source.
7. Live attempt завершается через idempotent Platform `finishSession` boundary.
8. Replay mode умеет валидировать canonical replay source и детерминированно выполнять forward playback без создания нового Platform result.
9. Production artifact содержит server, browser client root и versioned content bundle и проходит штатный verification/smoke contour.

Точные wire/content contracts определяются соответствующими документами `api/`, `architecture/`, `simulation/` и `deployment/`.

## 3. Baseline-возможности, отложенные после release 0.1.0

Следующие возможности остаются частью целевого baseline или следующего этапа, но не блокируют текущий release:

- полноценные guided coaching/hint events;
- replay seek/checkpoints, hidden-state inspection, assessment/logit reveal и расширенный replay UI;
- gameplay-взаимодействие со связью с машинистом;
- отдельное spatial sanitation state с public overlays и сравнением наблюдаемого состояния с журналом;
- multi-cell destination/path intent на уровне server protocol; в `0.1.0` `move-to` остаётся adjacent-cell command;
- автоматическое исполнение сервисного расписания как специальной server-side подсистемы;
- persistence/migration активной попытки между процессами;
- автоматический retry/backoff Platform finish после внешней ошибки.

Наличие schema/config/protocol extension point или простого тестового контура для такой возможности не означает, что она входит в release acceptance.

## 4. Service orchestration

Обслуживание пассажиров не должно превращаться в набор жёстко зашитых в simulation/server временных правил.

Разделение ответственности:

```text
simulation/content vocabulary
  traits + actions + events + generic service mechanics
                    │
                    ▼
scenario/content
  когда появляются/снимаются traits
  когда разрешаются или провоцируются запросы
  расписание сервисных окон и событий рейса
                    │
                    ▼
runtime
  исполняет generic mechanics и authoritative transitions
```

Код должен предоставлять переиспользуемые traits/actions/events для типовых запросов и реакций. Конкретный рейс определяет их время, пассажиров и последовательность через Scenario/content.

`servicePlan.windows` следует рассматривать как declarative scenario/content data и контекст для orchestration/assessment/coaching, а не как основание для отдельной жёстко зашитой business-логики Game Server.

Для release `0.1.0` достаточно существующих service interactions. Полная сценарная orchestration сервисных окон относится к дальнейшему baseline.

## 5. Критерий приёмки

`0.1.0` принимается по этому release scope и фактическим versioned contracts/tests.

`vsm_baseline_vertical_slice.md` используется как направление дальнейшего насыщения вертикального среза. Пункт baseline, явно отложенный здесь, не должен повторно трактоваться как release blocker без изменения этого документа.
