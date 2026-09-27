# Assessment

**Версия документа:** 0.2.0
**Статус:** Release implementation contract
**Дата редакции:** 2026-09-27

Assessment — отдельный детерминированный слой над authoritative simulation. Он наблюдает уже произошедшие игровые факты, но не меняет состояние мира, доступность действий или terminal rules.

Текущая реализованная версия assessment имеет `setVersion = baseline-v1` и формирует два независимых score `0..100`:

Здесь `baseline-v1` — стабильный идентификатор набора assessment rules, а не указание на product-level Baseline scope из [`../vsm_baseline_vertical_slice.md`](../vsm_baseline_vertical_slice.md). Этот assessment set входит в release `0.1.0`.

- `safety`;
- `customerSatisfaction`.

## Наблюдаемые факты baseline-v1

Assessment учитывает только то, что сервер уже может однозначно доказать:

- результат сдачи журнала и наличие критической неисправности;
- решения `admit/reject` относительно server-only `expectedBoardingDecision`;
- время ответа на food/drink request и timeout запроса;
- начало и тушение scripted fire;
- достижение критического fire state;
- достижение критического pressure state;
- снятие пломбы аварийного тормоза;
- активацию аварийного тормоза и наличие активного safety incident в момент активации;
- итоговый terminal outcome.

## Базовые штрафы

Текущие числа намеренно просты и централизованы в `simulation/assessment.ts`.

- допуск пассажира, которого следовало отклонить: `safety -15`;
- отказ пассажиру, которого следовало допустить: `customerSatisfaction -25`;
- service timeout: basic `-10`, comfort `-15`, business `-20` к customer satisfaction;
- ответ позднее class target: `-5`, позднее двойного target: `-10`;
- critical fire: `safety -60`, `customerSatisfaction -30`;
- critical pressure: `safety -50`, `customerSatisfaction -25`;
- аварийная остановка без активного safety incident: `-20` к обоим score;
- сорванная пломба без последующей активации: `safety -5`.

Class targets для service response:

- business: 60 s;
- comfort: 90 s;
- basic: 120 s.

Обнаруженная при приёмке критическая неисправность не считается провалом безопасности: `wagon-unserviceable`, полученный из корректно заполненного журнала с critical problem, сохраняет высокий safety score.

## Achievements baseline-v1

Текущий набор:

- `clean-predeparture` — сдан чистый журнал без critical problem;
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
