# Игровой content и media assets

**Версия документа:** 0.2.0
**Статус:** Draft / implementation direction
**Дата редакции:** 2026-09-27

## 1. Разделение content и изображений

Следует различать два вида данных.

### Versioned game content

Хранится в репозитории и участвует в validation/versioning:

```text
levels / maps
scenarios
dialogue content
action/trait definitions
service presets
asset manifest
```

### Media assets

Крупные изображения/спрайты могут поставляться отдельно от git:

```text
carriage/platform backgrounds
object sprites
modal artwork
character mannequins
clothing layers
held-item visuals
```

Отсутствие production media assets не должно блокировать simulation/server tests.

## 2. Реализованная server-content структура

Release server content находится в `Game/content/` и копируется build-ом в `dist/content/`:

```text
content/
  manifest.json
  vsm-baseline-01/
    level.json
    scenario.json
    actions.json
    assessment.json
```

`GAME_CONTENT_DIR` может указывать на отдельный read-only bundle. Точный контракт описан в [`../deployment/content-bundle.md`](../deployment/content-bundle.md). Dialogue/service extensions могут позднее добавляться как новые versioned files/references manifest-а.

## 3. Asset manifest

`assets/manifest.json` является versioned соглашением между content и Client.

Manifest сопоставляет stable visual ID с media resource и его ролью, например:

```text
carriage.background.default
platform.background.default
object.extinguisher.world
object.extinguisher.held
object.extinguisher.modal.base
character.body.default
character.clothes.jacket-blue
```

Level/Scenario/Presentation references используют visual ID, а не жёсткие относительные пути к изображениям.

Manifest может позднее содержать hash/version, dimensions или layer metadata, если это реально потребуется pipeline.

## 4. Загрузка ассетов

Baseline build должен допускать два источника media:

1. локальный `assets/local/`;
2. внешний asset bundle/base URL, указанный build/runtime option.

Предпочтительная дальнейшая схема:

```text
asset manifest
      ↓
prepare-assets
      ├─ local cache
      └─ optional remote base URL
      ↓
client build/public asset directory
```

Конкретный downloader пока не является обязательной реализацией.

## 5. Карта и фон

Level хранит authoritative grid/topology и ссылки на presentation assets.

Client может показывать каждый активный region как один большой фон, выровненный относительно grid origin. Интерактивные и изменяемые элементы рисуются поверх него.

Таким образом интерьер вагона или перрон не обязаны состоять из отдельных декоративных тайлов.

```text
region background
    + static/interactive objects
    + sanitation overlays
    + entities
    + transient effects
```

## 6. Персонажи

Character appearance собирается на Client из локальных layers:

```text
mannequin/body
clothing layers
optional accessories
held-item layer
```

Server передаёт только stable appearance IDs и observable state.

Character media следует держать в отдельном namespace/подкаталоге assets, но отдельная simulation model для них не требуется.

## 7. Placeholder policy

До прихода production art разрешены простые формы, подписи и placeholder images при условии, что они используют те же stable visual IDs.

Это позволяет Client и Server развиваться параллельно с художественным pipeline.
