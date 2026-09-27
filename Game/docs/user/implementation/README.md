# Implementation documentation map

**Версия документа:** 0.4.0  
**Статус:** Draft / concrete demo implementation  
**Дата редакции:** 2026-09-27

Этот раздел фиксирует конкретную реализацию текущего демонстрационного среза и ближайший baseline design для его content/presentation слоя: игровые объекты, модалки, переносимые предметы, визуальные слои и требования к клиентским ассетам.

Если раздел описывает baseline/deferred возможность, которая не входит в текущий release, это должно быть отмечено непосредственно рядом с таким контрактом. Наличие описания в `implementation/` само по себе не означает, что возможность уже реализована в release.

Он намеренно отделён от `architecture/` и `simulation/`.

- `architecture/` определяет границы сервисов, протокол, replay и режимы сессии;
- `simulation/` определяет общие механизмы движка;
- `implementation/` описывает конкретный контент и представление текущей игры.

Если конкретный объект позднее будет заменён или расширен, это не должно требовать переписывать базовые архитектурные документы.

## Документы

- [`interactables.md`](interactables.md) — конкретные игровые объекты, runtime-state и действия.
- [`modal-content.md`](modal-content.md) — содержимое модалок и программно заполняемые поля.
- [`held-items.md`](held-items.md) — один held slot, журнал, огнетушитель, простые еда/напиток.
- [`character-appearance.md`](character-appearance.md) — сборка персонажей из манекена и слоёв одежды.
- [`asset-requirements.md`](asset-requirements.md) — требования к художнику и разбиению изображений на слои.
- [`environment-state.md`](environment-state.md) — санитарные overlays, подключаемый перрон и presentation состояния поездки.
- [`service-levels.md`](service-levels.md) — уровни обслуживания, допустимые/неположенные запросы и требования к качеству.
- [`trip-service-plan.md`](trip-service-plan.md) — примерный план рейса, исходная посадка и временные окна обслуживания.
- [`hud.md`](hud.md) — DOM HUD клиента: панели, журнал событий, тосты и телефонный landscape.

## Sample data for Platform demos

`npm run samples:generate` из каталога `Game/` запускает [`scripts/generate-sample-results.ts`](../../../scripts/generate-sample-results.ts). Скрипт прогоняет уровень `vsm-train2-01` через тот же `GameAttempt` и assessment, что authoritative Game Server: детерминированные seed и политики бота, без рукописного JSON. Результат — `Backend/prisma/seed/fixtures/game-results.json`, массив тел `FinishedGameResult` с `assessment`.

`attemptId` в файле всегда `placeholder`. Platform подставляет свой идентификатор попытки, когда записывает прогон как живой finish. Повторный запуск с теми же seed даёт побайтово тот же файл. Vitest `scripts/generate-sample-results.test.ts` сверяет тела со схемой `finishedGameResultSchema` и эту стабильность.

Политики, которые смешиваются в выборке:

- аккуратный проводник: честный журнал, верная посадка, быстрый сервис, пожар потушен в пороге быстрого ответа, стоп-кран не трогает;
- спешка: сервис позже целевого окна; отдельно — два таймаута запроса, дальше сервис снова закрывается;
- ошибки документов: опасный допуск и неверный отказ;
- ложная критическая отметка в журнале приёма;
- пропущенная реальная неисправность: до сдачи журнала бот снимает пин огнетушителя и отмечает норму. Отдельного флага неисправности в контенте уровня нет, неисправность создаёт authoritative действие `prepareExtinguisher`;
- пожар не потушен до критического порога;
- критическая утечка давления. Штатные ступени `entry-pressure-leak` до порога не доходят, поэтому эти попытки идут с тем же уровнем и усиленной утечкой (`attenuationKPaPerMeter: 0`, потеря 30 кПа на первой ступени);
- ложный стоп-кран без активного пожара или утечки;
- экстренная остановка при уже начавшемся пожаре.

## Главная граница

Клиентские изображения и шрифты являются локальными ассетами, но их состояние определяет сервер.

Пример:

```text
Game Server
  extinguisher.pin = removed
  extinguisher.pressure = warning
  extinguisher.damage = scratch-01
        ↓ public projection
Game Client
  base image
  + no pin overlay
  + gauge needle at warning position
  + scratch overlay
```

Client asset registry может свободно менять конкретные изображения без изменения simulation semantics, пока стабильные asset/state IDs сохраняют смысл.

- [`assets-and-content.md`](assets-and-content.md) — разделение versioned content/media, asset manifest и optional remote загрузка.
