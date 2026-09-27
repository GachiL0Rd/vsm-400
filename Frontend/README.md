# Frontend

Кабинет проводника вокруг игры: смена, разбор рейса, профиль и компетенции,
достижения, рейтинг и лента уведомлений. React 19, TypeScript, Vite, шрифт
Moscow Sans.

Вход, сессия и экраны кабинета идут в Backend (`POST /api/v1/auth/login`,
cookie `vsm_access` / `vsm_refresh`, TanStack Query в `src/api/`). В кабинете
позывной, не ФИО.

## Требования

- Node.js 22.12.0 или новее; рекомендуемая LTS-major указана в `.nvmrc`;
- npm.

## Запуск

Локально против Backend:

1. Поднять API по [`Backend/README.md`](../Backend/README.md) на
   `http://127.0.0.1:3000`.
2. Из каталога `Frontend/`:

```powershell
npm ci --include=dev
npm run dev
```

3. Войти `demo1` / `demo1` — учётка из сида Backend. Рядом `demo2`…`demo5`, пароль равен логину.

Без живого Backend форма входа ответит «Нет связи с сервером».

Кнопка «Начать смену» открывает смену запросом `POST /api/v1/game-sessions`
с телом `{ "transport": "WS" }` и cookie-сессией. В ответе приходит `launchUrl` —
абсолютный адрес игрового клиента. Кабинет переходит на него. Билет и адрес
на экране не показываются.

Поле `launchUrl` в `src/api/schema.d.ts` вписано вручную. Когда ветка Backend
отдаст его в OpenAPI, типы нужно пересобрать командой `npm run api:types`.

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
