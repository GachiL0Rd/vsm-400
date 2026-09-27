# HTTP API

Снимок `GET /api/openapi.json` (OpenAPI 3.0). Повторить:

```powershell
cd Backend
npm run openapi:export
```

Пишет `dist/openapi.json`. В git этот файл не входит. `npm run openapi:export -- -` печатает документ в stdout. На macOS и Linux команда та же.

Роль в таблице — с декораторов контроллеров. Коды — только те, что есть в OpenAPI. `default` у ZodResponse — успешный ответ, по HTTP это 200. Тело ошибки, даже если кода нет в строке: `application/problem+json` с полями `type`, `title`, `status`, `detail`, `code`, у Zod ещё `errors[]`.

| Метод | Путь | Доступ | Тело | Ответ |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | публично | — | 200 object, 503 object |
| POST | `/api/v1/auth/login` | публично | LoginDto | 200 LoginResponseDto |
| POST | `/api/v1/auth/refresh` | публично | — | 200 LoginResponseDto |
| POST | `/api/v1/auth/logout` | публично | — | 200 |
| POST | `/api/v1/auth/password` | любая роль, cookie или Bearer | PasswordDto | 200 LoginResponseDto |
| GET | `/api/v1/auth/session` | любая роль, cookie или Bearer | — | 200 SessionResponseDto |
| GET | `/api/v1/me` | любая роль, cookie или Bearer | — | default ProfileDto_Output |
| GET | `/api/v1/me/stats` | любая роль, cookie или Bearer | — | default StatsDto_Output |
| GET | `/api/v1/me/next-shift` | любая роль, cookie или Bearer | — | default NextShiftDto_Output |
| GET | `/api/v1/me/runs` | любая роль, cookie или Bearer | — | default RunListDto_Output |
| GET | `/api/v1/me/runs/{id}` | любая роль, cookie или Bearer | — | default RunDetailDto_Output |
| GET | `/api/v1/me/achievements` | любая роль, cookie или Bearer | — | 200 AchievementDto_Output[] |
| GET | `/api/v1/me/compare` | любая роль, cookie или Bearer | — | default CompareDto_Output |
| GET | `/api/v1/notifications` | любая роль, cookie или Bearer | — | 200 NoticePageDto |
| GET | `/api/v1/notifications/stream` | любая роль, cookie или Bearer | — | 200 text/event-stream |
| POST | `/api/v1/notifications/read-all` | любая роль, cookie или Bearer | — | 200 UnreadCountDto |
| POST | `/api/v1/notifications/{id}/read` | любая роль, cookie или Bearer | — | 200 NoticeDto |
| GET | `/api/v1/leaderboards/brigades` | любая роль, cookie или Bearer | — | 200 BrigadePlaceDto |
| GET | `/api/v1/leaderboards/{scope}` | любая роль, cookie или Bearer | query `season` (uuid) | 200 LeaderboardDto |
| GET | `/api/v1/scenarios` | любая роль, cookie или Bearer | — | 200 CatalogItemDto[], 401 |
| GET | `/api/v1/scenarios/{id}` | METHODIST, ADMIN | — | 200 ScenarioDetailDto, 401, 403, 404 |
| PUT | `/api/v1/admin/scenarios/{id}` | METHODIST, ADMIN | граф, в документе `object` | 200 ScenarioDetailDto, 401, 403, 404, 422 |
| POST | `/api/v1/admin/scenarios/{id}/status` | METHODIST, ADMIN | ScenarioStatusDto | 200 ScenarioStatusViewDto, 401, 403, 404, 422 |
| POST | `/api/v1/game-sessions` | любая роль, cookie или Bearer | OpenSessionDto | 200 OpenedSessionDto, 201, 401 |
| GET | `/api/v1/game-sessions/{id}` | любая роль, cookie или Bearer | — | 200 SessionViewDto |
| POST | `/api/v1/game-sessions/{id}/decisions` | любая роль, cookie или Bearer | DecisionDto | 200 DecisionViewDto |
| POST | `/api/v1/game-sessions/{id}/abort` | любая роль, cookie или Bearer | — | 200 AbortResultDto |
| GET | `/api/v1/game-sessions/{id}/reveal` | любая роль, cookie или Bearer | — | 200 RevealDto |
| GET | `/api/v1/analytics/brigades/{id}/heatmap` | CHIEF своей бригады, METHODIST, ADMIN | — | default HeatmapDto_Output |
| GET | `/api/v1/analytics/brigades/{id}/gaps` | CHIEF своей бригады, METHODIST, ADMIN | — | default GapsDto_Output |
| GET | `/api/v1/analytics/scenarios/{id}` | METHODIST, ADMIN | — | default ScenarioFunnelDto_Output |
| GET | `/api/v1/assignments` | CHIEF своей бригады, METHODIST, ADMIN | — | default AssignmentListDto_Output |
| POST | `/api/v1/assignments` | CHIEF своей бригады, METHODIST, ADMIN | — | 201 AssignmentListDto_Output |
| DELETE | `/api/v1/assignments/{id}` | CHIEF своей бригады, METHODIST, ADMIN | — | default AssignmentDto_Output |
| GET | `/api/v1/promotions` | CHIEF своей бригады, ADMIN | query `status` | 200 object[] |
| POST | `/api/v1/promotions/{id}/decision` | CHIEF своей бригады, ADMIN | object | 200 object |
| GET | `/api/v1/runs/suspicious` | CHIEF своей бригады, ADMIN | — | 200 object[] |
| POST | `/api/v1/runs/{id}/review` | CHIEF своей бригады, ADMIN, не свой рейс | object `{ approve }` | 200 object |
| GET | `/api/v1/org/depots` | любая роль, cookie или Bearer | — | 200 |
| GET | `/api/v1/org/depots/{id}/brigades` | любая роль, cookie или Bearer | — | 200 |
| GET | `/api/v1/org/brigades/{id}` | любая роль, cookie или Bearer | — | 200 |
| GET | `/api/v1/admin/users` | ADMIN | — | 200 |
| POST | `/api/v1/admin/users` | ADMIN | CreateUserDto | 201 |
| PATCH | `/api/v1/admin/users/{id}` | ADMIN | UpdateUserDto | 200 |
| POST | `/api/v1/admin/users/{id}/reset-password` | ADMIN | — | 200 |
| GET | `/api/v1/admin/audit` | ADMIN | — | 200 |
| GET | `/api/v1/admin/api-clients` | ADMIN | — | 200 object[], 401 object |
| POST | `/api/v1/admin/api-clients` | ADMIN | CreateApiClientDto | 201 object, 401, 403, 422 object |
| POST | `/api/v1/admin/api-clients/{id}/revoke` | ADMIN | — | 200 object, 404 object |
| POST | `/api/internal/v1/tickets/verify` | X-Service-Token | VerifyTicketDto | 200 VerifyResultDto |
| POST | `/api/internal/v1/game-sessions/{id}/decisions` | X-Service-Token | DecisionDto | 200 DecisionViewDto |
| POST | `/api/internal/v1/game-sessions/{id}/events` | X-Service-Token | EventsDto | 200 EventsResultDto |
| POST | `/api/internal/v1/game-sessions/{id}/report` | X-Service-Token | RunReportDto | 200 ReportResultDto |
| PUT | `/api/integration/v1/employees/{extId}` | X-API-Key `employees:write` | UpsertEmployeeDto | 200, 401, 403, 404, 422 object |
| GET | `/api/integration/v1/employees/{extId}/progress` | X-API-Key `progress:read` | — | 200, 401, 404 object |
| GET | `/api/integration/v1/org` | X-API-Key `org:read` | — | 200, 401 object |
| GET | `/api/integration/v1/webhooks` | X-API-Key `webhooks:manage` | — | 200 object[] |
| POST | `/api/integration/v1/webhooks` | X-API-Key `webhooks:manage` | CreateWebhookDto | 201, 401, 422 object |
| DELETE | `/api/integration/v1/webhooks/{id}` | X-API-Key `webhooks:manage` | — | 204, 404 object |

`GET /api/v1/scenarios` на одном процессе может отдать каталог не старше 30 секунд. Запись сценария на этом же процессе кэш сбрасывает. Чужая реплика за эти 30 секунд может ещё держать старый список.

Чего в OpenAPI нет, хотя ручка это принимает:

- `GET /api/v1/me/runs` — query `limit`, `cursor`.
- `GET /api/v1/assignments` — query `brigadeId`.
- `POST /api/v1/assignments` — тело `CreateAssignmentsDto` (`userIds`, `scenarioIds`, необязательные `departureAt`, `focus`).

## Подключение Frontend

Типы — `Frontend/src/model.ts` ветки `feature/frontend`. Обёртки страниц остаются: журнал и лента не массив.

### Профиль `GET /api/v1/me`

К `Profile` добавлено `grade`: `TRAINEE`, `CONDUCTOR`, `CONDUCTOR_SENIOR`, `INSTRUCTOR`.

`level`, `levelFrom`, `levelTo` — полоса от пожизненных положительных начислений `RUN`, `ACHIEVEMENT` и `CHALLENGE`. Сгоревшие из этих причин уровень не уменьшают. `points` — сумма ещё не сгоревших начислений тех же трёх причин. `EXPIRE` и `ADJUST` не входят ни туда, ни туда. После сгорания `points` может быть меньше `levelFrom`. Долю уровня считать из `points` нельзя: для полосы на экране хватает номера `level`. Строка «Баллы» читает `points`.

### Статистика `GET /api/v1/me/stats`

Поля совпадают со `Stats`. Если `escalationsTotal === 0`, долю эскалаций не делить: на экране 0, не `NaN`. Ноль в ответе — пустая история, не ошибка.

### Следующая смена `GET /api/v1/me/next-shift`

К `NextShift` добавлено `departureAt` — ISO-момент. `departure` остаётся `HH:mm` по Москве для подписи. Прогноз без назначения смотрит ближайший ещё не наступивший слот из `content/routes.yaml`, не часы уже прошедшего сегодняшнего рейса. Прошедший `PLANNED` в этот ответ не попадает. Остановки — четыре станции маршрута из того же yaml.

### Журнал

`GET /api/v1/me/runs` — `{ total, runs, nextCursor }`, не `Run[]`. У элемента нет `decisions`. Знаменатель «N из total» — `total`. Хвост — `nextCursor`.

`GET /api/v1/me/runs/{id}` — тот же рейс плюс `decisions`. `time` — игровые `HH:mm`, не ISO. `loyalty` и `safety` — дельты решения. `lucky` либо `true`, либо ключа нет.

### Лента

`GET /api/v1/notifications` — `{ unreadCount, items, nextCursor }`, не `Notice[]`. Бейдж — `unreadCount`, список — `items`.

`kind` — enum `NotificationKind`: `expiring`, `scenario`, `challenge`, `overtaken`, `advice`, `achievement`, `promotion`, `assignment`. Фронтовый словарь из шести видов не покрывает `promotion` и `assignment`. Неизвестный `kind` нельзя брать из словаря без проверки: обращение к иконке падает. Схлопывать эти два вида в `advice` на бэкенде нельзя.

Кто пишет ленту:

- `expiring` — баллы сгорают в ближайшие `expiryWarnDays`.
- `scenario` — публикация версии. Получают проводники, у которых рейс или назначение того же класса вагона. Ключ дедупа включает версию. Без своего класса вагона уведомления нет.
- `advice` — понедельник 09:00 МСК. Компетенция ниже `weakScore` и ниже среднего по депо. В тексте название сценария для тренировки, если он есть.
- `challenge` — понедельник 00:00 МСК, тема депо (самая слабая средняя компетенция): «Неделя … — бригады депо соревнуются до воскресенья». Тема лежит в Redis и в аудите `challenge.theme`. Рейс с этой компетенцией пишет `PointLedger` с причиной `CHALLENGE` на `challengePoints` из `content/rules.yaml`. Повтор `run.recorded` вторую строку не пишет. Тот же `kind` пишет закрытие сезона: место бригады.
- Подозрительный рейс в ZSET не входит (`lb:applied:<runId> = skip`). После `POST /api/v1/runs/{id}/review` с `approve: true` очки пишутся один раз в сезон, текущий на момент одобрения.
- `overtaken` — соседа обогнали в бригаде.
- `achievement` — полученный знак.
- `promotion` — рекомендация к повышению, себе и начальнику бригады.
- `assignment` — назначение смены. В тексте названия сценариев; если названия нет, остаётся id.

### Рейтинг

`GET /api/v1/leaderboards/{scope}` — `Leaderboard`. В теле есть `seasonId` (uuid сезона) и `season` (подпись, «Сезон 39»). Query `season` ждёт этот uuid. Подпись обратно в query слать нельзя: будет 422. `endsAt` — ISO. Scope `brigade` без бригады у пользователя — пустой `rows`, не ошибка.

`GET /api/v1/leaderboards/brigades` без бригады у пользователя — `{ rank: null, total: 0 }`. Бригада без депо — 404 `NO_DEPOT`. Бригада не попала в список депо — 404 `NO_BRIGADE`.

## Окружение, которого нет в OpenAPI

Имена и пределы — `src/config/env.ts`. Пустое или короткое значение роняет процесс до `listen` текстом `Некорректное окружение`.

- `COOKIE_SECURE` — `true` или `false`, по умолчанию `false`. Флаг Secure у `vsm_access`, `vsm_refresh` и `vsm_game`. В `production` старт требует `true`.
- `TRUST_PROXY` — пусто, `false` или `0`: адрес сокета, `X-Forwarded-For` не читается. Иначе список IP, CIDR или `loopback` / `linklocal` / `uniquelocal` — адреса прокси, которым верим. `true` и число хопов роняют старт: Fastify 5.12 не доверяет заголовку по числу хопов. Лимит входа считает клиентский адрес, IPv6 режется до /64.
- `WEBHOOK_ALLOWED_HOSTS` — hostname через запятую. Пусто — список пуст, и фильтр хоста не включается. Непустой список оставляет только эти хосты и не открывает частные адреса. На создании подписки и на каждой отправке URL разбирается заново: схема, DNS A/AAAA, отсечение loopback, link-local, unique-local, RFC1918, CGNAT `100.64/10`, `0.0.0.0/8`, `198.18/15`, документационных сетей, 6to4 `2002::/16`, multicast и имён metadata. NAT64 `64:ff9b::/96` и `64:ff9b:1::/48` проверяется по вложенному IPv4. Сбой DNS при доставке ретраится, остальные отказы сразу `FAILED`. В `production` схема только `https`. Сокет идёт на уже проверенный адрес, тело ответа не читается.
- `BOOTSTRAP_ADMIN_PASSWORD` — не поле zod-объекта. `loadConfig` читает его отдельно. Пусто — случайный пароль первого `admin`. Иначе минимум 10 символов. В `production` любое непустое значение роняет старт.
