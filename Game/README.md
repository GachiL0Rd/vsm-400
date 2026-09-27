# Game

Браузерный модуль игры на Phaser 4, TypeScript и Vite. Серверная симуляция и
клиентское представление развиваются как отдельные слои: клиент не должен
принимать доменные решения и не является источником игрового состояния.

Актуальные release-требования, целевой baseline и архитектура находятся в
[`docs/user/`](docs/user/README.md). Рабочие инструкции находятся в [`docs/agent/`](docs/agent/README.md), а устаревшие материалы — в [`docs/backlog/`](docs/backlog/README.md). Они не имеют приоритета над `docs/user/`.

## Текущее состояние

`src/simulation/` содержит authoritative simulation primitives и gameplay runtime, `src/server/` — lifecycle/Game Server composition root, `src/common/` — browser-safe protocol/projection contracts, а `src/client/` — Phaser presentation client.

Обязательный scope текущего release candidate находится в [`docs/user/release-scope-0.1.0.md`](docs/user/release-scope-0.1.0.md). Более полный целевой вертикальный срез описан в [`docs/user/vsm_baseline_vertical_slice.md`](docs/user/vsm_baseline_vertical_slice.md).

Актуальные рабочие ограничения и точечные блокеры находятся в `docs/agent/`; они не заменяют normative release/baseline contracts из `docs/user/`.

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

`verify` выполняет Biome, TypeScript, Vitest, production build, smoke-запуск
скомпилированного Game Server и проверку browser bundle. `npm run build` создаёт
единый distributable в `dist/`: `dist/server/main.mjs`, browser folder root
`dist/client/` и versioned server config `dist/content/`. Запуск готовой сборки:
`npm run start:server`.

## Linux dependency bundle для агентной среды

Для среды автоматизированной разработки можно подготовить отдельный
`node_modules_linux/`. Каталог игнорируется Git и не заменяет обычный
`node_modules/` разработчика.

Для агентной Linux-среды допускается внешний offline dependency bundle. Обычная разработка по-прежнему использует `npm ci` и закоммиченный `package-lock.json`.

## Направление разработки

Перед изменениями прочитайте `AGENTS.md`, затем:

- [`release-scope-0.1.0.md`](docs/user/release-scope-0.1.0.md);
- [`vsm_baseline_vertical_slice.md`](docs/user/vsm_baseline_vertical_slice.md);
- [`project_direction.md`](docs/user/project_direction.md);
- [`simulation/actions.md`](docs/user/simulation/actions.md);
- [`architecture/client-server.md`](docs/user/architecture/client-server.md).
