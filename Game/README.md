# Game

Браузерный игровой клиент на Phaser 4, TypeScript и Vite. `index.html` служит
локальной оболочкой. Сервер владеет игровым состоянием; клиент показывает
наблюдаемое состояние, перемещает персонажей и отправляет команды по WebSocket.

## Требования

- Node.js 22.12.0 или новее; рекомендуемая LTS-major указана в `.nvmrc`;
- npm.

## Запуск

Из каталога `Game/`:

```powershell
npm ci --include=dev
npm run dev
```

Vite поднимает тестовый WebSocket на `/game-ws`. В интерфейсе доступны четыре
воспроизводимые ветки: давление, пожар, сервисная просьба и конфликт. Клик по
полу задаёт маршрут, клик по объекту или пассажиру открывает контекстные
действия. Скорость и пауза работают только в dev-стенде. Он нужен для проверки
клиента и не является production-сервером.

Для подключения к настоящему серверу задайте `VITE_GAME_WS_URL` при сборке
или заполните `<meta name="game-websocket" content="wss://…">` в оболочке.
При отсутствии адреса production-клиент показывает состояние «Нет связи» и
кнопку повторного подключения. Контракт сообщений и обязанности сервера:
[`docs/agent/game-websocket-contract.md`](docs/agent/game-websocket-contract.md).

Тестовые PNG-спрайты находятся в `public/sprites/`. Исходный генератор:
`scripts/make_sprites.py` (Python + Pillow; нужен только при перегенерации
артов). Фотографии Dataset в сборку не копируются.

Полная проверка:

```powershell
npm run verify
```

Браузерная проверка после `npm run dev`:

```powershell
node scripts/browser-smoke.mjs
node scripts/browser-flow.mjs
```

При другом порте задайте `GAME_URL` для этих команд. Скриншоты сохраняются в
`artifacts/`, который исключён из Git. `browser-flow.mjs` проходит четыре
ветки с настоящим WebSocket и проверяет успешный и неуспешный пожар. Полная
карта 51 ситуации Dataset: [`docs/agent/dataset-scenario-map.md`](docs/agent/dataset-scenario-map.md).

Если установлен `just`, доступны эквивалентные сокращения `just setup`,
`just dev` и `just check`. `just` не является обязательной зависимостью.

Перед изменением прочитайте `AGENTS.md` и актуальный baseline в
`../docs/user/vsm_baseline_vertical_slice.md`.
