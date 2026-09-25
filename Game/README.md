# Game

Браузерная игра на Phaser 4, TypeScript и Vite. `index.html` служит локальной
оболочкой разработки и не определяет способ будущего встраивания в клиент.

## Требования

- Node.js 22.12.0 или новее; рекомендуемая LTS-major указана в `.nvmrc`;
- npm.

## Запуск

Из каталога `Game/`:

```powershell
npm ci --include=dev
npm run dev
```

Полная проверка:

```powershell
npm run verify
```

Если установлен `just`, доступны эквивалентные сокращения `just setup`,
`just dev` и `just check`. `just` не является обязательной зависимостью.

Перед изменением прочитайте `AGENTS.md` и актуальный baseline в
`../docs/user/vsm_baseline_vertical_slice.md`.
