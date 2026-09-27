# Сценарии людей

Регистрации на сайте нет. Учётку создаёт администратор или HR. В пустой базе
первый запуск печатает в лог логин `admin` и одноразовый пароль.

Каталог `content/scenarios/<id>.yaml` в этой ветке пуст: файлы кладёт задача
сценариев при слиянии. Имя файла — `id` графа. Формат один, его проверяет
`ScenarioGraphSchema` в `src/engine/schema.ts`. Ниже два примера этого
формата, не выданные файлы.

Пространственная игра (давление, пожар, сервис, конфликт на стенде v1) в эти
YAML не сериализована. Она заканчивается `RunReport`. Диалоговый перегон
идёт узлами графа.

## Проводник

Роль `CONDUCTOR`.

1. `POST /api/v1/auth/login`. В ответе профиль, в cookie — `vsm_access` и
   `vsm_refresh`. Чужой пароль и чужой логин выглядят одинаково.
2. Кабинет читает `GET /api/v1/me`, `GET /api/v1/me/next-shift`,
   `GET /api/v1/me/stats`. Смена: поезд, маршрут, вагон, класс, фокус
   компетенций. Если назначений нет, план соберёт генератор в момент
   «Играть».
3. «Играть» — `POST /api/v1/game-sessions`. Ответ: `sessionId`, билет,
   `wsUrl`, `seedCommit`, публичный план. Дальше либо сокет `/game-ws`
   (см. `game-server-contract.md`), либо REST без GameServer:
   `GET /api/v1/game-sessions/:id` и `POST .../decisions`.
4. На экране текст узла, кнопки, две шкалы, дедлайн. Вердикта до разбора нет.
   Молчание до дедлайна — ход `timeout`, не «сеть упала».
5. После финала — `GET /api/v1/me/runs/:id`: исход, шкалы, вежливость, очки,
   решения с `better` и `basis`, раскрытый seed. Лента
   `GET /api/v1/notifications` (ачивка, сгорание баллов, «вас обогнал»).
   Рейтинг `GET /api/v1/leaderboards/:scope` — бригада, депо или компания,
   по позывным.
6. `GET /api/v1/me/compare` — свои компетенции против среднего бригады и депо.
   Чужие разборы не открываются.
7. Выход: `POST /api/v1/auth/logout`. Refresh гаснет, игровой сокет этой
   учётки закрывается.

Пока `mustChangePassword`, смена пароля `POST /api/v1/auth/password` раньше
игры.

## Бригадир

Роль `CHIEF`. Тот же вход. Своя смена ему доступна как проводнику: бригада —
начальник поезда и восемь проводников, играть может и он.

Дополнительно:

- `GET /api/v1/analytics/brigades/:id/heatmap` и `.../gaps` — где бригада
  проседает по компетенциям и категориям. В выборке позывные, не ФИО.
- `POST /api/v1/assignments` — назначить проводнику сценарии на рейс.
  Появляется `ShiftAssignment` и уведомление.
- `POST /api/v1/promotions/:id/decision` — подтвердить или отклонить
  рекомендацию грейда. Система сама грейд не поднимает.
- Рейтинг бригады он видит так же, как проводник, плюс место бригады в депо.

Чужое депо эти ручки ему не отдают.

## Методист

Роль `METHODIST`. Учебный центр, не член бригады на рейсе.

- Те же heatmap и gaps, чтобы собрать разбор смены, а не чтобы играть за
  проводника.
- `GET` и `PUT /api/v1/admin/scenarios/:id`. `PUT` кладёт новую версию графа.
  Схема zod отклоняет битый граф до записи. Старые рейсы остаются на прежней
  версии.
- Назначения сценариев — тем же `POST /api/v1/assignments`, если надо закрыть
  пробел, а не ждать бригадира.

Грейд он рекомендует косвенно: правила в `content/rules.yaml` считает
Backend. Кнопки «повысить» у методиста нет, её нажимает бригадир или HR.

## HR

Не браузерная роль. Система кадров шлёт `X-API-Key`.

1. `PUT /api/v1/integration/v1/employees/:extId` — завести или обновить
   человека. `extId` в базе не хранится, хранится `extHash`. Ответ один раз
   содержит пароль. Позывной выдаёт Backend.
2. `GET /api/v1/integration/v1/employees/:extId/progress` — уровень, шкалы,
   грейд, рекомендация. Без ФИО, потому что ФИО не записывались.
3. `GET /api/v1/integration/v1/org` — депо и бригады.
4. `POST /api/v1/integration/v1/webhooks` — подписка на `run.completed`,
   `achievement.granted`, `promotion.recommended`. Тело придёт с
   `X-VSM-Signature`. Повтор доставки делает cron, пока статус не `SENT`.

Путь собран так: глобальный `/api`, версия URI `v1`, дальше сегмент
`integration/v1`, как его пишет SPEC §9. Ключ с отозванным `ApiClient` эти
ручки не открывает.

## Формат сценария

Файл `content/scenarios/<id>.yaml`. Поля графа: `id`, `title`, `category`
(`medical`, `conflict`, `safety`, `technical`, `service`, `security`),
`stage` (`acceptance`, `boarding`, `enroute`, `stop`, `handover`),
`carClasses` (не меньше одного из `ECONOMY`, `FAMILY`, `BUSINESS`, `FIRST`),
`difficulty` 1..3, `competencies`, необязательные `params` (диапазоны для
seed), `init` (loyalty и safety 0..100), необязательный `gates.failIf`,
`start`, `nodes`.

Узел-решение: `text`, необязательные `variants` (подмена текста по параметру),
`timer` в секундах или `null`, `choices`, при таймере обязателен `onTimeout`.
Выбор: `id`, `text`, `next`, необязательные `effects` (шкалы), `skills`,
`set` (флаги), `verdict`, `better`, `basis`, `requires.flags`, `deviation`.
Узел-конец: `end` (`completed`, `incident`, `terminated`) и `text`.
`next` ведёт в существующий узел. Хотя бы один конец. Вердикт и `better`
клиенту до разбора не отдаются.

`deviation: true` — нетиповой, но допустимый ход. `summarize` его не штрафует
отдельно: оценивается смена целиком.

Очки рейса не лежат в YAML. Их считает правило из `content/rules.yaml` уже
после `summarize`.

## Пример 1. Недомогание в пути

Категория `medical`, перегон, бизнес и первый класс. Лекарство «с руки»
поднимает лояльность и роняет безопасность. Порог `gates` обрывает смену,
если безопасность ушла ниже 30. Короткий таймер: молчание — пропуск.

```yaml
id: med-chest-pain
title: "Пассажиру плохо на 300 км/ч"
category: medical
stage: enroute
carClasses: [BUSINESS, FIRST]
difficulty: 2
competencies: [reaction, escalation, safety]
params:
  nextStopMin: { min: 6, max: 25 }
init: { loyalty: 60, safety: 60 }
gates:
  failIf:
    safety: { lt: 30 }
start: n1
nodes:
  n1:
    text: "Пассажир побледнел и держится за грудь."
    variants:
      - if: { param: nextStopMin, lt: 10 }
        text: "До остановки меньше десяти минут, человек держится за грудь."
    timer: 15
    choices:
      - id: ask
        text: "Подойти и спросить, что болит"
        effects: { safety: 10, loyalty: 5 }
        skills: { reaction: 2, service: 1 }
        set: [approached]
        verdict: best
        next: n2
      - id: pill
        text: "Дать таблетку, которую просит пассажир"
        effects: { safety: -20, loyalty: 8 }
        verdict: worse
        better: "Лекарства проводник не назначает: медик через начальника поезда"
        next: n2
    onTimeout:
      effects: { safety: -15, loyalty: -10 }
      set: [hesitated]
      verdict: missed
      consequence: "Пассажир сполз с кресла"
      next: n2
  n2:
    text: "Начальник поезда на связи."
    timer: 20
    choices:
      - id: report-symptoms
        text: "Передать, что видел, и просить медика"
        effects: { safety: 10, loyalty: 5 }
        skills: { escalation: 2 }
        verdict: best
        next: end-ok
      - id: medic-direct
        text: "Вызвать медика напрямую, не через начальника поезда"
        requires:
          flags: [approached]
        deviation: true
        effects: { safety: 4, loyalty: 2 }
        verdict: ok
        next: end-ok
      - id: drop
        text: "Сказать, что уже прошло"
        effects: { safety: -25 }
        verdict: worse
        next: end-bad
    onTimeout:
      effects: { safety: -20 }
      verdict: missed
      next: end-bad
  end-ok:
    end: completed
    text: "Медика встретят на следующей остановке."
  end-bad:
    end: incident
    text: "Состояние ухудшилось без доклада."
```

Ход `medic-direct` на `n2` открыт только после `ask` (флаг `approached`).
Это нетиповой ход (`deviation`), не ошибка схемы. После `pill` флага нет,
и такого выбора на экране не будет.

## Пример 2. Свист давления

Тот же смысл, что ветка `pressure` стенда игры (свист, доклад), но как
диалоговый перегон для REST и для `decisions`. На стенде это команды
`inspect` и `report`, не YAML. Файл появится как
`content/scenarios/pressure-whistle.yaml`, когда каталог сольют. До слияния
его в дереве нет.

```yaml
id: pressure-whistle
title: "Свист в салоне"
category: technical
stage: enroute
carClasses: [ECONOMY, BUSINESS]
difficulty: 2
competencies: [detection, procedure, safety]
params:
  occupancy: { min: 40, max: 100 }
init: { loyalty: 70, safety: 70 }
gates:
  failIf:
    safety: { lt: 30 }
start: n1
nodes:
  n1:
    text: "Слышен свист. Пассажир держится за ухо. Откуда свист, не видно."
    timer: 20
    choices:
      - id: inspect-panel
        text: "Пройти к панели давления и снять показание"
        effects: { safety: 8 }
        skills: { detection: 2, procedure: 1 }
        set: [inspected]
        verdict: best
        next: n2
      - id: reassure
        text: "Сказать, что так и должно быть на скорости"
        effects: { safety: -10, loyalty: 4 }
        verdict: worse
        better: "Сначала показание панели, потом доклад начальнику поезда"
        next: n2
    onTimeout:
      effects: { safety: -12, loyalty: -6 }
      verdict: missed
      consequence: "Свист стих сам, источник не найден"
      next: n2
  n2:
    text: "Панель прочитана или ход уже пропущен."
    timer: 15
    choices:
      - id: report-chief
        text: "Доложить начальнику поезда, что слышали и что на панели"
        requires:
          flags: [inspected]
        effects: { safety: 12, loyalty: 6 }
        skills: { escalation: 2, safety: 1 }
        verdict: best
        next: end-ok
      - id: ignore
        text: "Идти дальше по салону, не докладывая"
        effects: { safety: -20, loyalty: -8 }
        verdict: worse
        next: end-bad
    onTimeout:
      effects: { safety: -15 }
      verdict: missed
      next: end-bad
  end-ok:
    end: completed
    text: "Доклад принят, салон оставлен под наблюдением."
  end-bad:
    end: incident
    text: "Источник шума не передан начальнику поезда."
```

Если этот перегон идёт внутри пространственной сессии, GameServer не
подставляет свои `safety` и `loyalty` в рейтинг. Он вызывает `decisions`,
а по `finish` сдаёт `RunReport`. Очки в обоих случаях считает Backend.
