# Интеграция HR и LMS

Внешний контур живёт на `/api/integration/v1` (глобальный префикс `/api` уже есть,
версия в пути не дублируется). Доступ — заголовок `X-API-Key`.

Ключ выглядит как `vsm_<id>_<secret>`. В базе хранится только `sha256(secret)`.
Сравнение секрета — `timingSafeEqual` по хешам. Отзыв (`revokedAt`) и недостающий
scope дают разные коды: `API_KEY_REVOKED` и `API_KEY_SCOPE`.

| Scope | Ручка |
| --- | --- |
| `employees:write` | `PUT` и `DELETE /api/integration/v1/employees/:extId` |
| `progress:read` | `GET /api/integration/v1/employees/:extId/progress` |
| `org:read` | `GET /api/integration/v1/org` |
| `webhooks:manage` | `POST/GET/DELETE /api/integration/v1/webhooks` |

Админские ручки ключей — JWT кабинета, роль `ADMIN`:

- `POST /api/v1/admin/api-clients` `{ "name", "scopes" }` — поле `key` только в этом ответе
- `GET /api/v1/admin/api-clients` — без секрета
- `POST /api/v1/admin/api-clients/:id/revoke`

## Сотрудник

ФИО не принимается и не хранится. Лишнее поле в теле даёт 422 `VALIDATION`.
Табельный номер — только в URL. В `user.extHash` пишется
`HMAC-SHA256(ключ = EXT_ID_PEPPER, сообщение = extId)` в hex.
Логин — `e` и первые 10 hex этого хеша. Позывной — 4 символа.

Повторный `PUT` с тем же `extId` обновляет роль, должность, грейд и бригаду
(`depotCode` + `brigadeCode`) и не меняет пароль. Пароль и флаг
`mustChangePassword` есть только при создании. В ответе всегда есть `userId`:
по нему LMS связывает события, потому что открытый `extId` из базы не возвращается.

`DELETE /api/integration/v1/employees/:extId` ставит `disabledAt` и отзывает
все `authSession` (та же ветка, что админское `disabled: true`). Повтор — 204
без второй записи аудита. Неизвестный `extId` — 404 `EMPLOYEE_NOT_FOUND`.
`ADMIN` и `METHODIST` — 403 `ROLE_ESCALATION`. `PUT` после отключения не
включает учётку и не меняет поля: 409 `EMPLOYEE_DISABLED`. Включить может
только администратор кабинета. Аудит отключения: `user.updated`,
`actorType` `API_CLIENT`, `actorId` — id ключа.

```bash
curl -sS -X PUT "http://127.0.0.1:3000/api/integration/v1/employees/TAB-100" \
  -H "X-API-Key: vsm_<id>_<secret>" \
  -H "content-type: application/json" \
  -d '{"role":"CONDUCTOR","brigadeCode":"12","depotCode":"MSK","position":"Проводник","grade":"TRAINEE"}'
```

`GET .../progress` читает таблицы напрямую: позывной, грейд, компетенции,
счётчики рейсов, полученные ачивки, `lastRunAt`, последняя рекомендация на грейд.
`level` — `levelFor` от пожизненной суммы положительных `RUN`, `ACHIEVEMENT` и
`CHALLENGE` (сгоревшие тоже остаются). `points` — те же причины, но только ещё
не сгоревшие. `EXPIRE` и `ADJUST` в оба счёта не входят. Это те же функции, что
у кабинета.

`GET /api/integration/v1/org` — депо, бригады и число сотрудников с `disabledAt = null`.

## Вебхуки

Подписка: `{ "url", "events" }`. События: `run.recorded`, `achievement.granted`,
`promotion.recommended`. Секрет подписки показывается один раз и хранится у нас:
им подписывается исходящий `POST`. В production URL только `https`.

```bash
curl -sS -X POST "http://127.0.0.1:3000/api/integration/v1/webhooks" \
  -H "X-API-Key: vsm_<id>_<secret>" \
  -H "content-type: application/json" \
  -d '{"url":"https://lms.example/vsm","events":["run.recorded","achievement.granted"]}'
```

Раз в минуту уходят доставки со статусом `PENDING` и `nextAttemptAt <= now`.
Тело:

```json
{ "id": "<delivery>", "event": "run.recorded", "occurredAt": "<iso>", "data": {} }
```

`data` — `userId`, позывной и поля события (рейс, очки, код ачивки, грейды).
Без ФИО, без табельного, без `extHash`.

Заголовки: `X-VSM-Event`, `X-VSM-Delivery`, `X-VSM-Timestamp` (unix-секунды),
`X-VSM-Signature: sha256=<hex>`. Подпись — HMAC-SHA256 от строки
`timestamp + "." + сырое тело`, ключ — секрет подписки как UTF-8 строка.
Таймаут 5 с, редиректы не следуем. Неуспех сети, HTTP не 2xx и ошибка DNS
(временный резолв): пауза 30 с, 60 с, 120 с, … до 7-й попытки; восьмая переводит
доставку в `FAILED`. `url`, `https`, allowlist и SSRF — сразу `FAILED`, без
повтора. Повтор того же события для той же подписки новую доставку не создаёт.

SSRF режет loopback, link-local, unique-local, RFC1918, CGNAT, multicast,
`0.0.0.0/8`, `240.0.0.0/4`, документационные `192.0.0.0/24`, `192.0.2.0/24`,
`198.51.100.0/24`, `203.0.113.0/24`, бенчмарк `198.18.0.0/15`, 6to4 `2002::/16`.
NAT64 `64:ff9b::/96` и `64:ff9b:1::/48` не закрываются целиком: встроенный IPv4
проверяется тем же списком. Имена metadata и `*.localhost` тоже запрещены.

Слушаем `run.recorded`, а не сырой `run.completed`: к этому моменту очки уже
лежат в леджере. Подозрительный рейс приходит с `suspicious: true` и
`points: 0`. Если начальник снял флаг, по тому же `runId` придёт второе событие
с `suspicious: false` и очками — последнее по `occurredAt` и есть итог.

### Проверка подписи

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, timestamp, rawBody, header) {
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`,
  );
  const given = Buffer.from(header);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
```

`rawBody` — байты тела запроса до `JSON.parse`. Имеет смысл отбрасывать
timestamp старше нескольких минут.

Пароль новой учётной записи считает `UsersService.createUser()` (argon2id).
Позывной выдаёт `generateCallsign()` того же сервиса.
