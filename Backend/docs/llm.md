# Перефразы LLM

Модель меняет только формулировки узла и выборов. id, эффекты, `next` и вердикт
остаются в YAML. В игру попадает `APPROVED` из общего пула (`sessionId` пустой)
или живой вариант именно этой сессии.

`llm.autoApprove` из `content/rules.yaml` ставит `APPROVED` только если включён
судья смысла (`LLM_JUDGE`, по умолчанию `true`) и он подтвердил тот же смысл.
Без судьи строка остаётся `PENDING_REVIEW`, даже при `autoApprove: true`.

`LLM_PROVIDER=none` ничего не генерирует: сессия остаётся на тексте YAML.

Промпт и версия — `PROMPT_VERSION` в `src/llm/prompt.ts` (сейчас `2026-09-27.2`).
Сэмплинг из бенча 2026-09-27, пустые env берут эти дефолты: `LLM_TEMPERATURE=0.7`,
`LLM_TOP_P=0.8`, `LLM_TOP_K=20`, `max_tokens` 256. У OpenAI-совместимого запроса
ещё `reasoning_effort=none` и `chat_template_kwargs.enable_thinking=false`, иначе
Qwen3 уходит в thinking и ломает JSON.

## Выбор модели

Замер 2026-09-27, MacBook Air M4 (10 CPU, GPU 10 ядер, 16 ГБ). 10 узлов сценариев,
один и тот же промпт. Схема — strict JSON. Оценка 1–5 вручную, один проход.
Сырые ответы лежат в `/Users/airman66/llm-bench/results-bonsai.json` и
`results-qwen.json`. Повторного замера с двумя правилами про подмену действия
и должности не было: они добавлены в промпт после прогона.

| | Bonsai 2 27B PTQ1_0, ternary | Qwen3-8B Q4_K_M |
| --- | --- | --- |
| Файл | 5.95 ГБ, 1.75 bpw, форк PrismML | 4.7 ГБ, stock-совместимый GGUF |
| Metal, генерация | 6.8 tok/s, к концу около 5.4 | 19.0 tok/s, к концу 12–14 |
| Metal, промпт | 31 tok/s | 152 tok/s |
| CPU, 4 потока, `-ngl 0` | 2.83 tok/s, RSS 6.2 ГБ, ответ обрезан | не мерили |
| Время узла | среднее 20.2 с | около 6.4 с |
| JSON, id, длина ≤160 | 10/10 | 10/10 |
| Якоря ситуации | 35/52 (67%) | 47/52 (90%) |
| Оценка schema / без схемы | 2.7 / 3.2 | 3.6 / 3.9 |

Дрейф Bonsai, schema: «таблетка уже во рту» стало «пилка уже в рот»; «советовать
зевать» стало «предложить потоптаться»; «пьёт из фляги» стало «мужик в фляге»;
узел с кошкой скопировал три выбора дословно. Qwen3-8B держит якоря лучше, но
не идеально: schema на медицинском узле перенесла таблетку «уже в руку», на
створке — «держать, пока не закроется». На temperature 0.4 и 0.7 Qwen отдал один
и тот же текст (Jaccard 1.0). Автоаппрув без судьи нельзя ни там, ни там.

Локально на этом Mac — Qwen3-8B Q4_K_M или крупнее, если влезает в память.
На GPU-сервере имеет смысл модель больше 8B: у 8B мало разнообразия при 0.7.
Обычный VPS без GPU для live не подходит: даже Bonsai на P-ядрах M4 дал 2.83 tok/s,
на x86 будет медленнее. Облако в РФ — GigaChat (`LLM_PROVIDER=gigachat`).
Зарубежные API не используем.

Пул с ротацией и опция live защищают от заучивания формулировки, не от смысла
правильного действия. Порядок выборов на экране — `rng.fork('order:'+сценарий+узел+визит)`,
один и тот же при повторном GET и другой у другой сессии. Какая реплика достанется
сессии, выбирается отдельным fork из пула `APPROVED`. После `maxUses` строка
становится `RETIRED`, в очередь уходит refill. Комбинаторика пула (несколько
персон × несколько узлов × ротация) не даёт заучить одну фразу и позицию кнопки.
`mode: live` дополнительно пишет вариант с `sessionId` этой сессии: пока смена
не кончилась, его не берёт чужой `pick`. В общий пул он попадает только если
проверки пройдены и сессия уже не активна. Судья отсекает подмену действия,
порог `llm.maxSimilarity` — почти дословный повтор.

Локальный сервер, который слушал `:8081` на замере:

```
/Users/airman66/llm-bench/src/build/bin/llama-server \
  -m /Users/airman66/llm-bench/models/Qwen3-8B-Q4_K_M.gguf \
  --host 127.0.0.1 --port 8081 -ngl 99 -c 4096 -fa on --jinja \
  --reasoning off --reasoning-budget 0 -t 4 -np 1 \
  --temp 0.7 --top-k 20 --top-p 0.8 --min-p 0 --repeat-penalty 1.0 \
  --alias qwen3-8b
```

Клиент ходит в `POST /v1/chat/completions`, модель `qwen3-8b`. Ключ не нужен.
Bonsai 2 этим бинарником stock llama.cpp не запускается: нужен форк PrismML
и тип PTQ1_0. Для тренажёра он проиграл и по скорости, и по смыслу.

## Провайдеры

| `LLM_PROVIDER` | Куда ходит | Что ещё нужно |
| --- | --- | --- |
| `none` | никуда | — |
| `openai-compatible` | `{LLM_BASE_URL}/v1/chat/completions` | `LLM_MODEL`. База — origin без `/v1` |
| `gigachat` | OAuth и chat, адреса ниже | `GIGACHAT_AUTH_KEY`, `GIGACHAT_CA_FILE`, `LLM_MODEL` |

`LLM_API_KEY` необязателен: уходит как `Authorization: Bearer`, если задан.
`LLM_TIMEOUT_MS` по умолчанию 90 с. `LLM_CONCURRENCY` читается при старте
процесса, по умолчанию 2. `LLM_JUDGE=false` (также `off` / `0`) выключает
второй вызов.

OpenAI-совместимый запрос ставит `response_format.type = json_schema` и кладёт
схему в `json_schema.schema` (`strict: true`). Так отвечает `llama-server`.

### GigaChat

Источники (сверка 2026-09-27):

- Токен: [POST /api/v2/oauth](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token).
  `Authorization: Basic <ключ>`, заголовок `RqUID` (uuid), тело
  `scope=GIGACHAT_API_PERS|B2B|CORP`. `expires_at` в справке — unix ms.
  Старый обзор показывал секунды, код принимает оба.
- Ответ: [POST /chat/completions](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-chat)
  и [структурированный вывод](https://developers.sber.ru/docs/ru/gigachat/guides/structured-output).
  У GigaChat схема лежит рядом с `type`: `{ type: json_schema, schema, strict }`,
  не внутри `json_schema`, как у OpenAI. `top_k` и `reasoning_effort` туда не шлём.
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

BullMQ, очередь `llm-variants`, Redis из `REDIS_URL`.
Задача: `{ scenarioId, version, nodeId, persona, reason, sessionId? }`.
`reason`: `seed` (добить пул), `refill` (после ротации), `live`, `manual`.
В строке пула то же самое enum-ом: `SEED | REFILL | LIVE | MANUAL`, плюс
`sessionId` у живого варианта. Три попытки, exponential backoff 2 с.
Лимит воркера — 20 задач за 10 с. Приоритет BullMQ (меньше — раньше): live 1,
manual 5, seed/refill 10.

`SESSION_TEXT_REQUESTED` слушает `LlmSessionListener` и зовёт `enqueueLive`:
персона берётся из пункта события, не перебрасывается заново. `RUN_COMPLETED`,
abort и expire вызывают `releaseSession`: у `APPROVED` этой сессии `sessionId`
обнуляется, и вариант попадает в общий пул. `PENDING_REVIEW` и `REJECTED` остаются
привязанными. Если методист одобрил live-строку уже после конца сессии, привязка
снимается в тот же момент.

`VariantPoolService.ensurePool` на старте и каждые 10 минут. Для опубликованных
сценариев с `llm.enabled` на каждый узел с выборами держит не меньше
`rules.llm.poolTarget` строк `APPROVED` с пустым `sessionId`. Уже стоящие в
очереди задачи учитываются, чтобы cron не дублировал пачку.

Выдача в сессию одна: `sessions` зовёт `pick` и `markUsed`. `pick` берёт
`APPROVED` с `sessionId = null`, по желанию с персоной сессии, список
сортируется по id, выбирает переданный rng. `markUsed` делает `uses++`.
Когда `uses >= maxUses`, статус `RETIRED` и в очередь ставится `refill`.
Отдельного инкремента в `text-plan` нет.

Пока live-задача не готова, показ берёт пул (если слот уже выбран на создании)
или YAML. Готовый `APPROVED` с `sessionId` этой сессии пишется в
`textPlan[scenarioId:nodeId]` и помечается показанным. Чужой «последний APPROVED
персоны» не подставляется. После этого текст не меняется.

В промпт генерации уходит до 5 уже лежащих формулировок узла с пометкой
«не повторяй». Сначала строки той же персоны, что у задачи, потом остальные.
Персона в тексте задания — персона этой задачи, воркер её не подменяет.

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
добавила бы факт в узел, где якоря не было. Такой ответ не пишется в пул,
счётчик `llm:rejected`, текст — в список `llm:errors` (20 последних).
Задача не ретраится: повтор с той же температурой не чинит смысл.
Сетевая ошибка ретраится.

## Судья и сходство

После валидатора, если `LLM_JUDGE` не выключен, тот же провайдер вызывается
второй раз. Температура этого вызова 0. На вход — исходные тексты ситуации и
каждого выбора и перефраз. На выход JSON по схеме `scenario_text_judge`:

```json
{"situation":{"same":true,"reason":"..."},"choices":[{"id":"...","same":true,"reason":"..."}]}
```

Хотя бы один `same: false` — строка сохраняется как `REJECTED`, причина в
`rejectReason`. Кривой JSON судьи тоже `REJECTED`, без ретрая. Сетевая ошибка
судьи ретраит всю задачу.

Отдельно Jaccard по нормализованным словам (регистр, `ё`, пунктуация сняты).
Сравнивается связка «ситуация + выборы» с исходником и с каждым уже лежащим
вариантом узла. Порог `llm.maxSimilarity` (0.75). Строже порога — `REJECTED`
с `rejectReason`, до судьи дело не доходит. Ровно 0.75 ещё проходит.

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
