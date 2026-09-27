# Frontend

Кабинет проводника вокруг игры: смена, разбор рейса, профиль и компетенции,
достижения, рейтинг и лента уведомлений. React 19, TypeScript, Vite, шрифт
Moscow Sans.

Вход и сессия идут в Backend (`POST /api/v1/auth/login`, cookie `vsm_access` /
`vsm_refresh`). Экраны кабинета пока читают синтетику из `src/demo.ts`:
позывные вместо ФИО, реальных персональных данных нет.

## Требования

- Node.js 22.12.0 или новее; рекомендуемая LTS-major указана в `.nvmrc`;
- npm.

## Запуск

Из каталога `Frontend/`:

```powershell
npm ci --include=dev
npm run dev
```

Кнопка «Начать смену» ведёт на адрес игры из `VITE_GAME_URL`
(см. `.env.example`). Пустое или отсутствующее значение — на кнопке
текст «Игра недоступна», это не ссылка. Адрес подставляется при запуске
и сборке Vite; смена переменной у уже собранного `dist/` ничего не меняет.

В `npm run dev` и `vite preview` запросы `/api` проксируются на
`VITE_API_PROXY` (по умолчанию `http://127.0.0.1:3000`), `changeOrigin` выключен:
браузер ходит на тот же origin, cookie остаются first-party. Для выкладки, где
API на другом хосте, задайте `VITE_API_URL`; пустое значение — тот же origin.
`import.meta.env.BASE_URL` только для роутера, пути API всегда начинаются с `/api`.

Типы OpenAPI лежат в `src/api/schema.d.ts`. Пересобрать при живом Backend:

```powershell
npm run api:types
```

## History API

Адреса разделов — обычные пути без `#` (`/profile`, `/runs/r412`).
`npm run dev` и `vite preview` отдают `index.html` на неизвестный путь.
Прод-сервер обязан делать то же, иначе обновление страницы на глубокой
ссылке вернёт 404. Для nginx:

```nginx
try_files $uri /index.html;
```

Полная проверка:

```powershell
npm run verify
```

Если установлен `just`, доступны эквивалентные сокращения `just setup`,
`just dev` и `just check`. `just` не является обязательной зависимостью.

Перед изменением прочитайте `AGENTS.md`.
