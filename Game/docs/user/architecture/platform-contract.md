# Контракт Game Server ↔ Platform Server

**Версия документа:** 0.2.0  
**Статус:** Draft  
**Дата редакции:** 2026-09-27

## 1. Назначение

Game Server обслуживает игровую попытку и не реализует меню, профиль, постоянную авторизацию или пользовательскую историю.

Platform Server отвечает за внешний lifecycle попытки: пользовательскую авторизацию, выдачу ключа запуска, назначение игрового уровня, хранение результата и страницу результата.

Интеграция намеренно минимальна. Для baseline обязательны два доменных вызова:

```text
resolveSession(key)
finishSession(result)
```

HTTP endpoints являются адаптером над этими операциями и не должны протекать в simulation core.

## 2. Термины

`SessionKey` — короткоживущий ключ запуска, который browser передаёт Game Server при подключении.

`AttemptId` — постоянный идентификатор игровой попытки на Platform Server.

`GameLevelId` — внешний идентификатор задания/уровня. Конкретная конфигурация этого уровня находится на Game Server и разрешается локально. Внутри она может ссылаться на отдельные `LevelDefinition`, `ScenarioDefinition`, action/trait/content assets.

`GameResult` — доменный итог завершённой попытки, формируемый Game Server.

## 3. Service authentication

Game Server обращается к Platform Server как доверенный service client.

Deployment передаёт как минимум:

```text
PLATFORM_API_URL
PLATFORM_SERVICE_TOKEN
```

Конкретный механизм может позднее быть заменён на mTLS или другой service-to-service auth, но пользовательский `SessionKey` не заменяет аутентификацию самого Game Server.

В локальной разработке при отсутствии platform configuration используется `MockPlatformGateway`.

## 4. Domain gateway

Рекомендуемая граница в game-server коде:

```ts
interface PlatformGateway {
  resolveSession(key: string): Promise<ResolvedGameSession>;
  finishSession(result: FinishedGameResult): Promise<FinishReceipt>;
}
```

Simulation engine не импортирует `PlatformGateway`.

## 5. resolveSession

Game Client открывает WebSocket и передаёт `SessionKey` в handshake/hello. Game Server вызывает Platform Server и либо получает разрешённую попытку, либо отклоняет соединение.

Доменный ответ:

```ts
interface ResolvedGameSession {
  attemptId: string;
  gameLevelId: string;
  mode: SessionModeConfig;
}
```

Platform Server не обязан передавать полный game config. `gameLevelId` разрешается Game Server через локальный content registry.

### Live session

```ts
interface LiveModeConfig {
  kind: "live";
}
```

### Guided session

```ts
interface GuidedModeConfig {
  kind: "guided";
  hints: HintPolicy;
}
```

### Replay session

Replay launch может содержать данные ранее завершённой попытки, которые Platform Server уже хранит:

```ts
interface ReplayModeConfig {
  kind: "replay";
  source: ReplaySource;
  reveal: ReplayRevealPolicy;
}
```

`SessionModeConfig`, `ReplaySource`, `ReplayRevealPolicy` и `HintPolicy` подробно описаны в `architecture/session-modes.md`.

## 6. Пример HTTP adapter для resolve

Baseline-вариант:

```http
POST /api/game/sessions/resolve
Authorization: Bearer <platform-service-token>
Content-Type: application/json
```

```json
{
  "key": "opaque-session-key"
}
```

Пример live response:

```json
{
  "contractVersion": 1,
  "attemptId": "attempt-123",
  "gameLevelId": "vsm-baseline-01",
  "mode": {
    "kind": "live"
  }
}
```

Некорректный, просроченный или уже недопустимый key приводит к отказу запуска.

HTTP adapter обязан сохранять смысл platform response и не маскировать service/infrastructure errors под ошибку пользовательского key. Для contract v1 используется следующая семантика:

- `404`/`410` на `resolveSession` → invalid/expired session key;
- `409` на `resolveSession` → attempt/session существует, но сейчас недоступен для запуска;
- `401`/`403` → ошибка service credential/permission Game Server, а не invalid user session;
- `5xx`/network error → temporary platform unavailability;
- malformed success DTO → contract error.

Для `finishSession` `409` означает конфликт terminal result и рассматривается как contract/integrity error; `404` означает, что ранее разрешённый attempt больше недоступен на Platform.

## 7. Кто создаёт seed

Для обычной live/guided попытки root seed создаёт Game Server после успешного `resolveSession`.

Platform Server получает seed только при финализации результата.

Если позднее понадобится фиксированный seed для стандартизированного задания, `ResolvedGameSession` может получить явную seed policy. Это не требуется baseline.

Replay получает сохранённый seed из `ReplaySource`.

## 8. Что считается user event log

Для воспроизведения хранится последовательность пользовательских команд, которым Game Server назначил authoritative simulation timestamp/order.

```ts
interface RecordedUserInput {
  at: SimTimeUs;
  order: number;
  command: RecordedGameplayCommand;
}
```

В log входят gameplay-affecting inputs, необходимые для replay и анализа. UI-only события browser, движения мыши и локальные клики без игровой семантики не сохраняются.

Если попытка выполнить недопустимое действие сама по себе имеет обучающую/оценочную семантику, она должна быть представлена стабильной gameplay command/event, а не теряться как транспортная ошибка.

Replay controls (`seek`, `pause`, `inspect replay entity`) не входят в original user event log.

## 9. FinishedGameResult

Domain object финального результата отделён от HTTP DTO:

```ts
interface FinishedGameResult {
  attemptId: string;

  content: {
    gameLevelId: string;
    gameLevelVersion: string;
    simulationCompatibilityVersion: string;
  };

  rootSeed: string;
  userInputs: RecordedUserInput[];

  achievements: {
    setVersion: string;
    ids: string[];
  };

  termination: {
    kind: "route-completed" | "terminal-rule";
    outcomeId: string;
  };

  scores: {
    safety: number;               // 0..100
    customerSatisfaction: number; // 0..100
  };
}
```

`termination` фиксирует фактический способ завершения попытки, но не заменяет оценку. Например `terminal-rule/emergency-brake-used` может соответствовать корректному безопасному решению и высокому `safety`.

`rootSeed` сериализуется как opaque string, чтобы формат не зависел от диапазона JSON number.

Если локальный `gameLevelId` разрешается в несколько versioned content assets, Game Server обязан записать достаточную content version информацию для будущего deterministic replay. Поле `gameLevelVersion` может позднее быть заменено/расширено structured content manifest без изменения Simulation API.

## 10. finishSession является терминальной операцией

Успешная запись результата означает, что попытка завершена на Platform Server.

Game Server не должен после успешного `finishSession` принимать новые gameplay commands для этого `attemptId`.

Рекомендуемый lifecycle:

```text
simulation terminal state
        ↓
build FinishedGameResult
        ↓
finishing
        ↓
PlatformGateway.finishSession(...)
        ↓ success
finished
        ↓
send client result redirect
```

До подтверждения Platform Server worker находится в `finishing`, а не в окончательном `finished`.

## 11. Идемпотентность финализации

`finishSession` обязан быть идемпотентным по `attemptId`.

Повторная передача того же terminal result из-за сетевого retry возвращает тот же `FinishReceipt`, а не создаёт второй результат.

Попытка повторно завершить тот же `attemptId` несовместимым payload должна возвращать conflict/error и не перезаписывать уже принятый результат молча.

Это необходимо, потому что Game Server не может считать HTTP timeout доказательством того, что Platform Server не сохранил предыдущий запрос.

## 12. FinishReceipt и redirect

Domain response:

```ts
interface FinishReceipt {
  resultId: string;
  redirectUrl: string;
}
```

После получения receipt Game Server отправляет Client терминальное presentation message с разрешённым redirect URL.

Client выполняет переход на страницу результата Platform Server.

Game Client не конструирует URL результата из `attemptId` самостоятельно: redirect является частью подтверждённого platform response.

## 13. Пример HTTP adapter для finish

```http
POST /api/game/sessions/{attemptId}/finish
Authorization: Bearer <platform-service-token>
Content-Type: application/json
```

Body является transport representation `FinishedGameResult`.

Пример response:

```json
{
  "contractVersion": 1,
  "resultId": "result-456",
  "redirectUrl": "https://platform.example/results/result-456"
}
```

## 14. Версионирование контракта

Platform contract имеет собственную `contractVersion` и не обязан совпадать с:

- simulation compatibility version;
- WebSocket protocol version;
- document version;
- application release version.

Adapter должен отклонять несовместимую major contract version явно.

## 15. Что не входит в baseline contract

Baseline не требует отдельных endpoints для:

- меню;
- списка уровней;
- профиля пользователя;
- leaderboard;
- achievement catalog;
- истории попыток;
- загрузки game config;
- polling текущего состояния run.

Эти функции принадлежат Platform UI/API и не нужны Game Server для одной игровой сессии.

## 16. Эксплуатационные вопросы, которые пока не фиксируются

### Aborted attempts

Platform, вероятно, потребуется знать о попытке, окончательно прерванной после reconnect grace. Это можно добавить как terminal variant (`completed | aborted`) либо отдельную operation. Baseline result contract пока описывает успешное завершение.

### Crash durability

Идемпотентный retry защищает от сетевых ошибок, но не от падения всего Game Server до отправки результата. Для production может потребоваться durable outbox/checkpoint или иной recovery mechanism. Это эксплуатационное решение не требуется для первой реализации simulation.
