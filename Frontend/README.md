# Frontend

React-клиент на React 19, TypeScript и Vite. Сейчас содержит стандартный шаблон
`create-vite` (`react-ts`) без прикладной логики.

## Требования

- Node.js 22.12.0 или новее; рекомендуемая LTS-major указана в `.nvmrc`;
- npm.

## Запуск

Из каталога `Frontend/`:

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

Перед изменением прочитайте `AGENTS.md`.
