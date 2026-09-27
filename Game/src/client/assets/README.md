# Необязательные изображения клиента

Игра запускается без файлов в этих каталогах: фон и персонажи рисуются простыми фигурами.

Для замены плейсхолдеров положите файлы в следующие места:

- `characters/<appearanceId>.png` — PNG персонажа с прозрачным фоном. Имя файла должно совпадать с `appearanceId` из публичного состояния сервера, например `character.conductor.default.png` или `passenger.demo-1.png`. Если точного файла нет, используется `characters/player.png` или `characters/passenger.png`; затем — фигура.
- `map/train2-long.map.json` — конечный Tiled JSON, который генерирует `npm run map:build` из `assets/map/train2-long.tmx`. Его читает `this.load.tilemapTiledJSON`. PNG тайлсетов лежат в `assets/map/` и в этот JSON не вшиты как файлы, только именами.
- `map/<tilesetName>.png` — старая заготовка: имя файла без расширения совпадает с именем тайлсета. В `train2-long.map.json` картинка задана полем `image` (хеш-PNG в `assets/map/`).

Клиент пока рисует клетки из публичного snapshot, без этого tilemap. Серверная сетка `vsm-train2-01` уже совпадает с тайлами карты: одна клетка = один тайл, координаты — координаты Tiled.
