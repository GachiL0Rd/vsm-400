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
versioned media-manifest placeholder (при необходимости)
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

## 3. Media contract текущего release

В release `0.1.0` полноценный media manifest **не зафиксирован**. Client использует stable `visualId` из public projection и собственный browser-local registry/hardcoded mapping. Это допустимое временное решение до интеграции основной клиентской ветки.

Серверный gameplay/content bundle не должен зависеть от конкретных URL, texture paths или формата клиентского asset registry.

Для будущей совместимости резервируется versioned media-manifest boundary, но его schema пока считается placeholder и не является нормативным API. Не следует добавлять поля manifest-а заранее без реального требования клиента/art pipeline.

Примеры стабильных visual IDs остаются полезными как namespace, но не определяют format manifest-а:

```text
carriage.background.default
platform.background.default
object.extinguisher.world
object.extinguisher.held
character.body.default
```

## 4. Browser-only asset delivery

Клиентские изображения, тексты и другие данные, которые влияют только на rendering/presentation, могут поставляться отдельно от authoritative game content.

Для интеграции клиентской ветки допускается HTTP file-storage endpoint/namespace Game Server, через который Client сможет получать такие browser-only assets. Точный URL layout, manifest schema, caching/hash policy и способ упаковки пока **не зафиксированы** и должны быть определены вместе с реальным клиентским набором данных.

До этого момента поддерживаются два простых варианта:

1. ассеты находятся рядом с browser build и разрешаются локальным registry/hardcode;
2. ассеты обслуживаются отдельным static/file endpoint без изменения simulation semantics.

Stable `visualId` остаётся границей между gameplay projection и способом хранения media.

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
