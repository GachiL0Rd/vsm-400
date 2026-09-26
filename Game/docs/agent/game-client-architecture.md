# Архитектура игрового клиента

`Game/src/main.ts` запускает Phaser и передаёт корневой DOM-элемент и WebSocket URL единственной сцене `GameScene`. Сцена создаёт менеджеры, принимает публичный `ClientState` от `GameConnection`, определяет полный snapshot или delta и распределяет данные. Она не рисует игровой мир и не строит HUD.

```text
main.ts → GameScene → GameConnection → protocol.ts / state.ts
                    ├─ WorldManager / ViewportManager
                    ├─ CollisionManager → map.ts
                    ├─ PlayerManager / NpcManager / PoiManager / InputManager
                    ├─ InteractionManager / DialogueManager / HudManager
                    └─ SoundManager / VfxManager / PauseManager
```

## Владельцы объектов и ресурсов

| Владелец | Объекты и локальное состояние | Очистка |
| --- | --- | --- |
| `WorldManager` | Постоянные `Graphics` и `Text` перрона/вагона | Удаляет свои game objects |
| `PlayerManager` | Фигура и подпись игрока, маркер маршрута, клетка/путь, ожидаемый переход зоны | Удаляет фигуры; на полном snapshot сбрасывает маршрут и позицию |
| `NpcManager` | Фигуры, номера, имена, речь, наблюдаемые intent и локальные маршруты NPC | Удаляет исчезнувших NPC и все фигуры при reset/shutdown |
| `PoiManager` | Фигуры/подписи видимых POI, дым и пульсация очага | Снимает pointer callbacks, останавливает tweens, удаляет фигуры |
| `CollisionManager` | Запросы занятости клеток и подбор маршрута поверх чистого `map.ts` | Не создаёт Phaser-объекты |
| `InputManager` | Pointer callbacks пола, NPC и POI | Снимает подписки при удалении объекта и shutdown |
| `ViewportManager` | Настройка камеры и подписка на изменение размера Phaser | Снимает resize listener |
| `InteractionManager` | Одно выделение, кольцо, контекстная карточка действий | Сбрасывает выбор на новом snapshot, удаляет кольцо и содержимое карточки |
| `HudManager` | DOM-оболочка, связь, часы, метрики, сигналы, задачи, предмет, итог, dev-сценарии | Останавливает интервал часов, снимает `window.resize`, удаляет DOM |
| `DialogueManager` | Диалог, документы и локально закрытое окно | Очищает контент при новом snapshot/shutdown |
| `SoundManager` | Регулятор громкости и `AudioContext` сигнала | Снимает input listener и закрывает аудиоконтекст |
| `VfxManager` | Краткие надписи и пульсации наблюдаемых изменений | Останавливает свои tweens и удаляет эффекты |
| `PauseManager` | Dev-кнопки `0/1/3` и их состояние | Удаляет кнопки; отправляет серверу `dev-control` |
| `GameConnection` | Один WebSocket, reconnect, `hello/resync`, очередь и статус команд | `stop()` на shutdown сцены и `beforeunload` |

`HudManager` владеет DOM-контейнерами, а `InteractionManager` и `DialogueManager` владеют **содержимым** своих вложенных элементов. Клиентские менеджеры читают лишь `ObservableSnapshot`; они не импортируют `Game/dev/demo-server.ts` или доменные реализации из корня `Game/src`. `map.ts`, `state.ts` и `protocol.ts` остаются чистыми TypeScript-модулями.

## Поток состояния и команд

1. `GameConnection` разбирает WebSocket-сообщение; `state.ts` применяет `snapshot/delta/ack/reject` и публикует `ClientState`.
2. `GameScene` сравнивает `snapshotSerial`, `sessionId` и ревизию. Для полного snapshot сбрасывает локальное представление и затем передаёт публичные данные менеджерам. Обычная delta обновляет только изменившиеся массивы/поля. Звук и краткие VFX не воспроизводятся повторно при полном snapshot.
3. В кадре сцена обновляет движение игрока и NPC, затем положение кольца выбора. Камера следует за игроком; HUD обновляет только отображение времени.
4. Клик/касание → `InputManager` → `PlayerManager` (маршрут) или `InteractionManager` (выбор). DOM-кнопка вызывает узкий callback сцены. Команды идут только через `GameConnection`; сервер подтверждает и решает последствия.

`CollisionManager` не является игровой физикой. Он использует прежнюю сетку 14 × 6, `isWalkable`, `findRoute` и текущие клетки персонажей. Решения NPC, развитие повреждений, задачи, оценка, случайность и скорость симуляции остаются на сервере. `PauseManager` меняет серверную скорость командой и не вызывает паузу Phaser-сцены.

## Проверка

Из `Game/`: `npm run verify`; при работающем `npm run dev` — `node scripts/browser-smoke.mjs`, `node scripts/browser-flow.mjs`, `node scripts/browser-lifecycle.mjs`. Последний проверяет мышь, касание, отказ сервера, паузу, два перезапуска сцены и уничтожение игры без накопления DOM-панелей, таймеров, pointer/resize listeners и WebSocket-соединений. Браузерные скриншоты сохраняются в игнорируемом `artifacts/`.
