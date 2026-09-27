# Устаревшая сверка реализации

> Архивный снимок до удаления старого demo. Не использовать как текущий
> checklist; актуальные working guide находятся в
> [`../agent/`](../agent/README.md).

# Сверка реализации с `vsm-docs-iteration-07`

Дата сверки: 2026-09-27. Источник требований: `Game/docs/user/README.md` и документы в указанном там порядке. Этот файл фиксирует состояние кода, а не заменяет ТЗ.

## Что изменилось относительно существующего демо

| Область | Требование итерации 0.7 | Реализация на момент сверки |
| --- | --- | --- |
| Источник правил | `architecture/` и `simulation/` выше исторических `agent/` | Корневые README и AGENTS обновлены; старые agent-документы остаются историческими. |
| Entity | Только player/passenger с `position`, `traits[]`, одним held slot и `currentAction`; без ECS, `TraitInstance`, отдельного `ServiceRequest` и `serviceLevelId` | Новый `src/simulation/entity-store.ts` следует модели, но старое демо продолжает использовать собственные NPC и service/task state. |
| Время и случайность | Целые микросекунды, общая очередь событий, derived RNG streams, ввод между тиками | Примитивы в `src/simulation/` есть; `dev/demo-server.ts` всё ещё считает float-секунды через `Date.now()` и не использует их. |
| Пространство | Server-authoritative grid, движение по edges, подключаемый перрон, поля пожара/давления | Grid, spatial и field primitives есть; старое демо работает с четырьмя zones, без связи с новой сеткой. |
| Действия NPC | Trait candidates, hard restrictions, logits, stable softmax, instant/running/waiting lifecycle | Decision engine есть; полный handler registry и цикл действий ещё нужно связать с attempt worker. |
| Предметы | Отдельные от Entity журнал, огнетушитель, простые еда/напиток; один held slot | Новый item store есть; старый wire contract всё ещё представляет предмет одним enum `stored/held/prepared/used`. |
| Сценарий | `preDeparture` → `originStop` → travel/route stops, посадка/высадка, service windows, terminal rules | В старом демо только `boarding/ride/finished` и четыре scripted сценария; полноценный Scenario runtime ещё отсутствует. |
| Граница платформы | `SessionKey` → `resolveSession`, локальный `gameLevelId`, `ResumeToken`, идемпотентный `finishSession` | В `src` и `dev` этих контрактов нет; WebSocket hello содержит только optional `sessionId`. |
| Режимы и replay | Единый движок для live/guided/replay, журнал authoritative inputs, seek/checkpoints, запрет gameplay input в replay | Нет mode policy, canonical replay source и replay controller. |
| Проекция и клиент | Только видимое состояние, runtime action handles, модалки и слои, guided hints/replay controls | Текущий Phaser-клиент работает со старым `client/protocol.ts`; новая simulation не подключена к проекции. |
| Результат | Safety, customer satisfaction, achievements и отдельный terminal reason | У старого демо есть простая оценка; контракт итогов и platform finish из новой архитектуры ещё отсутствуют. |

## Порядок продолжения

1. Завершить единый event/action runtime и устранить выявленные atomicity edge cases.
2. Загрузить Level/Scenario/content в один attempt worker; связать grid, fields, entities, actions, items, решение NPC и оценку.
3. Сделать явную public projection и новый wire contract с mode policy, reconnect и replay.
4. Подключить клиентские менеджеры к новой проекции, добавить UI для журнала, документов, оборудования, service point и режимов.
5. Пройти end-to-end короткую смену, replay того же ввода и полную проверку `npm run verify`.

Наличие unit-тестов примитивов не означает, что вертикальный срез уже играбелен: текущий `dev/demo-server.ts` пока обслуживает старую независимую реализацию.
