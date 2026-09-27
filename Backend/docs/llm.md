# Перефразы LLM

Модель меняет только формулировки узла и выборов. id, эффекты, `next` и вердикт
остаются в YAML. В игру попадает `APPROVED`. Если в `content/rules.yaml` стоит
`llm.autoApprove: true`, валидный ответ сразу `APPROVED`.

`LLM_PROVIDER=none` ничего не генерирует: сессия остаётся на тексте YAML.

Отчёта `llm-bench.md` на момент сборки не было. Промпт, температура `0.8` и
`max_tokens` `320` заданы в `src/llm/prompt.ts`, версия `PROMPT_VERSION`
(`2026-09-27.1`). Когда появится бенч, сверять инструкцию с ним и поднимать
версию.

## Провайдеры

| `LLM_PROVIDER` | Куда ходит | Что ещё нужно |
| --- | --- | --- |
| `none` | никуда | — |
| `openai-compatible` | `{LLM_BASE_URL}/v1/chat/completions` | `LLM_MODEL`. База — origin без `/v1` |
| `gigachat` | OAuth и chat, адреса ниже | `GIGACHAT_AUTH_KEY`, `GIGACHAT_CA_FILE`, `LLM_MODEL` |

`LLM_API_KEY` необязателен: уходит как `Authorization: Bearer`, если задан.
`LLM_TIMEOUT_MS` по умолчанию 90 с (локальная модель ~6 ток/с). `LLM_CONCURRENCY`
читается при старте процесса, по умолчанию 2.

OpenAI-совместимый запрос ставит `response_format.type = json_schema` и кладёт
схему в `json_schema.schema` (`strict: true`). Так отвечает llama.cpp
`llama-server` (проверено на `bonsai-2-27b`, `127.0.0.1:8081`).

### GigaChat

Источники (сверка 2026-09-27):

- Токен: [POST /api/v2/oauth](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token).
  `Authorization: Basic <ключ>`, заголовок `RqUID` (uuid), тело
  `scope=GIGACHAT_API_PERS|B2B|CORP`. `expires_at` в справке — unix ms.
  Старый обзор показывал секунды, код принимает оба.
- Ответ: [POST /chat/completions](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-chat)
  и [структурированный вывод](https://developers.sber.ru/docs/ru/gigachat/guides/structured-output).
  У GigaChat схема лежит рядом с `type`: `{ type: json_schema, schema, strict }`,
  не внутри `json_schema`, как у OpenAI.
- Сертификат НУЦ Минцифры: [certificates](https://developers.sber.ru/docs/ru/gigachat/certificates).
  Файл `https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt`
  кладётся в `GIGACHAT_CA_FILE`. TLS идёт через `undici` `Agent({ connect: { ca } })`,
  не через отключение проверки.
- С 17 июля 2026 целевой хост API — `https://api.giga.chat`
  ([обзор REST](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api)).
  OAuth в той же справке остаётся `https://ngw.devices.sberbank.ru:9443/api/v2/oauth`.
  Chat в этом модуле — `https://gigachat.devices.sberbank.ru/api/v1/chat/completions`:
  так зафиксирован приказ. Если хост переедет, менять константы
  `GIGACHAT_OAUTH_URL` и `GIGACHAT_CHAT_URL`.

Токен живёт ~30 минут. В Redis он лежит как `llm:gigachat:token:<scope>`
до `expires_at − 60 с`. Ключ авторизации — уже Base64, второй раз не кодируется.

## Очередь и пул

BullMQ, очередь `llm-variants`, Redis из `REDIS_URL` (это worktree — DB 15).
Задача: `{ scenarioId, version, nodeId, persona, reason, sessionId? }`.
`reason`: `seed` (добить пул), `refill` (после ротации), `live`, `manual`.
Три попытки, exponential backoff 2 с. Лимит воркера — 20 задач за 10 с.
Приоритет BullMQ (меньше — раньше): live 1, manual 5, seed/refill 10.

`VariantPoolService.ensurePool` на старте и каждые 10 минут. Для опубликованных
сценариев с `llm.enabled` на каждый узел с выборами держит не меньше
`rules.llm.poolTarget` строк `APPROVED`. Уже стоящие в очереди задачи
учитываются, чтобы cron не дублировал пачку.

`pick(scenarioId, version, nodeId, rng)` возвращает один `APPROVED` или `null`.
Порядок строк фиксирован по id, выбирает переданный rng. `markUsed(ids)` делает
`uses++`. Когда `uses >= maxUses` (`rules.llm.maxUses`), статус `RETIRED` и в
очередь ставится `refill`.

`enqueueLive(sessionId, nodes, persona)` ставит задачи сессии. Пока их нет,
показ берёт пул или YAML. Готовый вариант пишется в `textPlan[nodeId]`, если
узел ещё не текущий и не в журнале: после показа текст не меняется.

## Валидатор

`validateVariant` — чистая функция. Отклоняет ответ, если:

- это не JSON нужной формы или набор id выборов другой;
- любой текст пустой или длиннее 160 символов;
- ситуация или выбор дословно совпали с исходником;
- якорь из `keep` не нашёлся (регистр, `ё`, одна флексия);
- появилась цифра, которой не было в исходнике;
- появилось слово из словарей лекарств, имён или новых фактов
  (`src/llm/dictionaries.ts`), если той же основы не было в исходнике;
- есть латиница;
- два выбора совпали или собраны из тех же основ.

Якорь обязателен только если он уже есть в тексте этого узла. Иначе модель
добавила бы факт в узел, где якоря не было. Непрошедший ответ не пишется в
пул, счётчик `llm:rejected`, текст — в список `llm:errors` (20 последних).
Такая задача не ретраится: повтор с той же температурой не чинит смысл.
Сетевая ошибка ретраится.

## Ручки

Роли `METHODIST` и `ADMIN`.

| Метод | Путь | Тело |
| --- | --- | --- |
| GET | `/api/v1/admin/scenarios/:id/variants` | query `status`, `nodeId` |
| POST | `/api/v1/admin/scenarios/:id/variants/:variantId/approve` | — |
| POST | `/api/v1/admin/scenarios/:id/variants/:variantId/reject` | `{ reason }` |
| POST | `/api/v1/admin/scenarios/:id/variants/generate` | `{ nodeId?, count? }`, count 1..20 |
| GET | `/api/v1/admin/llm/status` | провайдер, модель, очередь, пул, ошибки |

Повторное approve/reject уже разобранного варианта — 409 `CONFLICT`.
`none` и сценарий без `llm.enabled` на generate — 409 `LLM_DISABLED`.

Сценарии с пулом: `ride-pressure`, `ride-unwell`, `ride-one-seat`.
