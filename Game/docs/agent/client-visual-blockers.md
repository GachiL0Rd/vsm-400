# Блокеры визуальной части клиента

## Санитарные overlay клеток

Документация реализации требует показывать поверх публичной клетки runtime
overlays: `trash-small-01`, `spill-01` и `stain-seat-01`. Текущий
`PublicCellView` содержит только `id`, `x`, `y` и `regionId`, поэтому у
браузера нет публичного источника такого visual.

- Блокируемый visual use case: отобразить server-authoritative загрязнение на
  клетке без догадки по object kind или истории клиента.
- Минимальный желаемый public contract: optional cell-local overlay records,
  например `{ visualId: string }`, либо эквивалентное public event/state поле,
  которое задаёт и клетку, и stable visual ID.

Клиентская догадка и изменение схемы в этот patch не входят.
