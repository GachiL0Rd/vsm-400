# Assessment

**Версия документа:** 0.3.0
**Статус:** Release implementation contract
**Дата редакции:** 2026-09-27

Assessment — отдельный детерминированный слой над authoritative simulation. Он наблюдает уже произошедшие игровые факты, но не меняет состояние мира, доступность действий или terminal rules.

Текущая реализованная версия assessment имеет `setVersion = baseline-v2` и формирует два независимых score `0..100`:

Здесь `baseline-v2` — стабильный идентификатор набора assessment rules, а не указание на product-level Baseline scope из [`../vsm_baseline_vertical_slice.md`](../vsm_baseline_vertical_slice.md). Этот assessment set входит в release `0.1.0`. Смена этих правил не меняет `simulationCompatibilityVersion`: симуляция и replay остаются прежними.

- `safety`;
- `customerSatisfaction`.

## Наблюдаемые факты baseline-v2

Assessment учитывает только то, что сервер уже может однозначно доказать:

- результат сдачи журнала и сверку критических отметок с состоянием оборудования на момент сдачи;
- решения `admit/reject` относительно server-only `expectedBoardingDecision`;
- время ответа на food/drink request и timeout запроса;
- начало и тушение scripted fire;
- достижение критического fire state;
- достижение критического pressure state;
- снятие пломбы аварийного тормоза;
- активацию аварийного тормоза и наличие активного safety incident в момент активации;
- итоговый terminal outcome.

## Журнал приёмки

В момент `returnJournal` simulation считает фактическую неисправность по каждому критическому пункту. Assessment получает готовые флаги и состояние мира не читает.

Фактическая неисправность:

- `extinguisher` — давление не `normal`, пломба `broken`, чека `removed`, повреждение корпуса не `none` или огнетушитель уже использован;
- `emergencyBrake` — пломба не цела или тормоз уже активирован;
- `climate` — в предрейсовой приёмке нет порога «климат вне нормы», поэтому пункт не бывает фактически неисправным;
- `communication` — отдельного состояния связи нет, пункт не бывает фактически неисправным.

`sanitation` не критический пункт и в эту сверку не входит.

Из этого получаются флаги:

- `reportedProblem` — игрок отметил хотя бы один критический пункт как `problem`;
- `realProblem` — хотя бы один пункт, отмеченный `problem`, действительно неисправен;
- `falseReport` — критическая отметка есть, но ни один отмеченный `problem` не подтверждён;
- `missedProblem` — пункт действительно неисправен, а игрок отметил его `ok` или сдал журнал, не сообщив об этой неисправности.

Terminal rule по-прежнему смотрит только на отметку игрока. Ложный критический доклад всё равно завершает попытку как `wagon-unserviceable`.

## Базовые штрафы

Текущие числа намеренно просты и лежат в versioned assessment config.

- допуск пассажира, которого следовало отклонить: `safety -15`;
- отказ пассажиру, которого следовало допустить: `customerSatisfaction -25`;
- service timeout: basic `-10`, comfort `-15`, business `-20` к customer satisfaction;
- ответ позднее class target: `-5`, позднее двойного target: `-10`;
- critical fire: `safety -60`, `customerSatisfaction -30`;
- critical pressure: `safety -50`, `customerSatisfaction -25`;
- аварийная остановка без активного safety incident: `-20` к обоим score;
- сорванная пломба без последующей активации: `safety -5`;
- ложный критический доклад (`journal.falseCriticalReport`): `safety -10`, `customerSatisfaction -40`;
- пропущенная критическая неисправность (`journal.missedCriticalProblem`): `safety -30`.

Class targets для service response:

- business: 60 s;
- comfort: 90 s;
- basic: 120 s.

Подъём safety до `safePredepartureMinimumSafety` действует только когда `wagon-unserviceable` совпал с `realProblem`. Ложный доклад этот подъём не получает. Подтверждённая при приёмке неисправность сама по себе safety не снижает.

## Achievements baseline-v2

Текущий набор:

- `clean-predeparture` — журнал сдан, санитария `clean`, нет критической отметки, нет `missedProblem` и нет `falseReport`;
- `documents-perfect` — все обработанные boarding decisions совпали с ожидаемыми;
- `fast-fire-response` — пожар потушен не позднее 120 s после старта;
- `safe-emergency-stop` — аварийный тормоз активирован при активном safety incident;
- `all-service-requests-resolved` — все зарегистрированные service requests завершены без timeout.

Achievement IDs передаются Platform Server вместе с `setVersion`, чтобы правила можно было менять без переиспользования старой семантики ID.

## Граница ответственности

Simulation фиксирует факты. Assessment интерпретирует их. Platform Server получает только итоговые scores, achievements, termination и authoritative input journal.

Assessment не должен:

- завершать попытку;
- менять traits/actions;
- раскрывать hidden expected decisions клиенту;
- влиять на deterministic simulation result.
