# Вагон `train1` для Tiled

Откройте [`train1.tiled-project`](train1.tiled-project) и карту [`train1.tmx`](train1.tmx). Это редактируемый визуальный прототип вагона ВСМ в боковом разрезе. Референсы Beholder Conductor использованы для композиции и настроения; пиксели из скриншотов не переносились.

- Карта: ортогональная, 30 × 16 ячеек по 64 × 64 px; полный размер 1920 × 1024 px.
- Слева направо: перрон (x 0–2), вход/тамбур (x 3), пассажирский салон (x 4–25), служебный отсек (x 26–29).
- `Background`, `Wall`, `Floor`, `Carriage`, `Furniture`, `Details` — видимые графические слои.
- `WalkableZones`, `GameplayAnchors`, `Collision` — скрытые слои с черновыми разметками для будущей интеграции. В Tiled их можно включить в панели слоёв.
- [`train1-tiles.tsx`](train1-tiles.tsx) использует оригинальный концепт-атлас из 64 тайлов. SVG-источник хранится в [`train1-tiles.svg`](train1-tiles.svg); [`train1-art-source.mjs`](train1-art-source.mjs) пересоздаёт SVG. Импортированное через Tiled AI PNG-изображение имеет имя `image-<hash>.png` и подключено относительным путём в TSX.

Карта пока является самостоятельным Tiled-ассетом. Клиент игры продолжает использовать текущую логическую сетку в `Game/src/client/map.ts`; разметка этой карты не меняет симуляцию или поведение персонажей.

## Длинный вагон `train2-long`

[`train2-long.tmx`](train2-long.tmx) сейчас — **один** длинный вагон, не состав из четырёх. Файл побайтно совпадает с [`train2-long-single-car.tmx`](train2-long-single-car.tmx). Это бесконечная ортогональная карта, клетка 64 × 64 px; чанки начинаются с x = −16. Масштаб арта: 1 px = 5 мм, поэтому тайл ≈ 32 см.

Не запускайте [`train2-four-car-source.mjs`](train2-four-car-source.mjs): скрипт перезаписывает `train2-long.tmx` четырёхвагонной картой. SVG планов `train2-first.svg`, `train2-business.svg`, `train2-comfort.svg` и `train2-standard.svg` остаются исходниками того генератора и в текущий TMX не входят.

Проходимые зоны (`WalkableZones`): перрон `origin_platform` x −6…−1, y 8…11; тамбур `boarding_vestibule` x 6…10, y 8…11; проход `central_aisle` x 11…66, y 8; служба `service_zone` x 67…74, y 8…11. Нос (x 0…5) стоит между перроном и тамбуром, пешего соединения нет. `PassengerSeats` — 56 точек `bay_NN_far_L|R` / `bay_NN_near_L|R`: дальние места на ряду 7, ближние на ряду 10. `Collision` — 56 прямоугольников `SeatSolid` 64×128 (дальний закрывает ряды 6–7, ближний — 9–10, поэтому ряд 9 — рама кресла, не клетка).

Эта карта — источник геометрии серверного уровня `vsm-train2-01`. Одна server cell = один тайл, `x`/`y` клетки — координаты тайла Tiled. Смысл, которого нет в арте (регионы, якоря, объекты, двери), лежит в [`content/vsm-train2-01/map-bindings.json`](../../content/vsm-train2-01/map-bindings.json).

Из каталога `Game/`:

```bash
npm run map:build   # пишет level.json и конечный Tiled JSON
npm run map:check   # падает, если закоммиченные файлы разошлись с генератором
```

`map:check` входит в `npm run verify`. Генератор — [`scripts/build-train2-map.ts`](../../scripts/build-train2-map.ts). Он читает TMX, три TSX и bindings и пишет:

- `content/vsm-train2-01/level.json` — клетки `carriage.x{X}y{Y}`, `platform-origin.x{X}y{Y}`, `platform-standard.x{X}y{Y}` и места `carriage.seat.{name}`;
- `src/client/assets/map/train2-long.map.json` — конечная карта для `this.load.tilemapTiledJSON`. Чанки склеены в границы x −16…80, y 0…16. Полоса y ≥ 16 содержит тайлы только слоя `Void`, поэтому в клиентский JSON она не входит. Свойства карты `originX` = −16 и `originY` = 0: мир в пикселях = `((x − originX) · 64, (y − originY) · 64)`. PNG тайлсетов остаются в этом каталоге.

Якорь садится на тайл точки, если тайл проходим. Иначе берётся ближайшая зонная клетка по манхэттену; при равенстве побеждает больший y, затем меньший x, затем регион с `defaultActive`, затем меньший id клетки. Места в кандидаты не входят. Так `entry_control_panel` (9, 6) попадает на `carriage.x9y8`, огнетушитель (67, 7) — на `carriage.x67y8`, `technical_panel` (74, 6) — на `carriage.x74y8`. `player_start` (−4, 8) сервером не используется: игрок стартует в клетке журнала.

`sanitation.service` стоит на ближайшем тайле `central_aisle` к `service_counter`: `carriage.x66y8`. Сама стойка — в служебной зоне (69, 8).

Дверь — два направленных ребра `platform-origin` и `platform-standard` (−1, 8) ↔ клетка `boarding_door`. Id кончается на `:door`. Цена = манхэттен в тайлах × 0.25.
