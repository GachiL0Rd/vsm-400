# Правила работы с модулем Frontend

## Контекст и границы

`Frontend/` — кабинет проводника вокруг игры: смена, разбор рейса, профиль,
достижения, рейтинг, лента. Игра запускается отдельно по `VITE_GAME_URL`.
HTTP API кабинета — `Backend/` через `src/api/` (openapi-fetch + TanStack Query).
Экраны читают профиль, журнал, рейтинг и ленту из `src/api/cabinet.ts`.
Сессия — `src/api/auth.ts`. В `npm run dev` запросы `/api` проксируются на
Backend (`VITE_API_PROXY`, по умолчанию `http://127.0.0.1:3000`).

Структура `src/`: `api/` — клиент, ключи (`keys.ts`), кэш (`queryClient.ts`) и
запросы кабинета, `model.ts` — типы и справочники экранов, `paths.ts` — пути
разделов, `format.ts` — форматирование, `hooks/` — общие хуки,
`components/` — общие элементы, `screens/` — экраны. Навигация —
`react-router` (History API, без `#`). Типы OpenAPI пересобирает
`npm run api:types` в `src/api/schema.d.ts`.

Каждый компонент и экран — своя папка: `components/Nav/Nav.tsx` и рядом
`Nav.css`. Импорт напрямую из файла (`./components/Nav/Nav`), без `index.ts`:
barrel-файлы замедляют Vite. Подкомпоненты с одним потребителем живут в файле
экрана. Стили — обычный CSS по БЭМ; токены, reset и утилиты — в `index.css`,
остальное — в CSS своего компонента.

Перед изменением прочитайте:

- `../docs/user/README.md` — индекс действующих требований;
- `../docs/user/project_direction.md` — границы модулей и переносимой логики.

Не реализуйте продуктовые сценарии по предположениям. Неопределённую деталь
оставляйте открытым вопросом.

## Среда и команды

- Node.js: минимум **22.12.0** (`package.json#engines`), рекомендуемая
  LTS-major **24** (`.nvmrc`).
- Package manager: npm; версии фиксируются точно (`.npmrc`: `save-exact`),
  `package-lock.json` коммитится.
- React: **19.3.0**.
- React Router: **8.4.0** — declarative mode, чистые пути.
- TypeScript: **6.0.3**.
- Vite: **8.3.1**.
- Biome: **2.5.14** — форматирование и lint, включён домен `react`.

Из каталога `Frontend/`:

```powershell
npm ci --include=dev
npm run dev
npm run verify
npm run api:types
```

`api:types` пересобирает `src/api/schema.d.ts` из живого
`http://127.0.0.1:3000/api/openapi.json` (openapi-typescript 7.13.0 через npx,
в зависимостях его нет: peer `typescript ^5` не сходится с TS 6). Сгенерированный
файл коммитится; Biome его не проверяет (`!src/api/schema.d.ts` в `biome.json`).

`verify` включает форматирование в режиме проверки, lint, TypeScript typecheck
(`tsc -b`) и production-сборку. `npm run format` и `npm run check:write` меняют
файлы и запускаются только намеренно.

## Границы реализации

- Не импортируйте код из `Game/` напрямую; общий контракт между модулями
  появляется отдельной задачей.
- Не создавайте пустые каталоги, слои и интерфейсы «на будущее»; структура
  должна появляться вместе с работающим кодом.
- Не добавляйте UI-kit и CSS-фреймворк без конкретного потребителя. Серверное
  состояние — TanStack Query; Redux/Zustand и второй query-клиент не нужны.
  Маршруты кабинета ведёт `react-router`: пять экранов, параметр `/runs/:id` и
  активный пункт меню. Второй роутер не добавляйте.
- Позывной приходит с сервера. ФИО в кабинет не выводить.

## Проверка и зависимости

- После законченного изменения запускайте `npm run verify`.
- Для визуальных изменений дополнительно проверяйте `npm run dev` в браузере.
- Перед runtime-зависимостью проверьте React, Web API и стандартный TypeScript.
- `node_modules/` и `dist/` не входят в Git.
