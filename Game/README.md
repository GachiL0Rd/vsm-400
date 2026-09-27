# Game

Браузерный модуль игры на Phaser 4, TypeScript и Vite. Серверная симуляция и
клиентское представление развиваются как отдельные слои: клиент не должен
принимать доменные решения и не является источником игрового состояния.

Актуальная архитектура и baseline находятся в
[`docs/user/`](docs/user/README.md). Рабочие инструкции находятся в [`docs/agent/`](docs/agent/README.md), а устаревшие материалы — в [`docs/backlog/`](docs/backlog/README.md). Они не имеют приоритета над `docs/user/`.

## Текущее состояние

В `src/simulation/` уже реализованы независимые примитивы времени, очереди
событий, deterministic RNG streams, grid/navigation, spatial movement, fields,
entity state, NPC action decision и предметы baseline.

Старый mechanics-playground, встроенный WebSocket demo-server и zone-based
Phaser client удалены. В `src/client/` оставлена только минимальная Phaser-
оболочка, чтобы production build оставался рабочим до появления `GameAttempt` и
новой public projection. `npm run dev` сейчас показывает именно эту оболочку;
полноценный локальный игровой сервер и presentation layer будут возвращены уже
поверх нового authoritative runtime.

Состояние интеграционного контура и ссылки на уже зафиксированные protocol/
deployment contracts находятся в
[`docs/agent/integration-hardening.md`](docs/agent/integration-hardening.md).
Известная недостающая visual data boundary описана в
[`docs/agent/client-visual-blockers.md`](docs/agent/client-visual-blockers.md).

## Требования

- Node.js `>=22.12.0`;
- `.nvmrc` указывает рекомендуемую major-версию для обычной разработки;
- npm и `package-lock.json` используются как основной package-manager contract.

## Установка и проверка

Из `Game/`:

```powershell
npm ci --include=dev
npm run verify
```

Запуск браузерной оболочки:

```powershell
npm run dev
```

`verify` выполняет Biome, TypeScript, Vitest, production build и проверку
bundle. Браузерные e2e-скрипты старого demo удалены; новый Playwright flow стоит
возвращать после появления стабильного сквозного `GameAttempt`.

## Linux dependency bundle для агентной среды

Для среды автоматизированной разработки можно подготовить отдельный
`node_modules_linux/`. Каталог игнорируется Git и не заменяет обычный
`node_modules/` разработчика.

Для агентной Linux-среды допускается внешний offline dependency bundle. Обычная разработка по-прежнему использует `npm ci` и закоммиченный `package-lock.json`.

## Направление разработки

Перед изменениями прочитайте `AGENTS.md`, затем:

- [`vsm_baseline_vertical_slice.md`](docs/user/vsm_baseline_vertical_slice.md);
- [`project_direction.md`](docs/user/project_direction.md);
- [`simulation/actions.md`](docs/user/simulation/actions.md);
- [`architecture/client-server.md`](docs/user/architecture/client-server.md).
